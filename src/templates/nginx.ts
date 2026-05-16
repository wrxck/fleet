interface NginxOpts {
  domain: string;
  port: number;
  type: 'proxy' | 'spa' | 'nextjs';
  apiPrefix?: string;
}

export function generateNginxConfig(opts: NginxOpts): string {
  const { domain, port, type } = opts;
  const apiPrefix = opts.apiPrefix ?? '/api';

  const securityHeaders = `    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;`;

  const proxyHeaders = `        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;`;

  if (type === 'proxy') {
    return proxyTemplate(domain, port, securityHeaders, proxyHeaders);
  }
  if (type === 'nextjs') {
    return nextjsTemplate(domain, port, securityHeaders, proxyHeaders);
  }
  return spaTemplate(domain, port, apiPrefix, securityHeaders, proxyHeaders);
}

function proxyTemplate(domain: string, port: number, security: string, proxy: string): string {
  return `server {
    server_name ${domain} www.${domain};

${security}

    location / {
        proxy_pass http://127.0.0.1:${port};
${proxy}
    }

    listen 80;
    listen [::]:80;
}
`;
}

function spaTemplate(domain: string, port: number, apiPrefix: string, security: string, proxy: string): string {
  return `server {
    server_name ${domain} www.${domain};

${security}

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;

    # API proxy
    location ${apiPrefix}/ {
        proxy_pass http://127.0.0.1:${port};
${proxy}
        proxy_read_timeout 60s;
        proxy_connect_timeout 60s;
    }

    # Sitemap and robots
    location = /sitemap.xml {
        proxy_pass http://127.0.0.1:${port};
${proxy}
    }
    location = /robots.txt {
        proxy_pass http://127.0.0.1:${port};
${proxy}
    }

    # Static assets
    location ~* \\.(?:css|js|jpg|jpeg|png|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    listen 80;
    listen [::]:80;
}
`;
}

function nextjsTemplate(domain: string, port: number, security: string, proxy: string): string {
  return `server {
    server_name ${domain} www.${domain};

${security}

    # Next.js static assets
    location /_next/static/ {
        proxy_pass http://127.0.0.1:${port};
${proxy}
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # All traffic to Next.js
    location / {
        proxy_pass http://127.0.0.1:${port};
${proxy}
    }

    listen 80;
    listen [::]:80;
}
`;
}
