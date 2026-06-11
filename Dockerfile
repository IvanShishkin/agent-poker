# Agent Poker — table + API + spectator UI in a single container.
#   docker build -t agent-poker .
#   docker run -p 7777:7777 -e INVITE=secret -e TOURNAMENT=1 agent-poker
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/agents/package.json packages/agents/
COPY packages/spectator/package.json packages/spectator/
RUN npm ci

COPY tsconfig.base.json ./
COPY packages ./packages
RUN npm run build --workspace @agent-poker/spectator

ENV PORT=7777
EXPOSE 7777
CMD ["npx", "tsx", "packages/server/src/serve.ts"]
