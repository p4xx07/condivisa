FROM node:26-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY index.html tsconfig*.json vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/condivisa.sqlite UPLOAD_DIR=/data/uploads
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
