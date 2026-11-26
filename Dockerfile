FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=5174 \
    HOSTNAME=0.0.0.0

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/drizzle.config.ts ./drizzle.config.ts

USER node
EXPOSE 5174
CMD ["./node_modules/.bin/next", "start", "src/frontend", "--hostname", "0.0.0.0", "--port", "5174"]
