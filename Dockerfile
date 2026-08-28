# syntax=docker/dockerfile:1.7
# foundry — the orchestrator, its web UI and the Claude Code CLI it drives.
# The image brings the tools; the login and your repositories come from mounted volumes.
ARG BUN_VERSION=1.3.13
ARG CLAUDE_CODE_VERSION=2.1.241

# ---------- base: node (for the Claude Code CLI and npx) + bun (the engine's runtime) ----------
FROM node:22-bookworm-slim AS base
ARG BUN_VERSION
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ripgrep ca-certificates curl gnupg \
 && rm -rf /var/lib/apt/lists/*
RUN npm install -g bun@${BUN_VERSION} && npm cache clean --force
WORKDIR /app

# ---------- deps: workspace manifests only, so the install layer caches ----------
FROM base AS deps
COPY package.json bun.lock bunfig.toml ./
COPY packages/core/package.json packages/core/
COPY packages/runner/package.json packages/runner/
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

# ---------- build: the React UI the server serves ----------
FROM deps AS build
COPY . .
RUN bun run web:build

# ---------- runtime ----------
FROM base AS runtime
ARG CLAUDE_CODE_VERSION
# gh: the engine's only remote arm (push / PR / merge). uv: optional markitdown installs from the Setup page.
RUN mkdir -p -m 755 /etc/apt/keyrings \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update && apt-get install -y --no-install-recommends gh \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
# graphify: the context provider that hands sessions only the relevant files/symbols (the catalog's one `required` tool).
# System-wide so the non-root user can run it; uv fetches its own Python.
ENV UV_TOOL_DIR=/opt/uv/tools UV_TOOL_BIN_DIR=/usr/local/bin UV_PYTHON_INSTALL_DIR=/opt/uv/python
RUN uv tool install graphifyy && chmod -R a+rX /opt/uv && graphify --version
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

# production dependencies only (the UI is already built)
COPY package.json bun.lock bunfig.toml ./
COPY packages/core/package.json packages/core/
COPY packages/runner/package.json packages/runner/
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY apps/cli/package.json apps/cli/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile --production

COPY tsconfig.base.json tsconfig.json ./
COPY packages ./packages
COPY apps/cli ./apps/cli
COPY roles ./roles
COPY catalog ./catalog
COPY scripts ./scripts
COPY CONTEXT.md README.md ./
COPY docs ./docs
# so a user who only pulled the image can get the compose file: docker run --rm <image> cat /app/docker-compose.yml
COPY docker-compose.yml ./docker-compose.yml
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
COPY --from=build /app/apps/web/dist ./apps/web/dist

# everything Claude Code keeps (login, sessions, skills) lives in one mounted directory
ENV CLAUDE_CONFIG_DIR=/home/node/.claude \
    FOUNDRY_HOST=0.0.0.0 \
    FOUNDRY_PORT=4111
RUN mkdir -p /app/data /home/node/.claude /repos && chown -R node:node /app /home/node /repos
USER node
EXPOSE 4111
VOLUME ["/app/data", "/home/node/.claude"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD curl -fsS http://127.0.0.1:4111/api/health || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "apps/cli/src/main.ts", "serve"]
