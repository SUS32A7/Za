FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go mod files if they exist
COPY go.mod go.sum* ./

# Download dependencies
RUN go mod download 2>/dev/null || true

# Copy source
COPY . .

# Build the binary
RUN go build -o server .

# --- Final minimal image ---
FROM alpine:latest

WORKDIR /app

COPY --from=builder /app/server .

# Copy any assets needed at runtime
COPY --from=builder /app/.assets ./.assets
COPY --from=builder /app/image-gen ./image-gen

EXPOSE 8000

ENV PORT=8000
ENV TZ=Asia/Shanghai

CMD ["./server"]
