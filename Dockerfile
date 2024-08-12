FROM node:20-bullseye-slim AS builder

WORKDIR /app

COPY package*.json .

RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .

RUN npm run build

RUN npm prune --omit=dev

FROM node:20-bullseye-slim

WORKDIR /app

COPY --from=builder /app/build ./
COPY --from=builder /app/node_modules ./node_modules

RUN groupadd -r xray && useradd -r -g xray -u 1001 xray

RUN chown -R xray:xray /app

USER 1001
