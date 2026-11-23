# syntax=docker/dockerfile:1
FROM node:26.12.1-bookworm-slim AS build

ENV npm_config_registry=https://registry.npmmirror.com
RUN npm install --global pnpm@12.15.0
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=512
COPY package.json pnpm-lock.yaml ./
RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:1.29-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
