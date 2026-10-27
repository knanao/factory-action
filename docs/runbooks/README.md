# Runbooks

Step-by-step procedures for operating factory-action and this repository. Each runbook starts from a symptom, lists what to check in order and ends with how to confirm the fix.

| Runbook | Use it when |
| --- | --- |
| [Failed or skipped run](./failed-or-skipped-run.md) | A run fails, is skipped unexpectedly, or Droid never replies |
| [Environment computers](./environment-computers.md) | An Environment computer is stuck provisioning, failed, or left behind after a thread closed |
| [Factory API key rotation](./api-key-rotation.md) | The key is about to expire, was revoked, or may have leaked |
| [Repository CI failures](./ci-failures.md) | `Check dist/`, the bundle budget, the coverage threshold or a static check fails |
| [Bad release rollback](./release-rollback.md) | A published tag breaks users of `knanao/factory-action@v0` |

## Before you start

- **Find the run.** Every run writes one logfmt record per event to the step log (`level=... event=...`), described in the README ([Logging](../../README.md#logging)). Download the log from the run page (**...** > **Download log archive**) to search it with `grep`.
- **Use the trace ID.** Each record carries `trace_id` and `span_id`, and the step output `trace-id` and the job summary show the same ID. Search for `trace_id=<id>` to see every record of one run. The ID exists only in the workflow run; it is not sent to Factory, so when you contact Factory support, quote the session ID and the time of the run instead.
- **Turn on debug records** by re-running the job with **Enable debug logging** (sets `ACTIONS_STEP_DEBUG`), or set `FACTORY_ACTION_LOG_LEVEL: debug` on the step.
- **Never paste secrets or personal data** from logs into issues; see [SECURITY.md](../../SECURITY.md).
