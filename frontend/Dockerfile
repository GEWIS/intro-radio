FROM node:20-bookworm AS builder

WORKDIR /app
COPY yarn.lock .
COPY package.json .

RUN yarn install --frozen-lockfile

FROM node:20-bookworm

WORKDIR /app
COPY . .
COPY --from=builder /app/node_modules ./node_modules

ENV NODE_ENV=production
RUN yarn build