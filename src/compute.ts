import { createHash } from 'node:crypto'
import type { Computer, FactoryClient } from './factory.js'
import { FactoryApiError } from './factory.js'
import { log } from './logger.js'

/**
 * Environment mode gives every (issue/PR, lane) its own computer, created from
 * the Environment and found again by a deterministic name. The name is the
 * only link that survives a cancelled job, so it must not depend on anything
 * but the repository, the thread key and the lane.
 *
 * Factory accepts names that start with a lowercase letter, contain only
 * lowercase letters, digits and hyphens, do not end with a hyphen and are at
 * most 63 characters long.
 */

const MAX_NAME = 63
const REPO_CHARS = 20

export type ComputeApi = Pick<
  FactoryClient,
  'getComputerByName' | 'createComputer' | 'getComputer' | 'deleteComputer'
>

/** Prefix shared by every computer the action creates for one repository. */
export function repoPrefix(owner: string, repo: string): string {
  const name = slug(repo).slice(0, REPO_CHARS).replace(/-+$/, '') || 'repo'
  return `fa-${name}-${shortHash(`${owner}/${repo}`.toLowerCase())}-`
}

/** Prefix of the computers that belong to one issue or PR. */
export function threadPrefix(
  owner: string,
  repo: string,
  number: number
): string {
  return `${repoPrefix(owner, repo)}${number}-`
}

/**
 * `fa-<repo>-<hash>-<key>-<lane>-<lane hash>`. The hash keeps distinct lane
 * names separate even when normalization or truncation produces the same slug.
 */
export function computerName(
  owner: string,
  repo: string,
  key: string,
  lane: string
): string {
  const prefix = `${repoPrefix(owner, repo)}${key}-`
  let laneSlug = slug(lane)
  const suffix = `-${shortHash(lane)}`
  const room = MAX_NAME - prefix.length - suffix.length
  if (room < 1) {
    throw new Error(`Cannot build a computer name for key '${key}'`)
  }
  if (laneSlug.length > room) {
    laneSlug = laneSlug.slice(0, room).replace(/-+$/, '')
  }
  return `${prefix}${laneSlug || 'l'}${suffix}`
}

export function isFromEnvironment(c: Computer, environmentId: string): boolean {
  return (
    c.computerSource?.kind === 'template' &&
    c.computerSource.templateId === environmentId
  )
}

export interface EnsureOptions {
  name: string
  environmentId: string
  timeoutMs: number
  pollMs?: number
}

/**
 * Returns the named computer once it is active, creating it from the
 * Environment when it does not exist. A computer that is still provisioning
 * (for example after a cancelled run) is waited for, not recreated.
 */
export async function ensureComputer(
  api: ComputeApi,
  opts: EnsureOptions
): Promise<Computer> {
  let computer = await api.getComputerByName(opts.name)
  if (computer) {
    log.info('computer.found', { computer_id: computer.id, name: opts.name })
  } else {
    try {
      computer = await api.createComputer({
        name: opts.name,
        source: {
          kind: 'environment',
          environmentId: opts.environmentId,
          isListed: false
        }
      })
      log.info('computer.created', {
        computer_id: computer.id,
        name: opts.name
      })
    } catch (err) {
      if (!(err instanceof FactoryApiError && err.status === 409)) throw err
      // Another run created it between the lookup and the create.
      computer = await api.getComputerByName(opts.name)
      if (!computer) throw err
    }
  }
  if (!isFromEnvironment(computer, opts.environmentId)) {
    throw new Error(
      `Computer ${opts.name} (${computer.id}) was not created from Environment ${opts.environmentId}. Delete it, or close the issue/PR so the cleanup mode removes it.`
    )
  }
  return waitActive(api, computer, opts)
}

async function waitActive(
  api: ComputeApi,
  computer: Computer,
  opts: EnsureOptions
): Promise<Computer> {
  const deadline = Date.now() + opts.timeoutMs
  let c = computer
  for (;;) {
    if (c.status === 'active') return c
    if (c.status === 'error') {
      // Deleting it lets the next run start over with a fresh computer.
      await api.deleteComputer(c.id)
      throw new Error(
        `Computer ${c.name} (${c.id}) failed to provision and was deleted. Check the Environment build, then retry.`
      )
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Computer ${c.name} (${c.id}) is still ${c.status ?? 'provisioning'} after ${Math.round(opts.timeoutMs / 1000)} s. The next run waits for it again.`
      )
    }
    await sleep(opts.pollMs ?? 2000)
    c = await api.getComputer(c.id)
  }
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 6)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
