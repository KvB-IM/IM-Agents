import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { dbConfigured } from "@/lib/db";
import { agentFromSession } from "@/lib/auth";
import LoginForm from "@/components/LoginForm";
import { safeNext } from "@/lib/safeNext";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign in — IM Agent Portal" };

/**
 * Sign-in.
 *
 * Its own route group, outside (app), so it has no tab bar and no header
 * chrome: there is nothing to navigate to until you are in.
 *
 * With no DATABASE_URL the app has no accounts to check against and falls back
 * to the stubbed agent, so this screen says so plainly rather than presenting a
 * form that cannot work. A login box that silently accepts nothing is worse
 * than an honest message.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; signedOut?: string }>;
}) {
  const { next, signedOut } = await searchParams;

  if (!dbConfigured()) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
        <Brand />
        <div className="mt-6 rounded-2xl bg-white p-5 ring-1 ring-line">
          <h1 className="text-[17px] font-semibold text-navy-900">Accounts are not set up</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            This deployment has no database configured, so there are no agent accounts to sign in
            to. It is running on fixture data with a stubbed identity.
          </p>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            Set <code className="rounded bg-navy-50 px-1 py-0.5 font-mono text-[11px]">DATABASE_URL</code>{" "}
            and apply <code className="rounded bg-navy-50 px-1 py-0.5 font-mono text-[11px]">db/*.sql</code>,
            then create the first agent with{" "}
            <code className="rounded bg-navy-50 px-1 py-0.5 font-mono text-[11px]">npm run create-agent</code>.
          </p>
        </div>
      </main>
    );
  }

  // Already signed in: nothing to do here. agentFromSession swallows database
  // errors and returns null, so an outage shows the form rather than a stack
  // trace — the POST is where the agent finds out sign-in is unavailable.
  const existing = await agentFromSession();
  if (existing) redirect(safeNext(next));

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-10">
      <Brand />
      <LoginForm next={safeNext(next)} signedOut={signedOut === "1"} />
      <p className="mt-6 text-center text-[12px] leading-relaxed text-muted">
        Trouble signing in? Call the office — accounts are created and reset there, not here.
      </p>
    </main>
  );
}

function Brand() {
  return (
    <div className="text-center">
      <ShieldCheck size={30} className="mx-auto text-gold-500" aria-hidden />
      <h1 className="mt-2 text-[20px] font-bold tracking-tight text-navy-900">
        Insurance Masters
      </h1>
      <p className="text-[13px] text-muted">Agent portal</p>
    </div>
  );
}
