FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git nodejs npm

WORKDIR /app

COPY . .

RUN go mod init zai-bridge && \
    go get modernc.org/sqlite@v1.53.0 && \
    go get github.com/mxschmitt/playwright-go && \
    go mod tidy

# Build server (main.go only)
RUN go build -trimpath -ldflags="-s -w" -o zai-bridge main.go

# Build token collector (init.go only)
RUN go build -trimpath -ldflags="-s -w" -o token-collector init.go

# --- Final image ---
FROM alpine:latest

# System Chromium + Node.js for Playwright driver
RUN apk add --no-cache \
    ca-certificates tzdata sqlite nodejs \
    chromium \
    nss freetype harfbuzz \
    ttf-freefont font-noto-emoji \
    dbus udev

WORKDIR /app

COPY --from=builder /app/zai-bridge .
COPY --from=builder /app/token-collector .
COPY --from=builder /app/.assets ./.assets
COPY --from=builder /app/image-gen ./image-gen
COPY start.sh .
RUN chmod +x start.sh

ENV PORT=3001
ENV TZ=Asia/Shanghai
# Tell Playwright to use the system Chromium instead of downloading its own
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3001

CMD ["./start.sh"]
