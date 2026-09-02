"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, LogIn, Eye, EyeOff, Check } from "lucide-react";
import { Field, TextInput, Button } from "./ui";

/**
 * The sign-in form.
 *
 * Mobile-first like the rest of the app: 16px inputs so iOS does not zoom the
 * viewport, 44px targets, and the correct `autoComplete` values so a password
 * manager fills it — an agent standing on a porch will not type a 12-character
 * passphrase by hand twice.
 *
 * `email` uses inputMode="email" and autoCapitalize="off", because an iPad
 * capitalises the first letter of a text field by default and "Dana@..." is a
 * failed login that looks like a wrong password.
 */
export default function LoginForm({ next, signedOut }: { next: string; signedOut: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, next }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; next?: string };

      if (!res.ok || !data.ok) {
        setError(data.error ?? "Could not sign in.");
        setPassword("");
        return;
      }

      // Full navigation rather than router.push: every protected page is a
      // server component that reads the session cookie, so the new cookie has
      // to be in play before they render.
      window.location.assign(data.next ?? next);
    } catch {
      setError("No connection. Sign-in needs signal.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3">
      {signedOut ? (
        <p className="flex items-center gap-2 rounded-xl bg-success/5 px-3 py-2.5 text-[13px] text-success ring-1 ring-success/20">
          <Check size={15} className="shrink-0" aria-hidden />
          You are signed out.
        </p>
      ) : null}

      <div className="rounded-2xl bg-white p-4 ring-1 ring-line">
        <Field label="Email">
          <TextInput
            type="email"
            name="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            inputMode="email"
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="username"
            spellCheck={false}
            required
            autoFocus
          />
        </Field>

        <div className="mt-3">
          <Field label="Password">
            <div className="relative">
              <TextInput
                type={reveal ? "text" : "password"}
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="pr-12"
              />
              {/* Reveal, because a long passphrase typed blind on a touch
                  keyboard is the commonest reason a real password "fails". */}
              <button
                type="button"
                onClick={() => setReveal((v) => !v)}
                aria-label={reveal ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted active:text-navy-700"
              >
                {reveal ? <EyeOff size={18} aria-hidden /> : <Eye size={18} aria-hidden />}
              </button>
            </div>
          </Field>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-error/5 px-3 py-2.5 text-[13px] text-error ring-1 ring-error/15"
        >
          <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <Button type="submit" disabled={busy || !email || !password}>
        <LogIn size={17} aria-hidden />
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
