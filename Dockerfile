FROM golang:1.25-alpine AS builder

RUN apk add --no-cache git

WORKDIR /app

COPY . .

RUN go mod init zai-bridge && \
    go get modernc.org/sqlite@v1.53.0 && \
    go mod tidy

RUN go build -trimpath -ldflags="-s -w" -o zai-bridge main.go

# --- Final minimal image ---
FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata sqlite

WORKDIR /app

COPY --from=builder /app/zai-bridge .
COPY --from=builder /app/.assets ./.assets
COPY --from=builder /app/image-gen ./image-gen

# Create empty tokens DB so server starts without crashing
RUN sqlite3 tokens.sqlite "CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY, token TEXT, batch INTEGER);"

EXPOSE 3001

ENV PORT=3001
ENV TZ=Asia/Shanghai

CMD ["./zai-bridge"]
