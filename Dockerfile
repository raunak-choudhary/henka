# Bun image pinned as in the organisers' TypeScript kit. No runtime dependencies.
FROM oven/bun:1.4.4-slim
WORKDIR /bot
COPY package.json ./
COPY src ./src
ENTRYPOINT ["bun", "/bot/src/main.ts"]
