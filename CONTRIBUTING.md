# Contributing

Thanks for your interest in contributing. Bug reports, feature requests and pull
requests are all welcome.

## Development setup

Development uses [Bun](https://bun.com) (version pinned in `.bun-version`) as
the package manager, test runner and bundler. The action itself runs on GitHub's
`node24` runtime.

```sh
bun install
bun run all   # format, lint, typecheck, test, bundle dist/
```

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
4. CI (format, lint, typecheck, tests, dist check, CodeQL) must pass before
   review.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE) that covers this project.
