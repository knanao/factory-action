import * as core from '@actions/core'

const MODES = [
  'mention',
  'review',
  'security',
  'deep-security',
  'qa',
  'wiki',
  'custom',
  'cleanup'
] as const
export type Mode = (typeof MODES)[number]

const AUTONOMY_LEVELS = ['off', 'low', 'medium', 'high'] as const
type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number]

/** Skills and plugin commands that `@factory <name>` runs as `/<name>`. */
const DEFAULT_COMMANDS =
  'security-review,deep-security-review,qa,wiki,verify,qa-test,demo'

export interface Inputs {
  factoryApiKey: string
  /** Exactly one of computerId and environmentId is set. */
  computerId: string
  environmentId: string
  provisionTimeoutMs: number
  mode: Mode
  prompt: string
  lane: string
  triggerPhrase: string
  allowedAssociations: string[]
  permissionFallback: boolean
  allowedBots: string[]
  commands: string[]
  cwd: string
  model: string
  reasoningEffort: string
  autonomyLevel: AutonomyLevel
  reuseSession: boolean
  maxComments: number
  messageTimeoutMs: number
  githubToken: string
  factoryApiUrl: string
}

/** Reads and validates the action inputs. Throws on invalid configuration. */
export function getInputs(): Inputs {
  const factoryApiKey = core.getInput('factory-api-key', { required: true })
  core.setSecret(factoryApiKey)

  const mode = oneOf('mode', MODES, core.getInput('mode') || 'mention')
  const prompt = core.getInput('prompt')
  if (mode === 'custom' && !prompt) {
    throw new Error("Input 'prompt' is required when mode is 'custom'")
  }

  const autonomyLevel = oneOf(
    'autonomy-level',
    AUTONOMY_LEVELS,
    core.getInput('autonomy-level') || 'high'
  )
  if (autonomyLevel !== 'high') {
    // Below high, a high-risk command waits for an approval that never comes,
    // and the session stays running (raising it later with PATCH doesn't help).
    core.warning(
      `autonomy-level '${autonomyLevel}': unattended sessions hang when Droid needs approval for a high-risk command (e.g. git push)`
    )
  }

  const computerId = core.getInput('computer-id')
  const environmentId = core.getInput('environment-id')
  if (Boolean(computerId) === Boolean(environmentId)) {
    throw new Error(
      "Set exactly one of the inputs 'computer-id' and 'environment-id'"
    )
  }

  return {
    factoryApiKey,
    computerId,
    environmentId,
    provisionTimeoutMs: int('provision-timeout-sec', 300) * 1000,
    mode,
    prompt,
    lane: core.getInput('lane') || defaultLane(mode),
    triggerPhrase: core.getInput('trigger-phrase') || '@factory',
    allowedAssociations: list(
      core.getInput('allowed-associations') || 'OWNER,MEMBER,COLLABORATOR'
    ).map((a) => a.toUpperCase()),
    permissionFallback: bool('permission-fallback', true),
    allowedBots: list(core.getInput('allowed-bots')).map((b) =>
      b.toLowerCase()
    ),
    commands: list(core.getInput('commands') || DEFAULT_COMMANDS).map((c) =>
      c.replace(/^\//, '').toLowerCase()
    ),
    cwd: core.getInput('cwd'),
    model: core.getInput('model'),
    reasoningEffort: core.getInput('reasoning-effort'),
    autonomyLevel,
    reuseSession: bool('reuse-session', true),
    maxComments: int('max-comments', 30),
    messageTimeoutMs: int('message-timeout-ms', 15000),
    githubToken: core.getInput('github-token', { required: true }),
    factoryApiUrl: (
      core.getInput('factory-api-url') || 'https://api.factory.ai'
    ).replace(/\/+$/, '')
  }
}

function defaultLane(mode: Mode): string {
  return mode === 'mention' ? 'task' : mode
}

function list(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((v) => v.trim())
    .filter(Boolean)
}

function bool(name: string, fallback: boolean): boolean {
  const value = core.getInput(name)
  if (!value) return fallback
  return core.getBooleanInput(name)
}

function int(name: string, fallback: number): number {
  const value = core.getInput(name)
  if (!value) return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      `Input '${name}' must be a positive integer, got '${value}'`
    )
  }
  return n
}

function oneOf<T extends string>(
  name: string,
  allowed: readonly T[],
  value: string
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(
      `Input '${name}' must be one of ${allowed.join(', ')}, got '${value}'`
    )
  }
  return value as T
}
