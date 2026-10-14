import * as core from '@actions/core'
import { authorize } from './authz.js'
import {
  computerName,
  ensureComputer,
  isFromEnvironment,
  threadPrefix
} from './compute.js'
import type {
  Computer,
  CreateSessionRequest,
  FactoryClient,
  Session
} from './factory.js'
import { resolveCwd, sessionUrl } from './factory.js'
import type { GitHubApi } from './github.js'
import type { Inputs } from './inputs.js'
import type { Workspace } from './prompts/common.js'
import { buildPrompt, cleanupPrompt, systemRules } from './prompts/index.js'
import type { LaneState, TrackingComment } from './state.js'
import { findAllTracking, findTracking, renderTracking } from './state.js'
import type { SkipReason, Trigger } from './trigger.js'
import { findCommand, needsAuthorization, precheck } from './trigger.js'

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
    core.info(`Skipped: ${skip}`)
    return { skipped: skip }
  }

  // Cleanup acts on a closed thread and sends no user-written text to Droid.
  if (inputs.mode === 'cleanup') return cleanup(inputs, t, deps)

  if (needsAuthorization(t)) {
    const authz = await authorize(t.author!, {
      allowedAssociations: inputs.allowedAssociations,
      permissionFallback: inputs.permissionFallback,
      getPermission: (login) => github.getPermission(login)
    })
    if (!authz.allowed) {
      // Stay quiet on the thread to avoid noise for outside users.
      core.notice(
        `@${t.author!.login} is not allowed to trigger Droid (${authz.reason})`
      )
      return { skipped: 'unauthorized' }
    }
    core.info(`Authorized @${t.author!.login} (${authz.reason})`)
  }

  if (t.reaction) {
    await github
      .addEyes(t.reaction)
      .catch((err) => core.warning(`Could not add reaction: ${err}`))
  }

  // A new push supersedes the previous run in this lane.
  const isPush = t.event === 'pull_request' || t.event === 'pull_request_target'

  let tracking: TrackingComment | undefined
  if (t.number !== undefined) {
    const [comments, self] = await Promise.all([
      github.listIssueComments(t.number),
      github.selfLogin()
    ])
    tracking = findTracking(comments, inputs.lane, self)
  }

  const key = t.number !== undefined ? String(t.number) : `run-${deps.runId}`
  const environmentComputer = inputs.environmentId
    ? await ensureComputer(factory, {
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
  const branch = `factory/${inputs.lane}-${key}`

  let sessionId: string | undefined
  let previousSha: string | undefined
  let existing: Session | undefined
  if (tracking && (inputs.reuseSession || environmentComputer)) {
    existing = await factory.getSession(tracking.state.sid)
    if (inputs.reuseSession && environmentComputer) {
      const trackedComputer = tracking.state.cid
        ? await factory.findComputer(tracking.state.cid)
        : undefined
      const canReuse =
        existing?.computerId === tracking.state.cid &&
        existing?.computerId === computerId &&
        trackedComputer?.status === 'active' &&
        isFromEnvironment(trackedComputer, inputs.environmentId)
      if (canReuse && existing) {
        sessionId = existing.sessionId
      } else {
        core.info(
          `Tracked Environment session ${tracking.state.sid} is no longer on its active computer; creating a new one`
        )
      }
    } else if (
      inputs.reuseSession &&
      existing?.computerId &&
      existing.computerId !== computerId
    ) {
      core.info(
        `Session ${existing.sessionId} runs on computer ${existing.computerId}, not ${computerId}; creating a new one`
      )
    } else if (inputs.reuseSession && existing) {
      sessionId = existing.sessionId
    } else if (!existing) {
      core.info(
        `Session ${tracking.state.sid} no longer exists; creating a new one`
      )
    }
  }

  if (
    environmentComputer &&
    !inputs.reuseSession &&
    existing &&
    existing.computerId === computerId &&
    existing.status !== 'idle'
  ) {
    core.info(
      `Interrupting previous session ${existing.sessionId}: reuse-session is disabled`
    )
    await factory.interrupt(existing.sessionId)
  }

  if (sessionId && existing) {
    if (isPush && existing.status !== 'idle') {
      core.info(
        `Interrupting running session ${sessionId}: a new push supersedes it`
      )
      await factory.interrupt(sessionId)
    }
    // The tracked SHA was sent, not necessarily reviewed before interruption.
    if (
      isPush &&
      existing.status === 'idle' &&
      tracking?.state.sha !== t.pr?.headSha
    )
      previousSha = tracking?.state.sha
  }

  const reused = sessionId !== undefined
  if (!sessionId) {
    const sessionCwd =
      cwd ?? (await resolveRepoDir(factory, computerId, t.repo))
    const workspace: Workspace = environmentComputer
      ? { kind: 'clone', branch }
      : {
          kind: 'worktree',
          path: `${sessionCwd.replace(/\/+$/, '')}.worktrees/${inputs.lane}-${key}`,
          branch
        }
    const session = await factory.createSession(
      sessionRequest(inputs, t, sessionCwd, deps.runId, computerId, workspace)
    )
    sessionId = session.sessionId
    core.info(`Created session ${sessionId}`)
  } else {
    core.info(`Reusing session ${sessionId}`)
  }

  const text = buildPrompt(inputs.mode, {
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
  })
  const sent = await factory.postMessage(
    sessionId,
    text,
    inputs.messageTimeoutMs
  )
  if (sent.timedOut) {
    core.warning(
      `No response from the messages endpoint within ${inputs.messageTimeoutMs} ms; assuming the message was accepted`
    )
  }

  const url = sessionUrl(sessionId)
  if (t.number !== undefined) {
    const state: LaneState = { v: 1, lane: inputs.lane, sid: sessionId }
    if (environmentComputer) state.cid = environmentComputer.id
    if (isPush && t.pr) state.sha = t.pr.headSha
    const body = renderTracking(state, {
      sessionUrl: url,
      reused,
      runUrl: deps.runUrl
    })
    try {
      if (tracking) await github.updateIssueComment(tracking.id, body)
      else await github.createIssueComment(t.number, body)
    } catch (err) {
      // Droid is already working; a missing tracking comment only loses reuse.
      core.warning(`Could not write the tracking comment: ${err}`)
    }
  }

  return { skipped: '', sessionId, sessionUrl: url, reused, computerId }
}

/** Performs mode-specific cleanup for a closed issue or PR. */
async function cleanup(
  inputs: Inputs,
  t: Trigger,
  deps: Deps
): Promise<Outcome> {
  const { github, factory } = deps
  if (t.number === undefined) return { skipped: 'no-trigger' }
  if (inputs.environmentId) return cleanupEnvironment(inputs, t, deps)
  const [comments, self] = await Promise.all([
    github.listIssueComments(t.number),
    github.selfLogin()
  ])
  const sessions: string[] = []
  for (const tracking of findAllTracking(comments, self)) {
    const { sid } = tracking.state
    const session = await factory.getSession(sid)
    if (!session) continue
    if (session.status !== 'idle') await factory.interrupt(sid)
    await factory.postMessage(sid, cleanupPrompt(t), inputs.messageTimeoutMs)
    sessions.push(sid)
    core.info(`Asked session ${sid} (${tracking.state.lane}) to clean up`)
    const body = renderTracking(tracking.state, {
      sessionUrl: sessionUrl(sid),
      reused: true,
      runUrl: deps.runUrl,
      status: 'Closed (cleanup requested)'
    })
    await github
      .updateIssueComment(tracking.id, body)
      .catch((err) =>
        core.warning(`Could not update the tracking comment: ${err}`)
      )
  }
  if (sessions.length === 0) core.info('No sessions to clean up')
  return { skipped: '', sessionId: sessions.join(','), reused: true }
}

async function cleanupEnvironment(
  inputs: Inputs,
  t: Trigger,
  deps: Deps
): Promise<Outcome> {
  const { github, factory } = deps
  if (t.number === undefined) return { skipped: 'no-trigger' }
  const [comments, self, computers] = await Promise.all([
    github.listIssueComments(t.number),
    github.selfLogin(),
    factory.listComputers()
  ])
  const trackings = findAllTracking(comments, self)
  const prefix = threadPrefix(t.owner, t.repo, t.number)
  const targets = new Map(
    computers
      .filter(
        (computer) =>
          computer.name.startsWith(prefix) &&
          isFromEnvironment(computer, inputs.environmentId)
      )
      .map((computer) => [computer.id, computer])
  )
  const unmanaged = new Set<string>()
  const alreadyAbsent = new Set<string>()
  for (const { state } of trackings) {
    if (!state.cid || targets.has(state.cid)) continue
    const computer = await factory.findComputer(state.cid)
    if (
      computer?.name.startsWith(prefix) &&
      isFromEnvironment(computer, inputs.environmentId)
    ) {
      targets.set(computer.id, computer)
    } else if (!computer) {
      alreadyAbsent.add(state.cid)
    } else {
      unmanaged.add(state.cid)
    }
  }

  const deleted = new Set<string>()
  const deletionFailures: string[] = []
  for (const computerId of targets.keys()) {
    try {
      if (await factory.deleteComputer(computerId)) deleted.add(computerId)
      else alreadyAbsent.add(computerId)
    } catch (err) {
      deletionFailures.push(computerId)
      core.warning(`Could not delete computer ${computerId}: ${err}`)
    }
  }

  for (const tracking of trackings) {
    const cid = tracking.state.cid
    if (!cid) continue
    const status =
      cid && deletionFailures.includes(cid)
        ? 'Closed (computer deletion failed)'
        : unmanaged.has(cid)
          ? 'Closed (computer not managed)'
          : alreadyAbsent.has(cid) || (!deleted.has(cid) && !targets.has(cid))
            ? 'Closed (computer already absent)'
            : 'Closed (computer deleted)'
    const body = renderTracking(tracking.state, {
      sessionUrl: sessionUrl(tracking.state.sid),
      reused: true,
      runUrl: deps.runUrl,
      status
    })
    await github
      .updateIssueComment(tracking.id, body)
      .catch((err) =>
        core.warning(`Could not update the tracking comment: ${err}`)
      )
  }

  if (targets.size === 0) core.info('No Environment computers to delete')
  if (deletionFailures.length > 0) {
    throw new Error(
      `Could not delete Environment computers: ${deletionFailures.join(', ')}`
    )
  }
  return {
    skipped: '',
    computerId: [...deleted].join(','),
    reused: true
  }
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
  cwd: string,
  runId: number,
  computerId: string,
  workspace: Workspace
): CreateSessionRequest {
  const repo = `${t.owner}/${t.repo}`
  const key = t.number !== undefined ? String(t.number) : `run-${runId}`
  return {
    computerId,
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
          metadata: { repo, number: key, lane: inputs.lane }
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
