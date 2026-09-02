#!/usr/bin/env node
/**
 * Apply db/*.sql in order.
 *
 * Deliberately minimal — a tracking table and a loop, no migration framework.
 * The whole schema is five files that only ever get appended to, and a
 * dependency whose job is to run five files in alphabetical order is a
 * dependency to keep patched for no gain.
 *
 *   npm run migrate          apply anything not yet applied
 *   npm run migrate -- --dry show what would run
 */

import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

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
      /* absent is fine */
    }
  }
}

async function main() {
  loadEnvLocal();
  const dry = process.argv.includes("--dry");

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Put it in .env.local, or export it.");
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);

  await sql`
    create table if not exists schema_migrations (
      filename   text        primary key,
      sha256     text        not null,
      applied_at timestamptz not null default now()
    )
  `;

  const applied = new Map(
    (await sql`select filename, sha256 from schema_migrations`).map((r) => [
      r.filename,
      r.sha256,
    ]),
  );

  const files = readdirSync("db").filter((f) => f.endsWith(".sql")).sort();
  let ran = 0;

  for (const file of files) {
    const body = readFileSync(join("db", file), "utf8");
    const sha = createHash("sha256").update(body).digest("hex");

    const previous = applied.get(file);
    if (previous === sha) continue;

    if (previous && previous !== sha) {
      // A file that has already run and then changed. Editing an applied
      // migration means two databases can silently diverge, so this stops
      // rather than guessing.
      console.error(
        `\n✖ ${file} has already been applied but its contents have changed.\n` +
          `  Add a new numbered file instead of editing one that has run.\n` +
          `  If the change is genuinely cosmetic, update the recorded hash by hand.`,
      );
      process.exit(1);
    }

    if (dry) {
      console.log(`would apply ${file}`);
      ran++;
      continue;
    }

    process.stdout.write(`applying ${file} … `);
    // Each file is one statement batch. The DDL here is all `if not exists`,
    // so re-running a partially applied file is safe — which matters more than
    // wrapping it in a transaction the HTTP driver cannot hold open.
    await sql.query(body);
    await sql`
      insert into schema_migrations (filename, sha256) values (${file}, ${sha})
      on conflict (filename) do update set sha256 = excluded.sha256, applied_at = now()
    `;
    console.log("ok");
    ran++;
  }

  console.log(
    ran === 0
      ? "Nothing to apply — schema is up to date."
      : dry
        ? `${ran} file(s) would be applied.`
        : `Applied ${ran} file(s).`,
  );
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
