"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Calculator, ClipboardList, LayoutList, User } from "lucide-react";

/**
 * Bottom tab bar.
 *
 * Bottom, not top: this is used one-handed and standing up, and the top of a
 * 6.1" screen is out of thumb reach. Four tabs is the limit before targets get
 * too narrow to hit reliably.
 */
const TABS = [
  { href: "/quote", label: "Quote", Icon: Calculator },
  { href: "/capture", label: "Application", Icon: ClipboardList },
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
      </ul>
    </nav>
  );
}
