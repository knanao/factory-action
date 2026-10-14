import { describe, expect, it } from 'bun:test'
import {
  containsTrigger,
  findCommand,
  DROID_MARKER,
  needsAuthorization,
  parseEvent,
  precheck
} from '../src/trigger.js'
import {
  issueComment,
  OWNER,
  pullRequestEvent,
  REPO,
  reviewComment
} from '../__fixtures__/payloads.js'

const opts = { triggerPhrase: '@factory', allowedBots: [] as string[] }
const parse = (event: string, payload: unknown) =>
  parseEvent(event, payload, OWNER, REPO)

describe('containsTrigger', () => {
  it.each([
    ['@factory fix this', true],
    ['please @factory, fix this', true],
    ['@Factory fix', true],
    ['@factory', true],
    ['@factorybot fix', false],
    ['email@factory.ai', false],
    ['> @factory quoted request\nthanks', false],
    ['```\n@factory in code\n```', false],
    ['use `@factory` to delegate', false]
  ])('%j -> %s', (text, expected) => {
    expect(containsTrigger(text, '@factory')).toBe(expected)
  })
})

describe('parseEvent', () => {
  it('normalizes an issue comment on a PR', () => {
    const t = parse(
      'issue_comment',
      issueComment('@factory hi', { onPR: true })
    )
    expect(t).toMatchObject({
      number: 42,
      isPR: true,
      text: '@factory hi',
      author: { login: 'alice', association: 'MEMBER' },
      reaction: { kind: 'issue-comment', id: 1001 }
    })
    expect(t.pr).toBeUndefined()
  })

  it('keeps review comment context and the PR', () => {
    const t = parse(
      'pull_request_review_comment',
      reviewComment('@factory explain')
    )
    expect(t.reviewContext).toEqual({
      path: 'src/a.ts',
      line: 12,
      diffHunk: '@@ -1 +1 @@'
    })
    expect(t.pr).toMatchObject({
      number: 7,
      headSha: 'head222',
      headRepo: 'acme/widgets'
    })
    expect(t.reaction).toEqual({ kind: 'review-comment', id: 2002 })
  })

  it('has no text for pull_request events', () => {
    const t = parse('pull_request', pullRequestEvent('opened'))
    expect(t.text).toBeUndefined()
    expect(needsAuthorization(t)).toBe(false)
  })
})

describe('precheck', () => {
  it('passes a mention from a user', () => {
    expect(
      precheck(
        'mention',
        parse('issue_comment', issueComment('@factory do it')),
        opts
      )
    ).toBeUndefined()
  })

  it('skips comments without the trigger', () => {
    expect(
      precheck('mention', parse('issue_comment', issueComment('lgtm')), opts)
    ).toBe('no-trigger')
  })

  it('skips edited comments', () => {
    const payload = { ...issueComment('@factory do it'), action: 'edited' }
    expect(precheck('mention', parse('issue_comment', payload), opts)).toBe(
      'no-trigger'
    )
  })

  it('skips bots unless allowed', () => {
    const t = parse(
      'issue_comment',
      issueComment('@factory go', { login: 'renovate[bot]', type: 'Bot' })
    )
    expect(precheck('mention', t, opts)).toBe('bot')
    expect(
      precheck('mention', t, { ...opts, allowedBots: ['renovate[bot]'] })
    ).toBeUndefined()
  })

  it("skips Droid's own posts", () => {
    const t = parse(
      'issue_comment',
      issueComment(`done @factory\n${DROID_MARKER}`)
    )
    expect(precheck('mention', t, opts)).toBe('bot')
  })

  it('rejects unsupported events in mention mode', () => {
    expect(() => precheck('mention', parse('push', {}), opts)).toThrow(
      /does not support/
    )
  })

  it('handles CI modes', () => {
    expect(
      precheck(
        'review',
        parse('pull_request', pullRequestEvent('synchronize')),
        opts
      )
    ).toBeUndefined()
    expect(
      precheck(
        'review',
        parse('pull_request', pullRequestEvent('closed')),
        opts
      )
    ).toBe('no-trigger')
    expect(
      precheck(
        'security',
        parse('pull_request', pullRequestEvent('opened', { draft: true })),
        opts
      )
    ).toBe('draft')
    expect(
      precheck(
        'review',
        parse(
          'pull_request',
          pullRequestEvent('opened', { headRepo: 'evil/widgets' })
        ),
        opts
      )
    ).toBe('fork')
    expect(() =>
      precheck('review', parse('issue_comment', issueComment('x')), opts)
    ).toThrow(/requires/)
  })

  it('runs cleanup only when an issue or PR is closed', () => {
    expect(
      precheck(
        'cleanup',
        parse('pull_request', pullRequestEvent('closed')),
        opts
      )
    ).toBeUndefined()
    expect(
      precheck(
        'cleanup',
        parse(
          'pull_request_target',
          pullRequestEvent('closed', { headRepo: 'evil/widgets' })
        ),
        opts
      )
    ).toBeUndefined()
    expect(
      precheck(
        'cleanup',
        parse('pull_request', pullRequestEvent('opened')),
        opts
      )
    ).toBe('no-trigger')
    expect(() =>
      precheck('cleanup', parse('issue_comment', issueComment('x')), opts)
    ).toThrow(/closed/)
  })

  it('runs deep-security only on schedule and workflow_dispatch', () => {
    expect(
      precheck('deep-security', parse('schedule', {}), opts)
    ).toBeUndefined()
    expect(
      precheck('deep-security', parse('workflow_dispatch', {}), opts)
    ).toBeUndefined()
    expect(() =>
      precheck(
        'deep-security',
        parse('pull_request', pullRequestEvent('opened')),
        opts
      )
    ).toThrow(/whole repository/)
  })

  it('runs wiki only on schedule and workflow_dispatch', () => {
    expect(precheck('wiki', parse('schedule', {}), opts)).toBeUndefined()
    expect(
      precheck('wiki', parse('workflow_dispatch', {}), opts)
    ).toBeUndefined()
    expect(() =>
      precheck('wiki', parse('pull_request', pullRequestEvent('opened')), opts)
    ).toThrow(/whole repository/)
  })

  it('lets custom mode run on any event', () => {
    expect(precheck('custom', parse('schedule', {}), opts)).toBeUndefined()
  })
})

describe('findCommand', () => {
  const commands = ['verify', 'security-review']
  it.each([
    ['@factory verify the fix', 'verify'],
    ['@factory /verify the fix', 'verify'],
    ['Hi @Factory Security-Review, please', 'security-review'],
    ['@factory\nverify it', 'verify'],
    ['@factory verify-all', undefined],
    ['@factory please verify', undefined],
    ['@factory implement this', undefined],
    ['> @factory verify\n@factory fix it', undefined],
    ['`@factory verify`', undefined],
    ['@factoryverify', undefined]
  ])('%p -> %p', (text, expected) => {
    expect(findCommand(text, '@factory', commands)).toBe(expected)
  })
})
