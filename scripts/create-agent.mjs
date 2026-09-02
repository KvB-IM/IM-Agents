#!/usr/bin/env node
/**
 * Create or update a field agent account.
 *
 * There is no self-service registration by design — an account here is a key to
 * client PII including SSNs — so accounts start life either through an admin
 * invitation (db/001_agents.sql, not yet built) or through this script.
 *
 *   npm run create-agent -- --email dana@example.com --zoho-name "Dana Ruiz"
 *
 * The password is read from a prompt with echo off, never from an argument:
 * anything on a command line lands in shell history and in the process list,
 * where every other user on the machine can read it.
 */

import { createInterface } from "node:readline";
import { randomBytes, scrypt as scryptCb } from "node:crypto";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const scrypt = promisify(scryptCb);

/* Mirrors src/lib/password.ts. Duplicated deliberately: this is a plain .mjs
 * script so it runs with no build step, and importing a TypeScript module that
 * pulls in `server-only` would not load here. If the parameters below change,
 * change them in both places — the format is self-describing, so old hashes
 * keep verifying either way. */
const N = 1 << 15;
const R = 8;
const P = 1;
const MAXMEM = 128 * N * R * 2;

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password.normalize("NFKC"), salt, 32, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  });
  return ["scrypt", N, R, P, salt.toString("base64url"), derived.toString("base64url")].join("$");
}

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Read .env.local without a dependency — this script runs outside Next. */
function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    try {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (!m) continue;
        const [, key, rawValue] = m;
        if (process.env[key]) continue;
        process.env[key] = rawValue.replace(/^["']|["']$/g, "");
      }
    } catch {
      /* file absent is fine */
    }
  }
}

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Suppress echo by swallowing the output writes while the answer is typed.
    const onData = (char) => {
      if (char === "\n" || char === "\r" || char === "") return;
      rl.output.write("[2K[200D" + question + "*".repeat(rl.line.length));
    };
    rl.output.write(question);
    rl.input.on("data", onData);
    rl.question("", (answer) => {
      rl.input.off("data", onData);
      rl.output.write("\n");
      rl.close();
      resolve(answer);
    });
  });
}


/* Same variable names lib/db.ts accepts, so the dashboard's injected
 * variable works without being renamed by hand. */
function connectionString() {
  for (const name of ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL"]) {
    const value = process.env[name];
    if (value && value.trim() !== "") return value;
  }
  return null;
}

async function main() {
  loadEnvLocal();

  const email = arg("email");
  const zohoName = arg("zoho-name");
  const agency = arg("agency") ?? "Insurance Masters";
  const regionalManager = arg("regional-manager");
  const subAgent = arg("sub-agent");
  /* Admins may connect the CRM and administer accounts. Deliberately a flag on
   * this script rather than anything in the UI: there is no way to grant
   * yourself admin from inside the app, which is what you want for a
   * capability that repoints the whole portal at a Zoho org. */
  const isAdmin = process.argv.includes("--admin");

  if (!email || !zohoName) {
    console.error(
      "Usage: npm run create-agent -- --email <email> --zoho-name <name in Zoho's Agent picklist>\n" +
        "             [--agency <agency>] [--regional-manager <name>] [--sub-agent <name>]\n" +
        "             [--admin]   may connect the CRM and administer accounts",
    );
    process.exit(1);
  }

  const url = connectionString();
  if (!url) {
    console.error(
      "No database connection string. Set DATABASE_URL in .env, or export it.\n" +
        "Vercel's storage integrations may inject POSTGRES_URL or DATABASE_URL_UNPOOLED\n" +
        "instead, and those are accepted too.",
    );
    process.exit(1);
  }

  console.log(`\nAccount:      ${email}`);
  console.log(`Zoho agent:   ${zohoName}`);
  console.log(`Agency:       ${agency}`);
  console.log(`Admin:        ${isAdmin ? "yes — may connect the CRM" : "no"}`);
  console.log(
    "\n⚠  The Zoho agent name must match this agent's entry in Zoho's `Agent`\n" +
      "   global picklist EXACTLY. Zoho silently drops a value that is not on the\n" +
      "   picklist, so a misspelling here means the agent files forms attributed to\n" +
      "   nobody and then sees an empty pipeline. Check it before continuing.\n",
  );

  const password = await promptHidden("Password (min 12 chars): ");
  if (password.length < 12) {
    console.error("\nToo short — at least 12 characters.");
    process.exit(1);
  }
  const again = await promptHidden("Again: ");
  if (password !== again) {
    console.error("\nThose did not match.");
    process.exit(1);
  }

  const sql = neon(url);
  const passwordHash = await hashPassword(password);

  // Upsert on email so re-running this resets a password rather than failing on
  // the unique index — which is what you want at 9pm when an agent is locked
  // out and there is no reset flow yet.
  const rows = await sql`
    insert into agents (email, zoho_agent_name, agency, sub_agent, regional_manager,
                        status, password_hash, is_admin)
    values (${email}, ${zohoName}, ${agency}, ${subAgent ?? null},
            ${regionalManager ?? null}, 'active', ${passwordHash}, ${isAdmin})
    on conflict (lower(email)) do update
       set zoho_agent_name  = excluded.zoho_agent_name,
           agency           = excluded.agency,
           sub_agent        = excluded.sub_agent,
           regional_manager = excluded.regional_manager,
           status           = 'active',
           password_hash    = excluded.password_hash,
           -- Only ever grants, never revokes: re-running this to reset a
           -- password must not silently strip someone's admin rights.
           is_admin         = agents.is_admin or excluded.is_admin,
           updated_at       = now()
    returning id, email, zoho_agent_name, status, is_admin
  `;

  const agent = rows[0];
  console.log(
    `\n✓ ${agent.email} is ${agent.status}${agent.is_admin ? " and an admin" : ""} (${agent.id})`,
  );

  // Any existing session belongs to whoever knew the old password.
  const revoked = await sql`
    update agent_sessions set revoked_at = now()
     where agent_id = ${agent.id} and revoked_at is null
     returning id
  `;
  if (revoked.length) {
    console.log(`  Revoked ${revoked.length} existing session(s), since the password changed.`);
  }
  await sql`delete from login_attempts where email = ${email.toLowerCase()}`;
  console.log("  Cleared any login throttle for this email.\n");
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
