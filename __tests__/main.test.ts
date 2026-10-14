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

describe('run job summary', () => {
  const originalEventName = context.eventName
  const originalPayload = context.payload
  let delegate: ReturnType<typeof jest.spyOn<typeof delegation, 'delegate'>>

  beforeEach(() => {
    jest.clearAllMocks()
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
      'false'
    ])
    expect(core.setOutput).toHaveBeenCalledWith('computer-id', 'comp-1')
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
        'true'
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
      'true'
    ])
    expect(core.summary.write).toHaveBeenCalledTimes(1)
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
