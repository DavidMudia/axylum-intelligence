import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: "../../.next",
  experimental: {
    agentUpgrade: "security",
  },
};

export default nextConfig;
