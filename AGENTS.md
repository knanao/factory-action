# AGENTS.md

Operating brief for autonomous agents working in this repository. Human
onboarding and user-facing documentation live in `README.md` and
`CONTRIBUTING.md`.

## What this project is

A GitHub Action that delegates work from GitHub to Factory Droid through the
Sessions API. It is fire-and-forget: each run parses the webhook event,
authorizes the sender, reuses or creates a session for the lane, posts one
message, and exits within seconds. Droid then writes results (PRs, comments,
reviews) back to GitHub itself, working either on an existing Droid Computer
(`computer-id`) or on a per-thread computer created from a Factory Environment
(`environment-id`) — set exactly one of the two. Sessions are keyed by
`(repository, issue/PR number, lane)`; the mapping is stored in a hidden marker
inside the action's own tracking comment.

## Commands

Development uses [Bun](https://bun.com) (version pinned in `.bun-version`) as
the package manager, test runner, bundler, and formatter: `bun fmt`, its
built-in Prettier-compatible command. The action itself runs on GitHub's
`node24` runtime.

- Install dependencies: `bun install` (also enables the pre-commit hook, see
  below)
- Everything (format, lint, typecheck, static checks, test, rebuild `dist/`,
  bundle budget): `bun run all`
- All checks without rewriting files or running tests: `bun run check`
- Format: `bun run format:write` (check only: `bun run format:check`)
- Lint: `bun run lint`
- Typecheck: `bun run typecheck`
- Run all tests: `bun test`
- Run focused tests: `bun test __tests__/state.test.ts`
- Tests with coverage (as CI runs them): `bun run ci-test`. It fails when any
  file under `src/` drops below 90% of lines or functions (`coverageThreshold`
  in `bunfig.toml`, checked per file); add tests instead of lowering it.
- Rebuild `dist/`: `bun run package` (or `bun run bundle` to format first)
- Run the action locally: `bun run local-action`

Static checks (`bun run check:static` runs the first five):

- Dead code, unused exports and unused or unlisted dependencies: `bun run knip`
  (config: `knip.jsonc`)
- Module boundaries and circular imports: `bun run depcruise` (config:
  `.dependency-cruiser.cjs`)
- Duplicate code: `bun run jscpd` (config: `.jscpd.json`)
- Tracked file sizes: `bun run check:size` (`script/check-file-size.ts`)
- Tech-debt markers: `bun run check:todos` (`script/check-todos.ts`)
- Bundle size budget and heaviest packages: `bun run check:bundle`
  (`script/check-bundle-size.ts`; run `bun run package` first)

### Pre-commit hook

`bun install` runs the `prepare` script (`script/install-hooks.sh`), which sets
`git config core.hooksPath .githooks`; it does nothing in CI (`CI` set) or
outside a git checkout. `.githooks/pre-commit` then runs
`bun fmt --check --staged` and ESLint on the staged files, the typecheck and
`bun run check:static`, in about five seconds. It replaces any hooks in
`.git/hooks`. Agents must never bypass it (`git commit --no-verify`); fix the
failure instead. Humans may bypass it only in an emergency, since CI runs the
same checks.

## Project layout

- `action.yml` — the action's public contract (inputs, outputs, branding). Keep
  it in sync with `README.md` when inputs, outputs, or modes change.
- `src/` — TypeScript sources, entry chain `index.ts` → `main.ts`:
  - `trigger.ts` — parses webhook events into a `Trigger`; prechecks
    (no-trigger, fork, bot, draft) and slash-command detection.
  - `authz.ts` — authorizes by `author_association`, with a permission-API
    fallback for private org members.
  - `delegate.ts` — orchestration: skip reasons, session reuse, prompt building,
    message send.
  - `cleanup.ts` — cleanup mode for a closed thread: asks its sessions to clean
    up, or deletes its Environment computers.
  - `factory.ts` — Sessions API client plus computer management (create, get,
    interrupt sessions; post messages; create, find, delete computers).
  - `compute.ts` — Environment mode: one computer per (issue/PR, lane), created
    from a Factory Environment, found again by its deterministic name and
    deleted in cleanup mode.
  - `github.ts` — GitHub API wrapper (reactions, comments, permissions).
  - `inputs.ts` — parses and validates action inputs.
  - `logger.ts` — structured logfmt records routed to `@actions/core`, with a
    per-run context (the trace IDs) appended to every record.
  - `trace.ts` — W3C trace IDs for the run's log records: joins `TRACEPARENT` or
    starts a trace, plus the OpenTelemetry CI/CD attributes. The context is
    never sent to an API; no OpenTelemetry SDK and no exporter.
  - `state.ts` — lane-to-session state (session id, last SHA, created computer),
    encoded in the tracking comment.
  - `prompts/` — system rules and per-mode prompt builders (mention, review,
    security, deep-security, qa, wiki, cleanup, custom).
- `__tests__/` — one `bun:test` file per module.
- `__fixtures__/` — mocked `@actions/core`, webhook payload helpers, and
  builders for inputs and tracking comments; tests load the mock with
  `mock.module('@actions/core', ...)` before importing the module under test.
- `docs/runbooks/` — operational procedures (failed or skipped runs, Environment
  computers, API key rotation, CI failures, release rollback). Keep them in sync
  when log events, error messages or release steps change.
- `examples/` — user-facing example workflows (mention, CI review, cleanup,
  Environment cleanup, QA, security audit, wiki).
- `dist/` — the committed bundle the action runs. Generated; see below.
- `script/check-*.ts` — repository checks run with Bun (file sizes, tech-debt
  markers, bundle budget); `script/lib/` holds their shared helpers.
  `script/install-hooks.sh` enables the Git hooks.
- `script/qa/` — the offline QA harness (mock APIs, sample events and the
  Bun-safe `local-action` wrapper).
- `.githooks/` — the checked-in pre-commit hook.
- `.github/workflows/` — CI (format, lint, typecheck, static checks, test),
  `check-dist.yml` (fails when `dist/` is stale or over its size budget),
  CodeQL, licensed, `factory.yml`, which runs this action on itself for
  `@factory` mentions, and `release.yml`, the manually run release (checks the
  commit, tags `vX.Y.Z`, publishes the GitHub release with generated notes and
  moves the major tag).
- `.github/` also holds `CODEOWNERS`, `dependabot.yml`, `release.yml` (release
  note categories by `type:` label), the pull request template and the issue
  forms (`ISSUE_TEMPLATE/`).

### Module boundaries

`.dependency-cruiser.cjs` enforces these rules (`bun run depcruise`):

- No circular imports, and no orphan modules outside `script/`.
- `src/prompts/` is pure text building: it imports only other prompt modules,
  `trigger.ts` and the types of `inputs.ts`; no API clients, orchestration or
  packages.
- The leaf modules `authz.ts`, `github.ts`, `inputs.ts`, `state.ts`, `trace.ts`
  and `trigger.ts` never import `factory.ts`, `compute.ts`, `cleanup.ts`,
  `delegate.ts`, `main.ts`, `index.ts` or `src/prompts/`.
- Only `github.ts` (and `main.ts`, for the event context) imports
  `@actions/github`, which keeps the GitHub token in one place.
- Only `index.ts` (and tests) import `main.ts`.
- `src/` never imports `__tests__/`, `__fixtures__/`, `script/` or a
  devDependency, and every package import is declared in `package.json`.

## Generated files

`dist/` is built from `src/` by `bun run package` and is committed, because
GitHub runs `dist/index.js`. Never edit it by hand: change `src/`, then rebuild
and commit `dist/` in the same change. The Check Transpiled JavaScript workflow
fails CI when `dist/` does not match the sources.

## Conventions

- Commit messages follow Conventional Commits, e.g.
  `fix: review full PR diff after interrupted CI sessions`.
- Pull requests fill in `.github/pull_request_template.md`. Every issue carries
  one `type:`, one `priority:` and one `area:` label (PRs may use them too); the
  taxonomy is in `CONTRIBUTING.md` (Issues and labels). `main` is protected by a
  ruleset (PR, one approval, required checks), so never push to it directly.
- Dependabot (`.github/dependabot.yml`) opens weekly update PRs after a 7-day
  minimum release age (14 for npm majors). A runtime (`@actions/*`) update needs
  `bun run package` and the rebuilt `dist/` pushed to the same branch; see
  `CONTRIBUTING.md` (Dependency updates).
- Add tests for behavior changes; they live in `__tests__/` and use the fixtures
  in `__fixtures__/`.
- Keep docs in sync: when adding or changing an input, output, or mode, update
  both `action.yml` and the tables in `README.md`.
- Formatting is enforced by `bun fmt`, Bun's built-in Prettier-compatible
  formatter (no semicolons, single quotes, 80 columns, hard-wrapped prose; it
  reads `.prettierrc.yml`). CI runs `bun run format:check` and the pre-commit
  hook checks the staged files, so formatting is not optional.
- TypeScript is strict (`strict`, `noUnusedLocals`). Tests and fixtures are
  excluded from `tsconfig.json` but still linted by ESLint.
- Prefer the existing dependencies (`@actions/core`, `@actions/github`); do not
  add a dependency unless the current stack cannot solve the problem. The
  devDependencies `knip`, `dependency-cruiser` and `jscpd` exist because ESLint
  and TypeScript cannot find unused files and dependencies, enforce import
  boundaries across modules, or detect copy-paste.
- Naming (enforced by `@typescript-eslint/naming-convention`): `camelCase` for
  variables, functions, parameters, methods and properties; `PascalCase` for
  classes, interfaces, type aliases and enums; `UPPER_CASE` only for `const`
  values such as `MODES` or `DROID_MARKER`. Object and type properties may also
  use `snake_case` or `UPPER_CASE` (and object properties `PascalCase`) where
  they mirror an external shape: webhook payloads (`author_association`),
  environment variables (`INPUT_MODE`), HTTP headers (`Authorization`). Keys
  that need quotes (`'Content-Type'`) are not checked. File names use
  `kebab-case` (a convention; not linted).
- Size and complexity budgets (ESLint errors): `complexity` 15 per function,
  `max-depth` 4, `max-params` 4 (pass an options object instead), `max-lines`
  400 per file, 700 in `__tests__/` (blank and comment lines excluded; the
  largest today are `src/delegate.ts` at about 390 and
  `__tests__/delegate.test.ts` at about 630). When a function or file hits a
  limit, split it; do not raise the limit or add disable comments.
- Duplicate code: `jscpd` reports clones of at least 50 tokens and 5 lines.
  `src/` must have none, and the whole codebase (`src/`, `__tests__/`,
  `__fixtures__/`, `script/`, `.githooks/`) must stay under 1.5% duplicated
  lines (about 0.9% today, all in tests).
- File sizes: every tracked file must stay under 100 KiB, except `bun.lock` (256
  KiB). `dist/` is exempt there because `dist/index.js` has its own budget:
  1,100,000 bytes (about 966 KB today), checked by `bun run check:bundle`, which
  also lists the heaviest packages. Raise a budget only in the change that
  explains the growth.
- Tech debt: every TODO, FIXME, HACK or XXX marker in code must name a GitHub
  issue right after the marker, as in `TODO(#123): drop once Bun supports X`.
  `bun run check:todos` scans tracked code and config files (not Markdown or
  `dist/`), fails on unlinked markers and lists the linked ones, also in the CI
  job summary. Open an issue before leaving a marker.

## Security rules

- `factory-api-key` reaches only the Factory API. `github-token` is used only
  for the action's own reaction and tracking comment and must never be sent to
  Droid.
- Authorization is deny-by-default. Outside users are skipped quietly (no
  comment noise): `author_association` first, permission API as fallback.
- GitHub content (comment bodies, PR text, diffs) is untrusted input. Keep it
  clearly delimited in prompts; the system rules tell Droid not to follow
  instructions embedded in it. Do not remove those rules.
- Bots are ignored unless listed in `allowed-bots`. Droid's own posts carry
  `<!-- factory-droid -->` and the action's state marker is
  `<!-- factory-action:state ... -->`; both must stay ignored so the action
  never triggers itself. The prompt must keep telling Droid never to write the
  trigger phrase.
- Data handling is documented in `SECURITY.md` (Data handling and personal
  data): what is read, sent to Factory, stored in the tracking comment and
  logged. Update it when that changes. Never log comment bodies, PR text, diffs
  or prompts, never store them in the state marker, and keep fixtures and QA
  events fictional (`alice`, `acme/widgets`, placeholder keys).

## Verification

Before calling work finished, run:

1. `bun run format:check && bun run lint && bun run typecheck`
2. `bun run check:static` (knip, dependency-cruiser, jscpd, file sizes,
   tech-debt markers)
3. `bun test` (plus the focused test file while iterating)
4. `bun run package` when `src/` changed, then `bun run check:bundle`, and
   commit the rebuilt `dist/` in the same change.

`bun run all` covers the same ground with `format:write`. CI runs format, lint,
typecheck, the static checks, tests, the dist check with the bundle budget, and
CodeQL; all must pass before review. The pre-commit hook runs steps 1 and 2.
