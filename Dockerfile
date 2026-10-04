# syntax=docker/dockerfile:1

# Multi-stage build for the single Stratofold image (ADR 0004):
#   web      -> Vite production build of the SPA
#   gobuild  -> static Go binary with the SPA embedded via go:embed
#   runtime  -> minimal Alpine image (the released artifact)
#   e2e      -> CI-only verification image running the in-proc E2E harness
#
# Docker builds run exclusively in CI (.github/workflows/release-image.yaml).

# ---- SPA build ------------------------------------------------------
FROM node:22-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- Go build -------------------------------------------------------
FROM golang:1.27-alpine AS gobuild
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Replace the committed placeholder with the real Vite build.
RUN rm -rf internal/webassets/dist
COPY --from=web /src/web/dist internal/webassets/dist
RUN CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/stratofold ./cmd/stratofold \
 && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w" -o /out/stratofold-e2e ./cmd/stratofold-e2e

# ---- Runtime --------------------------------------------------------
FROM alpine:3.21 AS runtime
RUN apk add --no-cache ca-certificates tzdata \
 && addgroup -S -g 1000 stratofold \
 && adduser -S -D -H -u 1000 -G stratofold stratofold \
 && mkdir -p /pb_data \
 && chown stratofold:stratofold /pb_data
COPY --from=gobuild /out/stratofold /usr/local/bin/stratofold
USER stratofold
EXPOSE 8090
VOLUME ["/pb_data"]
ENTRYPOINT ["stratofold"]
CMD ["serve", "--dir=/pb_data", "--http=0.0.0.0:8090"]

# ---- E2E verification image (CI only) -------------------------------
FROM runtime AS e2e
COPY --from=gobuild /out/stratofold-e2e /usr/local/bin/stratofold-e2e
ENTRYPOINT ["stratofold-e2e"]
CMD ["--http=0.0.0.0:8090"]
