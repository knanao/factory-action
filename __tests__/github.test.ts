import { describe, expect, it, jest, mock } from 'bun:test'

const octokit = {
  paginate: jest.fn(async () => [{ id: 1, body: 'hi' }]),
  rest: {
    repos: {
      getCollaboratorPermissionLevel: jest.fn(async () => ({
        data: { permission: 'write' }
      }))
    },
    users: {
      getAuthenticated: jest.fn(async () => ({ data: { login: 'alice' } }))
    },
    issues: {
      listComments: jest.fn(),
      createComment: jest.fn(async () => ({ data: { id: 55 } })),
      updateComment: jest.fn(async () => ({ data: {} }))
    },
    reactions: {
      createForIssueComment: jest.fn(async () => ({ data: {} })),
      createForPullRequestReviewComment: jest.fn(async () => ({ data: {} })),
      createForIssue: jest.fn(async () => ({ data: {} }))
    }
  }
}
const getOctokit = jest.fn(() => octokit)

// mock.module is process-wide, so keep the real `context` other tests use.
const real = await import('@actions/github')
mock.module('@actions/github', () => ({ ...real, getOctokit }))

const { createGitHubApi } = await import('../src/github.js')

const repo = { owner: 'acme', repo: 'widgets' }
const api = createGitHubApi('ghs-test', 'acme', 'widgets')

describe('createGitHubApi', () => {
  it('authenticates with the given token', () => {
    expect(getOctokit).toHaveBeenCalledWith('ghs-test')
  })

  it('reads a collaborator permission', async () => {
    await expect(api.getPermission('alice')).resolves.toBe('write')
    expect(
      octokit.rest.repos.getCollaboratorPermissionLevel
    ).toHaveBeenCalledWith({ ...repo, username: 'alice' })
  })

  it('returns the authenticated login', async () => {
    await expect(api.selfLogin()).resolves.toBe('alice')
  })

  it('falls back to github-actions[bot] for installation tokens', async () => {
    octokit.rest.users.getAuthenticated.mockRejectedValueOnce(
      new Error('Resource not accessible by integration')
    )
    await expect(api.selfLogin()).resolves.toBe('github-actions[bot]')
  })

  it('lists every issue comment', async () => {
    await expect(api.listIssueComments(42)).resolves.toEqual([
      { id: 1, body: 'hi' }
    ])
    expect(octokit.paginate).toHaveBeenCalledWith(
      octokit.rest.issues.listComments,
      { ...repo, issue_number: 42, per_page: 100 }
    )
  })

  it('creates and updates issue comments', async () => {
    await expect(api.createIssueComment(42, 'tracking')).resolves.toBe(55)
    expect(octokit.rest.issues.createComment).toHaveBeenCalledWith({
      ...repo,
      issue_number: 42,
      body: 'tracking'
    })

    await api.updateIssueComment(55, 'updated')
    expect(octokit.rest.issues.updateComment).toHaveBeenCalledWith({
      ...repo,
      comment_id: 55,
      body: 'updated'
    })
  })

  it.each([
    ['issue-comment', 'createForIssueComment', { comment_id: 1001 }],
    [
      'review-comment',
      'createForPullRequestReviewComment',
      { comment_id: 1001 }
    ],
    ['issue', 'createForIssue', { issue_number: 1001 }]
  ] as const)('reacts with eyes to an %s', async (kind, method, target) => {
    await api.addEyes({ kind, id: 1001 })
    expect(octokit.rest.reactions[method]).toHaveBeenCalledWith({
      ...repo,
      ...target,
      content: 'eyes'
    })
  })
})
