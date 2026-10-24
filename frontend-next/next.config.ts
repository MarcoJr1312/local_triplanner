import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Dev (next dev) y producción (next start) NO comparten .next: el dev
  // resetea los artefactos del build. El público corre con NEXT_PROD=1.
  distDir: process.env.NEXT_PROD === '1' ? '.next-prod' : '.next',
  async rewrites() {
    return [
      {
        // Avatares y archivos subidos: servidos por el backend local (mismo origen)
        source: '/uploads/:path*',
        destination: 'http://localhost:4000/uploads/:path*',
      },
    ];
  },
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
