"use client";

import type { ReactNode, InputHTMLAttributes } from "react";

/**
 * Section container.
 *
 * FULL-BLEED ON A PHONE, a rounded card from 640px up.
 *
 * Screen space on a 375px phone is the scarcest resource in this app, and a
 * floating rounded card inside a padded page spends it twice: the page's own
 * 16px gutter plus the card's 16px inset is 32px of horizontal chrome, 8.5% of
 * the viewport, before any content. So below `sm` the container goes edge to
 * edge and separates with hairline rules instead of gaps — the pattern iOS
 * Settings, Mail and Messages all use — and only the CONTENT inside it stays
 * inset by 16px.
 *
 * What is deliberately NOT done is running text to the screen edge. Text needs
 * a margin to be readable, and rounded display corners clip it. Full-bleed
 * applies to the container, never to the words inside it.
 */
export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`border-y border-line bg-white sm:rounded-2xl sm:border sm:shadow-[0_1px_3px_rgba(11,26,51,0.06)] ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Horizontal inset for content that is NOT inside a Card — page headings,
 * standalone paragraphs, buttons. Matches the Card's inner padding so
 * everything lines up on one left edge.
 */
export function Inset({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 ${className}`}>{children}</div>;
}

export function CardHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="px-4 pt-4 pb-2">
      <h2 className="text-[15px] font-semibold tracking-tight text-navy-900">{title}</h2>
      {hint ? <p className="mt-0.5 text-[13px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}

/** Labelled field wrapper. Labels sit above inputs — never beside them, which
 *  wraps badly at 375px. */
export function Field({
  label,
  hint,
  children,
  error,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  error?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-medium text-navy-800">{label}</span>
      {children}
      {hint && !error ? <span className="mt-1 block text-[12px] text-muted">{hint}</span> : null}
      {error ? <span className="mt-1 block text-[12px] font-medium text-error">{error}</span> : null}
    </label>
  );
}

const inputBase =
  "tap w-full rounded-xl border border-line bg-white px-3 text-ink placeholder:text-muted/60 " +
  "focus:border-navy-600 focus:outline-none focus:ring-2 focus:ring-navy-600/20 " +
  "disabled:bg-navy-50 disabled:text-muted";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = "", ...rest } = props;
  return <input {...rest} className={`${inputBase} ${className}`} />;
}

export function Select({
  children,
  className = "",
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={`${inputBase} appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8" viewBox="0 0 12 8"><path fill="%235c6779" d="M1 1l5 5 5-5"/></svg>')} bg-[length:12px_8px] bg-[right_0.85rem_center] bg-no-repeat pr-9 ${className}`}
    >
      {children}
    </select>
  );
}

/** Primary action. Full-width on a phone, because that is where the thumb is. */
export function Button({
  children,
  variant = "primary",
  className = "",
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const styles = {
    primary:
      "bg-navy-900 text-white active:bg-navy-950 disabled:bg-navy-900/40 shadow-[0_1px_2px_rgba(11,26,51,0.2)]",
    secondary: "bg-white text-navy-900 ring-1 ring-line active:bg-navy-50 disabled:text-muted",
    ghost: "bg-transparent text-navy-700 active:bg-navy-50",
    danger: "bg-error text-white active:brightness-90",
  }[variant];

  return (
    <button
      {...rest}
      className={`tap inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 text-[15px] font-semibold transition-colors ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

/** Yes/no as a segmented control. A checkbox at 375px is a 20px target next to
 *  a wrapping label; two big buttons are not. */
export function Toggle({
  value,
  onChange,
  labels = ["Yes", "No"],
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
  labels?: [string, string];
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[true, false].map((v, i) => (
        <button
          key={String(v)}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`tap rounded-xl px-3 text-[15px] font-medium transition-colors ${
            value === v
              ? "bg-navy-900 text-white"
              : "bg-white text-navy-700 ring-1 ring-line active:bg-navy-50"
          }`}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "live" | "attention" | "progress" | "closed" | "gold";
}) {
  const styles = {
    neutral: "bg-navy-50 text-navy-700 ring-line",
    live: "bg-success/10 text-success ring-success/20",
    attention: "bg-warning/10 text-warning ring-warning/25",
    progress: "bg-navy-100 text-navy-700 ring-navy-600/20",
    closed: "bg-navy-50 text-muted ring-line",
    gold: "bg-gold-100 text-gold-600 ring-gold-500/30",
  }[tone];

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ${styles}`}
    >
      {children}
    </span>
  );
}

/** Sticky footer action bar. Keeps the primary action reachable without
 *  scrolling to the bottom of a long form. */
export function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 mt-6 border-t border-line bg-cream/95 px-4 pt-3 pb-3 backdrop-blur">
      {children}
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-4 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <p className="text-[15px] font-semibold text-navy-900">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-[13px] leading-relaxed text-muted">{body}</p>
    </div>
  );
}
