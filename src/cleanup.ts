import * as core from '@actions/core'
import { isFromEnvironment, threadPrefix } from './compute.js'
import type { Computer, FactoryClient } from './factory.js'
import { sessionUrl } from './factory.js'
import type { GitHubApi } from './github.js'
import type { Inputs } from './inputs.js'
import { cleanupPrompt } from './prompts/index.js'
import type { TrackingComment } from './state.js'
import { findAllTracking, renderTracking } from './state.js'
import type { Trigger } from './trigger.js'

interface CleanupDeps {
  github: GitHubApi
  factory: Pick<
    FactoryClient,
    | 'getSession'
    | 'interrupt'
    | 'postMessage'
    | 'listComputers'
    | 'findComputer'
    | 'deleteComputer'
  >
  runUrl: string
}

/** A closed issue or PR. */
type Thread = Trigger & { number: number }

/** The sessions asked to clean up, or in Environment mode the computers deleted. */
interface Cleaned {
  sessionId?: string
  computerId?: string
}

/** Environment computers of one thread, and tracked ones that are not. */
interface CleanupPlan {
  targets: Map<string, Computer>
  unmanaged: Set<string>
  alreadyAbsent: Set<string>
}

interface Deletion {
  deleted: Set<string>
  failures: string[]
}

/** Performs mode-specific cleanup for a closed issue or PR. */
export async function cleanup(
  inputs: Inputs,
  t: Thread,
  deps: CleanupDeps
): Promise<Cleaned> {
  if (inputs.environmentId) return cleanupEnvironment(inputs, t, deps)
  const { github, factory } = deps
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
    await closeTracking(deps, tracking, 'Closed (cleanup requested)')
  }
  if (sessions.length === 0) core.info('No sessions to clean up')
  return { sessionId: sessions.join(',') }
}

async function cleanupEnvironment(
  inputs: Inputs,
  t: Thread,
  deps: CleanupDeps
): Promise<Cleaned> {
  const { github, factory } = deps
  const [comments, self, computers] = await Promise.all([
    github.listIssueComments(t.number),
    github.selfLogin(),
    factory.listComputers()
  ])
  const trackings = findAllTracking(comments, self)
  const prefix = threadPrefix(t.owner, t.repo, t.number)
  const owned = (computer: Computer): boolean =>
    computer.name.startsWith(prefix) &&
    isFromEnvironment(computer, inputs.environmentId)
  const plan = await planCleanup(factory, trackings, computers, owned)
  const deletion = await deleteTargets(factory, plan)

  for (const tracking of trackings) {
    const cid = tracking.state.cid
    if (!cid) continue
    await closeTracking(deps, tracking, cleanupStatus(cid, plan, deletion))
  }

  if (plan.targets.size === 0) core.info('No Environment computers to delete')
  if (deletion.failures.length > 0) {
    throw new Error(
      `Could not delete Environment computers: ${deletion.failures.join(', ')}`
    )
  }
  return { computerId: [...deletion.deleted].join(',') }
}

async function planCleanup(
  factory: CleanupDeps['factory'],
  trackings: TrackingComment[],
  computers: Computer[],
  owned: (computer: Computer) => boolean
): Promise<CleanupPlan> {
  const targets = new Map(
    computers.filter(owned).map((computer) => [computer.id, computer])
  )
  const unmanaged = new Set<string>()
  const alreadyAbsent = new Set<string>()
  for (const { state } of trackings) {
    if (!state.cid || targets.has(state.cid)) continue
    const computer = await factory.findComputer(state.cid)
    if (computer && owned(computer)) {
      targets.set(computer.id, computer)
    } else if (!computer) {
      alreadyAbsent.add(state.cid)
    } else {
      unmanaged.add(state.cid)
    }
  }
  return { targets, unmanaged, alreadyAbsent }
}

async function deleteTargets(
  factory: CleanupDeps['factory'],
  plan: CleanupPlan
): Promise<Deletion> {
  const deleted = new Set<string>()
  const failures: string[] = []
  for (const computerId of plan.targets.keys()) {
    try {
      if (await factory.deleteComputer(computerId)) deleted.add(computerId)
      else plan.alreadyAbsent.add(computerId)
    } catch (err) {
      failures.push(computerId)
      core.warning(`Could not delete computer ${computerId}: ${err}`)
    }
  }
  return { deleted, failures }
}

function cleanupStatus(
  cid: string,
  plan: CleanupPlan,
  deletion: Deletion
): string {
  if (deletion.failures.includes(cid)) {
    return 'Closed (computer deletion failed)'
  }
  if (plan.unmanaged.has(cid)) return 'Closed (computer not managed)'
  if (
    plan.alreadyAbsent.has(cid) ||
    (!deletion.deleted.has(cid) && !plan.targets.has(cid))
  ) {
    return 'Closed (computer already absent)'
  }
  return 'Closed (computer deleted)'
}

async function closeTracking(
  deps: CleanupDeps,
  tracking: TrackingComment,
  status: string
): Promise<void> {
  const body = renderTracking(tracking.state, {
    sessionUrl: sessionUrl(tracking.state.sid),
    reused: true,
    runUrl: deps.runUrl,
    status
  })
  await deps.github
    .updateIssueComment(tracking.id, body)
    .catch((err) =>
      core.warning(`Could not update the tracking comment: ${err}`)
    )
}
