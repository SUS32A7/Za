FROM golang:1.22-alpine AS builder

# Install git (needed for go get)
RUN apk add --no-cache git

WORKDIR /app

# Copy source files
COPY . .

# Generate go.mod and fetch dependencies
RUN go mod init zai-bridge && \
    go get modernc.org/sqlite && \
    go mod tidy

# Build only main.go (the server), excluding init.go (the token collector)
RUN go build -trimpath -ldflags="-s -w" -o zai-bridge main.go

# --- Final minimal image ---
FROM alpine:latest

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /app/zai-bridge .
COPY --from=builder /app/.assets ./.assets
COPY --from=builder /app/image-gen ./image-gen

# Create an empty tokens.sqlite so the server starts without crashing
RUN apk add --no-cache sqlite && \
    sqlite3 tokens.sqlite "CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY, token TEXT, batch INTEGER);" && \
    apk del sqlite

EXPOSE 3001

ENV PORT=3001
ENV TZ=Asia/Shanghai

CMD ["./zai-bridge"]
