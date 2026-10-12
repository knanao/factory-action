import type { PromptContext } from './common.js'
import { extraInstructions, header, join, untrusted } from './common.js'
import { diffSteps } from './review.js'

export function qaPrompt(ctx: PromptContext): string {
  const pr = ctx.pr!
  return join(
    `Run QA for pull request #${pr.number}.`,
    header(ctx),
    diffSteps(ctx),
    `First check that \`.factory/skills/qa/SKILL.md\` exists on the PR branch. If it does not, post one comment on #${pr.number} saying QA is not set up yet (a maintainer must run /install-qa interactively once and commit \`.factory/skills/qa*\`), then stop.`,
    'Otherwise run /qa for the changes in that diff. Do not ask questions; if a flow cannot be run, mark it BLOCKED with the reason.',
    `Post the report as one comment on #${pr.number}: a pass/fail/blocked table per flow with a short note each, with the screenshots embedded. Upload each screenshot with the user-attachments command in your rules and embed the URL it returns. Do not push commits to the PR branch.`,
    untrusted('PR description', ctx.body),
    extraInstructions(ctx.extra)
  )
}
