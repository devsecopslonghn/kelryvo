# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Native application image. Existing exact-artifact, source and publication
# gates remain required; a local build does not nominate or publish a release.
FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS native-build
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils python3 gcc libc6-dev pkg-config libssl-dev git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/kelryvo-source
ARG TARGETARCH
COPY docs/dependencies/rust-toolchain.json ./docs/dependencies/rust-toolchain.json
COPY scripts/rust-install-toolchain.sh ./scripts/rust-install-toolchain.sh
RUN bash scripts/rust-install-toolchain.sh "${TARGETARCH}"
ENV PATH=/opt/rust/bin:/opt/cargo/bin:/usr/bin:/bin CARGO_HOME=/opt/cargo \
    CARGO_TARGET_DIR=/opt/kelryvo-source/target CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2
RUN cargo install wasm-bindgen-cli --version 0.2.130 --locked \
    && test "$(wasm-bindgen --version)" = 'wasm-bindgen 0.2.130'
COPY Cargo.toml Cargo.lock rust-toolchain.toml LICENSE NOTICE ./
COPY Dockerfile .dockerignore compose.pilot.yaml ./
COPY crates ./crates
COPY deploy/native-oracle-helm.patch ./deploy/native-oracle-helm.patch
ARG KELRYVO_REVISION=local-unpublished
# Bootstrap in the distribution's release profile to reuse native dependencies
# and grammar artifacts within the same Cargo target directory.
# Keep one target per platform and serialize the shared locked source cache.
RUN --mount=type=cache,id=kelryvo-native-${TARGETARCH}-rust-1.99.1,target=/opt/kelryvo-source/target,sharing=locked \
    --mount=type=cache,id=kelryvo-registry-rust-1.99.1,target=/opt/cargo/registry,sharing=locked \
    cargo build -p kelryvo-cli --release --locked \
    && target/release/kelryvo build-dist /opt/native-distribution \
    && target/release/kelryvo verify-dist /opt/native-distribution

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS app
# OCI itself and wallets stay external, reviewed operator inputs. libaio/libnsl
# support that client; no Node, JVM, Python, Cargo or Rust compiler is installed.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git libssl3 libaio1 libnsl2 libatomic1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/kelryvo
COPY --from=native-build /opt/native-distribution/ ./
RUN /opt/kelryvo/bin/kelryvo verify-dist /opt/kelryvo \
    && mkdir -p /opt/licenses \
    && /opt/kelryvo/bin/kelryvo runtime-inventory /opt/licenses/os
ARG KELRYVO_REVISION=local-unpublished
LABEL org.opencontainers.image.source="https://github.com/devsecopslonghn/kelryvo" \
      org.opencontainers.image.revision="${KELRYVO_REVISION}" \
      org.opencontainers.image.licenses="PolyForm-Shield-1.0.0" \
      dev.kelryvo.implementation="rust"
USER 0:0
EXPOSE 8443
ENTRYPOINT ["/opt/kelryvo/bin/kelryvo-runtime"]
