import Link from "next/link";
import { Link2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Card, CardHeader } from "./ui";

/**
 * The admin's CRM connection panel.
 *
 * Shown only to admins, because connecting the CRM points the whole portal at
 * one Zoho org. A plain link rather than a fetch: the flow is a full-page
 * redirect out to Zoho's consent screen and back.
 */
export default function ZohoConnection({
  connected,
  connectedAt,
  scopes,
  lastError,
  status,
}: {
  connected: boolean;
  connectedAt: string | null;
  scopes: string | null;
  lastError: string | null;
  status: "connected" | "error" | null;
}) {
  return (
    <Card>
      <CardHeader
        title="CRM connection"
        hint="One service connection for the whole portal. Admin only."
      />

      <div className="space-y-3 px-4 pb-4">
        {status === "connected" ? (
          <p className="flex items-center gap-2 rounded-xl bg-success/5 px-3 py-2.5 text-[13px] text-success ring-1 ring-success/20">
            <CheckCircle2 size={15} className="shrink-0" aria-hidden />
            Connected. The pipeline now reads live data.
          </p>
        ) : null}

        {status === "error" ? (
          <p className="flex items-start gap-2 rounded-xl bg-error/5 px-3 py-2.5 text-[13px] text-error ring-1 ring-error/15">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
            That did not complete. Check the server log — the commonest cause is a
            redirect URI that does not match what is registered in Zoho, exactly.
          </p>
        ) : null}

        <dl className="divide-y divide-line">
          <Row label="Status" value={connected ? "Connected" : "Not connected"} />
          {connectedAt ? <Row label="Connected" value={connectedAt} /> : null}
          {scopes ? <Row label="Scopes" value={scopes} mono /> : null}
        </dl>

        {lastError ? (
          <p className="rounded-xl bg-warning/5 px-3 py-2.5 text-[12px] leading-snug text-navy-900 ring-1 ring-warning/20">
            <strong className="font-semibold">Last refresh failed.</strong> {lastError}
          </p>
        ) : null}

        <Link href="/api/auth/zoho/start?returnTo=/me" className="block">
          <span className="tap inline-flex w-full items-center justify-center gap-2 rounded-xl bg-navy-900 px-4 text-[15px] font-semibold text-white active:bg-navy-950">
            <Link2 size={16} aria-hidden />
            {connected ? "Reconnect the CRM" : "Connect the CRM"}
          </span>
        </Link>
      </div>
    </Card>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-[13px] text-muted">{label}</dt>
      <dd
        className={`text-right text-[13px] font-medium text-navy-900 ${
          mono ? "break-all font-mono text-[11px]" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
