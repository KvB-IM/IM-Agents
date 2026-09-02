import { ShieldCheck } from "lucide-react";

/**
 * Compact sticky header. Deliberately short — on a 375x667 screen every
 * vertical pixel spent on chrome is a pixel not spent on the form.
 *
 * The fixture badge is carried over from IM_CRM_Frontend: when the app is
 * serving fixtures rather than live data, that has to be visible, or someone
 * quotes a client off invented premiums.
 */
export default function AppHeader({
  agentName,
  fixture,
}: {
  agentName: string;
  fixture: boolean;
}) {
  return (
    <header className="safe-t sticky top-0 z-30 border-b border-line bg-navy-900 text-white">
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck size={18} className="shrink-0 text-gold-400" aria-hidden />
          <span className="truncate text-[14px] font-semibold tracking-tight">
            Insurance Masters
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {fixture ? (
            <span className="rounded-full bg-gold-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gold-400 ring-1 ring-gold-500/40">
              Fixture data
            </span>
          ) : null}
          <span className="text-[12px] text-navy-100">{agentName}</span>
        </div>
      </div>
    </header>
  );
}
