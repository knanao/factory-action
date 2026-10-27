/** Shared builders for action inputs and the action's own tracking comments. */
import type { Inputs } from '../src/inputs.js'
import type { LaneState } from '../src/state.js'
import { renderTracking } from '../src/state.js'

export const SELF = 'github-actions[bot]'

export function inputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    factoryApiKey: 'fk',
    computerId: 'comp-1',
    environmentId: '',
    provisionTimeoutMs: 300_000,
    mode: 'mention',
    prompt: '',
    lane: 'task',
    triggerPhrase: '@factory',
    allowedAssociations: ['OWNER', 'MEMBER', 'COLLABORATOR'],
    permissionFallback: true,
    allowedBots: [],
    commands: ['verify', 'security-review'],
    cwd: '',
    model: '',
    reasoningEffort: '',
    autonomyLevel: 'high',
    reuseSession: true,
    maxComments: 30,
    messageTimeoutMs: 1000,
    githubToken: 'ghs',
    factoryApiUrl: 'https://api.test',
    ...overrides
  }
}

/** A tracking comment written by the action itself for one lane. */
export function trackingComment(state: Omit<LaneState, 'v'>, id = 77) {
  return {
    id,
    body: renderTracking(
      { v: 1, ...state },
      { sessionUrl: 'u', reused: false, runUrl: 'r' }
    ),
    user: { login: SELF }
  }
}
