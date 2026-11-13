import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Standalone output for the container image; `next dev` ignores it.
  output: 'standalone',
  // Dev (next dev) y producción (next start) NO comparten .next: el dev
  // resetea los artefactos del build. El público corre con NEXT_PROD=1.
  distDir: process.env.NEXT_PROD === '1' ? '.next-prod' : '.next',
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
