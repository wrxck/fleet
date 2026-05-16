FROM golang:1.22 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /fleet-bot .

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    systemd \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /fleet-bot /usr/local/bin/fleet-bot
ENTRYPOINT ["fleet-bot"]
