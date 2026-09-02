/** Display formatting. Kept together so money and dates read the same
 *  everywhere, which matters more on a small screen than a large one. */

export function money(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  if (n === 0) return "$0";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

export function moneyExact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function monthYear(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

/** Metal-level colour, matching the tokens already used on IM-Website. */
export function metalClass(metal: string): string {
  const m = metal.toLowerCase();
  if (m.includes("bronze")) return "text-[#8c6a32] bg-[#8c6a32]/10 ring-[#8c6a32]/20";
  if (m.includes("silver")) return "text-[#64748b] bg-[#64748b]/10 ring-[#64748b]/20";
  if (m.includes("gold")) return "text-[#b0863f] bg-[#b0863f]/10 ring-[#b0863f]/20";
  if (m.includes("platinum")) return "text-[#7c3aed] bg-[#7c3aed]/10 ring-[#7c3aed]/20";
  if (m.includes("catastrophic")) return "text-[#dc2626] bg-[#dc2626]/10 ring-[#dc2626]/20";
  return "text-muted bg-navy-50 ring-line";
}
