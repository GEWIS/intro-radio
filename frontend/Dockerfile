FROM node:20-bookworm AS builder

WORKDIR /app
COPY yarn.lock .
COPY package.json .

RUN yarn install --frozen-lockfile

FROM node:20-bookworm AS base

WORKDIR /app
COPY . .
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
RUN yarn build

FROM nginx:alpine AS target
WORKDIR /app
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=base --chown=nginx /app/dist/ /app
