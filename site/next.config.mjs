import NextBundleAnalyzer from '@next/bundle-analyzer';
import createMdx from '@next/mdx';

const withBundleAnalyzer = NextBundleAnalyzer({
  enabled: process.env.ANALYZE_BUNDLE?.toLowerCase() === 'true',
});

const withMdx = createMdx({
  extension: /\.(md|mdx)$/,
});

/** @type {import('next').NextConfig} */
export default withMdx(
  withBundleAnalyzer({
    output: 'standalone',
    pageExtensions: ['js', 'jsx', 'md', 'mdx', 'ts', 'tsx'],
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
    rewrites: () => [
      {
        source: '/helioviewer/v2/getClosestImage',
        destination: 'https://api.helioviewer.org/v2/getClosestImage/',
      },
    ],
  })
);
