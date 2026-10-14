import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import {
  MOCK_CLONE_DIR,
  SELF_LOGIN,
  startMockServer,
  type MockApi
} from '../qa/mock-server.js'

let api: MockApi

interface CallResult<T> {
  status: number
  data: T
}

async function call<T = Record<string, unknown>>(
  method: string,
  path: string,
  body?: unknown
): Promise<CallResult<T>> {
  const res = await fetch(`${api.url}${path}`, {
    method,
    headers: {
      Authorization: 'Bearer test-token',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  return {
    status: res.status,
    data: (text ? JSON.parse(text) : undefined) as T
  }
}

interface Session {
  sessionId: string
  status: string
  computerId?: string
}

interface Comment {
  id: number
  body: string
  user: { login: string }
}

beforeAll(async () => {
  api = await startMockServer(0)
})

afterAll(async () => {
  await api.close()
})

describe('mock Factory API', () => {
  it('creates a session and echoes the computer', async () => {
    const res = await call<Session>('POST', '/api/v0/sessions', {
      computerId: 'cmp-1',
      cwd: MOCK_CLONE_DIR,
      sessionSettings: { autonomyLevel: 'high' }
    })
    expect(res.status).toBe(201)
    expect(res.data.sessionId).toMatch(/^sess-/)
    expect(res.data.status).toBe('idle')
    expect(res.data.computerId).toBe('cmp-1')
  })

  it('requires a computerId', async () => {
    const res = await call('POST', '/api/v0/sessions', {})
    expect(res.status).toBe(422)
  })

  it('fetches sessions and 404s on unknown ones', async () => {
    const created = await call<Session>('POST', '/api/v0/sessions', {
      computerId: 'cmp-1'
    })
    const found = await call<Session>(
      'GET',
      `/api/v0/sessions/${created.data.sessionId}`
    )
    expect(found.status).toBe(200)
    expect(found.data.sessionId).toBe(created.data.sessionId)

    const missing = await call('GET', '/api/v0/sessions/missing')
    expect(missing.status).toBe(404)
  })

  it('posts messages to a session', async () => {
    const created = await call<Session>('POST', '/api/v0/sessions', {
      computerId: 'cmp-1'
    })
    const res = await call<{ messageId: string; status: string }>(
      'POST',
      `/api/v0/sessions/${created.data.sessionId}/messages`,
      { text: '@factory hello' }
    )
    expect(res.status).toBe(200)
    expect(res.data.messageId).toMatch(/^msg-/)
    expect(typeof res.data.status).toBe('string')

    const missing = await call('POST', '/api/v0/sessions/none/messages', {
      text: 'x'
    })
    expect(missing.status).toBe(404)
  })

  it('serves the computer and its clone list', async () => {
    const res = await call<{
      id: string
      clonedRepoDirectories: string[]
    }>('GET', '/api/v0/computers/cmp-1')
    expect(res.status).toBe(200)
    expect(res.data.id).toBe('cmp-1')
    expect(res.data.clonedRepoDirectories).toEqual([MOCK_CLONE_DIR])

    const byName = await call<{ id: string }>(
      'GET',
      '/api/v0/computers/name/qa-mock-computer'
    )
    expect(byName.status).toBe(200)
    expect(byName.data.id).toBe('qa-mock-computer')

    const unknown = await call('GET', '/api/v0/computers/name/nope')
    expect(unknown.status).toBe(404)
  })
})

describe('mock GitHub API', () => {
  it('reports the bot identity', async () => {
    const res = await call<{ login: string; type: string }>('GET', '/user')
    expect(res.status).toBe(200)
    expect(res.data.login).toBe(SELF_LOGIN)
    expect(res.data.type).toBe('Bot')
  })

  it('answers collaborator permission lookups', async () => {
    const res = await call<{ permission: string }>(
      'GET',
      '/repos/acme/widgets/collaborators/alice/permission'
    )
    expect(res.status).toBe(200)
    expect(res.data.permission).toBe('write')
  })

  it('creates, lists and updates issue comments', async () => {
    const created = await call<Comment>(
      'POST',
      '/repos/acme/widgets/issues/42/comments',
      { body: 'tracking' }
    )
    expect(created.status).toBe(201)
    expect(created.data.user.login).toBe(SELF_LOGIN)

    const list = await call<Comment[]>(
      'GET',
      '/repos/acme/widgets/issues/42/comments'
    )
    expect(list.status).toBe(200)
    expect(list.data).toHaveLength(1)
    expect(list.data[0].id).toBe(created.data.id)

    const updated = await call<Comment>(
      'PATCH',
      `/repos/acme/widgets/issues/comments/${created.data.id}`,
      { body: 'updated' }
    )
    expect(updated.status).toBe(200)
    expect(updated.data.body).toBe('updated')

    const missing = await call(
      'PATCH',
      '/repos/acme/widgets/issues/comments/1',
      {
        body: 'x'
      }
    )
    expect(missing.status).toBe(404)
  })

  it('adds eyes reactions to comments and issues', async () => {
    for (const path of [
      '/repos/acme/widgets/issues/comments/1001/reactions',
      '/repos/acme/widgets/issues/42/reactions',
      '/repos/acme/widgets/pulls/comments/2002/reactions'
    ]) {
      const res = await call<{ content: string }>('POST', path, {
        content: 'eyes'
      })
      expect(res.status).toBe(201)
      expect(res.data.content).toBe('eyes')
    }
  })

  it('404s on unknown endpoints', async () => {
    const res = await call('GET', '/repos/acme/widgets/unknown')
    expect(res.status).toBe(404)
  })
})

describe('mock request log', () => {
  it('records authorized requests, excluding introspection', async () => {
    await call('GET', '/__log')
    const log = api.requests()
    expect(log.length).toBeGreaterThan(0)
    expect(log.every((entry) => entry.authorized)).toBe(true)
    expect(log.every((entry) => !entry.path.startsWith('/__'))).toBe(true)

    const created = await call<Session>('POST', '/api/v0/sessions', {
      computerId: 'cmp-1'
    })
    const entry = api
      .requests()
      .findLast((r) => r.method === 'POST' && r.path === '/api/v0/sessions')
    expect(entry?.response).toMatchObject({
      sessionId: created.data.sessionId
    })
  })

  it('resets sessions, comments and the log', async () => {
    await call('POST', '/api/v0/sessions', { computerId: 'cmp-1' })
    await call('POST', '/repos/acme/widgets/issues/42/comments', {
      body: 'x'
    })
    const reset = await call('POST', '/__reset')
    expect(reset.status).toBe(200)

    expect(api.sessions()).toHaveLength(0)
    expect(api.requests()).toHaveLength(0)
    const list = await call<Comment[]>(
      'GET',
      '/repos/acme/widgets/issues/42/comments'
    )
    expect(list.data).toEqual([])
  })
})
