/**
 * Local stand-in for the Factory Sessions API and the slice of the GitHub REST
 * API the action calls, so the action can be run end to end without real
 * credentials, a Droid Computer or a GitHub repository.
 *
 *   bun run qa:mock            # listens on http://127.0.0.1:4010
 *   QA_PORT=5000 bun run qa:mock
 *
 * Inspect what the action did with `GET /__qa/state`; clear it with
 * `POST /__qa/reset`. See .factory/skills/qa/SKILL.md for the full flow.
 */

const PORT = Number(process.env.QA_PORT ?? 4010)

/** The only key the mock accepts. `script/qa/run.ts` sends it by default. */
const API_KEY = process.env.QA_FACTORY_API_KEY ?? 'qa-factory-key'

/** Repository permission per login for the permission-API fallback. */
const PERMISSIONS: Record<string, string> = {
  alice: 'write',
  'private-member': 'write',
  outsider: 'read'
}

/** Login the default GITHUB_TOKEN writes comments as. */
const BOT_LOGIN = 'github-actions[bot]'

interface MockSession {
  sessionId: string
  status: 'idle' | 'pending' | 'running'
  computerId: string
  cwd?: string
  sessionSettings?: unknown
  messages: { messageId: string; text: string }[]
  interrupts: number
}

interface MockComment {
  id: number
  issue: number
  body: string
  user: { login: string }
}

interface State {
  sessions: Record<string, MockSession>
  comments: MockComment[]
  reactions: { target: string; id: number; content: string }[]
  requests: { method: string; path: string; status: number }[]
}

let state: State = fresh()
let nextId = 1

function fresh(): State {
  return { sessions: {}, comments: [], reactions: [], requests: [] }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function problem(status: number, title: string, detail: string): Response {
  return json({ title, detail }, status)
}

async function body<T>(req: Request): Promise<T> {
  const raw = await req.text()
  return (raw ? JSON.parse(raw) : {}) as T
}

async function factory(req: Request, path: string): Promise<Response> {
  if (req.headers.get('authorization') !== `Bearer ${API_KEY}`) {
    return problem(401, 'Unauthorized', 'Invalid or missing API key')
  }

  let m = path.match(/^\/api\/v0\/computers\/([^/]+)$/)
  if (m && req.method === 'GET') {
    const id = decodeURIComponent(m[1])
    // Matches the repository names used by the sample events in events/.
    return json({
      id,
      name: `qa-computer-${id}`,
      status: 'active',
      clonedRepoDirectories: [
        '/home/factory-user/repos/widgets',
        '/home/factory-user/repos/factory-action'
      ]
    })
  }

  if (path === '/api/v0/sessions' && req.method === 'POST') {
    const b = await body<{
      computerId: string
      cwd?: string
      sessionSettings?: unknown
    }>(req)
    const sessionId = `qa-session-${nextId++}`
    state.sessions[sessionId] = {
      sessionId,
      status: 'idle',
      computerId: b.computerId,
      cwd: b.cwd,
      sessionSettings: b.sessionSettings,
      messages: [],
      interrupts: 0
    }
    return json({ sessionId, status: 'idle', computerId: b.computerId }, 201)
  }

  m = path.match(/^\/api\/v0\/sessions\/([^/]+)(\/interrupt|\/messages)?$/)
  if (m) {
    const session = state.sessions[decodeURIComponent(m[1])]
    if (!session) return problem(404, 'Not Found', 'Session not found')
    const { sessionId, status, computerId } = session

    if (!m[2] && req.method === 'GET') {
      return json({ sessionId, status, computerId })
    }
    if (m[2] === '/interrupt' && req.method === 'POST') {
      session.interrupts++
      session.status = 'idle'
      return json({ sessionId, status: session.status })
    }
    if (m[2] === '/messages' && req.method === 'POST') {
      const { text } = await body<{ text: string }>(req)
      const messageId = `qa-message-${nextId++}`
      session.messages.push({ messageId, text })
      // A real session keeps working after accepting the message. Leave it
      // running so a follow-up push exercises the interrupt path.
      session.status = 'running'
      return json({ messageId, status: 'pending' }, 202)
    }
  }

  return problem(404, 'Not Found', `No mock for ${req.method} ${path}`)
}

async function github(req: Request, path: string): Promise<Response> {
  if (!req.headers.get('authorization')) {
    return json({ message: 'Requires authentication' }, 401)
  }

  if (path === '/user' && req.method === 'GET') {
    // GITHUB_TOKEN cannot call GET /user; the action falls back to the bot.
    return json({ message: 'Resource not accessible by integration' }, 403)
  }

  let m = path.match(
    /^\/repos\/[^/]+\/[^/]+\/collaborators\/([^/]+)\/permission$/
  )
  if (m && req.method === 'GET') {
    const login = decodeURIComponent(m[1])
    return json({ permission: PERMISSIONS[login] ?? 'none' })
  }

  m = path.match(/^\/repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/)
  if (m) {
    const issue = Number(m[1])
    if (req.method === 'GET') {
      return json(state.comments.filter((c) => c.issue === issue))
    }
    if (req.method === 'POST') {
      const { body: text } = await body<{ body: string }>(req)
      const comment = {
        id: nextId++,
        issue,
        body: text,
        user: { login: BOT_LOGIN }
      }
      state.comments.push(comment)
      return json(comment, 201)
    }
  }

  m = path.match(/^\/repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/)
  if (m && req.method === 'PATCH') {
    const comment = state.comments.find((c) => c.id === Number(m![1]))
    if (!comment) return json({ message: 'Not Found' }, 404)
    comment.body = (await body<{ body: string }>(req)).body
    return json(comment)
  }

  m = path.match(
    /^\/repos\/[^/]+\/[^/]+\/(issues\/comments|pulls\/comments|issues)\/(\d+)\/reactions$/
  )
  if (m && req.method === 'POST') {
    const { content } = await body<{ content: string }>(req)
    state.reactions.push({ target: m[1], id: Number(m[2]), content })
    return json({ id: nextId++, content }, 201)
  }

  return json({ message: `No mock for ${req.method} ${path}` }, 404)
}

async function route(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname

  if (path === '/__qa/health') return json({ ok: true })
  if (path === '/__qa/state') return json(state)
  if (path === '/__qa/reset' && req.method === 'POST') {
    state = fresh()
    return json({ ok: true })
  }

  if (path.startsWith('/api/v0/')) return factory(req, path)
  return github(req, path)
}

Bun.serve({
  hostname: '127.0.0.1',
  port: PORT,
  async fetch(req) {
    const res = await route(req)
    const path = new URL(req.url).pathname
    if (!path.startsWith('/__qa/')) {
      state.requests.push({ method: req.method, path, status: res.status })
      console.log(`${req.method} ${path} -> ${res.status}`)
    }
    return res
  }
})

console.log(`QA mock API listening on http://127.0.0.1:${PORT}`)
