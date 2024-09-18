import NextBundleAnalyzer from '@next/bundle-analyzer';

const withBundleAnalyzer = NextBundleAnalyzer({
  enabled: process.env.ANALYZE_BUNDLE?.toLowerCase() === 'true',
});

/** @type {import('next').NextConfig} */
export default withBundleAnalyzer({
  output: 'standalone',
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'api.helioviewer.org',
        port: '',
        pathname: '/v2/takeScreenshot/',
      },
    ],
  },
});
