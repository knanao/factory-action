# Factory API key rotation

`factory-api-key` reaches only the Factory API. It is masked in logs, but treat
any exposure as a leak.

## Rotate on schedule or after expiry

1. Create a new key for the same service account in the Factory app
   ([API keys](https://app.factory.ai/settings/api-keys)).
2. Update the repository (or organization) secret `FACTORY_API_KEY`:
   `gh secret set FACTORY_API_KEY --repo <owner>/<repo>` and paste the key at
   the prompt, so it never lands in shell history.
3. Trigger a run (for example `@factory say hello` on a test issue) and check
   for `session.created` or `session.reused`.
4. Revoke the old key in the Factory app.

Sessions and computers belong to the key's owner. Keep the new key on the same
account: a key from another account may not see the existing sessions or the
computer, and the next run then starts a new session (`session.missing`) or
fails on the computer lookup.

## Suspected leak

1. Revoke the key in the Factory app first, then follow the rotation steps.
2. Review the Factory app for sessions or computers you did not start.
3. If the key was committed, also remove it from history and report it as
   described in [SECURITY.md](../../SECURITY.md). Secret scanning and push
   protection are enabled on this repository, but do not rely on them alone.

## Confirm the fix

A new run succeeds with the new key, and a request with the old key fails with
`Factory API 401`.
