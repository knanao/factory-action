import type { PromptContext } from './common.js'
import { extraInstructions, header, join } from './common.js'

/**
 * A scheduled audit of the whole repository with the deep-security-review
 * skill. Findings are vulnerabilities that may not be fixed yet, so they go
 * only into draft repository security advisories, never into public posts.
 */
export function deepSecurityPrompt(ctx: PromptContext): string {
  return join(
    'Run a deep security audit of the whole repository.',
    header(ctx),
    `Triggered by the '${ctx.event}' event. There is no issue or PR for this run, so nobody can answer questions: do not ask any. Where the skill would ask, choose for yourself: the scope is the whole repository at the default branch, and for other choices take the most thorough option the skill offers. Record each choice in the report.`,
    'In your workspace (fresh from the default branch), run /deep-security-review on the entire repository. Use `.factory/threat-model.md` if it exists, and follow `.factory/skills/security-review-guidelines` if it exists. Validate every finding against the code and drop anything you cannot confirm.',
    'Write the full report to `~/security-audits/<repo>-<YYYYMMDD>/` on this computer.',
    `Findings may be unfixed vulnerabilities, so never put their details in issues, PRs, comments, commits or anything else public. Report them only as draft repository security advisories, which only admins and security managers can read:
1. List the existing drafts with \`gh api "repos/${ctx.repo}/security-advisories?state=draft" --paginate\` and skip findings already filed.
2. For each new finding of severity P0 (critical), P1 (high) or P2 (medium), create one draft: write a JSON file and run \`gh api repos/${ctx.repo}/security-advisories --method POST --input <file>\` with \`summary\` ("[P<n>] <short title>"), \`description\` (affected files and lines, impact, how to reproduce, suggested fix), \`severity\`, \`cwe_ids\` when known, and \`vulnerabilities: [{"package": {"ecosystem": "other", "name": "${ctx.repo}"}}]\`.
3. Keep P3 findings in the report file only.`,
    `If creating advisories fails (for example, the GitHub credentials lack permission), do not fall back to any public post with details. Instead open one issue titled "Security audit <YYYY-MM-DD>: action needed" that says only that the audit finished, how many findings there are per severity, that advisories could not be created and why, and where the report is on this computer.`,
    extraInstructions(ctx.extra)
  )
}
