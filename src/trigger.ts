import type { Mode } from './inputs.js'

/** Marker Droid appends to everything it posts. Used for loop prevention. */
export const DROID_MARKER = '<!-- factory-droid -->'

export type SkipReason =
  'unauthorized' | 'no-trigger' | 'fork' | 'bot' | 'draft'

export interface PullRef {
  number: number
  baseRef: string
  baseSha: string
  headRef: string
  headSha: string
  headRepo: string
  draft: boolean
}

export interface Author {
  login: string
  type: string
  association?: string
}

/** A GitHub event normalized into what the action needs. */
export interface Trigger {
  event: string
  action?: string
  owner: string
  repo: string
  number?: number
  isPR: boolean
  url?: string
  title?: string
  body?: string
  author?: Author
  /** User-written text that triggered the run (comment, review or issue body). Untrusted. */
  text?: string
  /** Where to put the 👀 reaction. */
  reaction?: { kind: 'issue-comment' | 'review-comment' | 'issue'; id: number }
  /** Set for pull_request_review_comment events. */
  reviewContext?: { path: string; line?: number; diffHunk: string }
  /** Set when the payload carries the pull request. */
  pr?: PullRef
}

const CI_ACTIONS = ['opened', 'synchronize', 'reopened', 'ready_for_review']

/* eslint-disable @typescript-eslint/no-explicit-any -- webhook payloads are loosely typed */
export function parseEvent(
  event: string,
  payload: any,
  owner: string,
  repo: string
): Trigger {
  const base: Trigger = {
    event,
    action: payload.action,
    owner,
    repo,
    isPR: false
  }

  const parse = PARSERS.get(event)
  return parse ? { ...base, ...parse(payload) } : base
}

type Parser = (payload: any) => Partial<Trigger>

const fromPullRequest: Parser = ({ pull_request: pr }) => ({
  ...fromPull(pr),
  author: author(pr.user, pr.author_association)
})

const PARSERS = new Map<string, Parser>([
  [
    'issue_comment',
    ({ issue, comment }) => ({
      number: issue.number,
      isPR: Boolean(issue.pull_request),
      url: issue.html_url,
      title: issue.title,
      body: issue.body ?? '',
      author: author(comment.user, comment.author_association),
      text: comment.body ?? '',
      reaction: { kind: 'issue-comment', id: comment.id }
    })
  ],
  [
    'pull_request_review_comment',
    ({ pull_request: pr, comment }) => ({
      ...fromPull(pr),
      author: author(comment.user, comment.author_association),
      text: comment.body ?? '',
      reaction: { kind: 'review-comment', id: comment.id },
      reviewContext: {
        path: comment.path,
        line: comment.line ?? comment.original_line ?? undefined,
        diffHunk: comment.diff_hunk ?? ''
      }
    })
  ],
  [
    'pull_request_review',
    ({ pull_request: pr, review }) => ({
      ...fromPull(pr),
      author: author(review.user, review.author_association),
      text: review.body ?? ''
    })
  ],
  [
    'issues',
    ({ issue }) => ({
      number: issue.number,
      url: issue.html_url,
      title: issue.title,
      body: issue.body ?? '',
      author: author(issue.user, issue.author_association),
      text: issue.body ?? '',
      reaction: { kind: 'issue', id: issue.number }
    })
  ],
  ['pull_request', fromPullRequest],
  ['pull_request_target', fromPullRequest]
])

function fromPull(pr: any): Partial<Trigger> {
  return {
    number: pr.number,
    isPR: true,
    url: pr.html_url,
    title: pr.title,
    body: pr.body ?? '',
    pr: {
      number: pr.number,
      baseRef: pr.base.ref,
      baseSha: pr.base.sha,
      headRef: pr.head.ref,
      headSha: pr.head.sha,
      headRepo: pr.head.repo?.full_name ?? '',
      draft: Boolean(pr.draft)
    }
  }
}

function author(user: any, association?: string): Author {
  return { login: user?.login ?? '', type: user?.type ?? '', association }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Cleanup reads no PR content, so pull_request_target is safe and also covers
// PRs from forks.
const CLOSE_EVENTS = ['issues', 'pull_request', 'pull_request_target']

const SCHEDULED_EVENTS = ['schedule', 'workflow_dispatch']

const MENTION_EVENTS: Record<string, string[]> = {
  issue_comment: ['created'],
  pull_request_review_comment: ['created'],
  pull_request_review: ['submitted'],
  issues: ['opened']
}

/**
 * Decides, without any API calls, whether this event should be handled.
 * Returns a skip reason, or undefined to continue. Throws when the mode cannot
 * work with the event at all (a workflow misconfiguration).
 */
export function precheck(
  mode: Mode,
  t: Trigger,
  opts: { triggerPhrase: string; allowedBots: string[] }
): SkipReason | undefined {
  switch (mode) {
    case 'mention':
      return mentionSkip(t, opts)
    case 'cleanup':
      return cleanupSkip(t)
    // deep-security and wiki cover the whole repository, not one thread.
    case 'deep-security':
    case 'wiki':
      return repositorySkip(mode, t)
    case 'custom':
      return customSkip(t, opts.allowedBots)
    default:
      // review / security / qa
      return pullRequestSkip(mode, t)
  }
}

function mentionSkip(
  t: Trigger,
  opts: { triggerPhrase: string; allowedBots: string[] }
): SkipReason | undefined {
  if (!MENTION_EVENTS[t.event]) {
    throw new Error(
      `mode 'mention' does not support the '${t.event}' event. Supported: ${Object.keys(MENTION_EVENTS).join(', ')}`
    )
  }
  if (!MENTION_EVENTS[t.event].includes(t.action ?? '')) return 'no-trigger'
  if (isBotOrDroid(t, opts.allowedBots)) return 'bot'
  if (!containsTrigger(t.text ?? '', opts.triggerPhrase)) return 'no-trigger'
  return undefined
}

function cleanupSkip(t: Trigger): SkipReason | undefined {
  if (!CLOSE_EVENTS.includes(t.event)) {
    throw new Error(
      `mode 'cleanup' supports only ${CLOSE_EVENTS.join(', ')} (closed), got '${t.event}'`
    )
  }
  return t.action === 'closed' ? undefined : 'no-trigger'
}

function repositorySkip(mode: Mode, t: Trigger): SkipReason | undefined {
  if (!SCHEDULED_EVENTS.includes(t.event)) {
    throw new Error(
      `mode '${mode}' works on the whole repository and supports only ${SCHEDULED_EVENTS.join(', ')}, got '${t.event}'`
    )
  }
  return undefined
}

function customSkip(t: Trigger, allowedBots: string[]): SkipReason | undefined {
  if (t.text !== undefined && isBotOrDroid(t, allowedBots)) return 'bot'
  if (t.pr && isFork(t)) return 'fork'
  return undefined
}

function pullRequestSkip(mode: Mode, t: Trigger): SkipReason | undefined {
  if (t.event !== 'pull_request' && t.event !== 'pull_request_target') {
    throw new Error(
      `mode '${mode}' requires the 'pull_request' event, got '${t.event}'`
    )
  }
  if (!CI_ACTIONS.includes(t.action ?? '')) return 'no-trigger'
  if (t.pr?.draft) return 'draft'
  if (isFork(t)) return 'fork'
  return undefined
}

/** Authorization is required when a user-written text triggered the run. */
export function needsAuthorization(t: Trigger): boolean {
  return t.text !== undefined && t.author !== undefined
}

function isFork(t: Trigger): boolean {
  return t.pr !== undefined && t.pr.headRepo !== `${t.owner}/${t.repo}`
}

function isBotOrDroid(t: Trigger, allowedBots: string[]): boolean {
  if ((t.text ?? '').includes(DROID_MARKER)) return true
  const a = t.author
  if (!a) return false
  const isBot = a.type === 'Bot' || a.login.endsWith('[bot]')
  return isBot && !allowedBots.includes(a.login.toLowerCase())
}

/**
 * True when the phrase appears as a standalone word outside quotes and code.
 * Quoted replies and code blocks are ignored so that quoting an earlier request
 * does not trigger a new run.
 */
export function containsTrigger(text: string, phrase: string): boolean {
  return new RegExp(
    `(^|\\s)${escapeRegExp(phrase)}(?=[\\s.,!?;:]|$)`,
    'i'
  ).test(prose(text))
}

/**
 * Returns the command named right after the trigger phrase, e.g. `verify` in
 * `@factory verify the fix`, if it is one of `commands`. A leading slash is
 * accepted too (`@factory /verify`).
 */
export function findCommand(
  text: string,
  phrase: string,
  commands: string[]
): string | undefined {
  const re = new RegExp(
    `(?:^|\\s)${escapeRegExp(phrase)}\\s+/?([a-z0-9][a-z0-9-]*)(?=[\\s.,!?;:]|$)`,
    'gi'
  )
  for (const m of prose(text).matchAll(re)) {
    const name = m[1].toLowerCase()
    if (commands.includes(name)) return name
  }
  return undefined
}

/** Drops code and quoted lines, which never trigger a run. */
function prose(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('>'))
    .join('\n')
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
