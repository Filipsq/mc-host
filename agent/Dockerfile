# Built on the machine doing the build for whichever machine runs it, so the
# main machine can build the agent for the others (deploy/add-node.sh).
FROM --platform=$BUILDPLATFORM golang:1.25 AS build
ARG TARGETARCH
WORKDIR /src
COPY . .
RUN CGO_ENABLED=0 GOARCH=$TARGETARCH go build -o /agent .

FROM gcr.io/distroless/static-debian12
COPY --from=build /agent /agent
EXPOSE 8081
ENTRYPOINT ["/agent"]
