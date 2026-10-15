# Contributing

Thanks for your interest in contributing. Bug reports, feature requests and pull
requests are all welcome.

## Development setup

Development uses [Bun](https://bun.com) (version pinned in `.bun-version`) as
the package manager, test runner and bundler. The action itself runs on GitHub's
`node24` runtime.

```sh
bun install    # also enables the pre-commit hook
bun run all    # format, lint, typecheck, static checks, test, bundle dist/
bun run check  # every check, without rewriting files or running tests
```

### Checks

| Command                | What it enforces                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lint`         | ESLint, including naming conventions, `complexity` ≤ 15, `max-depth` ≤ 4, `max-params` ≤ 4 and `max-lines` ≤ 400 (700 for tests) |
| `bun run knip`         | No unused files, exports or dependencies, and no unlisted ones (`knip.jsonc`)                                                    |
| `bun run depcruise`    | Module boundaries and no circular imports (`.dependency-cruiser.cjs`, rules listed in `AGENTS.md`)                               |
| `bun run jscpd`        | No duplicated code in `src/`, under 1.5% duplication overall (`.jscpd.json`)                                                     |
| `bun run check:size`   | Tracked files stay under 100 KiB (`bun.lock`: 256 KiB)                                                                           |
| `bun run check:todos`  | TODO, FIXME, HACK and XXX markers link to an issue, as in `TODO(#123): ...`                                                      |
| `bun run check:bundle` | `dist/index.js` stays under 1,100,000 bytes; lists the heaviest packages (run `bun run package` first)                           |

`bun run check:static` runs knip, dependency-cruiser, jscpd and the size and
marker checks together. `knip`, `dependency-cruiser` and `jscpd` are the only
devDependencies added for these checks: ESLint and TypeScript cannot find unused
files and dependencies, enforce import boundaries across modules, or detect
copy-paste.

Names follow the codebase: `camelCase` for variables, functions and properties,
`PascalCase` for types and classes, `UPPER_CASE` for module-level constants.
Properties that mirror webhook payloads, environment variables or HTTP headers
keep their external spelling. `AGENTS.md` (Conventions) has the details.

### Pre-commit hook

`bun install` runs the `prepare` script (`script/install-hooks.sh`), which
points `core.hooksPath` at `.githooks/` (skipped when `CI` is set). Before each
commit, `.githooks/pre-commit` runs Prettier and ESLint on the staged files, the
typecheck and `bun run check:static` (about five seconds). Run it by hand with
`.githooks/pre-commit`. Bypass it with `git commit --no-verify` only in an
emergency: CI runs the same checks, and automated agents must never bypass it.

### Dev container

To skip local setup entirely, open the repository in the dev container
(`.devcontainer/`): its image installs the exact Bun version from `.bun-version`
plus Node.js 24 (the action's runtime), and the first start runs `bun install`.
It works with VS Code Dev Containers, GitHub Codespaces and the Dev Containers
CLI:

```sh
npm install --global @devcontainers/cli
devcontainer up --workspace-folder .
```

## Trying the action locally

To run the action against a local (simulated) event, copy `.env.example` to
`.env` and fill in the required values: Factory API key, a Droid Computer id or
Environment id, a GitHub PAT and a webhook payload file (`GITHUB_EVENT_PATH`).
Then run:

```sh
bun run local-action   # local-action . src/main.ts .env
```

To run the action end to end without Factory or GitHub credentials, start the
mock API and send it a sample event:

```sh
bun run qa:mock &   # mock Factory Sessions API + GitHub REST API on :4010
bun run qa:run script/qa/events/issue_comment.mention.json
curl -s http://127.0.0.1:4010/__qa/state   # sessions, prompts, comments
```

The full scenario list and what to check is in
[`.factory/skills/qa/SKILL.md`](./.factory/skills/qa/SKILL.md).

## House rules

- **`dist/` is committed.** The action runs `dist/index.js`, so rebuild and
  commit it with every source change (`bun run all` does this). The **Check
  Transpiled JavaScript** workflow fails if `dist/` is stale.
- **Add tests for behavior changes.** Tests run with `bun test` and live in
  `__tests__/`, with webhook payload helpers in `__fixtures__/`.
- **Keep the docs in sync.** When you add or change an input, output or mode,
  update both `action.yml` and the tables in `README.md`.
- **Commit messages** follow the Conventional Commits style used in the history,
  e.g. `fix: review full PR diff after interrupted CI sessions`.
- Releases are cut by the maintainer with `script/release`, which tags `vX.Y.Z`
  and moves the major tag `v1`.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change and run `bun run all` until it is green.
3. Open a pull request against `main` with a short description of the change and
   its motivation.
4. CI (format, lint, typecheck, static checks, tests, dist check with the bundle
   budget, CodeQL) must pass before review.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE) that covers this project.
