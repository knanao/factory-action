# Development container image for factory-action.
#
# The base image ships Node.js 24 — the runtime the action deploys to — plus
# common TypeScript tooling. Bun, this repo's package manager, test runner and
# bundler, is layered on top at the version pinned in .bun-version so the
# container reproduces the documented development environment exactly.

FROM mcr.microsoft.com/devcontainers/typescript-node:24

# Install Bun system-wide (/usr/local/bin) so it is on PATH for every user
# without shell rc-file tweaks. .bun-version is the single source of truth:
# BuildKit re-runs this layer whenever the pin file changes, and the trailing
# test fails the build if the installed version ever drifts.
USER root
COPY .bun-version /tmp/.bun-version
RUN export BUN_INSTALL=/usr/local \
  && curl -fsSL -o /tmp/bun-install.sh https://bun.sh/install \
  && bash /tmp/bun-install.sh "bun-v$(cat /tmp/.bun-version)" \
  && test "$(bun --version)" = "$(cat /tmp/.bun-version)" \
  && rm -f /tmp/bun-install.sh /tmp/.bun-version

# Back to the base image's day-to-day user (uid 1000, with passwordless
# sudo, per the devcontainers common-utils setup).
USER node
