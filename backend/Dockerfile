FROM golang:1.24 AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./
RUN CGO_ENABLED=0 GOOS=linux go build -o /radiogaga

FROM alpine

COPY --from=builder /webhooker /radioagga

CMD ["/radiogaga"]
