"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, LayoutList, Phone, User } from "lucide-react";
import { OFFICE_PHONE_DISPLAY, OFFICE_PHONE_HREF } from "@/lib/office";

/**
 * Bottom tab bar.
 *
 * Bottom, not top: this is used one-handed and standing up, and the top of a
 * 6.1" screen is out of thumb reach.
 *
 * Three DESTINATIONS, plus one ACTION. Quote and Application used to be two
 * tabs over one draft; they are one flow now — Enroll — so the bar is back to
 * the four targets the original comment wanted. The last slot is "Call office" — a
 * `tel:` link, not a route: it hands off to the dialer and leaves the page
 * exactly where it was, which is the point when an agent is mid-application
 * with a client and needs the office. It is drawn in
 * the accent colour so it reads as a button among tabs rather than a fifth
 * place to go.
 */
const TABS = [
  { href: "/enroll", label: "Enroll", Icon: ClipboardList },
  { href: "/submissions", label: "Submissions", Icon: LayoutList },
  { href: "/me", label: "Me", Icon: User },
];

export default function TabBar() {
  const pathname = usePathname();

  return (
    <nav
      className="safe-b fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/95 backdrop-blur"
      aria-label="Main"
    >
      <ul className="mx-auto grid max-w-2xl grid-cols-4">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 px-1 pt-2.5 pb-2 text-[11px] font-medium transition-colors ${
                  active ? "text-navy-900" : "text-muted active:text-navy-700"
                }`}
              >
                <Icon
                  size={22}
                  strokeWidth={active ? 2.4 : 1.8}
                  aria-hidden
                />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
        {/* Not a <Link>: a tel: href must reach the browser untouched so the
            OS can hand it to the phone app. Next's router would try to treat
            it as navigation. Never "active" — there is no page to be on. */}
        <li>
          <a
            href={OFFICE_PHONE_HREF}
            title={OFFICE_PHONE_DISPLAY}
            aria-label={`Call the office, ${OFFICE_PHONE_DISPLAY}`}
            className="flex flex-col items-center gap-1 px-1 pt-2.5 pb-2 text-[11px] font-medium text-gold-600 transition-colors active:text-navy-900"
          >
            <Phone size={22} strokeWidth={2} aria-hidden />
            <span>Call office</span>
          </a>
        </li>
      </ul>
    </nav>
  );
}
