import * as core from '@actions/core'
import { authorize } from './authz.js'
import type { CreateSessionRequest, FactoryClient } from './factory.js'
import { resolveCwd, sessionUrl } from './factory.js'
import type { GitHubApi } from './github.js'
import type { Inputs } from './inputs.js'
import { buildPrompt, cleanupPrompt, systemRules } from './prompts/index.js'
import type { LaneState, TrackingComment } from './state.js'
import { findAllTracking, findTracking, renderTracking } from './state.js'
import type { SkipReason, Trigger } from './trigger.js'
import { findCommand, needsAuthorization, precheck } from './trigger.js'

export type FactoryApi = Pick<
  FactoryClient,
  'createSession' | 'getSession' | 'interrupt' | 'postMessage' | 'getComputer'
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

  let sessionId: string | undefined
  let previousSha: string | undefined
  if (tracking && inputs.reuseSession) {
    const existing = await factory.getSession(tracking.state.sid)
    if (existing?.computerId && existing.computerId !== inputs.computerId) {
      core.info(
        `Session ${existing.sessionId} runs on computer ${existing.computerId}, not ${inputs.computerId}; creating a new one`
      )
    } else if (existing) {
      sessionId = existing.sessionId
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
        tracking.state.sha !== t.pr?.headSha
      )
        previousSha = tracking.state.sha
    } else {
      core.info(
        `Session ${tracking.state.sid} no longer exists; creating a new one`
      )
    }
  }

  const reused = sessionId !== undefined
  if (!sessionId) {
    const cwd =
      inputs.cwd || (await resolveRepoDir(factory, inputs.computerId, t.repo))
    const session = await factory.createSession(
      sessionRequest(inputs, t, cwd, deps.runId)
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

  return { skipped: '', sessionId, sessionUrl: url, reused }
}

/**
 * Asks every session tracked on a closed issue or PR to remove its worktree,
 * so worktrees and local branches do not pile up on the computer. A session
 * that is reopened later recreates its worktree (common rule 6).
 */
async function cleanup(
  inputs: Inputs,
  t: Trigger,
  deps: Deps
): Promise<Outcome> {
  const { github, factory } = deps
  if (t.number === undefined) return { skipped: 'no-trigger' }
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

async function resolveRepoDir(
  factory: FactoryApi,
  computerId: string,
  repo: string
): Promise<string> {
  const computer = await factory.getComputer(computerId)
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
  runId: number
): CreateSessionRequest {
  const repo = `${t.owner}/${t.repo}`
  const key = t.number !== undefined ? String(t.number) : `run-${runId}`
  return {
    computerId: inputs.computerId,
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
      // The API ignores sessionSettings.worktree, so Droid creates its own
      // worktree as told in the rules.
      systemPrompt: {
        type: 'preset',
        preset: 'droid',
        append: systemRules(repo, inputs.triggerPhrase, {
          path: `${cwd.replace(/\/+$/, '')}.worktrees/${inputs.lane}-${key}`,
          branch: `factory/${inputs.lane}-${key}`
        })
      }
    }
  }
}
