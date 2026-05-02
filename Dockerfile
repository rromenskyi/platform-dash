# SvelteKit + adapter-node — multi-stage so the runtime image only
# carries production deps + the compiled `build/` output. Pinned to
# Node 22 LTS to match local dev (24 of which is in Bullseye nodejs).
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Re-install with dev deps stripped — adapter-node's runtime needs
# only the production tree, ~70% smaller than the build-stage one.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/build ./build
COPY start.js ./

EXPOSE 3000
# start.js wraps adapter-node's bundled `handler` in an http.Server so
# we can attach the /ws/exec/* WebSocket bridge for pod shells. Drop
# back to `node build` if the shell surface needs to go away.
CMD ["node", "start.js"]
