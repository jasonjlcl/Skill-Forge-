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

EXPOSE 4000

CMD ["node", "dist/src/index.js"]
