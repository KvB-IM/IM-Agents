import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  async redirects() {
    return [
      /* /pipeline was renamed to /submissions. Kept because an agent may have
       * bookmarked a form, and because the sign-in flow round-trips through a
       * `next` path — a stale one should land on the form, not a 404. */
      { source: "/pipeline", destination: "/submissions", permanent: true },
      { source: "/pipeline/:id", destination: "/submissions/:id", permanent: true },
    ];
  },
};

export default nextConfig;
