# Build the web client (React + Vite) into client/dist.
FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# API server; it also serves the built client.
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=3000 \
    WOS_DB=/data/wos.db
WORKDIR /app/server
# Install inside server/: "npm --prefix server install" from the root would add the root as a dependency.
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/src ./src
COPY --from=client /app/client/dist /app/client/dist

# The database, secret.key, uploads and backups all live next to WOS_DB: keep them on a volume.
# An empty volume starts with the seed data; it is never reset.
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node

EXPOSE 3000
CMD ["node", "--no-warnings", "src/index.js"]
