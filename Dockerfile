# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
# Native application image. Existing exact-artifact, source and publication
# gates remain required; a local build does not nominate or publish a release.
FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS build-prerequisites
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl xz-utils gcc libc6-dev pkg-config libssl-dev git \
    && rm -rf /var/lib/apt/lists/*
FROM build-prerequisites AS rust-toolchain-amd64
ADD --checksum=sha256:2ff05ff9c08a90861e7f6e4065b40a8b87463b4576186fd613871c3e37f2091f https://static.rust-lang.org/dist/2026-10-15/rustc-1.99.1-x86_64-unknown-linux-gnu.tar.xz /tmp/kelryvo-toolchain/
RUN tar -xJf /tmp/kelryvo-toolchain/rustc-1.99.1-x86_64-unknown-linux-gnu.tar.xz -C /tmp/kelryvo-toolchain \
    && /bin/bash /tmp/kelryvo-toolchain/rustc-1.99.1-x86_64-unknown-linux-gnu/install.sh --prefix=/opt/rust --disable-ldconfig
ADD --checksum=sha256:53f3521949404d595efb06a55c12c5658d4ed1c75566f33d3d514eaebe70bd8a https://static.rust-lang.org/dist/2026-10-15/cargo-1.99.1-x86_64-unknown-linux-gnu.tar.xz /tmp/kelryvo-toolchain/
RUN tar -xJf /tmp/kelryvo-toolchain/cargo-1.99.1-x86_64-unknown-linux-gnu.tar.xz -C /tmp/kelryvo-toolchain \
    && /bin/bash /tmp/kelryvo-toolchain/cargo-1.99.1-x86_64-unknown-linux-gnu/install.sh --prefix=/opt/rust --disable-ldconfig
ADD --checksum=sha256:109b074225bf5b9ea3820890876bfdf4ed161adbfaf94b2b4b5984c85ee5d958 https://static.rust-lang.org/dist/2026-10-15/rust-std-1.99.1-x86_64-unknown-linux-gnu.tar.xz /tmp/kelryvo-toolchain/
RUN tar -xJf /tmp/kelryvo-toolchain/rust-std-1.99.1-x86_64-unknown-linux-gnu.tar.xz -C /tmp/kelryvo-toolchain \
    && /bin/bash /tmp/kelryvo-toolchain/rust-std-1.99.1-x86_64-unknown-linux-gnu/install.sh --prefix=/opt/rust --disable-ldconfig
ADD --checksum=sha256:5f628f857dd00a8aa3fcac2e275665d2782066a5795274ed124c5b560f46423c https://static.rust-lang.org/dist/2026-10-15/rust-std-1.99.1-wasm32-unknown-unknown.tar.xz /tmp/kelryvo-toolchain/
RUN tar -xJf /tmp/kelryvo-toolchain/rust-std-1.99.1-wasm32-unknown-unknown.tar.xz -C /tmp/kelryvo-toolchain \
    && /bin/bash /tmp/kelryvo-toolchain/rust-std-1.99.1-wasm32-unknown-unknown/install.sh --prefix=/opt/rust --disable-ldconfig
ADD --checksum=sha256:9687f3bb551b9f66f37ed32a40d7913a00f7962db653054e56857bc306c3227f https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.130/wasm-bindgen-0.2.130-x86_64-unknown-linux-musl.tar.gz /tmp/kelryvo-toolchain/
RUN mkdir -p /opt/wasm-bindgen \
    && tar -xzf /tmp/kelryvo-toolchain/wasm-bindgen-0.2.130-x86_64-unknown-linux-musl.tar.gz --strip-components=1 -C /opt/wasm-bindgen
ADD --checksum=sha256:aa73c7270c997894038c0d8f0d297865f57569e1687883322bc431713d4bb9dd https://github.com/mozilla/sccache/releases/download/v0.19.0/sccache-v0.19.0-x86_64-unknown-linux-musl.tar.gz /tmp/kelryvo-toolchain/
RUN mkdir -p /opt/sccache \
    && tar -xzf /tmp/kelryvo-toolchain/sccache-v0.19.0-x86_64-unknown-linux-musl.tar.gz --strip-components=1 -C /opt/sccache
RUN rm -rf /tmp/kelryvo-toolchain

FROM build-prerequisites AS rust-toolchain-arm64
ADD --checksum=sha256:acdcdfe09ae1f103aa9a2b7f88903a9588bc2e99288af10e6fbf5514e2e49f25 https://static.rust-lang.org/dist/2026-10-15/rustc-1.99.1-aarch64-unknown-linux-gnu.tar.xz /tmp/kelryvo-toolchain/
RUN tar -xJf /tmp/kelryvo-toolchain/rustc-1.99.1-aarch64-unknown-linux-gnu.tar.xz -C /tmp/kelryvo-toolchain \
    && /bin/bash /tmp/kelryvo-toolchain/rustc-1.99.1-aarch64-unknown-linux-gnu/install.sh --prefix=/opt/rust --disable-ldconfig
ADD --checksum=sha256:5156832e0c1254e9b49a79edabdc6d4c35f32f8fc1cf3ca700f268ff96087ab0 https://static.rust-lang.org/dist/2026-10-15/cargo-1.99.1-aarch64-unknown-linux-gnu.tar.xz /tmp/kelryvo-toolchain/
RUN tar -xJf /tmp/kelryvo-toolchain/cargo-1.99.1-aarch64-unknown-linux-gnu.tar.xz -C /tmp/kelryvo-toolchain \
    && /bin/bash /tmp/kelryvo-toolchain/cargo-1.99.1-aarch64-unknown-linux-gnu/install.sh --prefix=/opt/rust --disable-ldconfig
ADD --checksum=sha256:e25668477083d6a9ddb87b9beb9c00742225f38233ccb4bfba3afa7a07427f52 https://static.rust-lang.org/dist/2026-10-15/rust-std-1.99.1-aarch64-unknown-linux-gnu.tar.xz /tmp/kelryvo-toolchain/
RUN tar -xJf /tmp/kelryvo-toolchain/rust-std-1.99.1-aarch64-unknown-linux-gnu.tar.xz -C /tmp/kelryvo-toolchain \
    && /bin/bash /tmp/kelryvo-toolchain/rust-std-1.99.1-aarch64-unknown-linux-gnu/install.sh --prefix=/opt/rust --disable-ldconfig
ADD --checksum=sha256:5f628f857dd00a8aa3fcac2e275665d2782066a5795274ed124c5b560f46423c https://static.rust-lang.org/dist/2026-10-15/rust-std-1.99.1-wasm32-unknown-unknown.tar.xz /tmp/kelryvo-toolchain/
RUN tar -xJf /tmp/kelryvo-toolchain/rust-std-1.99.1-wasm32-unknown-unknown.tar.xz -C /tmp/kelryvo-toolchain \
    && /bin/bash /tmp/kelryvo-toolchain/rust-std-1.99.1-wasm32-unknown-unknown/install.sh --prefix=/opt/rust --disable-ldconfig
ADD --checksum=sha256:99ffc93ce80081b91632e2b539b782821a8f3439ab0fddc645287462b2f55d3d https://github.com/wasm-bindgen/wasm-bindgen/releases/download/0.2.130/wasm-bindgen-0.2.130-aarch64-unknown-linux-musl.tar.gz /tmp/kelryvo-toolchain/
RUN mkdir -p /opt/wasm-bindgen \
    && tar -xzf /tmp/kelryvo-toolchain/wasm-bindgen-0.2.130-aarch64-unknown-linux-musl.tar.gz --strip-components=1 -C /opt/wasm-bindgen
ADD --checksum=sha256:3e47fc4a71b1ddd1b4294a0de9d34498922fdf41e3cd0bda5df3954e3d6deb9d https://github.com/mozilla/sccache/releases/download/v0.19.0/sccache-v0.19.0-aarch64-unknown-linux-musl.tar.gz /tmp/kelryvo-toolchain/
RUN mkdir -p /opt/sccache \
    && tar -xzf /tmp/kelryvo-toolchain/sccache-v0.19.0-aarch64-unknown-linux-musl.tar.gz --strip-components=1 -C /opt/sccache
RUN rm -rf /tmp/kelryvo-toolchain

FROM rust-toolchain-${TARGETARCH} AS native-build
WORKDIR /opt/kelryvo-source
ARG TARGETARCH
COPY docs/dependencies/rust-toolchain.json ./docs/dependencies/rust-toolchain.json
ENV PATH=/opt/rust/bin:/opt/wasm-bindgen:/opt/sccache:/opt/cargo/bin:/usr/bin:/bin CARGO_HOME=/opt/cargo \
    CARGO_TARGET_DIR=/opt/kelryvo-source/target CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=4
ENV RUSTC_WRAPPER=/opt/sccache/sccache SCCACHE_DIR=/opt/kelryvo-source/target/sccache \
    SCCACHE_SERVER_UDS=/tmp/kelryvo-sccache.sock SCCACHE_CACHE_SIZE=512M
RUN test "$(wasm-bindgen --version)" = 'wasm-bindgen 0.2.130'
COPY Cargo.toml Cargo.lock rust-toolchain.toml LICENSE NOTICE ./
COPY .cargo/config.toml ./.cargo/config.toml
COPY Dockerfile .dockerignore compose.pilot.yaml ./
COPY crates ./crates
COPY deploy/native-oracle-helm.patch ./deploy/native-oracle-helm.patch
ARG KELRYVO_REVISION=local-unpublished
ARG KELRYVO_SOURCE_TREE_DIGEST=0000000000000000000000000000000000000000000000000000000000000000
# CI supplies a read-only inventory hint so the first compilation already has
# the final identity and full feature graph. build-dist independently recomputes
# the source inventory and rebuilds if the hint is absent or differs.
ENV KELRYVO_SOURCE_SHA=${KELRYVO_REVISION} KELRYVO_SOURCE_TREE_DIGEST=${KELRYVO_SOURCE_TREE_DIGEST}
# Keep one target per platform and serialize the shared locked source cache.
RUN --mount=type=cache,id=kelryvo-native-${TARGETARCH}-rust-1.99.1,target=/opt/kelryvo-source/target,sharing=locked \
    --mount=type=cache,id=kelryvo-registry-rust-1.99.1,target=/opt/cargo/registry,sharing=locked \
    --mount=type=tmpfs,target=/tmp \
    cargo build --release --locked -p kelryvo-cli -p kelryvo-server -p kelryvo-worker -p kelryvo-operator -p kelryvo-launcher \
    && target/release/kelryvo-repository toolchain --installed \
    && target/release/kelryvo build-dist /opt/native-distribution \
    && target/release/kelryvo verify-dist /opt/native-distribution \
    && /opt/sccache/sccache --stop-server

# Export a native test helper against the same libc as the image. Host CI
# runners can have a newer libc; their executables must not be mounted here.
# This separate target is never copied into the shipped application image.
FROM native-build AS container-test-build
RUN --mount=type=cache,id=kelryvo-native-${TARGETARCH}-rust-1.99.1,target=/opt/kelryvo-source/target,sharing=locked \
    --mount=type=cache,id=kelryvo-registry-rust-1.99.1,target=/opt/cargo/registry,sharing=locked \
    --mount=type=tmpfs,target=/tmp \
    KELRYVO_SOURCE_SHA=${KELRYVO_REVISION} cargo build --locked --release \
      -p kelryvo-test-tools --bin kelryvo-container-probe \
    && cp target/release/kelryvo-container-probe /opt/kelryvo-container-probe \
    && /opt/sccache/sccache --stop-server

FROM scratch AS container-test-tools
COPY --from=container-test-build /opt/kelryvo-container-probe /kelryvo-container-probe

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
