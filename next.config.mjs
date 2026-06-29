const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(), payment=()',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "img-src 'self' data: blob: https: *",
      "style-src 'self' 'unsafe-inline' https: *",
      "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https: *",
      "font-src 'self' data: https: *",
      "connect-src 'self' https: *",
      "media-src 'self' blob: https: *",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "frame-src 'self' https: *",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  async rewrites() {
    return [
      { source: '/patient', destination: '/patient/index.html' },
      { source: '/therapist/index.html', destination: '/' },
      { source: '/therapist/capture.html', destination: '/therapist/capture' },
      { source: '/therapist/plan.html', destination: '/therapist/plan' },
      { source: '/therapist/record.html', destination: '/therapist/record' },
      { source: '/therapist/dashboard.html', destination: '/therapist/dashboard' },
    ];
  },
};

export default nextConfig;
