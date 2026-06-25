import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root (the repo has sibling lockfiles up the tree).
  turbopack: { root: import.meta.dirname },
  // The Rain SDK is a local file: dependency that ships ESM + CJS in dist/.
  // Transpiling it keeps Next's bundler happy across server/client boundaries.
  transpilePackages: ["rain-sdk"],
};

export default nextConfig;
