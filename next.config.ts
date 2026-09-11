import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return ['/rsvp','/convite/:path*','/api/rsvp','/api/invitations/:path*'].map(source=>({
      source,headers:[
        {key:'Referrer-Policy',value:'no-referrer'},
        {key:'X-Robots-Tag',value:'noindex, nofollow'},
        {key:'Cache-Control',value:'private, no-store, max-age=0'},
        {key:'X-Content-Type-Options',value:'nosniff'},
        {key:'X-Frame-Options',value:'DENY'},
      ],
    }));
  },
};
export default nextConfig;
