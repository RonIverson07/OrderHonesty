import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to all routes
        source: "/(.*)",
        headers: [
          {
            key: "Permissions-Policy",
            value: "camera=*, microphone=()",
          },
          {
            key: "Feature-Policy",
            value: "camera *",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
