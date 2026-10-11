# The web panel. Built by deploy/docker-compose.yml.
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Prisma needs OpenSSL to pick its query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app ./
# Apply any new database migrations, then serve on localhost (Caddy is in front).
CMD ["sh", "-c", "npx prisma migrate deploy && npx next start -H 127.0.0.1 -p 3000"]
