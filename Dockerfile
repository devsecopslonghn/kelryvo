# syntax=docker/dockerfile:1
# Native amd64 matches the existing cluster and the pinned parser JDK archive.
FROM node:22.23.3-bookworm-slim@sha256:efd0ab5780c2d9ab1f0f869571a00d5edb17793bff4cce4a2792e3eb0ffc7562 AS base
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt/kelryvo

FROM base AS build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
RUN node scripts/antlr-prepare.mjs --download
RUN node scripts/container-source-archives.mjs
ENV SCHEMAFORGE_JAVA_HOME=/opt/kelryvo/.cache/antlr/temurin
RUN node scripts/antlr-build.mjs
RUN SCHEMAFORGE_PRODUCT_NAME=Kelryvo node scripts/build-web.mjs
RUN GIT_AUTHOR_DATE=2000-01-01T00:00:00Z GIT_COMMITTER_DATE=2000-01-01T00:00:00Z \
    node --input-type=module -e "import {prepareDemoRepository} from './scripts/local-resources.mjs'; await prepareDemoRepository();"
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM debian:bookworm-slim@sha256:a4672c0cb26fbdde88e38fa2dfb6c681942306680e41e4378b28770b6e79ee91 AS runtime
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
RUN node scripts/container-inventory.mjs
ENV NODE_ENV=production SCHEMAFORGE_JAVA_HOME=/opt/kelryvo/.cache/antlr/temurin
ARG KELRYVO_REVISION=local-unpublished
LABEL org.opencontainers.image.source="https://github.com/devsecopslonghn/schemaForge" \
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
