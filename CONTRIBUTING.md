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
commit, `.githooks/pre-commit` runs `bun fmt --check --staged` and ESLint on the
staged files, the typecheck and `bun run check:static` (about five seconds). Run
it by hand with `.githooks/pre-commit`. Bypass it with `git commit --no-verify`
only in an emergency: CI runs the same checks, and automated agents must never
bypass it.

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
`.env` and fill in the required values for a real run: Factory API key, a Droid
Computer id or Environment id, a GitHub PAT and a webhook payload file
(`GITHUB_EVENT_PATH`). The shipped defaults already target the mock APIs below,
so offline runs need no edits. Then run:

```sh
bun run local-action   # via script/qa/local-action.ts (Bun-safe wrapper)
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

## Issues and labels

Open issues with the **Bug report** or **Feature request** form; blank issues
are disabled. Report security vulnerabilities privately as described in
[SECURITY.md](./SECURITY.md), never in a public issue. Redact keys, tokens and
personal data from anything you paste.

Every open issue carries exactly one label from each of these groups. The forms
set the type; the maintainer adds priority and area during triage.

- **Type**, what kind of work it is: `type: bug`, `type: feature`, `type: docs`,
  `type: chore` (tooling, refactors, dependency updates, releases), `type: test`
  or `type: security` (hardening; not for undisclosed vulnerabilities).
- **Priority**: `priority: P0` (breaks delegation for users or is a security
  risk; fix now), `priority: P1` (important, no good workaround), `priority: P2`
  (worth doing soon; a workaround exists) or `priority: P3` (nice to have, or
  blocked on an external dependency).
- **Area**, where the change lands: `area: triggers` (`trigger.ts`, `authz.ts`),
  `area: sessions` (`delegate.ts`, `factory.ts`, `state.ts`),
  `area: environments` (`compute.ts`, `cleanup.ts`), `area: prompts`
  (`src/prompts/`), `area: ci` (workflows, checks, hooks, bundling, release),
  `area: docs` (documentation and examples) or `area: dependencies` (package,
  Bun and action versions).

The GitHub defaults `duplicate`, `invalid`, `question`, `wontfix`,
`good first issue`, `help wanted` and `accessibility` are kept as optional
status labels. Pull requests may use the same labels; Dependabot labels its pull
requests `type: chore` and `area: dependencies`.

## Dependency updates

Dependabot (`.github/dependabot.yml`) checks every Monday for new versions of
the npm packages in `package.json`/`bun.lock` (the `bun` ecosystem) and of the
GitHub Actions used by the workflows:

- **Minimum release age.** A version is proposed only after it has been public
  for 7 days, 14 for a major version of an npm package. The delay gives the
  ecosystem time to catch a compromised or broken release before it lands here.
  Vulnerable dependencies are still reported immediately through Dependabot
  alerts.
- **Grouping.** Minor and patch updates are grouped: the runtime dependencies
  (`@actions/*`) in one pull request, the development tooling in another, and
  the GitHub Actions in a third. Each major update gets its own pull request.
- **Commit messages** follow Conventional Commits with a `chore` type and a
  `deps` scope, e.g. `chore(deps): bump @actions/core from 3.0.1 to 3.1.0`.
- **Runtime updates need a rebuilt `dist/`.** An update to `@actions/*` changes
  the bundle, so the **Check dist/** job fails until `dist/` is rebuilt. Check
  out the Dependabot branch, run `bun install --frozen-lockfile` and
  `bun run package`, check `bun run check:bundle`, and push the rebuilt `dist/`
  to that branch before merging. Tooling updates can also change formatting or
  lint results; fix those on the branch the same way.

TypeScript runs side by side: `@typescript/native` aliases TypeScript 7 and
provides `tsc` for `bun run typecheck`, while `typescript` aliases
`@typescript/typescript6` for tools that need the TypeScript 6 API, including
`typescript-eslint`. Keep these aliases until those tools support the new API.

Review the changelog of every update before merging, and treat a new install
script, a new maintainer or an unexpected new dependency as a reason to pause.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change and run `bun run all` until it is green.
3. Open a pull request against `main` and fill in the pull request template:
   description, related issue, potential risk and impact, and how it was tested.
4. CI (format, lint, typecheck, static checks, tests, dist check with the bundle
   budget, CodeQL) must pass before review.

`main` is protected by the **Protect main** repository ruleset: changes land
only through pull requests, with one approving review (approvals are dismissed
when new commits are pushed) and the required checks **TypeScript Tests**,
**Check dist/** and **Analyze (typescript)** passing. Force pushes and deleting
`main` are blocked. Repository admins can bypass the ruleset, for example to
merge their own pull requests when no other reviewer is available.
`.github/CODEOWNERS` requests a review from the maintainer automatically.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE) that covers this project.
