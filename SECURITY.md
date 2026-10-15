# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities privately through GitHub: open the
**Security** tab of this repository and choose **Report a vulnerability** to
file a draft security advisory
([direct link](https://github.com/knanao/factory-action/security/advisories/new)).
Do not open a public issue for a vulnerability.

Please include:

- A description of the vulnerability and its impact
- The affected version (release tag or commit SHA)
- Steps to reproduce, or a proof of concept
- A suggested fix, if you have one

Reports are acknowledged as time allows. This is a personal open-source project
without an SLA, but security reports are prioritized over other work.

## Scope

This repository contains a GitHub Action that delegates work from GitHub to
Factory Droid through the Sessions API.

- **In scope:** the action's own code (`src/`, bundled into `dist/`), the
  workflows under `examples/`, and the authorization, trigger-parsing and
  prompt-construction logic described in the
  [Security section of the README](./README.md#security).
- **Out of scope:** the Factory platform itself (the Sessions API, Droid
  Computers and the Droid agent). Please report those to Factory through their
  own channels.

When reporting, keep in mind the action's documented security model: Droid runs
unattended with `autonomy-level: high` on the user's own Droid Computer and
writes to GitHub with the computer's credentials. Behaviors that follow from a
user's own configuration choices (for example, enabling `permission-fallback`)
are not vulnerabilities by themselves, but ways to bypass those checks are.

## Data handling and personal data

The action is a thin relay: it reads one webhook event, sends one message to a
Factory session and exits. It has no database, cache or artifacts of its own.
This section describes what the action itself does; what Droid does inside the
session is governed by the session's prompt, the computer's credentials and
Factory.

### What the action reads

From the webhook event (`src/trigger.ts`): the repository owner and name, the
issue or PR number, URL and title, the issue or PR body, the triggering user's
login, account type and `author_association`, the triggering text (comment,
review or issue body), the comment or review ID, and for review comments the
file path, line and diff hunk. For pull requests it also reads the base and head
branch names and SHAs and the head repository name.

Through the GitHub API, with `github-token` (`src/github.ts`): the triggering
user's collaborator permission when `permission-fallback` applies, the comments
on the issue or PR (only to find the action's own tracking comments; other
comments are matched by author and ignored), and the token's own login.

### Where it goes

Only to the Factory API at `factory-api-url` (`https://api.factory.ai` by
default), authenticated with `factory-api-key` (`src/factory.ts`):

- **The message** (`src/prompts/`): the repository name, issue or PR number,
  title and URL, PR branch names and SHAs, the triggering user's login (mention
  mode), the triggering text and, for review comments, the diff hunk (mention
  mode), the PR description (`review`, `security` and `qa` modes), and the
  `prompt` input. Comment, review, issue and PR bodies and diff hunks are
  wrapped in `<untrusted-github-content>` blocks. `cleanup` mode sends no
  user-written text, only the repository name and the issue or PR number.
- **Session and computer metadata** (`src/delegate.ts`, `src/compute.ts`): a
  session tag with the repository name, issue or PR number and lane; in
  Environment mode, computer names derived from the repository name, a short
  hash of `owner/repo`, the issue or PR number and the lane.

`github-token` is used only for the reaction, the tracking comment and the
lookups above. It is never put into a message or a session request. In mention
mode the prompt tells Droid to read the whole thread itself with `gh`, so Droid
sees every comment on the thread, using the computer's own GitHub credentials.

### What it stores

- **Tracking comment**, one per lane on the issue or PR (`src/state.ts`). Its
  visible table shows the lane, session ID and link, status, a timestamp and a
  link to the workflow run. The hidden `<!-- factory-action:state ... -->`
  marker holds only `v` (format version), `lane`, `sid` (session ID) and,
  optionally, `sha` (last head SHA sent, CI lanes) and `cid` (the computer the
  action created, Environment mode). No comment text, prompt or user login is
  stored.
- **Step outputs and job summary** (`src/main.ts`): session ID and URL, computer
  ID, lane, whether the session was reused, and the skip reason.

### What it logs

The step log (`src/delegate.ts`, `src/cleanup.ts`, `src/compute.ts`) contains
the triggering user's login with the authorization result and reason
(`author_association`, and the permission level when the fallback ran; denials
are a notice annotation on the run), session IDs, computer names and IDs, lane
names, and error messages returned by the GitHub and Factory APIs. It does not
log comment bodies, PR text, diffs or the message sent to Droid.
`factory-api-key` is registered with `core.setSecret`, so the runner masks it;
values passed from `secrets.*` and `github.token` are masked by the runner as
well.

### Retention and deletion

The action keeps nothing outside GitHub and Factory. Tracking comments stay on
the thread until someone deletes them (deleting one only stops session reuse for
that lane). Workflow logs follow the repository's Actions log retention.
Sessions, their messages and computers are retained by Factory under your
Factory account's policies. For a closed thread, `cleanup` mode asks its
sessions to remove their worktrees (`computer-id`) or deletes its computers
(Environment mode); it never deletes sessions. To remove data, delete the
tracking comment, the workflow run logs, and the session or computer in the
Factory app.

### Guidance for users

- Do not put secrets or personal data in issues, PRs or comments that trigger
  Droid: that text is sent to Factory and processed by a model.
- Restrict who can trigger Droid (`allowed-associations`, `allowed-bots`) and
  use `pull_request_target` only for `cleanup` mode, as described in the
  [Security section of the README](./README.md#security).
- Use a dedicated computer or Environment and least-privilege GitHub credentials
  on it, and a Factory service account key.

### Guidance for contributors

- Tests, fixtures and QA events use fictional data only (users such as `alice`,
  `carol`, `mallory` and `outsider`, repositories such as `acme/widgets`,
  placeholder keys such as `fk-test` and `qa-github-token`). Keep it that way;
  never copy a real webhook payload without anonymizing it.
- Never commit real tokens or API keys. `.env` is gitignored; secret scanning
  and push protection are enabled on this repository.
- Redact keys, tokens and personal data from logs and screenshots in issues and
  pull requests.

## Dependency updates

Dependabot proposes version updates weekly for the npm packages in `bun.lock`
and for the GitHub Actions used by the workflows, and only once a release has
been public for at least 7 days (14 days for major versions). This minimum
release age gives the ecosystem time to detect and yank a compromised release
before it reaches this repository. Vulnerable dependencies are reported through
Dependabot alerts, which the delay does not apply to. The policy is described in
[CONTRIBUTING.md](./CONTRIBUTING.md#dependency-updates).
