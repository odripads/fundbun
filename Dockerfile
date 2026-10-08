# FundBun — one container serving the web app and the LLM gateway on port 8787.
#   docker build -t fundbun .
#   docker run -p 8787:8787 --env-file .env fundbun      → http://localhost:8787/?demo=mei
# Without an API key the app runs its on-device engine only (the gateway reports llm unavailable).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production FUNDBUN_API_PORT=8787 FUNDBUN_API_HOST=0.0.0.0
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src/core ./src/core
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://localhost:8787/api/health >/dev/null 2>&1 || exit 1
CMD ["npx", "tsx", "server/index.ts"]
