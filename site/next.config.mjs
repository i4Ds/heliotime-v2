/** @type {import('next').NextConfig} */
export default {
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
};
