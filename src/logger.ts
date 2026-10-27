import * as core from '@actions/core'

/**
 * Structured logging for the action's run log. Every record is a single
 * logfmt-style line (`level=... event=... key=value`) so records stay readable
 * in the Actions UI while remaining machine-parseable when the run log is
 * exported (Loki logfmt, Vector, grep).
 *
 * Levels route to the matching `@actions/core` function, so annotations,
 * step-debug masking, and the runner's own timestamps keep working.
 */

export type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error'

/** Structured context attached to a record; keys use snake_case. */
export type LogFields = Record<string, unknown>

const SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  notice: 30,
  warning: 40,
  error: 50
}

const LEVEL_ENV = 'FACTORY_ACTION_LOG_LEVEL'

let levelOverride: LogLevel | undefined
let context: LogFields = {}

/** Sets the minimum emitted level, overriding the environment (test hook). */
export function setLogLevel(level: LogLevel): void {
  levelOverride = level
}

/** Clears an explicit override; the level falls back to the environment. */
export function resetLogLevel(): void {
  levelOverride = undefined
}

/**
 * Sets fields appended to every record, such as the run's `trace_id` and
 * `span_id`. Replaces any earlier context; call with no argument to clear it.
 */
export function setLogContext(fields: LogFields = {}): void {
  context = { ...fields }
}

/** The minimum level currently emitted. */
export function minLogLevel(): LogLevel {
  if (levelOverride) return levelOverride
  const fromEnv = parseLevel(process.env[LEVEL_ENV])
  if (fromEnv) return fromEnv
  // GitHub's convention for turning on step debug output.
  if (process.env.ACTIONS_STEP_DEBUG) return 'debug'
  return 'info'
}

function parseLevel(value: string | undefined): LogLevel | undefined {
  const level = (value ?? '').trim().toLowerCase()
  return (Object.keys(SEVERITY) as LogLevel[]).includes(level as LogLevel)
    ? (level as LogLevel)
    : undefined
}

/** Renders one record as a logfmt line. */
export function renderRecord(
  level: LogLevel,
  event: string,
  fields: LogFields = {}
): string {
  const pairs = [`level=${level}`, `event=${token(event)}`]
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue
    pairs.push(`${token(key)}=${formatValue(value)}`)
  }
  return pairs.join(' ')
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  if (SEVERITY[level] < SEVERITY[minLogLevel()]) return
  const line = renderRecord(level, event, { ...fields, ...context })
  if (level === 'debug') core.debug(line)
  else if (level === 'notice') core.notice(line)
  else if (level === 'warning') core.warning(line)
  else if (level === 'error') core.error(line)
  else core.info(line)
}

/**
 * The action's logger. Events use an `area.what` naming scheme, e.g.
 * `session.created`, `authz.denied`, `tracking.write_failed`.
 */
export const log = {
  debug(event: string, fields?: LogFields): void {
    emit('debug', event, fields)
  },
  info(event: string, fields?: LogFields): void {
    emit('info', event, fields)
  },
  notice(event: string, fields?: LogFields): void {
    emit('notice', event, fields)
  },
  warning(event: string, fields?: LogFields): void {
    emit('warning', event, fields)
  },
  error(event: string, fields?: LogFields): void {
    emit('error', event, fields)
  }
}

/** Keeps a logfmt key or event name to `[A-Za-z0-9_.-]`. */
function token(key: string): string {
  return key.replace(/[^A-Za-z0-9_.-]/g, '_')
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return quote(`${value.name}: ${value.message}`)
  if (typeof value === 'string') return quote(value)
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return quote(json(value))
}

/** Compact JSON for structured values; never throws (circular refs, ...). */
function json(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Quotes a value when logfmt requires it, escaping the characters inside. */
function quote(value: string): string {
  if (!/[\s="]/.test(value) && value !== '') return value
  return `"${value
    .replace(/(["\\])/g, '\\$1')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')}"`
}
