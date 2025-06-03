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
          hostname: 'helioviewer-api.ias.u-psud.fr',
          port: '',
          pathname: '/v2/takeScreenshot/',
        },
      ],
    },
    rewrites: () => [
      {
        source: '/helioviewer/v2/getClosestImage',
        destination: 'https://helioviewer-api.ias.u-psud.fr/v2/getClosestImage/',
      },
    ],
  })
);
