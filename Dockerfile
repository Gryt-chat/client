FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --ignore-engines

COPY . .
RUN yarn build

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
    location /addons/ {
      alias /addons/;
      autoindex off;
    }
    location /health {
      return 200 "healthy";
      add_header Content-Type text/plain;
    }
  }
}
NGINX

# The runtime config nginx writes before it starts serving. Every key here has
# to match what `getGrytConfig()` in src/config.ts reads off `__GRYT_CONFIG__`,
# and every default has to match the fallback it uses when the key is absent —
# otherwise setting nothing behaves differently depending on which of the two
# is doing the defaulting.
#
# GRYT_IDENTITY_URL is here because leaving it out did not mean "use the
# default", it meant "there is no way to change this". Somebody self-hosting
# against their own Keycloak could set the issuer and got Gryt's certificate
# authority regardless: their token went to id.gryt.chat, which validates
# against its own configured issuer and rejects it with "no applicable key
# found in the JWKS" — the symptom, not the cause. That is GRYT-156 again, and
# the only way around it was the per-browser override in Settings, which is not
# something an operator can set for their users.
RUN printf '%s\n' \
  '#!/bin/sh' \
  'set -eu' \
  ': "${GRYT_OIDC_ISSUER:=https://auth.gryt.chat/realms/gryt}"' \
  ': "${GRYT_OIDC_REALM:=gryt}"' \
  ': "${GRYT_OIDC_CLIENT_ID:=gryt-web}"' \
  ': "${GRYT_IDENTITY_URL:=https://id.gryt.chat}"' \
  ': "${GRYT_AUTH_API:=https://auth.gryt.chat}"' \
  ': "${GRYT_AUTH_CALLBACK_URL:=https://gryt.chat/auth/callback}"' \
  'cat > /usr/share/nginx/html/config.js <<EOF' \
  'window.__GRYT_CONFIG__ = {' \
  '  GRYT_OIDC_ISSUER: "${GRYT_OIDC_ISSUER}",' \
  '  GRYT_OIDC_REALM: "${GRYT_OIDC_REALM}",' \
  '  GRYT_OIDC_CLIENT_ID: "${GRYT_OIDC_CLIENT_ID}",' \
  '  GRYT_IDENTITY_URL: "${GRYT_IDENTITY_URL}",' \
  '  GRYT_AUTH_API: "${GRYT_AUTH_API}",' \
  '  GRYT_AUTH_CALLBACK_URL: "${GRYT_AUTH_CALLBACK_URL}",' \
  '};' \
  'EOF' \
  > /docker-entrypoint.d/99-gryt-config.sh \
  && chmod +x /docker-entrypoint.d/99-gryt-config.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
