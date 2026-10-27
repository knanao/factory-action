import { describe, expect, it } from 'bun:test'
import { cicdAttributes, startTrace, traceLogFields } from '../src/trace.js'

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const SPAN_ID = '00f067aa0ba902b7'
const PARENT = `00-${TRACE_ID}-${SPAN_ID}-01`

describe('startTrace', () => {
  it('joins the trace in TRACEPARENT', () => {
    expect(startTrace({ TRACEPARENT: PARENT })).toEqual({
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      inherited: true
    })
  })

  it('accepts uppercase values and a future version with extra fields', () => {
    expect(startTrace({ TRACEPARENT: PARENT.toUpperCase() }).traceId).toBe(
      TRACE_ID
    )
    expect(
      startTrace({
        TRACEPARENT: `cc-${TRACE_ID}-${SPAN_ID}-01-what-the-future-holds`
      })
    ).toEqual({ traceId: TRACE_ID, spanId: SPAN_ID, inherited: true })
  })

  for (const invalid of [
    '',
    'garbage',
    `ff-${TRACE_ID}-${SPAN_ID}-01`,
    `00-${TRACE_ID}-${SPAN_ID}-01-extra`,
    `00-${'0'.repeat(32)}-${SPAN_ID}-01`,
    `00-${TRACE_ID}-${'0'.repeat(16)}-01`,
    `00-${TRACE_ID.slice(1)}-${SPAN_ID}-01`
  ]) {
    it(`starts a new trace for an invalid TRACEPARENT: '${invalid}'`, () => {
      const ctx = startTrace({ TRACEPARENT: invalid })
      expect(ctx.inherited).toBe(false)
      expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/)
      expect(ctx.traceId).not.toBe(TRACE_ID)
      expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/)
    })
  }

  it('starts a different trace on every run', () => {
    expect(startTrace({}).traceId).not.toBe(startTrace({}).traceId)
  })
})
describe('traceLogFields', () => {
  it('uses the OpenTelemetry log field names', () => {
    expect(traceLogFields(startTrace({ TRACEPARENT: PARENT }))).toEqual({
      trace_id: TRACE_ID,
      span_id: SPAN_ID
    })
  })
})

describe('cicdAttributes', () => {
  it('maps the runner environment to CI/CD semantic conventions', () => {
    expect(
      cicdAttributes({
        GITHUB_SERVER_URL: 'https://github.com',
        GITHUB_REPOSITORY: 'acme/widgets',
        GITHUB_RUN_ID: '12345',
        GITHUB_RUN_ATTEMPT: '2',
        GITHUB_WORKFLOW: 'Factory',
        GITHUB_JOB: 'delegate',
        GITHUB_SHA: 'abc123'
      })
    ).toEqual({
      'cicd.pipeline.name': 'Factory',
      'cicd.pipeline.run.id': '12345',
      'cicd.pipeline.run.url.full':
        'https://github.com/acme/widgets/actions/runs/12345/attempts/2',
      'cicd.pipeline.task.name': 'delegate',
      'vcs.repository.url.full': 'https://github.com/acme/widgets',
      'vcs.ref.head.revision': 'abc123'
    })
  })

  it('leaves out what the environment does not provide', () => {
    expect(cicdAttributes({})).toEqual({
      'cicd.pipeline.name': undefined,
      'cicd.pipeline.run.id': undefined,
      'cicd.pipeline.run.url.full': undefined,
      'cicd.pipeline.task.name': undefined,
      'vcs.repository.url.full': undefined,
      'vcs.ref.head.revision': undefined
    })
  })
})
