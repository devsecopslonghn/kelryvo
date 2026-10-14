# syntax=docker/dockerfile:1
# Each stage resolves the pinned multi-platform base for the Buildx target architecture.
FROM node:22.23.3-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392 AS base
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/kelryvo

FROM base AS build
ARG TARGETARCH
RUN node -e "if ({x64:'amd64',arm64:'arm64'}[process.arch] !== '${TARGETARCH}') process.exit(1)"
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
# Keep pinned parser/JDK/source inputs independent of application edits, so the
# reviewed parser build can be reused without downloading or recompiling it.
COPY docs/dependencies ./docs/dependencies
COPY experiments/db-devops-wp0/antlr-helper ./experiments/db-devops-wp0/antlr-helper
COPY scripts/antlr-prepare.mjs scripts/antlr-build.mjs scripts/jdk-platform.mjs scripts/container-source-archives.mjs ./scripts/
RUN node scripts/antlr-prepare.mjs --download
RUN node scripts/container-source-archives.mjs
ENV SCHEMAFORGE_JAVA_HOME=/opt/kelryvo/.cache/antlr/temurin
RUN node scripts/antlr-build.mjs
COPY . .
RUN SCHEMAFORGE_PRODUCT_NAME=Kelryvo node scripts/build-web.mjs
RUN GIT_AUTHOR_DATE=2000-01-01T00:00:00Z GIT_COMMITTER_DATE=2000-01-01T00:00:00Z \
    node --input-type=module -e "import {prepareDemoRepository} from './scripts/local-resources.mjs'; await prepareDemoRepository();"
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM debian:bookworm-slim@sha256:7c7b2c966bc9ee8cedfeef67e0e279108992c77681fa595db4a9d65c06ccc587 AS runtime
# Copy only Node and its full notices. npm, yarn and corepack stay in build layers.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates libatomic1 libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=base /usr/local/bin/node /usr/local/bin/node
COPY --from=base /usr/local/LICENSE /opt/licenses/node-LICENSE
WORKDIR /opt/kelryvo
COPY --from=build /opt/kelryvo/package.json /opt/kelryvo/package-lock.json /opt/kelryvo/LICENSE /opt/kelryvo/NOTICE ./
COPY --from=build /opt/kelryvo/node_modules ./node_modules
COPY --from=build /opt/kelryvo/apps ./apps
COPY --from=build /opt/kelryvo/packages ./packages
COPY --from=build /opt/kelryvo/scripts ./scripts
COPY --from=build /opt/kelryvo/docs/dependencies ./docs/dependencies
COPY --from=build /opt/kelryvo/experiments/db-devops-wp0/*.mjs ./experiments/db-devops-wp0/
COPY --from=build /opt/kelryvo/experiments/db-devops-wp0/antlr-helper ./experiments/db-devops-wp0/antlr-helper
COPY --from=build /opt/kelryvo/.cache/antlr/temurin ./.cache/antlr/temurin
COPY --from=build /opt/kelryvo/.cache/antlr/antlr4-runtime-4.13.2.jar ./.cache/antlr/antlr4-runtime-4.13.2.jar
COPY --from=build /opt/kelryvo/.cache/container-sources /opt/licenses/sources
RUN chmod 0644 .cache/antlr/antlr4-runtime-4.13.2.jar experiments/db-devops-wp0/antlr-helper/target/schemaforge-antlr-parser.jar
ARG TARGETARCH
RUN node -e "if ({x64:'amd64',arm64:'arm64'}[process.arch] !== '${TARGETARCH}') process.exit(1)" \
    && .cache/antlr/temurin/bin/java -version \
    && node scripts/container-inventory.mjs
ENV NODE_ENV=production SCHEMAFORGE_JAVA_HOME=/opt/kelryvo/.cache/antlr/temurin
ARG KELRYVO_REVISION=local-unpublished
LABEL org.opencontainers.image.source="https://github.com/devsecopslonghn/kelryvo" \
      org.opencontainers.image.revision="${KELRYVO_REVISION}" \
      org.opencontainers.image.licenses="PolyForm-Shield-1.0.0"

FROM runtime AS app
COPY --from=build /opt/kelryvo/dist/web ./dist/web
COPY --from=build --chown=10001:10001 /opt/kelryvo/.cache/local-product/demo-repository ./repositories/demo
USER 10001:10001
EXPOSE 8443
ENTRYPOINT ["node", "apps/api/container-main.mjs"]

FROM runtime AS worker
USER 10002:10002
# No installation or credentials are built in. Missing trusted installation fails closed.
ENTRYPOINT ["node", "apps/worker/execution-service-main.mjs"]
