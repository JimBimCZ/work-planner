import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `standalone` is the self-host output and is what the Docker image needs. Vercel requires the
  // default output — forcing standalone there breaks its file tracing mid-build.
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,
};

export default nextConfig;
