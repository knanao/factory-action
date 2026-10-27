import { beforeEach, describe, expect, it, jest, mock } from 'bun:test'
import * as core from '../__fixtures__/core.js'
import { inputs, SELF, trackingComment } from '../__fixtures__/inputs.js'
import { OWNER, pullRequestEvent, REPO } from '../__fixtures__/payloads.js'
import type { Computer, FactoryClient } from '../src/factory.js'
import type { GitHubApi } from '../src/github.js'

mock.module('@actions/core', () => core)

const { cleanup } = await import('../src/cleanup.js')
const { computerName } = await import('../src/compute.js')
const { parseEvent } = await import('../src/trigger.js')

type Comment = ReturnType<typeof trackingComment>

const thread = {
  ...parseEvent('pull_request', pullRequestEvent('closed'), OWNER, REPO),
  number: 7
}
const envInputs = inputs({
  mode: 'cleanup',
  computerId: '',
  environmentId: 'env-1'
})

const computer = (id: string, templateId = 'env-1'): Computer => ({
  id,
  name: computerName(OWNER, REPO, '7', id),
  status: 'active',
  computerSource: { kind: 'template', templateId }
})

function fakes(comments: Comment[] = []) {
  const github = {
    selfLogin: jest.fn<GitHubApi['selfLogin']>().mockResolvedValue(SELF),
    listIssueComments: jest
      .fn<GitHubApi['listIssueComments']>()
      .mockResolvedValue(comments),
    updateIssueComment: jest
      .fn<GitHubApi['updateIssueComment']>()
      .mockResolvedValue()
  }
  const factory = {
    getSession: jest.fn<FactoryClient['getSession']>(),
    interrupt: jest.fn<FactoryClient['interrupt']>(),
    postMessage: jest.fn<FactoryClient['postMessage']>(),
    listComputers: jest
      .fn<FactoryClient['listComputers']>()
      .mockResolvedValue([]),
    findComputer: jest
      .fn<FactoryClient['findComputer']>()
      .mockResolvedValue(undefined),
    deleteComputer: jest
      .fn<FactoryClient['deleteComputer']>()
      .mockResolvedValue(true)
  }
  const deps = {
    github: github as unknown as GitHubApi,
    factory,
    runUrl: 'https://run'
  }
  /** The status written to each tracking comment, by comment id. */
  const statuses = () =>
    Object.fromEntries(
      github.updateIssueComment.mock.calls.map(([id, body]) => [
        id,
        /\| (Closed \([^)]*\)) \|/.exec(body)?.[1]
      ])
    )
  return { github, factory, deps, statuses }
}

const warnings = () => core.warning.mock.calls.map(([msg]) => String(msg))

describe('cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('logs that nothing was cleaned up without tracked sessions', async () => {
    const { factory, deps } = fakes()

    const out = await cleanup(inputs({ mode: 'cleanup' }), thread, deps)

    expect(out).toEqual({ sessionId: '' })
    expect(factory.getSession).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      'level=info event=cleanup.none number=7'
    )
  })

  it('logs that no Environment computer belongs to the thread', async () => {
    const { github, factory, deps } = fakes([
      trackingComment({ lane: 'task', sid: 'task-sid' })
    ])
    factory.listComputers.mockResolvedValue([
      { ...computer('other-thread'), name: 'fa-unrelated-1-task' },
      computer('other-env', 'env-2')
    ])

    const out = await cleanup(envInputs, thread, deps)

    expect(out).toEqual({ computerId: '' })
    expect(factory.findComputer).not.toHaveBeenCalled()
    expect(factory.deleteComputer).not.toHaveBeenCalled()
    expect(github.updateIssueComment).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith(
      'level=info event=cleanup.none number=7 environment_id=env-1'
    )
  })

  it('resolves tracked computers that are not listed', async () => {
    const { factory, deps, statuses } = fakes([
      trackingComment({ lane: 'task', sid: 's1', cid: 'found' }, 1),
      trackingComment({ lane: 'review', sid: 's2', cid: 'absent' }, 2),
      trackingComment({ lane: 'qa', sid: 's3', cid: 'foreign' }, 3),
      trackingComment({ lane: 'security', sid: 's4', cid: 'stale' }, 4),
      trackingComment({ lane: 'wiki', sid: 's5' }, 5)
    ])
    factory.listComputers.mockResolvedValue([computer('stale')])
    factory.findComputer.mockImplementation(async (id) => {
      if (id === 'found') return computer('found')
      if (id === 'foreign') return computer('foreign', 'env-2')
      return undefined
    })
    factory.deleteComputer.mockImplementation(async (id) => id !== 'stale')

    const out = await cleanup(envInputs, thread, deps)

    expect(out).toEqual({ computerId: 'found' })
    expect(factory.findComputer.mock.calls.map(([id]) => id)).toEqual([
      'found',
      'absent',
      'foreign'
    ])
    expect(factory.deleteComputer.mock.calls.map(([id]) => id)).toEqual([
      'stale',
      'found'
    ])
    expect(statuses()).toEqual({
      1: 'Closed (computer deleted)',
      2: 'Closed (computer already absent)',
      3: 'Closed (computer not managed)',
      4: 'Closed (computer already absent)'
    })
  })

  it('fails after recording computers it could not delete', async () => {
    const { factory, deps, statuses } = fakes([
      trackingComment({ lane: 'task', sid: 's1', cid: 'broken' }, 1),
      trackingComment({ lane: 'review', sid: 's2', cid: 'fine' }, 2)
    ])
    factory.listComputers.mockResolvedValue([
      computer('broken'),
      computer('fine')
    ])
    factory.deleteComputer.mockImplementation(async (id) => {
      if (id === 'broken') throw new Error('500')
      return true
    })

    await expect(cleanup(envInputs, thread, deps)).rejects.toThrow(
      'Could not delete Environment computers: broken'
    )
    expect(statuses()).toEqual({
      1: 'Closed (computer deletion failed)',
      2: 'Closed (computer deleted)'
    })
    expect(warnings()).toContain(
      'level=warning event=cleanup.computer_delete_failed computer_id=broken error="Error: 500"'
    )
  })

  it('still cleans up when a tracking comment cannot be updated', async () => {
    const { github, factory, deps } = fakes([
      trackingComment({ lane: 'task', sid: 's1', cid: 'env-comp' })
    ])
    factory.listComputers.mockResolvedValue([computer('env-comp')])
    github.updateIssueComment.mockRejectedValue(new Error('403'))

    const out = await cleanup(envInputs, thread, deps)

    expect(out).toEqual({ computerId: 'env-comp' })
    expect(warnings()).toContain(
      'level=warning event=tracking.update_failed session_id=s1 error="Error: 403"'
    )
  })
})
