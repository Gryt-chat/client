FROM --platform=$BUILDPLATFORM oven/bun:1-alpine AS builder
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

COPY . .
RUN bun run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

RUN cat <<'NGINX' > /etc/nginx/nginx.conf
events { worker_connections 1024; }
http {
  include       /etc/nginx/mime.types;
  default_type  application/octet-stream;
  sendfile      on;
  keepalive_timeout 65;
  gzip          on;
  gzip_types    text/plain text/css application/json application/javascript text/xml;

  server {
    listen 80;
    root   /usr/share/nginx/html;
    index  index.html;

    location / {
      try_files $uri $uri/ /index.html;
    }
    location /health {
      return 200 "healthy";
      add_header Content-Type text/plain;
    }
  }
}
NGINX

RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  ': "${GRYT_OIDC_ISSUER:=https://auth.gryt.chat/realms/gryt}"' \
  ': "${GRYT_OIDC_REALM:=gryt}"' \
  ': "${GRYT_OIDC_CLIENT_ID:=gryt-web}"' \
  'cat > /usr/share/nginx/html/config.js <<EOF' \
  'window.__GRYT_CONFIG__ = {' \
  '  GRYT_OIDC_ISSUER: "${GRYT_OIDC_ISSUER}",' \
  '  GRYT_OIDC_REALM: "${GRYT_OIDC_REALM}",' \
  '  GRYT_OIDC_CLIENT_ID: "${GRYT_OIDC_CLIENT_ID}",' \
  '};' \
  'EOF' \
  > /docker-entrypoint.d/99-gryt-config.sh \
  && chmod +x /docker-entrypoint.d/99-gryt-config.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
