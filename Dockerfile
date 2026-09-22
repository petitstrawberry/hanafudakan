# syntax=docker/dockerfile:1
# Nix 2.27.1, pinned multi-platform builder. Toolchains are in flake.lock.
FROM nixos/nix:2.27.1@sha256:cf7ba2afcacd7be9171259d209d2d1ae6ab183b5c561c7e7524a9bc1d8fddaa1 AS nix-base
FROM nix-base AS build
ARG TARGETARCH
WORKDIR /build
COPY . .
RUN --mount=type=cache,id=hanafudakan-nix-2.27.1-${TARGETARCH},target=/nix,from=nix-base,source=/nix,sharing=locked \
    nix --extra-experimental-features "nix-command flakes" \
      build --no-update-lock-file .#container --out-link /result \
    && mkdir -p /runtime/nix/store /runtime/app \
    && for path in $(nix-store --query --requisites /result); do \
         cp -a "$path" /runtime/nix/store/; \
       done \
    && cp -a /result/. /runtime/app/

FROM scratch AS runtime
COPY --from=build /runtime/ /
WORKDIR /app
ENV BIND_ADDR=0.0.0.0:3000 \
    RUST_LOG=info \
    SSL_CERT_FILE=/app/etc/ssl/certs/ca-bundle.crt
USER 10001:10001
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["/app/bin/curl", "--fail", "--silent", "http://127.0.0.1:3000/api/health"]
ENTRYPOINT ["/app/bin/hanafudakan-server"]
