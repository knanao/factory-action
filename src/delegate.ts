import { isAuthorized } from './authz.js'
import { cleanup } from './cleanup.js'
import { computerName, ensureComputer, isFromEnvironment } from './compute.js'
import type {
  Computer,
  CreateSessionRequest,
  FactoryClient,
  Session
} from './factory.js'
import { resolveCwd, sessionUrl } from './factory.js'
import type { GitHubApi } from './github.js'
import type { Inputs } from './inputs.js'
import { log } from './logger.js'
import type { Workspace } from './prompts/common.js'
import type { PromptContext } from './prompts/index.js'
import { buildPrompt, systemRules } from './prompts/index.js'
import type { LaneState, TrackingComment } from './state.js'
import { findTracking, renderTracking } from './state.js'
import type { SkipReason, Trigger } from './trigger.js'
import { findCommand, precheck } from './trigger.js'

export type FactoryApi = Pick<
  FactoryClient,
  | 'createSession'
  | 'getSession'
  | 'interrupt'
  | 'postMessage'
  | 'getComputer'
  | 'findComputer'
  | 'getComputerByName'
  | 'createComputer'
  | 'listComputers'
  | 'deleteComputer'
>

export interface Deps {
  github: GitHubApi
  factory: FactoryApi
  runUrl: string
  runId: number
}

export interface Outcome {
  skipped: SkipReason | ''
  sessionId?: string
  sessionUrl?: string
  reused?: boolean
  /** The session's computer; in cleanup mode, the computers deleted. */
  computerId?: string
}

/** Where a lane's session runs, resolved before any session is touched. */
interface Lane {
  /** A new push supersedes the previous run in this lane. */
  isPush: boolean
  key: string
  branch: string
  tracking?: TrackingComment
  environmentComputer?: Computer
  computerId: string
  cwd?: string
  headSha?: string
}

/** The tracked session, and its id when it may be reused. */
interface Previous {
  existing?: Session
  sessionId?: string
}

/**
 * Hands the event to a Droid session and returns right away (fire-and-forget).
 * Droid writes its results to GitHub itself.
 */
export async function delegate(
  inputs: Inputs,
  t: Trigger,
  deps: Deps
): Promise<Outcome> {
  const { github, factory } = deps

  const skip = precheck(inputs.mode, t, inputs)
  if (skip) {
    log.info('delegate.skipped', { reason: skip })
    return { skipped: skip }
  }

  // Cleanup acts on a closed thread and sends no user-written text to Droid.
  if (inputs.mode === 'cleanup') {
    const { number } = t
    if (number === undefined) return { skipped: 'no-trigger' }
    const cleaned = await cleanup(inputs, { ...t, number }, deps)
    return { skipped: '', ...cleaned, reused: true }
  }

  if (!(await isAuthorized(inputs, t, github))) {
    return { skipped: 'unauthorized' }
  }

  if (t.reaction) {
    await github
      .addEyes(t.reaction)
      .catch((err) => log.warning('reaction.add_failed', { error: err }))
  }

  const lane = await resolveLane(inputs, t, deps)
  const previous = await findPrevious(inputs, factory, lane)
  await interruptUnreused(inputs, factory, lane, previous)
  const previousSha = await supersede(factory, lane, previous)

  const reused = previous.sessionId !== undefined
  let sessionId = previous.sessionId
  if (!sessionId) {
    sessionId = await openSession(inputs, t, factory, lane)
  } else {
    log.info('session.reused', { session_id: sessionId })
  }

  const sent = await factory.postMessage(
    sessionId,
    buildPrompt(inputs.mode, promptContext(inputs, t, previousSha)),
    inputs.messageTimeoutMs
  )
  if (sent.timedOut) {
    log.warning('message.timeout', {
      timeout_ms: inputs.messageTimeoutMs,
      msg: 'assuming the message was accepted'
    })
  }

  const url = sessionUrl(sessionId)
  if (t.number !== undefined) {
    const body = renderTracking(laneState(inputs, t, lane, sessionId), {
      sessionUrl: url,
      reused,
      runUrl: deps.runUrl
    })
    try {
      if (lane.tracking) await github.updateIssueComment(lane.tracking.id, body)
      else await github.createIssueComment(t.number, body)
    } catch (err) {
      // Droid is already working; a missing tracking comment only loses reuse.
      log.warning('tracking.write_failed', { error: err })
    }
  }

  return {
    skipped: '',
    sessionId,
    sessionUrl: url,
    reused,
    computerId: lane.computerId
  }
}

async function resolveLane(
  inputs: Inputs,
  t: Trigger,
  deps: Deps
): Promise<Lane> {
  let tracking: TrackingComment | undefined
  if (t.number !== undefined) {
    const [comments, self] = await Promise.all([
      deps.github.listIssueComments(t.number),
      deps.github.selfLogin()
    ])
    tracking = findTracking(comments, inputs.lane, self)
    if (tracking)
      log.debug('tracking.found', {
        lane: inputs.lane,
        session_id: tracking.state.sid
      })
  }

  const key = laneKey(t, deps.runId)
  const environmentComputer = inputs.environmentId
    ? await ensureComputer(deps.factory, {
        name: computerName(t.owner, t.repo, key, inputs.lane),
        environmentId: inputs.environmentId,
        timeoutMs: inputs.provisionTimeoutMs
      })
    : undefined
  const computerId = environmentComputer?.id ?? inputs.computerId
  const cwd = inputs.cwd
    ? inputs.cwd
    : environmentComputer
      ? resolveComputerCwd(environmentComputer, computerId, t.repo)
      : undefined
  return {
    isPush: t.event === 'pull_request' || t.event === 'pull_request_target',
    key,
    branch: `factory/${inputs.lane}-${key}`,
    tracking,
    environmentComputer,
    computerId,
    cwd,
    headSha: t.pr?.headSha
  }
}

function laneKey(t: Trigger, runId: number): string {
  return t.number !== undefined ? String(t.number) : `run-${runId}`
}

/** Looks up the tracked session and decides whether it can be reused. */
async function findPrevious(
  inputs: Inputs,
  factory: FactoryApi,
  lane: Lane
): Promise<Previous> {
  const { tracking, environmentComputer, computerId } = lane
  if (!tracking || !(inputs.reuseSession || environmentComputer)) return {}
  const existing = await factory.getSession(tracking.state.sid)
  if (inputs.reuseSession && environmentComputer) {
    return reuseOnEnvironment(inputs, factory, tracking.state, {
      existing,
      computerId
    })
  }
  if (
    inputs.reuseSession &&
    existing?.computerId &&
    existing.computerId !== computerId
  ) {
    log.info('session.computer_mismatch', {
      session_id: existing.sessionId,
      computer_id: existing.computerId,
      expected_computer_id: computerId
    })
    return { existing }
  }
  if (inputs.reuseSession && existing) {
    return { existing, sessionId: existing.sessionId }
  }
  if (!existing) {
    log.info('session.missing', { session_id: tracking.state.sid })
  }
  return { existing }
}

/** Reuses an Environment session only while it runs on its tracked, active computer. */
async function reuseOnEnvironment(
  inputs: Inputs,
  factory: FactoryApi,
  state: LaneState,
  { existing, computerId }: { existing?: Session; computerId: string }
): Promise<Previous> {
  const trackedComputer = state.cid
    ? await factory.findComputer(state.cid)
    : undefined
  const canReuse =
    existing?.computerId === state.cid &&
    existing?.computerId === computerId &&
    trackedComputer?.status === 'active' &&
    isFromEnvironment(trackedComputer, inputs.environmentId)
  if (canReuse && existing) return { existing, sessionId: existing.sessionId }
  log.info('session.computer_inactive', {
    session_id: state.sid,
    tracked_computer_id: state.cid
  })
  return { existing }
}

/** With reuse disabled, a still-running Environment session is stopped. */
async function interruptUnreused(
  inputs: Inputs,
  factory: FactoryApi,
  lane: Lane,
  { existing }: Previous
): Promise<void> {
  if (
    lane.environmentComputer &&
    !inputs.reuseSession &&
    existing &&
    existing.computerId === lane.computerId &&
    existing.status !== 'idle'
  ) {
    log.info('session.interrupted', {
      session_id: existing.sessionId,
      reason: 'reuse-session is disabled'
    })
    await factory.interrupt(existing.sessionId)
  }
}

/**
 * Interrupts a reused session that a new push supersedes. Returns the SHA the
 * idle reused session last saw, so the review covers only what changed since.
 */
async function supersede(
  factory: FactoryApi,
  lane: Lane,
  { existing, sessionId }: Previous
): Promise<string | undefined> {
  if (!sessionId || !existing || !lane.isPush) return undefined
  if (existing.status !== 'idle') {
    log.info('session.interrupted', {
      session_id: sessionId,
      reason: 'superseded by a new push',
      status: existing.status
    })
    await factory.interrupt(sessionId)
    return undefined
  }
  // The tracked SHA was sent, not necessarily reviewed before interruption.
  const trackedSha = lane.tracking?.state.sha
  return trackedSha !== lane.headSha ? trackedSha : undefined
}

async function openSession(
  inputs: Inputs,
  t: Trigger,
  factory: FactoryApi,
  lane: Lane
): Promise<string> {
  const cwd =
    lane.cwd ?? (await resolveRepoDir(factory, lane.computerId, t.repo))
  const session = await factory.createSession(
    sessionRequest(inputs, t, lane, cwd)
  )
  log.info('session.created', { session_id: session.sessionId })
  return session.sessionId
}

function promptContext(
  inputs: Inputs,
  t: Trigger,
  previousSha: string | undefined
): PromptContext {
  return {
    repo: `${t.owner}/${t.repo}`,
    event: t.event,
    number: t.number,
    url: t.url,
    isPR: t.isPR,
    title: t.title,
    body: t.body,
    author: t.author,
    text: t.text,
    command:
      inputs.mode === 'mention' && t.text
        ? findCommand(t.text, inputs.triggerPhrase, inputs.commands)
        : undefined,
    reviewContext: t.reviewContext,
    reviewCommentId:
      t.reaction?.kind === 'review-comment' ? t.reaction.id : undefined,
    pr: t.pr,
    triggerPhrase: inputs.triggerPhrase,
    extra: inputs.prompt,
    maxComments: inputs.maxComments,
    previousSha
  }
}

function laneState(
  inputs: Inputs,
  t: Trigger,
  lane: Lane,
  sessionId: string
): LaneState {
  const state: LaneState = { v: 1, lane: inputs.lane, sid: sessionId }
  if (lane.environmentComputer) state.cid = lane.environmentComputer.id
  if (lane.isPush && t.pr) state.sha = t.pr.headSha
  return state
}

async function resolveRepoDir(
  factory: FactoryApi,
  computerId: string,
  repo: string
): Promise<string> {
  const computer = await factory.getComputer(computerId)
  return resolveComputerCwd(computer, computerId, repo)
}

function resolveComputerCwd(
  computer: Computer,
  computerId: string,
  repo: string
): string {
  const dir = resolveCwd(computer, repo)
  if (!dir) {
    throw new Error(
      `Could not find a single clone of '${repo}' on computer ${computerId} (cloned: ${(computer.clonedRepoDirectories ?? []).join(', ') || 'none'}). Set the 'cwd' input.`
    )
  }
  return dir
}

function sessionRequest(
  inputs: Inputs,
  t: Trigger,
  lane: Lane,
  cwd: string
): CreateSessionRequest {
  const repo = `${t.owner}/${t.repo}`
  const workspace: Workspace = lane.environmentComputer
    ? { kind: 'clone', branch: lane.branch }
    : {
        kind: 'worktree',
        path: `${cwd.replace(/\/+$/, '')}.worktrees/${inputs.lane}-${lane.key}`,
        branch: lane.branch
      }
  return {
    computerId: lane.computerId,
    cwd,
    sessionSettings: {
      ...(inputs.model ? { model: inputs.model } : {}),
      ...(inputs.reasoningEffort
        ? { reasoningEffort: inputs.reasoningEffort }
        : {}),
      interactionMode: 'auto',
      autonomyLevel: inputs.autonomyLevel,
      tags: [
        {
          name: 'factory-action',
          metadata: { repo, number: lane.key, lane: inputs.lane }
        }
      ],
      systemPrompt: {
        type: 'preset',
        preset: 'droid',
        append: systemRules(repo, inputs.triggerPhrase, workspace)
      }
    }
  }
}
