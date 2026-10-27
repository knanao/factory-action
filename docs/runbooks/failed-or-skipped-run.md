# Failed or skipped run

The action is fire-and-forget: a green run only means the message was accepted.
Work through the sections that match what you see.

## The job never started

The example workflows filter in the job's `if:` before a runner starts, so a
skipped job (grey icon) is expected when:

- the commenter's `author_association` is not `OWNER`, `MEMBER` or
  `COLLABORATOR`, or
- the comment does not contain the trigger phrase.

Check the workflow's `if:` against the event. Private organization members often
show as `CONTRIBUTOR` or `NONE` in webhook payloads; the action's own
`permission-fallback` covers them, but only if the `if:` lets the job start.

## The run succeeded but was skipped

The `skipped` output and the `delegate.skipped` record (`reason=...`) say why:

| `skipped`      | Meaning and fix                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `no-trigger`   | Wrong event action, no trigger phrase outside quotes and code, or a cleanup event that is not `closed`. Check `trigger-phrase`. |
| `unauthorized` | Denied by `allowed-associations` and the permission fallback; an `authz.denied` notice names the user and reason.               |
| `bot`          | A bot or Droid's own post (`<!-- factory-droid -->`). Add the bot login to `allowed-bots` if it should trigger.                 |
| `draft`        | Draft PRs are skipped in CI modes. Mark the PR ready for review.                                                                |
| `fork`         | PRs from forks are skipped because secrets are unavailable. A maintainer can mention `@factory` instead.                        |

## The run failed

The `run.failed` error record and the error annotation carry the message. Common
causes:

- **Input errors** (`Input '...' must be ...`,
  `Set exactly one of the inputs 'computer-id' and 'environment-id'`): fix the
  workflow's `with:` block. The mode/event errors
  (`mode 'review' requires the 'pull_request' event`) mean the workflow's `on:`
  does not fit the mode.
- **`Factory API 401` or `403`**: the key is wrong, expired or lacks access to
  the computer or Environment. See [API key rotation](./api-key-rotation.md).
- **`Factory API 404`** on a computer: `computer-id` points to a deleted
  computer, or the key's owner cannot see it.
- **`Factory API 429`**: rate limited. Session and computer creation retry three
  times with backoff; re-run the job later.
- **`Factory API 5xx`**: a Factory outage. Messages retry once on 500/502/503.
  Re-run the job once Factory is healthy.
- **`Could not find a single clone of '<repo>' on computer ...`**: the computer
  has no clone, or several. Clone the repository on the computer, or set `cwd`.
- **Environment computer errors**: see
  [Environment computers](./environment-computers.md).

## Droid never replied

1. Open the `session-url` output (also in the job summary) in the Factory app
   and check the session's status and last turn.
2. A `message.timeout` warning is normal: the message was still accepted. If the
   session shows no new turn, re-run the job.
3. A session stuck in `running` usually waits for an approval: check that
   `autonomy-level` is `high` (an `input.autonomy_below_high` warning means it
   is not). Interrupt it in the Factory app; the next run reuses it.
4. On the computer, check `gh auth status`: Droid writes to GitHub with the
   computer's credentials, not the workflow token.

## Confirm the fix

Re-run the job (or post a new `@factory` comment) and check that the
`session.created` or `session.reused` record and the `session-url` output
appear, and that Droid's reply arrives on the thread.
