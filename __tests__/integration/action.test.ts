/**
 * Integration tests for the whole action. Each test starts localhost HTTP
 * stubs for the GitHub and Factory APIs, then runs the real bundle as a
 * subprocess with a GitHub-Actions-like environment (see runner.ts). Nothing
 * is mocked at module level: the action parses the event file, reads its
 * inputs, authorizes the sender and talks to both APIs over real HTTP, the
 * way it does on a runner.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it
} from 'bun:test'
import {
  issueComment,
  pullRequest,
  pullRequestEvent
} from '../../__fixtures__/payloads.js'
import { computerName } from '../../src/compute.js'
import { FactoryStub, GitHubStub, type RecordedRequest } from './servers.js'
import { buildAction, cleanupRunner, runAction } from './runner.js'

const MARKER_RE = /<!-- factory-action:state (\{.*?\}) -->/

function trackingState(body: string | undefined): Record<string, unknown> {
  const match = MARKER_RE.exec(body ?? '')
  expect(match).toBeDefined()
  return JSON.parse(match![1]) as Record<string, unknown>
}

/** The comment body of a recorded create/update-comment request. */
function commentBody(req: RecordedRequest | undefined): string {
  expect(req).toBeDefined()
  const body = (req?.body as { body?: unknown } | undefined)?.body
  return typeof body === 'string' ? body : ''
}

/** A pull_request synchronize event with a specific head SHA. */
function synchronize(headSha: string) {
  const pr = pullRequest()
  return {
    action: 'synchronize',
    pull_request: { ...pr, head: { ...pr.head, sha: headSha } }
  }
}

/** An issues closed event for the issue used by the payload fixtures. */
function issueClosed() {
  const { issue } = issueComment('@factory placeholder')
  return { action: 'closed', issue }
}

describe('integration: the bundled action', () => {
  let github: GitHubStub
  let factory: FactoryStub

  beforeAll(() => buildAction(), 120_000)

  beforeEach(async () => {
    github = new GitHubStub()
    factory = new FactoryStub()
    await Promise.all([github.start(), factory.start()])
  })

  afterEach(async () => {
    await Promise.all([github.stop(), factory.stop()])
  })

  afterAll(() => cleanupRunner())

  const mention = (body: string, inputs?: Record<string, string>) => ({
    eventName: 'issue_comment',
    payload: issueComment(body),
    githubUrl: github.url,
    factoryUrl: factory.url,
    inputs
  })

  const pullRequestRun = (
    payload: unknown,
    inputs?: Record<string, string>
  ) => ({
    eventName: 'pull_request',
    payload,
    githubUrl: github.url,
    factoryUrl: factory.url,
    inputs
  })

  it('delegates a mention end to end', async () => {
    const run = await runAction(
      mention('@factory please fix the flaky login test')
    )

    expect(run.exitCode).toBe(0)
    expect(run.stdout).not.toContain('::error::')

    // Outputs and job summary, as a runner would receive them.
    expect(run.outputs).toEqual({
      skipped: '',
      'session-id': 'sess-1',
      'session-url': 'https://app.factory.ai/sessions/sess-1',
      reused: 'false',
      'computer-id': 'comp-1'
    })
    expect(run.summary).toContain('<h3>Factory Droid</h3>')
    expect(run.summary).toContain('https://app.factory.ai/sessions/sess-1')

    // The eyes reaction on the triggering comment, with the GitHub token.
    const reaction = github.sent(
      'POST',
      '/repos/acme/widgets/issues/comments/1001/reactions'
    )[0]
    expect(reaction?.body).toEqual({ content: 'eyes' })
    expect(reaction?.headers.authorization).toBe('token gh-test')

    // The session is created on the computer, in the cloned directory.
    expect(factory.sent('GET', '/api/v0/computers/comp-1')).toHaveLength(1)
    expect(factory.createdSessions).toHaveLength(1)
    const create = factory.createdSessions[0]
    expect(create).toMatchObject({
      computerId: 'comp-1',
      cwd: '/home/factory-user/projects/widgets',
      sessionSettings: {
        interactionMode: 'auto',
        autonomyLevel: 'high',
        tags: [
          {
            name: 'factory-action',
            metadata: { repo: 'acme/widgets', number: '42', lane: 'task' }
          }
        ]
      }
    })
    const systemPrompt = (create.sessionSettings as Record<string, unknown>)
      .systemPrompt as { preset: string; append: string }
    expect(systemPrompt.preset).toBe('droid')
    // The system rules must keep the loop-prevention instructions.
    expect(systemPrompt.append).toContain('Never write the phrase "@factory"')
    expect(systemPrompt.append).toContain('.worktrees/task-42')

    // The prompt carries the request as clearly delimited untrusted data.
    const texts = factory.messages.get('sess-1')
    expect(texts).toHaveLength(1)
    const text = texts![0]
    expect(text).toContain('@alice asked you to do something')
    expect(text).toContain('Issue: #42 Broken button')
    expect(text).toContain(
      '<untrusted-github-content source="request from @alice">'
    )
    expect(text).toContain('please fix the flaky login test')

    // The tracking comment records the session for the next run.
    const created = github.sent(
      'POST',
      '/repos/acme/widgets/issues/42/comments'
    )[0]
    const comment = commentBody(created)
    expect(comment).toContain(
      'https://github.test/acme/widgets/actions/runs/12345'
    )
    expect(comment).toContain(
      '[sess-1](https://app.factory.ai/sessions/sess-1)'
    )
    expect(trackingState(comment)).toEqual({
      v: 1,
      lane: 'task',
      sid: 'sess-1'
    })

    // Every Factory call carries the API key.
    for (const req of factory.requests) {
      expect(req.headers.authorization).toBe('Bearer fk-test')
    }
  }, 30_000)

  it('reuses the lane session on a follow-up mention', async () => {
    const first = await runAction(mention('@factory first task'))
    expect(first.exitCode).toBe(0)

    const second = await runAction(mention('@factory second task'))
    expect(second.exitCode).toBe(0)

    // No second session; the existing one is fetched and reused.
    expect(factory.sent('POST', '/api/v0/sessions')).toHaveLength(1)
    expect(factory.sent('GET', '/api/v0/sessions/sess-1')).toHaveLength(1)
    expect(second.outputs['session-id']).toBe('sess-1')
    expect(second.outputs['reused']).toBe('true')

    // The message went to the existing session.
    const texts = factory.messages.get('sess-1')
    expect(texts).toHaveLength(2)
    expect(texts![1]).toContain('second task')

    // The tracking comment is updated in place, not duplicated.
    expect(
      github.sent('POST', '/repos/acme/widgets/issues/42/comments')
    ).toHaveLength(1)
    const patched = github.sent(
      'PATCH',
      '/repos/acme/widgets/issues/comments/5001'
    )[0]
    expect(commentBody(patched)).toContain('Delegated (follow-up)')
  }, 30_000)

  it('reviews a pull request on CI and records the head SHA', async () => {
    const run = await runAction(
      pullRequestRun(pullRequestEvent('opened'), { mode: 'review' })
    )

    expect(run.exitCode).toBe(0)
    expect(run.outputs).toEqual({
      skipped: '',
      'session-id': 'sess-1',
      'session-url': 'https://app.factory.ai/sessions/sess-1',
      reused: 'false',
      'computer-id': 'comp-1'
    })

    const text = factory.messages.get('sess-1')![0]
    expect(text).toContain('Review pull request #7')
    expect(text).toContain('git diff origin/main...head222')
    expect(text).toContain('repos/acme/widgets/pulls/7/reviews')

    // No user text triggered the run, so no authorization or reaction.
    expect(
      github.requests.filter((r) => r.path.includes('/reactions'))
    ).toHaveLength(0)

    const created = github.sent(
      'POST',
      '/repos/acme/widgets/issues/7/comments'
    )[0]
    expect(trackingState(commentBody(created))).toEqual({
      v: 1,
      lane: 'review',
      sid: 'sess-1',
      sha: 'head222'
    })
  }, 30_000)

  it('interrupts the running session when a new push supersedes it', async () => {
    const first = await runAction(
      pullRequestRun(pullRequestEvent('opened'), { mode: 'review' })
    )
    expect(first.exitCode).toBe(0)
    expect(factory.sessions.get('sess-1')?.status).toBe('running')

    const second = await runAction(
      pullRequestRun(synchronize('head333'), { mode: 'review' })
    )
    expect(second.exitCode).toBe(0)

    expect(factory.sent('POST', '/api/v0/sessions')).toHaveLength(1)
    expect(
      factory.sent('POST', '/api/v0/sessions/sess-1/interrupt')
    ).toHaveLength(1)
    expect(second.outputs['reused']).toBe('true')
    expect(factory.messages.get('sess-1')![1]).toContain(
      'git diff origin/main...head333'
    )
  }, 30_000)

  it('scopes a follow-up review to the commits pushed since the last run', async () => {
    await runAction(
      pullRequestRun(pullRequestEvent('opened'), { mode: 'review' })
    )
    // The previous review finished before the new push.
    factory.sessions.get('sess-1')!.status = 'idle'

    const second = await runAction(
      pullRequestRun(synchronize('head333'), { mode: 'review' })
    )
    expect(second.exitCode).toBe(0)
    expect(
      factory.requests.filter((r) => r.path.endsWith('/interrupt'))
    ).toHaveLength(0)

    const text = factory.messages.get('sess-1')![1]
    expect(text).toContain(
      'New commits were pushed since your last run on this PR (at head222)'
    )
    expect(text).toContain('git diff head222...head333')
  }, 30_000)

  it('skips an outside user quietly after the permission fallback', async () => {
    const run = await runAction({
      eventName: 'issue_comment',
      payload: issueComment('@factory run the deploy', {
        association: 'NONE',
        login: 'charlie'
      }),
      githubUrl: github.url,
      factoryUrl: factory.url
    })

    expect(run.exitCode).toBe(0)
    expect(run.outputs).toEqual({
      skipped: 'unauthorized',
      'session-id': '',
      'session-url': '',
      reused: 'false',
      'computer-id': ''
    })

    // The permission check is the only API call: no reaction, no comment,
    // no session, nothing for Droid to act on.
    expect(github.requests).toHaveLength(1)
    expect(github.requests[0]?.path).toBe(
      '/repos/acme/widgets/collaborators/charlie/permission'
    )
    expect(factory.requests).toHaveLength(0)
    expect(run.summary).toBe('')
  }, 30_000)

  it('fails the run when the Factory API rejects the session', async () => {
    factory.createFailure = {
      status: 500,
      title: 'Internal Server Error',
      detail: 'computer offline'
    }

    const run = await runAction(mention('@factory fix it'))

    expect(run.exitCode).toBe(1)
    expect(run.stdout).toContain(
      '::error::Factory API 500 Internal Server Error: computer offline'
    )
    // Nothing was delegated, so no outputs or summary were written.
    expect(Object.keys(run.outputs)).toHaveLength(0)
    expect(run.summary).toBe('')
  }, 30_000)

  it('still delivers the message after a transient 503', async () => {
    factory.messageFailures.push(503)

    const run = await runAction(mention('@factory fix it'))

    expect(run.exitCode).toBe(0)
    expect(
      factory.sent('POST', '/api/v0/sessions/sess-1/messages')
    ).toHaveLength(2)
    expect(factory.messages.get('sess-1')).toHaveLength(1)
    expect(run.outputs['session-id']).toBe('sess-1')
    expect(run.stdout).not.toContain('assuming the message was accepted')
  }, 30_000)

  it('asks tracked sessions to clean up when the thread closes', async () => {
    const first = await runAction(mention('@factory fix the button'))
    expect(first.exitCode).toBe(0)
    factory.sessions.get('sess-1')!.status = 'idle'

    const second = await runAction({
      eventName: 'issues',
      payload: issueClosed(),
      githubUrl: github.url,
      factoryUrl: factory.url,
      inputs: { mode: 'cleanup' }
    })

    expect(second.exitCode).toBe(0)
    expect(second.outputs['session-id']).toBe('sess-1')
    expect(second.outputs['reused']).toBe('true')

    const text = factory.messages.get('sess-1')![1]
    expect(text).toContain('Issue #42 in acme/widgets was closed')
    expect(
      factory.requests.filter((r) => r.path.endsWith('/interrupt'))
    ).toHaveLength(0)

    const patched = github.sent(
      'PATCH',
      '/repos/acme/widgets/issues/comments/5001'
    )[0]
    expect(commentBody(patched)).toContain('Closed (cleanup requested)')
  }, 30_000)

  it('provisions a computer from an Environment and reuses it', async () => {
    const inputs = { 'environment-id': 'env-1' }
    // The computer name is the only link between runs, so it must be
    // derived from nothing but the repository, the thread and the lane.
    const name = computerName('acme', 'widgets', '42', 'task')

    const first = await runAction(
      mention('@factory fix the deploy script', inputs)
    )
    expect(first.exitCode).toBe(0)

    expect(factory.sent('GET', `/api/v0/computers/name/${name}`)).toHaveLength(
      1
    )
    expect(factory.createdComputers).toHaveLength(1)
    expect(factory.createdComputers[0]).toMatchObject({
      name,
      source: { kind: 'environment', environmentId: 'env-1', isListed: false }
    })

    // The session runs on the provisioned computer, in its clone.
    expect(first.outputs['computer-id']).toBe('comp-env-1')
    expect(first.outputs['session-id']).toBe('sess-1')
    const create = factory.createdSessions[0]
    expect(create).toMatchObject({
      computerId: 'comp-env-1',
      cwd: '/home/droid/widgets'
    })
    const systemPrompt = (create.sessionSettings as Record<string, unknown>)
      .systemPrompt as { append: string }
    expect(systemPrompt.append).toContain('Your workspace is the clone')

    // The tracking comment records the computer for the cleanup mode.
    const created = github.sent(
      'POST',
      '/repos/acme/widgets/issues/42/comments'
    )[0]
    expect(trackingState(commentBody(created))).toEqual({
      v: 1,
      lane: 'task',
      sid: 'sess-1',
      cid: 'comp-env-1'
    })

    // A follow-up finds the computer by name and reuses the session.
    const second = await runAction(
      mention('@factory also check the rollback script', inputs)
    )
    expect(second.exitCode).toBe(0)
    expect(factory.createdComputers).toHaveLength(1)
    expect(factory.createdSessions).toHaveLength(1)
    expect(second.outputs['session-id']).toBe('sess-1')
    expect(second.outputs['reused']).toBe('true')
    expect(factory.messages.get('sess-1')).toHaveLength(2)
  }, 30_000)

  it('deletes the Environment computer when the thread closes', async () => {
    await runAction(
      mention('@factory fix the button', { 'environment-id': 'env-1' })
    )

    const cleanup = await runAction({
      eventName: 'issues',
      payload: issueClosed(),
      githubUrl: github.url,
      factoryUrl: factory.url,
      inputs: { mode: 'cleanup', 'environment-id': 'env-1' }
    })

    expect(cleanup.exitCode).toBe(0)
    expect(factory.sent('DELETE', '/api/v0/computers/comp-env-1')).toHaveLength(
      1
    )
    expect(factory.computers).toHaveLength(0)
    expect(cleanup.outputs['computer-id']).toBe('comp-env-1')
    expect(cleanup.outputs['session-id']).toBe('')

    const patched = github.sent(
      'PATCH',
      '/repos/acme/widgets/issues/comments/5001'
    )[0]
    expect(commentBody(patched)).toContain('Closed (computer deleted)')
  }, 30_000)

  it('never reacts to Droid output, so the action cannot trigger itself', async () => {
    const run = await runAction(
      mention('Done, fixed in #9. <!-- factory-droid -->')
    )

    expect(run.exitCode).toBe(0)
    expect(run.outputs).toEqual({
      skipped: 'bot',
      'session-id': '',
      'session-url': '',
      reused: 'false',
      'computer-id': ''
    })
    expect(github.requests).toHaveLength(0)
    expect(factory.requests).toHaveLength(0)
    expect(run.summary).toBe('')
  }, 30_000)
})
