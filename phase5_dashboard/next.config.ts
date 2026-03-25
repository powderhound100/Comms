import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    return [
      { source: '/sat-images/:path*', destination: '/api/imagery/file/:path*' },
    ]
  },
}

export default nextConfig
