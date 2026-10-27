# Environment computers

With `environment-id`, the action creates one unlisted computer per issue/PR and
lane, named `fa-<repo>-<hash>-<number>-<lane>-<hash>`, and deletes it when the
thread closes (`cleanup` mode).

## Stuck provisioning

Symptom:
`Computer <name> (<id>) is still provisioning after 300 s. The next run waits for it again.`

1. Re-run the job: the next run finds the same computer by name and keeps
   waiting instead of creating a duplicate.
2. If provisioning is always slow, raise `provision-timeout-sec`.
3. If it never becomes active, check the Environment's build in the Factory app.

## Provisioning failed

Symptom:
`Computer <name> (<id>) failed to provision and was deleted. Check the Environment build, then retry.`

The action already deleted the broken computer. Fix the Environment's setup
steps (they must leave tracked files unchanged and receive no Runtime secrets),
rebuild it, then re-run the job.

## Name already taken by another computer

Symptom: `Computer <name> (<id>) was not created from Environment <id>.`

A computer with the action's deterministic name exists but comes from a
different Environment, usually after `environment-id` changed. Delete that
computer in the Factory app, or close the issue/PR so `cleanup` removes it, then
re-run.

## Computers left behind

- `Could not delete Environment computers: <ids>` fails the cleanup run; a
  `cleanup.computer_delete_failed` warning names each computer. Re-run the
  cleanup job, or delete them in the Factory app.
- Runs without an issue or PR (`schedule`, `workflow_dispatch`) are never
  cleaned up automatically. Delete their computers in the Factory app.
- Make sure the cleanup workflow
  ([`examples/factory-environment-cleanup.yml`](../../examples/factory-environment-cleanup.yml))
  uses the same `environment-id` as the other workflows.

## Confirm the fix

The run logs `computer.found` or `computer.created` followed by
`session.created`, and the `computer-id` output is set. After a cleanup run, the
tracking comment shows `Closed (computer deleted)`.
