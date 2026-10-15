---
name: qa
description:
  Interactively QA factory-action itself by running the built action against a
  local mock of the Factory Sessions API and the GitHub REST API. Use when
  checking a change to src/ or dist/ end to end (trigger parsing, authorization,
  session reuse, tracking comments, prompts), before opening a PR or when asked
  to "qa", "verify" or "try" the action.
---

# QA for factory-action

factory-action is a GitHub Action (no UI). Running it for real needs a Factory
organization with the Sessions API, a Droid Computer and a GitHub repository.
This skill runs the same code offline instead:

- `script/qa/mock-api.ts` serves the Factory endpoints the action calls
  (`/api/v0/computers`, `/api/v0/sessions`, `.../messages`, `.../interrupt`) and
  the GitHub endpoints it calls (permissions, issue comments, reactions,
  `GET /user`), keeping everything in memory.
- `script/qa/run.ts` runs `node dist/index.js` the way a runner does: it sets
  `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`, `GITHUB_API_URL`, the `INPUT_*`
  variables, `GITHUB_OUTPUT` and `GITHUB_STEP_SUMMARY`, then prints the log, the
  outputs and the job summary.
- `script/qa/events/<event_name>.<scenario>.json` are sample webhook payloads.
  The event name is the part before the first dot.

No real credentials are used, and nothing leaves `127.0.0.1`.

## 1. Set up

Needs Bun (version in `.bun-version`) and Node 24 or later.

```sh
bun install
bun run package        # rebuild dist/ if src/ changed; run.ts executes dist/
```

## 2. Start the mock API

Start it in the background and keep it running for the whole session:

```sh
bun run qa:mock        # http://127.0.0.1:4010, set QA_PORT to change it
curl -s http://127.0.0.1:4010/__qa/health   # {"ok": true}
```

## 3. Auth

There is no login. The mock accepts exactly one Factory key, `qa-factory-key`
(override both sides with `QA_FACTORY_API_KEY`), and any non-empty GitHub token.
`run.ts` passes both by default. The mock's GitHub user permissions are fixed:
`alice` and `private-member` have `write`, `outsider` has `read`, everyone else
`none`. `GET /user` returns 403, like the default `GITHUB_TOKEN`, so tracking
comments are written as `github-actions[bot]`.

## 4. Drive the action

Run scenarios in this order; later ones depend on the state earlier ones leave
in the mock. Reset first with `curl -s -XPOST http://127.0.0.1:4010/__qa/reset`.

| #   | Command                                                                            | Expected                                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `bun run qa:run script/qa/events/issue_comment.mention.json`                       | Log `Authorized @alice` and `Created session qa-session-N`; outputs `skipped: ""`, `reused: "false"`; exit 0                                                                                              |
| 2   | `bun run qa:run script/qa/events/issue_comment.follow-up.json`                     | `Reusing session` with the same ID as step 1; `reused: "true"`                                                                                                                                            |
| 3   | `bun run qa:run script/qa/events/issue_comment.outsider.json`                      | `::notice::@outsider is not allowed ...`; `skipped: "unauthorized"`; no new session                                                                                                                       |
| 4   | `bun run qa:run script/qa/events/pull_request.opened.json mode=review`             | New session in lane `review`                                                                                                                                                                              |
| 5   | `bun run qa:run script/qa/events/pull_request.synchronize.json mode=review`        | `Interrupting running session ...` then `Reusing session`; the new message says `Head: feature (head333)`. Because the session was interrupted, it reviews the full PR diff, not only `head222...head333` |
| 6   | `bun run qa:run script/qa/events/pull_request.fork.json mode=review`               | `Skipped: fork`                                                                                                                                                                                           |
| 7   | `bun run qa:run script/qa/events/issues.closed.json mode=cleanup`                  | `Asked session ... (task) to clean up`; tracking comment status `Closed (cleanup requested)`                                                                                                              |
| 8   | `bun run qa:run script/qa/events/issue_comment.mention.json factory-api-key=wrong` | `::error::Factory API 401 Unauthorized`; exit 1                                                                                                                                                           |

Any action input can be overridden with `input=value` (e.g. `mode=security`,
`lane=docs`, `reuse-session=false`, `commands=verify`). Add `--src` to run
`src/index.ts` with Bun instead of the committed bundle, which helps while
iterating before `bun run package`.

## 5. Check the results

The action's console output is only half of it; check what it sent:

```sh
curl -s http://127.0.0.1:4010/__qa/state
```

- `sessions.<id>.sessionSettings` is the create request: `cwd`, `autonomyLevel`,
  tags and the system rules (`systemPrompt.append`).
- `sessions.<id>.messages[].text` is each prompt sent to Droid. Check that
  GitHub text sits inside `<untrusted-github-content>` and that the trigger
  phrase rules are present.
- `sessions.<id>.interrupts` counts interrupts (step 5 should make it 1).
- `comments` are the tracking comments, with the hidden
  `<!-- factory-action:state ... -->` marker.
- `reactions` are the 👀 reactions on the triggering comments.
- `requests` lists every API call with its status. `GET /user` returning 403 is
  expected (see Auth). An unexpected 404 means the action called an endpoint the
  mock does not know.

To exercise a new event or edge case, copy a file in `script/qa/events/`, edit
the fields (see `__fixtures__/payloads.ts` for what the action reads), and run
it. If the action starts calling a new API endpoint, add it to `mock-api.ts`.

## 6. Finish

Stop the mock (kill its process). Report each scenario as pass/fail with the
relevant log line or `__qa/state` excerpt. This QA does not replace
`bun run all`; run both before opening a PR.

## Against real services (optional)

A real end-to-end run needs the secret `FACTORY_API_KEY`, the variable
`FACTORY_COMPUTER_ID` and a Droid Computer with the repository cloned. In this
repository, `.github/workflows/factory.yml` runs the current sources
(`uses: ./`): comment `@factory <task>` on an issue or PR here, then open the
run under Actions and follow the session link in its job summary.
