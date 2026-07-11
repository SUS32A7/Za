FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git nodejs npm curl unzip

WORKDIR /app

COPY . .

RUN go mod init zai-bridge && \
    go get modernc.org/sqlite@v1.53.0 && \
    go get github.com/mxschmitt/playwright-go && \
    go mod tidy

RUN go build -trimpath -ldflags="-s -w" -o zai-bridge main.go
RUN go build -trimpath -ldflags="-s -w" -o token-collector init.go

# Find out which exact driver version this go.mod pinned to
RUN grep "mxschmitt/playwright-go" go.mod

# Download the Playwright Node driver into the exact path the Go lib expects.
# URL format is playwright-<version>-linux.zip (NOT linux-x64), and -f makes
# curl fail loudly (non-zero exit) on a 404/error instead of saving garbage.
RUN PW_VERSION="1.61.1" && \
    mkdir -p /root/.cache/ms-playwright-go/${PW_VERSION} && \
    curl -fL "https://playwright.azureedge.net/builds/driver/playwright-${PW_VERSION}-linux.zip" \
    -o /tmp/pw-driver.zip && \
    unzip -q /tmp/pw-driver.zip -d /root/.cache/ms-playwright-go/${PW_VERSION} && \
    chmod +x /root/.cache/ms-playwright-go/${PW_VERSION}/node && \
    rm /tmp/pw-driver.zip && \
    ls -la /root/.cache/ms-playwright-go/${PW_VERSION}/node

# --- Final image ---
FROM alpine:latest

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
COPY --from=builder /root/.cache/ms-playwright-go /root/.cache/ms-playwright-go
COPY start.sh .
RUN chmod +x start.sh

ENV PORT=3001
ENV TZ=Asia/Shanghai
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser

EXPOSE 3001

CMD ["./start.sh"]
