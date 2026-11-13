/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_BUILD_DIR || '.next',
  reactStrictMode: true,
  serverExternalPackages: ['better-sqlite3', 'ua-parser-js'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet, noimageindex' },
        ],
      },
      {
        source: '/api/collect',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type' },
        ],
      },
      {
        source: '/t.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          // Browsers re-check every 5 min so tracker fixes reach visitors quickly (a cheap 304
          // from the CDN); the CDN keeps it a day and is purged on every deploy. No browser
          // stale-while-revalidate: that kept running an old tracker for up to a week.
          { key: 'Cache-Control', value: 'public, max-age=300, s-maxage=86400' },
        ],
      },
      {
        source: '/r.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cache-Control', value: 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800' },
        ],
      },
    ];
  },
};

export default nextConfig;
