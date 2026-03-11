import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

// Create next-intl plugin with request handler path
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  experimental: {
    middlewareClientMaxBodySize: '50mb',
  },
};

export default withNextIntl(nextConfig);
