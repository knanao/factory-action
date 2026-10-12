import { describe, expect, it, jest, mock } from 'bun:test'
import * as core from '../__fixtures__/core.js'
import {
  issueComment,
  OWNER,
  pullRequestEvent,
  REPO
} from '../__fixtures__/payloads.js'
import type { GitHubApi } from '../src/github.js'
import type { Inputs } from '../src/inputs.js'
import { renderTracking } from '../src/state.js'

mock.module('@actions/core', () => core)

const { delegate } = await import('../src/delegate.js')
const { parseEvent } = await import('../src/trigger.js')
type FactoryApi = import('../src/delegate.js').FactoryApi

const SELF = 'github-actions[bot]'

function inputs(overrides: Partial<Inputs> = {}): Inputs {
  return {
    factoryApiKey: 'fk',
    computerId: 'comp-1',
    mode: 'mention',
    prompt: '',
    lane: 'task',
    triggerPhrase: '@factory',
    allowedAssociations: ['OWNER', 'MEMBER', 'COLLABORATOR'],
    permissionFallback: true,
    allowedBots: [],
    commands: ['verify', 'security-review'],
    cwd: '',
    model: '',
    reasoningEffort: '',
    autonomyLevel: 'high',
    reuseSession: true,
    maxComments: 30,
    messageTimeoutMs: 1000,
    githubToken: 'ghs',
    factoryApiUrl: 'https://api.test',
    ...overrides
  }
}

function fakes(
  comments: { id: number; body: string; user: { login: string } }[] = []
) {
  const github = {
    getPermission: jest
      .fn<GitHubApi['getPermission']>()
      .mockResolvedValue('read'),
    selfLogin: jest.fn<GitHubApi['selfLogin']>().mockResolvedValue(SELF),
    listIssueComments: jest
      .fn<GitHubApi['listIssueComments']>()
      .mockResolvedValue(comments),
    createIssueComment: jest
      .fn<GitHubApi['createIssueComment']>()
      .mockResolvedValue(99),
    updateIssueComment: jest
      .fn<GitHubApi['updateIssueComment']>()
      .mockResolvedValue(),
    addEyes: jest.fn<GitHubApi['addEyes']>().mockResolvedValue()
  }
  const factory = {
    createSession: jest
      .fn<FactoryApi['createSession']>()
      .mockResolvedValue({ sessionId: 'new-sid', status: 'idle' }),
    getSession: jest.fn<FactoryApi['getSession']>(),
    interrupt: jest.fn<FactoryApi['interrupt']>().mockResolvedValue(),
    postMessage: jest.fn<FactoryApi['postMessage']>().mockResolvedValue({
      messageId: 'm',
      status: 'running',
      timedOut: false
    }),
    getComputer: jest.fn<FactoryApi['getComputer']>().mockResolvedValue({
      id: 'comp-1',
      name: 'c',
      clonedRepoDirectories: ['/home/factory-user/projects/widgets']
    })
  }
  return {
    github,
    factory,
    deps: { github, factory, runUrl: 'https://run', runId: 5 }
  }
}

const tracking = (lane: string, sid: string, sha?: string) => ({
  id: 77,
  body: renderTracking(
    { v: 1, lane, sid, sha },
    { sessionUrl: 'u', reused: false, runUrl: 'r' }
  ),
  user: { login: SELF }
})

describe('delegate', () => {
  it('creates a session for a new mention and records it', async () => {
    const { github, factory, deps } = fakes()
    const t = parseEvent(
      'issue_comment',
      issueComment('@factory fix the button'),
      OWNER,
      REPO
    )

    const out = await delegate(inputs(), t, deps)

    expect(out).toMatchObject({
      skipped: '',
      sessionId: 'new-sid',
      reused: false
    })
    const req = factory.createSession.mock.calls[0][0]
    expect(req).toMatchObject({
      computerId: 'comp-1',
      cwd: '/home/factory-user/projects/widgets',
      sessionSettings: {
        autonomyLevel: 'high',
        tags: [
          {
            name: 'factory-action',
            metadata: { repo: 'acme/widgets', number: '42', lane: 'task' }
          }
        ]
      }
    })
    const rules = (
      req.sessionSettings?.systemPrompt as { append: string } | undefined
    )?.append
    expect(rules).toContain(
      'git worktree add -B factory/task-42 /home/factory-user/projects/widgets.worktrees/task-42 origin/HEAD'
    )
    expect(factory.postMessage.mock.calls[0][1]).toContain('fix the button')
    expect(github.addEyes).toHaveBeenCalledWith({
      kind: 'issue-comment',
      id: 1001
    })
    expect(github.createIssueComment.mock.calls[0][1]).toContain(
      '"sid":"new-sid"'
    )
  })

  it('runs a command named without a slash', async () => {
    const { factory, deps } = fakes()
    const t = parseEvent(
      'issue_comment',
      issueComment('@factory verify saving keeps the form'),
      OWNER,
      REPO
    )

    await delegate(inputs(), t, deps)

    expect(factory.postMessage.mock.calls[0][1]).toContain('run /verify,')
  })

  it('starts a new deep-security session per scheduled run', async () => {
    const { github, factory, deps } = fakes()
    const t = parseEvent('schedule', {}, OWNER, REPO)

    const out = await delegate(
      inputs({ mode: 'deep-security', lane: 'deep-security' }),
      t,
      deps
    )

    expect(out).toMatchObject({ skipped: '', sessionId: 'new-sid' })
    expect(
      factory.createSession.mock.calls[0][0].sessionSettings?.tags
    ).toEqual([
      {
        name: 'factory-action',
        metadata: {
          repo: 'acme/widgets',
          number: 'run-5',
          lane: 'deep-security'
        }
      }
    ])
    expect(factory.postMessage.mock.calls[0][1]).toContain(
      '/deep-security-review'
    )
    expect(github.listIssueComments).not.toHaveBeenCalled()
    expect(github.createIssueComment).not.toHaveBeenCalled()
  })

  it('creates a new session when the stored one is on another computer', async () => {
    const { factory, deps } = fakes([tracking('task', 'old-sid')])
    factory.getSession.mockResolvedValue({
      sessionId: 'old-sid',
      status: 'idle',
      computerId: 'comp-old'
    })
    const t = parseEvent(
      'issue_comment',
      issueComment('@factory again'),
      OWNER,
      REPO
    )

    const out = await delegate(inputs(), t, deps)

    expect(out).toMatchObject({ sessionId: 'new-sid', reused: false })
    expect(factory.createSession).toHaveBeenCalled()
  })

  it('asks every tracked session to clean up when the thread closes', async () => {
    const { github, factory, deps } = fakes([
      tracking('task', 'task-sid'),
      tracking('review', 'review-sid'),
      tracking('security', 'gone-sid')
    ])
    factory.getSession.mockImplementation(async (sid) =>
      sid === 'gone-sid'
        ? undefined
        : { sessionId: sid, status: sid === 'review-sid' ? 'running' : 'idle' }
    )
    const t = parseEvent(
      'pull_request',
      pullRequestEvent('closed'),
      OWNER,
      REPO
    )

    const out = await delegate(inputs({ mode: 'cleanup' }), t, deps)

    expect(out).toMatchObject({ skipped: '', sessionId: 'task-sid,review-sid' })
    expect(factory.interrupt).toHaveBeenCalledWith('review-sid')
    expect(factory.postMessage.mock.calls.map((c) => c[0])).toEqual([
      'task-sid',
      'review-sid'
    ])
    expect(factory.postMessage.mock.calls[0][1]).toContain(
      'git worktree remove'
    )
    expect(github.updateIssueComment.mock.calls[0][1]).toContain(
      'Closed (cleanup requested)'
    )
    expect(factory.createSession).not.toHaveBeenCalled()
    expect(github.addEyes).not.toHaveBeenCalled()
  })

  it('sends a follow-up to the existing session', async () => {
    const { github, factory, deps } = fakes([tracking('task', 'old-sid')])
    factory.getSession.mockResolvedValue({
      sessionId: 'old-sid',
      status: 'running'
    })
    const t = parseEvent(
      'issue_comment',
      issueComment('@factory also add tests'),
      OWNER,
      REPO
    )

    const out = await delegate(inputs({ cwd: '/repo' }), t, deps)

    expect(out).toMatchObject({ sessionId: 'old-sid', reused: true })
    expect(factory.createSession).not.toHaveBeenCalled()
    expect(factory.interrupt).not.toHaveBeenCalled()
    expect(factory.getComputer).not.toHaveBeenCalled()
    expect(factory.postMessage.mock.calls[0][0]).toBe('old-sid')
    expect(github.updateIssueComment.mock.calls[0][0]).toBe(77)
  })

  it('creates a new session when the stored one is gone', async () => {
    const { github, factory, deps } = fakes([tracking('task', 'gone')])
    factory.getSession.mockResolvedValue(undefined)
    const t = parseEvent(
      'issue_comment',
      issueComment('@factory retry'),
      OWNER,
      REPO
    )

    const out = await delegate(inputs({ cwd: '/repo' }), t, deps)

    expect(out).toMatchObject({ sessionId: 'new-sid', reused: false })
    expect(github.updateIssueComment.mock.calls[0][1]).toContain(
      '"sid":"new-sid"'
    )
  })

  it('quietly skips outside users', async () => {
    const { github, factory, deps } = fakes()
    const t = parseEvent(
      'issue_comment',
      issueComment('@factory hack', { association: 'NONE', login: 'mallory' }),
      OWNER,
      REPO
    )

    const out = await delegate(inputs(), t, deps)

    expect(out).toEqual({ skipped: 'unauthorized' })
    expect(github.getPermission).toHaveBeenCalledWith('mallory')
    expect(github.addEyes).not.toHaveBeenCalled()
    expect(github.createIssueComment).not.toHaveBeenCalled()
    expect(factory.createSession).not.toHaveBeenCalled()
  })

  describe.each(['review', 'security', 'qa'] as const)(
    '%s CI follow-ups',
    (mode) => {
      describe.each(['pull_request', 'pull_request_target'])('%s', (event) => {
        it.each(['running', 'pending'] as const)(
          'interrupts a %s session and examines the full PR diff',
          async (status) => {
            const { github, factory, deps } = fakes([
              tracking(mode, 'ci-sid', 'old999')
            ])
            factory.getSession.mockResolvedValue({
              sessionId: 'ci-sid',
              status
            })
            const t = parseEvent(
              event,
              pullRequestEvent('synchronize'),
              OWNER,
              REPO
            )

            const out = await delegate(
              inputs({ mode, lane: mode, cwd: '/repo' }),
              t,
              deps
            )

            expect(out).toMatchObject({ sessionId: 'ci-sid', reused: true })
            expect(factory.createSession).not.toHaveBeenCalled()
            expect(factory.interrupt).toHaveBeenCalledWith('ci-sid')
            expect(factory.postMessage.mock.calls[0][0]).toBe('ci-sid')
            const text = factory.postMessage.mock.calls[0][1]
            expect(text).toContain('git diff origin/main...head222')
            expect(text).not.toContain('git diff old999...head222')
            expect(text).not.toContain('Look only at')
            expect(github.updateIssueComment.mock.calls[0][1]).toContain(
              '"sha":"head222"'
            )
          }
        )

        it('examines only new commits after an idle session', async () => {
          const { factory, deps } = fakes([tracking(mode, 'ci-sid', 'old999')])
          factory.getSession.mockResolvedValue({
            sessionId: 'ci-sid',
            status: 'idle'
          })
          const t = parseEvent(
            event,
            pullRequestEvent('synchronize'),
            OWNER,
            REPO
          )

          const out = await delegate(
            inputs({ mode, lane: mode, cwd: '/repo' }),
            t,
            deps
          )

          expect(out).toMatchObject({ sessionId: 'ci-sid', reused: true })
          expect(factory.interrupt).not.toHaveBeenCalled()
          const text = factory.postMessage.mock.calls[0][1]
          expect(text).toContain('Look only at `git diff old999...head222`')
          expect(text).toContain('Do not repeat findings')
        })
      })
    }
  )

  it('fails clearly when the repo clone cannot be resolved', async () => {
    const { factory, deps } = fakes()
    factory.getComputer.mockResolvedValue({
      id: 'comp-1',
      name: 'c',
      clonedRepoDirectories: []
    })
    const t = parseEvent(
      'issue_comment',
      issueComment('@factory go'),
      OWNER,
      REPO
    )

    await expect(delegate(inputs(), t, deps)).rejects.toThrow(
      /Set the 'cwd' input/
    )
  })

  it('does not fail when the tracking comment cannot be written', async () => {
    const { github, deps } = fakes()
    github.createIssueComment.mockRejectedValue(new Error('403'))
    const t = parseEvent(
      'issue_comment',
      issueComment('@factory go'),
      OWNER,
      REPO
    )

    await expect(
      delegate(inputs({ cwd: '/repo' }), t, deps)
    ).resolves.toMatchObject({ sessionId: 'new-sid' })
    expect(core.warning).toHaveBeenCalled()
  })
})
