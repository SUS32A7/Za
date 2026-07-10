FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

COPY . .

RUN go mod init zai-bridge && \
    go get modernc.org/sqlite@v1.53.0 && \
    go get github.com/mxschmitt/playwright-go && \
    go mod tidy

RUN go build -trimpath -ldflags="-s -w" -o zai-bridge main.go
RUN go build -trimpath -ldflags="-s -w" -o token-collector init.go

# Install Playwright driver at build time
RUN go run github.com/mxschmitt/playwright-go/cmd/playwright install --with-deps chromium

# --- Final image ---
FROM golang:1.25-alpine

RUN apk add --no-cache \
    ca-certificates tzdata sqlite \
    chromium \
    nss freetype harfbuzz \
    ttf-freefont font-noto-emoji \
    dbus udev xvfb

WORKDIR /app

COPY --from=builder /app/zai-bridge .
COPY --from=builder /app/token-collector .
COPY --from=builder /app/.assets ./.assets
COPY --from=builder /app/image-gen ./image-gen

# Copy the Playwright driver from builder
COPY --from=builder /root/.cache/ms-playwright-go /root/.cache/ms-playwright-go

COPY start.sh .
RUN chmod +x start.sh

ENV PORT=3001
ENV TZ=Asia/Shanghai
ENV PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright-go

EXPOSE 3001

CMD ["./start.sh"]
