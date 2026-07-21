import type { NextConfig } from 'next';

/**
 * Security headers applied to every response.
 *
 * A Content-Security-Policy is deliberately not set here: Next.js injects
 * inline bootstrap scripts, so a useful policy needs a per-request nonce
 * generated in proxy.ts. Shipping a broad `unsafe-inline` policy would provide
 * the appearance of protection without the substance.
 */
const SECURITY_HEADERS = [
  // Block MIME sniffing, which is what makes an uploaded file dangerous.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
];

const nextConfig: NextConfig = {
  // Fail the production build on type errors rather than shipping them.
  typescript: { ignoreBuildErrors: false },

  /**
   * pdf-parse loads pdfjs-dist, which uses dynamic requires and ships its own
   * worker. Bundling it breaks those lookups, so it is kept external and
   * resolved from node_modules at runtime.
   */
  serverExternalPackages: ['pdf-parse'],

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
