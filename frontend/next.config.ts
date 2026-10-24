import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "i.ytimg.com" }],
  },
  // Lets a second build (e.g. an end-to-end run) live beside a running `next dev` without clobbering .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  async redirects() {
    return [
      {
        source: "/radar",
        destination: "/trends",
        permanent: false,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: "/api/radar/:path*",
        destination: `${BACKEND_URL}/api/trends/radar/:path*`,
      },
      {
        source: "/api/radar",
        destination: `${BACKEND_URL}/api/trends/radar`,
      },
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
      {
        source: "/storage/:path*",
        destination: `${BACKEND_URL}/storage/:path*`,
      },
    ];
  },
};

export default nextConfig;
