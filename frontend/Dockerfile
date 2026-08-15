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

# Same reasoning as GIT_SHA above -- the semantic-release version tied to
# whatever release actually produced this image, not package.json's own
# `version` field (semantic-release here doesn't rewrite that back into the
# repo, so it stays a stale placeholder).
ARG APP_VERSION=unknown
ENV VITE_APP_VERSION=${APP_VERSION}
ENV NODE_ENV=production
RUN yarn build

FROM nginx:alpine AS target
WORKDIR /app
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=base --chown=nginx /app/dist/ /app
