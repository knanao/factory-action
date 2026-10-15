#!/bin/sh
# Enables the checked-in Git hooks in .githooks/ for this clone. `bun install`
# runs it through the `prepare` script. It does nothing in CI, where commits
# (such as the Licensed workflow's) must not run the hooks, or outside a git
# checkout.
[ -n "${CI:-}" ] && exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git config core.hooksPath .githooks
