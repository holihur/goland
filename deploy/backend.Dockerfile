# syntax=docker/dockerfile:1
FROM node:26.12.1-bookworm-slim AS frontend

ENV npm_config_registry=https://registry.npmmirror.com NODE_OPTIONS=--max-old-space-size=512
RUN npm install --global pnpm@12.15.0
WORKDIR /app
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM golang:1.27.4-bookworm AS builder

WORKDIR /src
ENV GOMAXPROCS=2 CGO_ENABLED=0 GOPROXY=https://goproxy.cn,direct
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/goland ./cmd/server \
 && GOBIN=/out/tools go install golang.org/x/tools/gopls@latest \
 && GOBIN=/out/tools go install github.com/go-delve/delve/cmd/dlv@latest

FROM node:26.12.1-bookworm-slim

ENV npm_config_registry=https://registry.npmmirror.com

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates bash curl git tini passwd chromium \
 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /usr/local/go /usr/local/go
COPY --from=builder /out/goland /usr/local/bin/goland
COPY --from=builder /out/tools/gopls /opt/goland/bin/gopls
COPY --from=builder /out/tools/dlv /opt/goland/bin/dlv

RUN npm install --global --prefix /opt/goland \
      typescript@5.9.3 typescript-language-server@6.1.0 \
 && ln -sf /opt/goland/bin/typescript-language-server /usr/local/bin/typescript-language-server

COPY deploy/js-debug /opt/goland/js-debug
COPY --from=frontend /app/dist /opt/goland/web

ENV PATH="/usr/local/go/bin:/opt/goland/bin:/opt/goland/node_modules/.bin:${PATH}" \
    GOLAND_ADDR="0.0.0.0:8788" \
    GOLAND_DATA_DIR="/data" \
    GOLAND_WORKSPACE_ROOTS="/data/workspaces" \
    GOLAND_GOPLS="/opt/goland/bin/gopls" \
    GOLAND_DLV="/opt/goland/bin/dlv" \
    GOLAND_TSSERVER="/opt/goland/bin/typescript-language-server" \
    GOLAND_JS_DEBUG="/opt/goland/js-debug/src/dapDebugServer.js" \
    GOLAND_CHROME="/usr/bin/chromium" \
    GOLAND_WEB_DIST="/opt/goland/web" \
    NODE_OPTIONS="--max-old-space-size=512" \
    GOMAXPROCS="1"

RUN mkdir -p /data/workspaces && chmod 0755 /data

EXPOSE 8788
VOLUME ["/data"]
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["goland"]
