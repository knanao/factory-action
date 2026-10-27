import { randomBytes } from 'node:crypto'
import type { LogFields } from './logger.js'

/**
 * W3C Trace Context (https://www.w3.org/TR/trace-context/) IDs for one action
 * run, following OpenTelemetry's environment-variable carrier: a workflow that
 * already traces the job passes `TRACEPARENT` to the step, and the run's log
 * records join that trace. Without it the run starts a new trace so that its
 * records still share one `trace_id`.
 *
 * The context stays inside the run: it is never sent to the Factory or GitHub
 * API, and no spans are recorded or exported.
 */
export interface TraceContext {
  traceId: string
  spanId: string
  inherited: boolean
}

type Env = Record<string, string | undefined>

const TRACEPARENT =
  /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/

/** Joins the trace in `TRACEPARENT`, or starts a new one. */
export function startTrace(env: Env = process.env): TraceContext {
  const parent = parseTraceparent(env.TRACEPARENT)
  if (parent) return { ...parent, inherited: true }
  return { traceId: randomHex(16), spanId: randomHex(8), inherited: false }
}

function parseTraceparent(
  value: string | undefined
): Pick<TraceContext, 'traceId' | 'spanId'> | undefined {
  const m = TRACEPARENT.exec(value?.trim().toLowerCase() ?? '')
  if (!m) return undefined
  const [, version, traceId, spanId, , rest] = m
  // Version ff is invalid, and version 00 has exactly four fields.
  if (version === 'ff' || (version === '00' && rest !== undefined)) {
    return undefined
  }
  if (/^0+$/.test(traceId) || /^0+$/.test(spanId)) return undefined
  return { traceId, spanId }
}

/** Fields that tie every log record to the trace. */
export function traceLogFields(ctx: TraceContext): LogFields {
  return { trace_id: ctx.traceId, span_id: ctx.spanId }
}
/**
 * OpenTelemetry CI/CD and VCS semantic-convention attributes for the run,
 * read from the runner's default environment variables.
 */
export function cicdAttributes(env: Env = process.env): LogFields {
  const server = env.GITHUB_SERVER_URL
  const repo = env.GITHUB_REPOSITORY
  const runId = env.GITHUB_RUN_ID
  const repoUrl = server && repo ? `${server}/${repo}` : undefined
  return {
    'cicd.pipeline.name': env.GITHUB_WORKFLOW,
    'cicd.pipeline.run.id': runId,
    'cicd.pipeline.run.url.full':
      repoUrl && runId
        ? `${repoUrl}/actions/runs/${runId}/attempts/${env.GITHUB_RUN_ATTEMPT ?? '1'}`
        : undefined,
    'cicd.pipeline.task.name': env.GITHUB_JOB,
    'vcs.repository.url.full': repoUrl,
    'vcs.ref.head.revision': env.GITHUB_SHA
  }
}

function randomHex(bytes: number): string {
  for (;;) {
    const hex = randomBytes(bytes).toString('hex')
    if (!/^0+$/.test(hex)) return hex
  }
}
