import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // `standalone` is the self-host output and is what the Docker image needs. Vercel requires the
  // default output — forcing standalone there breaks its file tracing mid-build.
  output: process.env.DOCKER_BUILD === '1' ? 'standalone' : undefined,

  // Next 16 removed images.domains; remotePatterns is the supported form. The
  // two OAuth avatar hosts only — a plain img would trip no-img-element in a
  // lint run that has to stay clean.
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'avatars.githubusercontent.com' },
    ],
  },
};

export default nextConfig;
