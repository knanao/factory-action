import type { PromptContext } from './common.js'
import { extraInstructions, header, join, untrusted } from './common.js'

/** Diff range and checkout steps shared by the PR-based CI modes. */
export function diffSteps(ctx: PromptContext): string {
  const pr = ctx.pr!
  const range = ctx.previousSha
    ? `${ctx.previousSha}...${pr.headSha}`
    : `origin/${pr.baseRef}...${pr.headSha}`
  const followUp = ctx.previousSha
    ? `New commits were pushed since your last run on this PR (at ${ctx.previousSha}). Look only at \`git diff ${range}\`; if that range is unavailable because of a force-push, use \`git diff origin/${pr.baseRef}...${pr.headSha}\`. Do not repeat findings you already posted.`
    : ''
  return join(
    followUp,
    `In your workspace, check out the PR without taking its branch with \`gh pr checkout ${pr.number} --detach\` and run \`git fetch origin ${pr.baseRef}\`. The diff to examine is \`git diff ${range}\`.`
  )
}

/** Instructions for posting one batched review with inline comments. */
export function postReviewSteps(ctx: PromptContext, labels: string): string {
  const pr = ctx.pr!
  return `Post exactly one review: write a JSON file and run \`gh api repos/${ctx.repo}/pulls/${pr.number}/reviews --method POST --input <file>\` with \`"event": "COMMENT"\`, \`"commit_id": "${pr.headSha}"\`, a short summary as \`body\`, and at most ${ctx.maxComments} inline comments in \`comments\` (each \`{path, line, side: "RIGHT", body}\`, anchored on lines that are in the diff). Each inline body starts with ${labels} and a short title, followed by one paragraph. Use \`\`\`suggestion blocks only for small fixes you are sure about. If there are no findings, post the review with only the summary. Do not push commits; this run is review only.`
}

export function reviewPrompt(ctx: PromptContext): string {
  const pr = ctx.pr!
  return join(
    `Review pull request #${pr.number}.`,
    header(ctx),
    diffSteps(ctx),
    `Before reviewing, read the existing review comments so you do not duplicate them: \`gh api repos/${ctx.repo}/pulls/${pr.number}/comments --paginate\`.`,
    'Use the review skill: first collect candidate findings, then validate each one against the code and drop anything you cannot confirm. If `.factory/skills/review-guidelines` exists, follow it. Focus on correctness bugs, security problems, data loss, concurrency issues and breaking changes. Skip style nits.',
    postReviewSteps(ctx, '`[P0]`, `[P1]` or `[P2]`'),
    untrusted('PR description', ctx.body),
    extraInstructions(ctx.extra)
  )
}
