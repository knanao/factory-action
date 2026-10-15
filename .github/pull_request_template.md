## Description

<!--
What does this change do, and why? Summarize the behavior change for users of
the action (inputs, outputs, modes, prompts) and for contributors (tooling,
CI). Use a Conventional Commits title, e.g.
"fix: review full PR diff after interrupted CI sessions".
-->

## Related Issue

<!--
Link the issue this addresses, e.g. "Closes #123", or write "N/A" with a short
reason.
-->

## Potential Risk & Impact

<!--
What could break? Call out changes to authorization, trigger parsing, the
untrusted-content rules in the prompts, token handling, session reuse or the
tracking comment, Environment computers, and anything that changes how existing
workflows behave after upgrading.
-->

## How Has This Been Tested?

<!--
Commands you ran and their results, new or changed tests, and manual checks
(for example `bun run qa:mock` / `bun run qa:run <event>` or a real workflow
run). Redact tokens, API keys and personal data from any logs you paste.
-->

## Checklist

- [ ] `bun run format:check`, `bun run lint` and `bun run typecheck` pass
- [ ] `bun run check:static` passes
- [ ] `bun test` passes, and behavior changes come with tests in `__tests__/`
- [ ] When `src/` changed: `bun run package` was run and the rebuilt `dist/` is
      committed in this pull request (`bun run check:bundle` passes)
- [ ] When an input, output or mode changed: `action.yml` and the tables in
      `README.md` are updated together
- [ ] No secrets, tokens or real personal data in code, fixtures, logs or
      screenshots
