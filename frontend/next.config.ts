import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a second build (e.g. an end-to-end run) live beside a running `next dev` without clobbering .next.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
