FROM golang:1.24 AS build
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 go build -o /agent .

FROM gcr.io/distroless/static-debian12
COPY --from=build /agent /agent
EXPOSE 8081
ENTRYPOINT ["/agent"]
