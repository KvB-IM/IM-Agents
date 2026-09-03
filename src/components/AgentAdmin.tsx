"use client";

import { useCallback, useEffect, useState } from "react";
import {
  UserPlus, KeyRound, Ban, Check, ShieldCheck, Copy, AlertCircle, RefreshCw,
} from "lucide-react";
import { Card, CardHeader, Field, TextInput, Button, Badge, Toggle } from "./ui";
import { shortDate } from "@/lib/format";

interface AdminAgent {
  id: string;
  email: string;
  zohoAgentName: string;
  agency: string;
  status: string;
  isAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  activeSessions: number;
  hasPassword: boolean;
}

/**
 * Create and disable agent accounts.
 *
 * Admin only, and the API re-checks that on every request — this component
 * hiding itself is presentation, not security.
 *
 * A generated first password is shown ONCE and never again. That is not an
 * inconvenience to design around: the hash is one-way, so "show it again" is
 * impossible by construction, and the alternative — storing something readable
 * — is the thing being avoided. The proper answer is the invitation flow the
 * schema already supports, where the agent sets their own password and the
 * admin never knows it; that needs email.
 */
export default function AgentAdmin() {
  const [agents, setAgents] = useState<AdminAgent[] | null>(null);
  const [me, setMe] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [email, setEmail] = useState("");
  const [zohoName, setZohoName] = useState("");
  const [makeAdmin, setMakeAdmin] = useState(false);

  /** The one-time password, and who it belongs to. */
  const [reveal, setReveal] = useState<{ email: string; password: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/agents");
      const data = (await res.json()) as { agents?: AdminAgent[]; me?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not load accounts.");
        return;
      }
      setAgents(data.agents ?? []);
      setMe(data.me ?? "");
    } catch {
      setError("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(agentId: string, action: string, value?: boolean) {
    setError(null);
    setBusy(agentId + action);
    try {
      const res = await fetch("/api/admin/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId, action, value }),
      });
      const data = (await res.json()) as { error?: string; password?: string };
      if (!res.ok) {
        setError(data.error ?? "That did not work.");
        return;
      }
      if (data.password) {
        const who = agents?.find((a) => a.id === agentId)?.email ?? "";
        setReveal({ email: who, password: data.password });
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy("create");
    try {
      const res = await fetch("/api/admin/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, zohoAgentName: zohoName, isAdmin: makeAdmin }),
      });
      const data = (await res.json()) as { error?: string; password?: string };
      if (!res.ok) {
        setError(data.error ?? "Could not create that account.");
        return;
      }
      setReveal({ email, password: data.password ?? "" });
      setEmail("");
      setZohoName("");
      setMakeAdmin(false);
      setShowCreate(false);
      await load();
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Agent accounts"
        hint="Admins only. Disabling an account ends its sessions immediately."
      />

      <div className="space-y-3 px-4 pb-4">
        {error ? (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-error/5 px-3 py-2.5 text-[13px] text-error ring-1 ring-error/15"
          >
            <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden />
            {error}
          </p>
        ) : null}

        {/* The one-time password. Deliberately loud and deliberately not
            dismissable by accident — once it is gone the only way back is a
            reset, which invalidates whatever the agent was already told. */}
        {reveal ? (
          <div className="rounded-xl bg-gold-100 p-3.5 ring-1 ring-gold-500/40">
            <p className="text-[12px] font-semibold uppercase tracking-wide text-gold-600">
              Password for {reveal.email}
            </p>
            <p className="mt-1.5 break-all font-mono text-[16px] font-semibold text-navy-900">
              {reveal.password}
            </p>
            <p className="mt-2 text-[12px] leading-snug text-navy-800">
              Shown once. Pass it on now — it is stored only as a hash, so it cannot be
              retrieved, only reset.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(reveal.password)}
                className="tap inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white px-3 text-[13px] font-semibold text-navy-900 ring-1 ring-gold-500/40"
              >
                <Copy size={14} aria-hidden /> Copy
              </button>
              <button
                type="button"
                onClick={() => setReveal(null)}
                className="tap inline-flex flex-1 items-center justify-center rounded-lg bg-navy-900 px-3 text-[13px] font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Create ───────────────────────────────────────────────────── */}
        {showCreate ? (
          <form onSubmit={create} className="space-y-3 rounded-xl bg-navy-50 p-3 ring-1 ring-navy-100">
            <Field label="Email">
              <TextInput
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                inputMode="email"
                autoCapitalize="off"
                autoComplete="off"
                required
              />
            </Field>
            <Field
              label="Zoho agent name"
              hint="Must match their entry in Zoho's Agent picklist exactly, or their submissions read empty."
            >
              <TextInput
                value={zohoName}
                onChange={(e) => setZohoName(e.target.value)}
                autoComplete="off"
                required
              />
            </Field>
            <Field label="Can administer accounts and the CRM connection">
              <Toggle value={makeAdmin} onChange={setMakeAdmin} />
            </Field>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowCreate(false)}
                className="!w-auto flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy === "create" || !email || !zohoName}
                className="!w-auto flex-[2]"
              >
                {busy === "create" ? "Creating…" : "Create account"}
              </Button>
            </div>
          </form>
        ) : (
          <Button variant="secondary" onClick={() => setShowCreate(true)}>
            <UserPlus size={16} aria-hidden /> Add an agent
          </Button>
        )}

        {/* ── The list ─────────────────────────────────────────────────── */}
        {agents === null ? (
          <p className="py-3 text-[13px] text-muted">Loading accounts…</p>
        ) : agents.length === 0 ? (
          <p className="py-3 text-[13px] text-muted">No accounts yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {agents.map((a) => (
              <li key={a.id} className="py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-semibold text-navy-900">{a.email}</p>
                    <p className="mt-0.5 text-[12px] text-muted">
                      {a.zohoAgentName} · {a.agency}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge tone={a.status === "active" ? "live" : "closed"}>{a.status}</Badge>
                    {a.isAdmin ? (
                      <Badge tone="gold">
                        <ShieldCheck size={11} aria-hidden /> admin
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <p className="mt-1.5 text-[11px] text-muted">
                  {a.lastLoginAt ? `Last signed in ${shortDate(a.lastLoginAt)}` : "Never signed in"}
                  {a.activeSessions > 0
                    ? ` · ${a.activeSessions} active session${a.activeSessions === 1 ? "" : "s"}`
                    : ""}
                  {a.id === me ? " · you" : ""}
                </p>

                <div className="mt-2 flex flex-wrap gap-2">
                  <SmallButton
                    onClick={() => act(a.id, "reset")}
                    busy={busy === a.id + "reset"}
                    icon={<KeyRound size={13} aria-hidden />}
                    label="Reset password"
                  />
                  {a.status === "active" ? (
                    <SmallButton
                      onClick={() => act(a.id, "disable")}
                      busy={busy === a.id + "disable"}
                      icon={<Ban size={13} aria-hidden />}
                      label="Disable"
                      danger
                      disabled={a.id === me}
                    />
                  ) : (
                    <SmallButton
                      onClick={() => act(a.id, "enable")}
                      busy={busy === a.id + "enable"}
                      icon={<Check size={13} aria-hidden />}
                      label="Re-enable"
                    />
                  )}
                  <SmallButton
                    onClick={() => act(a.id, "admin", !a.isAdmin)}
                    busy={busy === a.id + "admin"}
                    icon={<ShieldCheck size={13} aria-hidden />}
                    label={a.isAdmin ? "Remove admin" : "Make admin"}
                    disabled={a.isAdmin && a.id === me}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          onClick={() => void load()}
          className="tap inline-flex items-center gap-1.5 text-[12px] font-medium text-navy-700"
        >
          <RefreshCw size={13} aria-hidden /> Refresh
        </button>
      </div>
    </Card>
  );
}

function SmallButton({
  onClick,
  busy,
  icon,
  label,
  danger,
  disabled,
}: {
  onClick: () => void;
  busy: boolean;
  icon: React.ReactNode;
  label: string;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className={`tap inline-flex items-center gap-1.5 rounded-lg px-3 text-[12px] font-semibold ring-1 disabled:opacity-40 ${
        danger
          ? "bg-white text-error ring-error/25 active:bg-error/5"
          : "bg-white text-navy-800 ring-line active:bg-navy-50"
      }`}
    >
      {icon}
      {busy ? "…" : label}
    </button>
  );
}
