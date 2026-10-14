/**
 * Session state lives in a hidden marker inside a tracking comment that the
 * action writes on the issue or PR. There is one tracking comment per lane, so
 * lanes running in parallel (e.g. a review/security matrix) never race on the
 * same comment.
 */

const MARKER_PREFIX = '<!-- factory-action:state '
const MARKER_RE = /<!-- factory-action:state (\{.*?\}) -->/

export interface LaneState {
  v: 1
  lane: string
  sid: string
  /** Last head SHA sent to the session (CI lanes). */
  sha?: string
  /** Computer the session runs on, when the action created it (Environment mode). */
  cid?: string
}

export interface TrackingComment {
  id: number
  state: LaneState
}

export interface IssueComment {
  id: number
  body?: string | null
  user?: { login: string } | null
}

export function parseState(
  body: string | null | undefined
): LaneState | undefined {
  const match = body?.match(MARKER_RE)
  if (!match) return undefined
  try {
    const state = JSON.parse(match[1]) as Partial<LaneState>
    if (
      state.v !== 1 ||
      typeof state.lane !== 'string' ||
      typeof state.sid !== 'string' ||
      (state.cid !== undefined && typeof state.cid !== 'string')
    ) {
      return undefined
    }
    return state as LaneState
  } catch {
    return undefined
  }
}

/**
 * Finds the tracking comment for a lane. Only comments written by the action's
 * own identity are trusted, so a third party cannot forge a marker that points
 * the run at another session.
 */
export function findTracking(
  comments: IssueComment[],
  lane: string,
  selfLogin: string
): TrackingComment | undefined {
  for (const c of comments) {
    if (c.user?.login !== selfLogin) continue
    const state = parseState(c.body)
    if (state?.lane === lane) return { id: c.id, state }
  }
  return undefined
}

/** All tracking comments on a thread written by the action, one per lane. */
export function findAllTracking(
  comments: IssueComment[],
  selfLogin: string
): TrackingComment[] {
  const found: TrackingComment[] = []
  for (const c of comments) {
    if (c.user?.login !== selfLogin) continue
    const state = parseState(c.body)
    if (state) found.push({ id: c.id, state })
  }
  return found
}

export interface RenderOptions {
  sessionUrl: string
  reused: boolean
  runUrl: string
  /** Overrides the status derived from `reused`. */
  status?: string
}

export function renderTracking(state: LaneState, opts: RenderOptions): string {
  const status =
    opts.status ??
    (opts.reused ? 'Delegated (follow-up)' : 'Delegated (new session)')
  const updated = new Date().toISOString()
  // The marker is JSON without "-->" so it cannot break out of the comment.
  const marker = `${MARKER_PREFIX}${JSON.stringify(state).replace(/--/g, '-\\u002d')} -->`
  return [
    `**Factory Droid** · \`${state.lane}\``,
    '',
    '| Session | Status | Updated | Run |',
    '|---|---|---|---|',
    `| [${state.sid}](${opts.sessionUrl}) | ${status} | ${updated} | [logs](${opts.runUrl}) |`,
    '',
    'Droid posts its results directly to this thread.',
    '',
    marker
  ].join('\n')
}
