import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
  mock
} from 'bun:test'
import * as core from '../__fixtures__/core.js'
import { issueComment } from '../__fixtures__/payloads.js'

mock.module('@actions/core', () => core)

const { context } = await import('@actions/github')
const delegation = await import('../src/delegate.js')
const { getInputs } = await import('../src/inputs.js')
const { run } = await import('../src/main.js')
const { setLogContext } = await import('../src/logger.js')

const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736'
const TRACEPARENT = `00-${TRACE_ID}-00f067aa0ba902b7-01`

describe('run job summary', () => {
  const originalEventName = context.eventName
  const originalPayload = context.payload
  const originalTraceparent = process.env.TRACEPARENT
  let delegate: ReturnType<typeof jest.spyOn<typeof delegation, 'delegate'>>

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.TRACEPARENT = TRACEPARENT
    context.eventName = 'issue_comment'
    context.payload = {
      ...issueComment('test'),
      repository: { owner: { login: 'acme', name: 'acme' }, name: 'widgets' }
    }
    core.getInput.mockImplementation((name) => {
      const values: Record<string, string> = {
        'factory-api-key': 'fk-test',
        'computer-id': 'comp-1',
        'github-token': 'gh-test'
      }
      return values[name] ?? ''
    })
    delegate = jest.spyOn(delegation, 'delegate')
  })

  afterEach(() => {
    delegate.mockRestore()
    setLogContext()
    if (originalTraceparent === undefined) delete process.env.TRACEPARENT
    else process.env.TRACEPARENT = originalTraceparent
    context.eventName = originalEventName
    context.payload = originalPayload
  })

  it('links a delegated session when its URL is available', async () => {
    delegate.mockResolvedValue({
      skipped: '',
      sessionId: 'task-sid',
      sessionUrl: 'https://app.factory.ai/sessions/task-sid',
      computerId: 'comp-1',
      reused: false
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.summary.addTable.mock.calls[0][0][1]).toEqual([
      'task',
      '<a href="https://app.factory.ai/sessions/task-sid">task-sid</a>',
      'comp-1',
      'false',
      TRACE_ID
    ])
    expect(core.setOutput).toHaveBeenCalledWith('computer-id', 'comp-1')
    expect(core.setOutput).toHaveBeenCalledWith('trace-id', TRACE_ID)
    expect(core.summary.write).toHaveBeenCalledTimes(1)
  })

  it('requires exactly one computer source and supports provisioning timeout', () => {
    const getInput = core.getInput.getMockImplementation()!
    core.getInput.mockImplementation((name, options) =>
      name === 'computer-id' || name === 'environment-id'
        ? ''
        : getInput(name, options)
    )
    expect(() => getInputs()).toThrow(
      "Set exactly one of the inputs 'computer-id' and 'environment-id'"
    )

    core.getInput.mockImplementation((name, options) =>
      name === 'computer-id'
        ? 'comp-1'
        : name === 'environment-id'
          ? 'env-1'
          : getInput(name, options)
    )
    expect(() => getInputs()).toThrow(
      "Set exactly one of the inputs 'computer-id' and 'environment-id'"
    )

    core.getInput.mockImplementation((name, options) => {
      if (name === 'computer-id') return ''
      if (name === 'environment-id') return 'env-1'
      if (name === 'provision-timeout-sec') return '90'
      return getInput(name, options)
    })
    expect(getInputs()).toMatchObject({
      environmentId: 'env-1',
      provisionTimeoutMs: 90_000
    })
  })

  for (const sessionId of ['task-sid', 'task-sid,review-sid']) {
    it(`renders cleanup session IDs without a broken link: ${sessionId}`, async () => {
      const getInput = core.getInput.getMockImplementation()!
      core.getInput.mockImplementation((name, options) =>
        name === 'mode' ? 'cleanup' : getInput(name, options)
      )
      delegate.mockResolvedValue({ skipped: '', sessionId, reused: true })

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.summary.addTable.mock.calls[0][0][1]).toEqual([
        'cleanup',
        sessionId,
        '',
        'true',
        TRACE_ID
      ])
      expect(core.summary.write).toHaveBeenCalledTimes(1)
      expect(core.setOutput).toHaveBeenCalledWith('session-id', sessionId)
      expect(core.setOutput).toHaveBeenCalledWith('session-url', '')
      expect(core.setOutput).toHaveBeenCalledWith('reused', 'true')
    })
  }

  it('summarizes Environment computers deleted during cleanup', async () => {
    const getInput = core.getInput.getMockImplementation()!
    core.getInput.mockImplementation((name, options) =>
      name === 'mode' ? 'cleanup' : getInput(name, options)
    )
    delegate.mockResolvedValue({
      skipped: '',
      computerId: 'comp-1,comp-2',
      reused: true
    })

    await run()

    expect(core.setFailed).not.toHaveBeenCalled()
    expect(core.setOutput).toHaveBeenCalledWith('computer-id', 'comp-1,comp-2')
    expect(core.summary.addTable.mock.calls[0][0][1]).toEqual([
      'cleanup',
      '',
      'comp-1,comp-2',
      'true',
      TRACE_ID
    ])
    expect(core.summary.write).toHaveBeenCalledTimes(1)
  })

  it('tags every log record with the inherited trace', async () => {
    delegate.mockResolvedValue({ skipped: 'no-trigger' })

    await run()

    const started = core.info.mock.calls
      .map(([line]) => line)
      .find((line) => line.includes('event=run.started'))
    expect(started).toContain('trace_inherited=true')
    expect(started).toContain(`trace_id=${TRACE_ID}`)
    expect(started).toContain('span_id=00f067aa0ba902b7')
  })

  it('reports a failed run with its trace ID', async () => {
    core.getInput.mockImplementation(() => '')
    core.getInput.mockImplementationOnce(() => {
      throw new Error('Input required and not supplied: factory-api-key')
    })

    await run()

    expect(core.setOutput).toHaveBeenCalledWith('trace-id', TRACE_ID)
    expect(core.setFailed).toHaveBeenCalledWith(
      'Input required and not supplied: factory-api-key'
    )
    const [line] = core.error.mock.calls[0]
    expect(line).toContain('event=run.failed')
    expect(line).toContain(`trace_id=${TRACE_ID}`)
    expect(delegate).not.toHaveBeenCalled()
  })

  for (const outcome of [
    { skipped: '' as const, sessionId: '', reused: true },
    { skipped: 'no-trigger' as const }
  ]) {
    it(`omits the summary without a session: ${JSON.stringify(outcome)}`, async () => {
      delegate.mockResolvedValue(outcome)

      await run()

      expect(core.setFailed).not.toHaveBeenCalled()
      expect(core.summary.addHeading).not.toHaveBeenCalled()
      expect(core.summary.addTable).not.toHaveBeenCalled()
      expect(core.summary.write).not.toHaveBeenCalled()
    })
  }
})
