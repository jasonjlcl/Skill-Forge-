FROM node:20-alpine AS client-build
WORKDIR /app/client

COPY client/package*.json ./
RUN npm ci

COPY client ./
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
RUN npm run build

FROM nginx:1.29-alpine

# Pull latest patched Alpine packages for runtime CVEs surfaced by image scans.
RUN apk upgrade --no-cache

COPY infra/nginx/default.http.conf.template /opt/nginx/templates/default.http.conf.template
COPY infra/nginx/default.https.conf.template /opt/nginx/templates/default.https.conf.template
COPY infra/nginx/entrypoint/05-select-template.sh /docker-entrypoint.d/05-select-template.sh
RUN chmod +x /docker-entrypoint.d/05-select-template.sh
COPY --from=client-build /app/client/dist /usr/share/nginx/html
