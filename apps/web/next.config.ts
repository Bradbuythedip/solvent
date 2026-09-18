import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@solvent/core'],
  typedRoutes: false,
};

export default config;
