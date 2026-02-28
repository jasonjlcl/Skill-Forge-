FROM node:20-alpine AS build
WORKDIR /app/server

COPY server/package*.json ./
RUN npm ci

COPY tsconfig.json /app/tsconfig.json
COPY server ./
RUN npm run build

FROM build AS deps-prod
RUN npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app/server
ENV NODE_ENV=production
ENV PORT=4000

COPY --from=build /app/server/package*.json ./
COPY --from=deps-prod /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist

# Runtime image does not need npm/npx; removing them drops vulnerable bundled npm deps.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
    && addgroup -S app \
    && adduser -S -G app app \
    && chown -R app:app /app/server

USER app

EXPOSE 4000

CMD ["node", "dist/src/index.js"]
