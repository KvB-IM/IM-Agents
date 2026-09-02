"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "./ui";

/**
 * Sign out.
 *
 * POST, so a prefetch or an image tag cannot end the session, and a full
 * navigation afterwards rather than a router push — every protected page is a
 * server component that reads the cookie, and they have to re-render without
 * it.
 */
export default function SignOutButton() {
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await fetch("/api/auth/logout", { method: "POST" });
        } finally {
          window.location.assign("/login?signedOut=1");
        }
      }}
    >
      <LogOut size={16} aria-hidden />
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}
