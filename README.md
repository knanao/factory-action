# factory-action

Delegate work from GitHub to [Factory](https://factory.ai) Droid through the [Sessions API](https://docs.factory.com/api-reference/sessions).

- **Task delegation.** Comment `@factory <anything>` on an issue or PR and Droid does it: implement, fix, explain, run skills and commands such as `security-review` or `verify`, and so on. Follow-up comments continue **the same session**.
- **CI jobs.** Automatic code review, diff security review (`security-review` skill) and opt-in QA (`qa` skill) on every PR push. After a push, the same session reviews only the new commits.
- **Isolated Environment mode.** Use a Factory Environment to provision one unlisted computer per issue/PR and lane. The action reuses it for follow-ups and deletes it when the thread closes.
- **Fire-and-forget.** The action creates or reuses a session, sends one message and exits within seconds. Droid runs on your Droid Computer and writes results (PRs, comments, reviews) to GitHub itself.
- **Quiet for outsiders.** Authorization uses `author_association`, so mentions from outside users don't start the job.

## Why not droid-action?

Factory's official [droid-action](https://github.com/Factory-AI/droid-action) is a good fit for reviewing PRs on the runner. This action exists because we needed four things it does not do:

| Problem in droid-action | factory-action |
| --- | --- |
| **Runs on the runner.** It installs the Droid CLI and runs `droid exec` inside the job. The runner is busy until Droid finishes, and the job needs the repo's tooling. | Calls the Sessions API and exits within seconds. Droid works on a persistent Droid Computer that already has the repo, its dependencies and tools (browser, `ffmpeg`). |
| **Review only.** `@droid` supports `fill`, `review`, `security` and `security --full`. A bare `@droid` also starts a review. You cannot ask it to implement or fix something. | `@factory <anything>` delegates any task: implement an issue, fix a review comment, explain code, run a skill or a plugin command. |
| **No session reuse.** Every run starts a new `droid exec`. A follow-up instruction or a re-review after new commits starts from zero. | One session per (repository, issue/PR, lane). Follow-up comments continue that session, and a re-review after a push looks only at the new commits. |
| **Authorization is a permission check only.** It checks write permission after the job has already started, so a mention from an outside user still starts a run and shows noise. | Uses `author_association` in the workflow's `if:` (the job never starts) and in the action, then falls back to the permission API for private org members. |

The trade-offs: this action needs the Sessions API, which is enabled only for some Factory organizations, and a Droid Computer.

## How it works

```
GitHub event ─▶ workflow job (if: author_association filter)
                  │
                  ▼
           factory-action (node24, seconds)
             1. normalize the event, check the trigger, authorize
             2. read the lane's session and computer from its tracking comment
             3. reuse them, or create an Environment computer and session
             4. POST the message, update the tracking comment, exit
                  │
                  ▼
           Droid Computer (computer-id or Environment-created)
             runs the task / review / security review with skills,
             writes back to GitHub with gh and git
```

Sessions are keyed by **(repository, issue/PR number, lane)**. The lane defaults to the mode (`task` for mentions), so a human task, the code review and the security review on one PR each keep their own context. The mapping is stored in a hidden marker in a tracking comment that the action writes. Only comments written by the action's own token identity are trusted.

## Prerequisites

1. **The Sessions API is enabled for your Factory organization.** The docs say it is "enabled for selected organizations only", so confirm this before adopting the action.
2. **A Factory API key.** Prefer a [service account](https://docs.factory.com/enterprise/identity-and-access) key, so sessions and billing belong to the service account. Store it as the secret `FACTORY_API_KEY`.
3. **A Droid Computer or Factory Environment** with the repository cloned. Store the computer ID as `FACTORY_COMPUTER_ID`, or the Environment ID as `FACTORY_ENVIRONMENT_ID`. See [Computer setup](#computer-setup) and [Environment setup](#environment-setup).

## Quick start

`.github/workflows/factory.yml`, for `@factory` mentions:

```yaml
name: Factory
on:
  issue_comment: { types: [created] }
  pull_request_review_comment: { types: [created] }
  pull_request_review: { types: [submitted] }
  issues: { types: [opened] }
permissions: {}
jobs:
  delegate:
    if: >-
      contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'),
        github.event.comment.author_association ||
      github.event.review.author_association || github.event.issue.author_association) && contains(github.event.comment.body || github.event.review.body || github.event.issue.body, '@factory')
    runs-on: ubuntu-latest
    permissions: { issues: write, pull-requests: write }
    concurrency:
      group: factory-${{ github.event.issue.number || github.event.pull_request.number }}
      cancel-in-progress: false
    steps:
      - uses: knanao/factory-action@v0.1.0
        with:
          factory-api-key: ${{ secrets.FACTORY_API_KEY }}
          computer-id: ${{ vars.FACTORY_COMPUTER_ID }}
```

`.github/workflows/factory-ci.yml`, for automatic review and security review:

```yaml
name: Factory CI
on:
  pull_request: { types: [opened, synchronize, reopened, ready_for_review] }
permissions: {}
jobs:
  droid:
    if: ${{ !github.event.pull_request.draft && github.event.pull_request.head.repo.full_name == github.repository }}
    runs-on: ubuntu-latest
    permissions: { pull-requests: write }
    strategy: { matrix: { mode: [review, security] } }
    concurrency:
      group: factory-${{ matrix.mode }}-${{ github.event.pull_request.number }}
      cancel-in-progress: true
    steps:
      - uses: knanao/factory-action@v0.1.0
        with:
          factory-api-key: ${{ secrets.FACTORY_API_KEY }}
          computer-id: ${{ vars.FACTORY_COMPUTER_ID }}
          mode: ${{ matrix.mode }}
```

More examples are in [examples/](./examples): opt-in QA, a weekly full-repository security audit and a weekly wiki refresh.

### Use a Factory Environment

To isolate each issue/PR lane, replace `computer-id` with:

```yaml
environment-id: ${{ vars.FACTORY_ENVIRONMENT_ID }}
```

Use the same `environment-id` in every workflow, including cleanup. For example:

```yaml
on:
  issues: { types: [closed] }
  pull_request_target: { types: [closed] }
permissions: {}
jobs:
  cleanup:
    runs-on: ubuntu-latest
    permissions: { issues: write, pull-requests: write }
    steps:
      - uses: knanao/factory-action@v0.2.0
        with:
          factory-api-key: ${{ secrets.FACTORY_API_KEY }}
          environment-id: ${{ vars.FACTORY_ENVIRONMENT_ID }}
          mode: cleanup
```

See [`examples/factory-environment-cleanup.yml`](examples/factory-environment-cleanup.yml) for the full workflow. Issue/PR computers are removed on close. Cleanup does not find computers for runs without an issue/PR, such as scheduled `deep-security` audits and `workflow_dispatch`; those computers remain until manually deleted in Factory. See [Environment setup](#environment-setup) for snapshot and build-script guidance.

## Usage

### Mentions (`mode: mention`, default)

Any text after `@factory` goes to Droid unchanged. To run a skill or plugin command, name it right after `@factory`, **without a slash**: `@factory verify ...` runs `/verify`. The names that work this way are set by the `commands` input (default: `security-review`, `deep-security-review`, `qa`, `wiki`, `verify`, `qa-test`, `demo`). Any other first word is just part of the request. `review` is left out on purpose: `/review` opens an interactive menu, so `@factory review this PR` is sent as a plain request.

```text
@factory implement this issue
@factory the tests in this PR are flaky, fix them
@factory security-review this PR
@factory verify 123 -- clicking Save keeps the form values
```

- On an **issue**, Droid creates a branch and opens a PR that references the issue.
- On a **PR**, Droid checks out the PR and pushes to its head branch. If that push is rejected (e.g. a fork that does not allow edits from maintainers), Droid pushes its own branch and opens a PR against the PR's base branch instead.
- On a **review comment**, the file, line and diff hunk are included, and Droid replies in that review thread.
- Mentions in quoted replies (`> ...`) and in code are ignored.
- If Droid needs a decision, it posts the question as a comment and stops. Your `@factory ...` reply goes to the same session.

### CI modes

| mode | Event | What Droid does |
| --- | --- | --- |
| `review` | `pull_request` | Code review of the diff, posted as one review with up to `max-comments` inline comments labeled `[P0]`–`[P2]` |
| `security` | `pull_request` | `/security-review` on the diff. Inline `[P0]`–`[P2] [security]` findings; P3 findings go only in the summary |
| `deep-security` | `schedule`, `workflow_dispatch` | `/deep-security-review` on the whole repository at the default branch. Findings go only to **draft security advisories** (see below) |
| `wiki` | `schedule`, `workflow_dispatch` | `/wiki` on the whole repository at the default branch. Uploaded to the Factory app, and the same pages pushed to `droid-wiki/` on the default branch (see below) |
| `qa` | `pull_request` | `/qa` on the changed flows, posted as a pass/fail/blocked report. Opt-in, see [QA](#qa-and-droid-control) |
| `cleanup` | `issues` / `pull_request_target` (`closed`) | With `computer-id`, asks tracked sessions to remove their worktrees and local branches. With `environment-id`, deletes the thread's Environment computers directly. See [Computer setup](#computer-setup) |
| `custom` | any (e.g. `schedule`) | Sends the `prompt` input with the repository/thread context |

- Drafts are skipped.
- PRs from forks are skipped, because secrets are not available to them.
- On `synchronize`, a running session in that lane is interrupted, and Droid is told to review only `<previous head>...<new head>` and not to repeat findings.
- Repository-specific rules are picked up from `.factory/skills/review-guidelines`, `.factory/skills/security-review-guidelines` and `.factory/threat-model.md`.

#### Deep security audit (`mode: deep-security`)

A full audit with the `deep-security-review` skill can take hours, so it runs on a schedule, not on every PR. Each run starts a new session.

- The skill normally asks about scope and options. Droid is told to audit the whole repository and pick the most thorough options itself, and to record its choices in the report.
- Findings can be unfixed vulnerabilities, so Droid **never posts them publicly**. Each P0–P2 finding becomes a [draft repository security advisory](https://docs.github.com/en/code-security/security-advisories/working-with-repository-security-advisories/about-repository-security-advisories), which only admins and security managers can read. Drafts that already exist are skipped. P3 findings stay in the report.
- The full report is written on the computer under `~/security-audits/<repo>-<YYYYMMDD>/`.
- The computer's GitHub credentials must be allowed to create security advisories (admin or security manager on the repository). If that fails, Droid opens one issue with only the finding counts, the reason and the report path, with no details.

See [`examples/factory-security-audit.yml`](examples/factory-security-audit.yml).

#### Wiki refresh (`mode: wiki`)

The `wiki` skill generates comprehensive documentation for the whole repository, so it runs on a schedule, not on every push. Each run starts a new session and regenerates the wiki from scratch.

- The skill asks about scope and options. Droid is told to document the whole repository at the default branch and pick the skill's standard options itself.
- The wiki is uploaded to the Factory app, and the same pages are pushed to `droid-wiki/` directly on the default branch, with no PR. If that push is rejected (for example branch protection), Droid opens one pull request titled "docs: refresh droid-wiki" instead.
- The narrated video overview (`wiki-video-gen`) is skipped by default; ask for it through the `prompt` input.
- The session removes its own worktree when it finishes: scheduled runs have no issue or PR whose close would trigger `cleanup`.
- The computer's push credentials must be allowed to push to the default branch.

### UI changes need before/after evidence

When Droid opens or pushes to a PR that changes what people see rendered (the app's web, desktop or terminal screens, or output GitHub renders, such as comments, summaries or generated HTML), it must:

1. Capture the same view before and after: for app screens, run the app on the base branch and on its branch; for output Droid cannot run for real (rendered by GitHub or CI), render the actual output the code produces and caption how it was made. PNG screenshots for static changes, MP4 (under 10 MB) plus GIF for interactions. Skip evidence only when a plain diff shows the effect just as well.
2. Upload each file to GitHub's user-attachments storage with the computer's `gh` credentials (`https://uploads.github.com/user-attachments/assets`) and embed the returned URL. Images, GIFs and videos all render inline, and nothing lands in any branch, so the PR diff stays clean.
3. Put the **Before / After** section in the PR body when opening the PR, and post it as a comment when pushing updates to an existing PR.
4. If the evidence cannot be captured, leave the PR as a **draft** and explain why.

This is enforced through the session's system prompt. It needs the Droid Control tools on the computer, see [Computer setup](#computer-setup).

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `factory-api-key` | **required** | Factory API key (service account recommended) |
| `computer-id` | — | Existing Droid Computer to run the session on. Set exactly one of this or `environment-id` |
| `environment-id` | — | Factory Environment used to create one unlisted computer per issue/PR and lane. Set exactly one of this or `computer-id` |
| `provision-timeout-sec` | `300` | Maximum time to wait for an Environment computer to become active |
| `mode` | `mention` | `mention` \| `review` \| `security` \| `deep-security` \| `qa` \| `wiki` \| `custom` \| `cleanup` |
| `prompt` | `''` | Template for `custom` (required there); extra instructions for the other modes |
| `lane` | mode (`task` for mention) | Session reuse key per issue/PR |
| `trigger-phrase` | `@factory` | Mention phrase |
| `allowed-associations` | `OWNER,MEMBER,COLLABORATOR` | `author_association` values allowed to trigger |
| `permission-fallback` | `true` | If the association is not allowed, also allow users with write/admin permission (covers private org members) |
| `allowed-bots` | `''` | Bot logins allowed to trigger |
| `commands` | `security-review,deep-security-review,qa,wiki,verify,qa-test,demo` | Names that `@factory <name>` runs as `/<name>` |
| `cwd` | auto | Repository path on the computer. Auto-detected from the computer's cloned repositories |
| `model` | Factory default | Model for new sessions |
| `reasoning-effort` | Factory default | Reasoning effort for new sessions |
| `autonomy-level` | `high` | `off` \| `low` \| `medium` \| `high`. Unattended work needs git push and `gh`, see [Security](#security) |
| `reuse-session` | `true` | Follow up on the lane's existing session |
| `max-comments` | `30` | Max inline comments per review |
| `message-timeout-ms` | `15000` | Timeout for sending the message; a timeout is treated as accepted |
| `github-token` | `${{ github.token }}` | Used only for the reaction and the tracking comment. Never passed to Droid |
| `factory-api-url` | `https://api.factory.ai` | API base URL |

## Outputs

| Output | Description |
| --- | --- |
| `session-id` | Session the message was sent to (in `cleanup` mode, the sessions asked to clean up, comma separated) |
| `session-url` | Link to the session in the Factory app |
| `computer-id` | Computer used by the session; in Environment cleanup mode, computers deleted (comma separated) |
| `reused` | `true` if the message was a follow-up |
| `skipped` | `''`, or `unauthorized` \| `no-trigger` \| `fork` \| `bot` \| `draft` |

## Computer setup

`GITHUB_TOKEN` expires when the job ends, so **Droid writes to GitHub with credentials on the computer**, not with the workflow token.

1. **GitHub write access.** Factory sets up the computer's GitHub credentials, and the computer's owner decides whose name Droid's comments, reviews, commits and PRs appear under:
   - **Computer owned by a person:** Factory uses that person's [personal GitHub integration](https://docs.factory.com/droid-computers/overview.md) (a user-to-server `ghu_` token). Droid contributes **as that user account**. Installing the Factory Droid GitHub App on the repository does not change this: the app installation only decides which repositories the token can reach.
   - **Computer owned by a service account (unverified):** according to [Identity & Access](https://docs.factory.com/enterprise/identity-and-access.md#service-accounts), a service account's Git access uses the organization's [GitHub App](https://docs.factory.com/integrations/github-app) installation. Droid would then contribute **as the app's bot account**. Whether these credentials also authenticate `gh`, and whether they refresh in sessions longer than an hour, has not been verified.

   Check it with `gh auth status` and `gh pr list` on the computer.

2. **Repository clone.** The action resolves `cwd` from the computer's cloned repositories by name (e.g. `/home/factory-user/repos/<repo>`). If that is ambiguous, set `cwd`. Sessions share that clone, so each session is told to create and use its own git worktree at `<cwd>.worktrees/<lane>-<number>` on branch `factory/<lane>-<number>`. The shared clone's checkout is never changed. (The API's `sessionSettings.worktree` setting has no effect, so the action does not rely on it.) Add [`examples/factory-cleanup.yml`](examples/factory-cleanup.yml) so worktrees and local branches are removed when an issue or PR closes. A session is reused only on the computer it runs on: if `computer-id` changes, the next request starts a new session.
3. **Droid Control and QA tools.** Needed for UI evidence, `verify`, `qa-test` and `qa` mode:
   ```sh
   droid plugin marketplace add https://github.com/Factory-AI/factory-plugins
   droid plugin install droid-control@factory-plugins --scope user
   # plus the runtime tools you need: agent-browser (Chromium), tuistory, ffmpeg
   ```
   The app under test must be startable on the computer or reachable, e.g. a staging URL.

### Environment setup

Use an organization Environment, especially when the workflow uses a service-account API key. Clone the target repository and install its dependencies in the Environment setup steps. Install Droid Control and its runtime tools there if the workflow uses UI evidence, `verify`, `qa-test` or `qa`.

Build scripts should leave tracked files unchanged. For example, use the repository's lockfile-based install (`npm ci`, `bun install --frozen-lockfile`, or the equivalent), not commands that rewrite `package.json` or the lockfile. Environment build steps do not receive Runtime secrets. The Environment is a snapshot: computers created from it keep their own state, and rebuilding the Environment does not update existing computers. New issues/PRs use the newer snapshot.

The action creates one persistent, unlisted computer per issue/PR and lane. Follow-ups reuse that computer; closing the issue/PR deletes it. Runs without an issue/PR (including scheduled deep-security audits and manual dispatches) are not covered by cleanup. Delete those computers manually from Factory until an automatic sweep mode is available.

The first run waits for the computer to become active, up to `provision-timeout-sec` (300 seconds by default). If a run is cancelled during provisioning, the next run finds the same computer by its deterministic name and resumes waiting instead of creating a duplicate.

## QA and Droid Control

Skills and Droid Control commands run through mentions, named without a slash (see [Mentions](#mentions-mode-mention-default)). CI modes cover the ones that need no conversation.

| Feature | Kind | What it does | Use it when | How to use | Notes |
| --- | --- | --- | --- | --- | --- |
| Code review | built-in skill | Reviews the diff for bugs, security problems and breaking changes | Every PR | `mode: review`, or `@factory review this PR` | Prompt-based. `review` is not a command name, because `/review` opens an interactive menu |
| `security-review` | built-in skill | Security review of the diff (data flows, authn/authz, injection, …) | Every PR | `mode: security`, or `@factory security-review` | Static analysis; no special requirements |
| `deep-security-review` | built-in skill | Multi-phase audit of the whole repository | Periodic audits, e.g. weekly | `mode: deep-security` (scheduled), or `@factory deep-security-review` | Can take hours. Findings go to draft security advisories. In a mention, its questions come back as comments |
| `wiki` | built-in skill | Comprehensive documentation of the whole repository, uploaded to the Factory app | Keeping onboarding docs fresh without writing them by hand | `mode: wiki` (scheduled), or `@factory wiki` | The pages are also pushed to `droid-wiki/` on the default branch. The video overview is skipped by default |
| `qa` | repository skill | Runs the repository's own QA flows (created by `/install-qa`) against what the PR changed | Every PR, for apps with flows that must not break (login, checkout, …) | `mode: qa` (opt-in), or `@factory qa` | Run `/install-qa` once and commit `.factory/skills/qa*`. The app must be reachable from the computer. Without the skill, Droid posts setup steps and stops |
| `verify` | Droid Control | Checks **one claim** by running the app, and reports CONFIRMED / REFUTED / INCONCLUSIVE with evidence | "Is this bug really fixed?", "Does this bug report reproduce?" | `@factory verify 1234 -- saving keeps the form values` | Droid acts as an investigator: a refuted claim is a valid result |
| `qa-test` | Droid Control | Plans and runs test steps against a URL, CLI or Electron app, with a pass/fail table per step | Trying a feature end to end, as a person would by hand. Broader than `verify` | `@factory qa-test https://staging.example.com -- log in, create a project` | Droid designs the steps if none are given. Questions come back as comments; reply with `@factory ...` in the same session |
| `demo` | Droid Control | Records a demo video of a feature or PR, side by side for before/after changes | Videos for PR descriptions or release notes | `@factory demo 1234` | **Experimental.** It waits for plan approval: reply `@factory approve` to continue |

In short: `verify` checks one point, `qa-test` walks through a flow, `qa` runs the repository's QA on every PR, and `demo` makes a video to show.

Droid also picks a matching skill on its own when the request fits the skill's description, so plain requests such as "check this for security issues" often work. Name the skill (`@factory security-review`) when it must run every time, and in CI, where the modes always name it.

Droid Control commands need the plugin and its tools on the computer ([Computer setup](#computer-setup)). To use another skill or plugin command this way, add its name to the `commands` input.

## Security

- **Authorization.** The workflow `if:` filters by `author_association` before the job starts. The action checks again, falls back to the permission API for private org members, and denies quietly.
- **Loops.** Bots are ignored unless listed in `allowed-bots`. Droid's own posts carry `<!-- factory-droid -->` and are ignored. Droid is told never to write the trigger phrase.
- **Forks.** CI modes skip fork PRs. Do not use `pull_request_target`. A maintainer can still ask for a review explicitly with `@factory review this`.
- **Prompt injection.** GitHub content is passed as clearly delimited untrusted data, and the system prompt tells Droid not to follow instructions in it. Use a dedicated computer and least-privilege GitHub credentials. Remember that `autonomy-level: high` lets Droid run commands and push.
- **Why `autonomy-level: high`.** Below `high`, a command Droid rates as high-risk (e.g. `git push`, `git branch -D`) waits for an approval that never comes, and the session stays `running` until it is interrupted. Autonomy is fixed when the session is created; changing it later does not affect a reused session.
- **No secrets to Droid.** The workflow token is used only for the reaction and the tracking comment.

## Limitations

- **CI status does not reflect results.** The run ends before Droid finishes, so the check cannot be used as a merge gate.
- **Tracking with GitHub App tokens.** The tracking comment is recognized when it was written by `github-actions[bot]` (the default `GITHUB_TOKEN`) or by a PAT user. If you pass a GitHub App token as `github-token`, sessions are not reused.
- **Messages to a running session are merged into the current turn.** Droid receives a follow-up sent while it is working as "steering" for the current task, not as a new turn. CI lanes therefore interrupt a running session before sending the new push.

## Development

Development uses [Bun](https://bun.com) (version in `.bun-version`) as the package manager, test runner and bundler. The action itself still runs on GitHub's `node24` runtime: `bun build --target=node` bundles it into `dist/index.js`.

```sh
bun install
bun run all       # format, lint, typecheck, test, bundle dist/
```

To run the action against a local (simulated) event, copy [`.env.example`](./.env.example) to `.env`, fill in the required values (Factory API key, a Droid Computer id or Environment id, a GitHub PAT and a webhook payload file) and run `bun run local-action`. `.env` is gitignored; never commit real keys.

`dist/` is committed. The **Check Transpiled JavaScript** workflow fails if it is stale. Releases follow the [typescript-action](https://github.com/actions/typescript-action) flow: `script/release` tags `vX.Y.Z` and updates the corresponding major tag (for `v0.1.0`, that is `v0`).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). To report a security vulnerability, see [SECURITY.md](./SECURITY.md).

## License

[MIT](./LICENSE)
