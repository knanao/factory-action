# Repository CI failures

Every check below also runs locally; reproduce it before pushing a fix.

## `Check dist/` reports a diff

`dist/` is committed and must match `src/`. Rebuild and commit it in the same
change:

```sh
bun install --frozen-lockfile
bun run package
git add dist/ && git commit
```

For a Dependabot update of `@actions/*`, check out its branch, rebuild the same
way and push to that branch (see CONTRIBUTING.md, Dependency updates).

## Bundle over budget

`bun run check:bundle` fails when `dist/index.js` exceeds its budget and lists
the heaviest packages. Remove or replace the heavy import; raise the budget in
`script/check-bundle-size.ts` only in a change that explains the growth.

## Coverage below the threshold

`bun run ci-test` fails when any file under `src/` drops below 90% of lines or
functions (`coverageThreshold` in `bunfig.toml`, checked per file). The coverage
table names the file and the uncovered lines; add tests for them. Do not lower
the threshold to make a change pass.

## Static checks

| Failing step                 | Fix                                                                      |
| ---------------------------- | ------------------------------------------------------------------------ |
| `bun run knip`               | Remove the unused export, file or dependency, or declare the missing one |
| `bun run depcruise`          | Move the import so it respects the module boundaries in AGENTS.md        |
| `bun run jscpd`              | Extract the duplicated block into a shared helper                        |
| `bun run check:size`         | Split the file; tracked files must stay under 100 KiB                    |
| `bun run check:todos`        | Link the marker to an issue, as in `TODO(#123): ...`                     |
| ESLint complexity/size rules | Split the function or file; do not raise limits or add disable comments  |

## Confirm the fix

`bun run all` passes locally, and the PR's required checks (TypeScript Tests,
Check dist/, Analyze (typescript)) are green.
