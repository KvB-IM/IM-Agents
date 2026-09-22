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
      /* Quote and Application were two tabs over one draft; they are one flow
       * now. Same reasoning as above: bookmarks and stale `next` paths. */
      { source: "/quote", destination: "/enroll", permanent: true },
      { source: "/capture", destination: "/enroll", permanent: true },
    ];
  },
};

export default nextConfig;
