import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IM Agent Portal",
  description: "ACA quoting, capture and enrollment for Insurance Masters field agents.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* Not maximumScale: 1 — locking zoom out of a form that asks for SSNs and
     dates of birth is an accessibility failure, and iOS ignores it anyway. */
  viewportFit: "cover",
  themeColor: "#0f2140",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
