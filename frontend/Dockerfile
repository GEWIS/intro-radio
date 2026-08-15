FROM node:25-bookworm AS builder

WORKDIR /app
COPY yarn.lock .
COPY package.json .

RUN yarn install --frozen-lockfile

FROM node:25-bookworm AS base

WORKDIR /app
COPY . .
COPY --from=builder /app/node_modules ./node_modules

# Baked in at build time so the running app can show exactly what's
# deployed (see src/components/AppFooter.vue) -- there's no git history
# inside the container to read this from at runtime. Defaults to "unknown"
# so a build that doesn't pass --build-arg GIT_SHA (e.g. a local `docker
# build` or the PR-validation build in ci.yml) still succeeds.
ARG GIT_SHA=unknown
ENV VITE_GIT_SHA=${GIT_SHA}
ENV NODE_ENV=production
RUN yarn build

FROM nginx:alpine AS target
WORKDIR /app
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=base --chown=nginx /app/dist/ /app
