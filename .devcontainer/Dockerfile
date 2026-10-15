# Development container image for factory-action.
#
# The base image ships Node.js 24 - the runtime the action deploys to - plus
# common TypeScript tooling. Bun, this repo's package manager, test runner and
# bundler, is layered on top at the version pinned in .bun-version, so the
# container reproduces the documented development environment exactly:
# .bun-version stays the single source of truth, and the trailing test fails
# the build if the installed Bun ever drifts from the pin.

FROM mcr.microsoft.com/devcontainers/typescript-node:24-bookworm

USER root

# The Bun installer unzips the release archive it downloads.
RUN apt-get update \
  && apt-get install -y --no-install-recommends unzip \
  && rm -rf /var/lib/apt/lists/*

# Install Bun system-wide (/usr/local/bin) so it is on PATH for every user,
# without shell rc-file tweaks. BuildKit re-runs this layer whenever the pin
# file changes, so bumping Bun only requires editing .bun-version.
COPY .bun-version /tmp/.bun-version
RUN export BUN_INSTALL=/usr/local \
  && curl -fsSL -o /tmp/bun-install.sh https://bun.com/install \
  && bash /tmp/bun-install.sh "bun-v$(cat /tmp/.bun-version)" \
  && test "$(bun --version)" = "$(cat /tmp/.bun-version)" \
  && rm -f /tmp/bun-install.sh /tmp/.bun-version

# The base image's day-to-day user (the typescript-node images ship `node`,
# uid 1000, rather than the `vscode` user of other devcontainers images).
USER node
