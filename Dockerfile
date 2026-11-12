# Two images from one checkout: `app` runs the API, which starts each build as
# a child process from the checkout itself, and `web` serves the interface.

FROM node:24-alpine AS checkout
WORKDIR /app
# The manifests first, so a change to the sources reuses the installed layer.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/worker/package.json packages/worker/
COPY packages/api/package.json packages/api/
COPY packages/web/package.json packages/web/
# Development dependencies included: the API resolves `tsx` and the worker's
# script against the checkout, and a build would not start without them.
RUN npm ci
COPY . .

FROM checkout AS bundle
RUN npm run build:web

FROM node:24-alpine AS app
WORKDIR /app
COPY --from=checkout --chown=node:node /app /app
# The volumes are mounted over these, and a fresh named volume takes the owner
# of the directory it covers: created here, they are writable by `node`.
RUN mkdir -p /data/media && chown node:node /data/media
USER node
ENV MEDIA_PATH=/data/media
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "packages/api/src/main.ts"]

FROM nginx:1.29-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=bundle /app/packages/web/dist /usr/share/nginx/html
