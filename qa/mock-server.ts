/**
 * An offline mock of the two APIs the action talks to: the Factory Sessions
 * API and the GitHub REST API. It lets the action run end-to-end on a laptop
 * with no credentials and no network access beyond localhost.
 *
 * Start it standalone with `bun run qa:mock-server`, or from code with
 * `startMockServer()`. State lives in memory for the lifetime of the server,
 * so a second action run against a live server exercises the session-reuse
 * path. `POST /__reset` clears it, and `GET /__log` returns every request the
 * server has seen (introspection requests excluded).
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse
} from 'node:http'
import type { AddressInfo } from 'node:net'

/** The identity the mocked GitHub API reports for the action's token. */
export const SELF_LOGIN = 'github-actions[bot]'

/** Port used when the server is started standalone without a PORT env. */
export const DEFAULT_PORT = 8765

/** The clone directory the mocked computer reports for `acme/widgets`. */
export const MOCK_CLONE_DIR = '/home/qa/repos/acme/widgets'

export interface LoggedRequest {
  method: string
  path: string
  status: number
  /** JSON request body, for methods that carry one. */
  body?: unknown
  /** JSON response body, when there is one. */
  response?: unknown
  /** Whether an Authorization header was sent. Its value is never logged. */
  authorized: boolean
}

export interface MockSession {
  sessionId: string
  status: string
  computerId: string
}

export interface MockApi {
  server: Server
  port: number
  /** Base URL, e.g. http://127.0.0.1:8765. */
  url: string
  sessions(): MockSession[]
  requests(): LoggedRequest[]
  reset(): void
  close(): Promise<void>
}

interface Comment {
  id: number
  body: string
  user: { login: string; type: string }
}

interface MockState {
  sessions: Map<string, MockSession>
  /** Issue comments by `${owner}/${repo}#${number}`. */
  comments: Map<string, Comment[]>
  log: LoggedRequest[]
  nextId: number
}

function freshState(): MockState {
  return {
    sessions: new Map(),
    comments: new Map(),
    log: [],
    nextId: 5001
  }
}

/** Clears sessions, comments and the log in place. */
function resetState(state: MockState): void {
  state.sessions.clear()
  state.comments.clear()
  state.log.length = 0
  state.nextId = 5001
}

/** Starts the mock APIs. Pass 0 for an ephemeral port. */
export async function startMockServer(port = 0): Promise<MockApi> {
  const state = freshState()
  const server = createServer((req, res) => {
    void handle(req, res, state)
  })
  await new Promise<void>((resolve) =>
    server.listen(port, '127.0.0.1', resolve)
  )

  const address = server.address() as AddressInfo
  return {
    server,
    port: address.port,
    url: `http://127.0.0.1:${address.port}`,
    sessions: () => [...state.sessions.values()],
    requests: () => state.log.map((entry) => ({ ...entry })),
    reset: () => resetState(state),
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
  }
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  state: MockState
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const method = req.method ?? 'GET'
  const body = await readBody(req)

  let status: number
  let response: unknown
  try {
    ;({ status, body: response } = route(method, url.pathname, body, state))
  } catch (err) {
    status = 500
    response = { title: 'mock error', detail: String(err) }
  }

  if (!url.pathname.startsWith('/__')) {
    state.log.push({
      method,
      path: url.pathname,
      status,
      ...(body === undefined ? {} : { body }),
      ...(response === undefined ? {} : { response }),
      authorized: Boolean(req.headers.authorization)
    })
  }
  respond(res, status, response)
}

type RouteResult = { status: number; body: unknown }

/**
 * Routes one request. GitHub requests are matched by their REST paths and
 * Factory requests by the `/api/v0/...` paths used by `src/factory.ts`.
 */
function route(
  method: string,
  path: string,
  body: unknown,
  state: MockState
): RouteResult {
  const id = () => state.nextId++

  // --- Introspection ----------------------------------------------------------
  if (path === '/__log' && method === 'GET') {
    return { status: 200, body: { requests: state.log } }
  }
  if (path === '/__reset' && method === 'POST') {
    resetState(state)
    return { status: 200, body: {} }
  }

  // --- Factory API -----------------------------------------------------------
  if (path === '/api/v0/sessions') {
    if (method !== 'POST') return methodNotAllowed(method)
    const computerId = str(body, 'computerId')
    if (!computerId) return invalid('computerId is required')
    const session: MockSession = {
      sessionId: `sess-${id()}`,
      status: 'idle',
      computerId
    }
    state.sessions.set(session.sessionId, session)
    return { status: 201, body: session }
  }

  let m = path.match(/^\/api\/v0\/sessions\/([^/]+)$/)
  if (m) {
    if (method !== 'GET') return methodNotAllowed(method)
    const session = state.sessions.get(m[1])
    return session
      ? { status: 200, body: session }
      : notFound(`session ${m[1]}`)
  }

  m = path.match(/^\/api\/v0\/sessions\/([^/]+)\/messages$/)
  if (m) {
    if (method !== 'POST') return methodNotAllowed(method)
    const session = state.sessions.get(m[1])
    if (!session) return notFound(`session ${m[1]}`)
    return {
      status: 200,
      body: { messageId: `msg-${id()}`, status: 'pending' }
    }
  }

  m = path.match(/^\/api\/v0\/sessions\/([^/]+)\/interrupt$/)
  if (m) {
    if (method !== 'POST') return methodNotAllowed(method)
    const session = state.sessions.get(m[1])
    if (!session) return notFound(`session ${m[1]}`)
    session.status = 'idle'
    return { status: 200, body: {} }
  }

  m = path.match(/^\/api\/v0\/computers\/name\/([^/]+)$/)
  if (m && method === 'GET') {
    return m[1] === 'qa-mock-computer'
      ? { status: 200, body: computer('qa-mock-computer') }
      : notFound(`computer named ${m[1]}`)
  }

  m = path.match(/^\/api\/v0\/computers\/([^/]+)$/)
  if (m && method === 'GET') {
    return { status: 200, body: computer(m[1]) }
  }

  // --- GitHub API ------------------------------------------------------------
  if (path === '/user' && method === 'GET') {
    return {
      status: 200,
      body: { login: SELF_LOGIN, type: 'Bot' }
    }
  }

  m = path.match(
    /^\/repos\/([^/]+)\/([^/]+)\/collaborators\/([^/]+)\/permission$/
  )
  if (m && method === 'GET') {
    return {
      status: 200,
      body: { permission: 'write', user: { login: m[3] } }
    }
  }

  m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/)
  if (m) {
    const [owner, repo, number] = [m[1], m[2], m[3]]
    const key = `${owner}/${repo}#${number}`
    if (method === 'GET') {
      return { status: 200, body: state.comments.get(key) ?? [] }
    }
    if (method === 'POST') {
      const text = str(body, 'body')
      if (typeof text !== 'string') return invalid('body is required')
      const comment: Comment = {
        id: id(),
        body: text,
        user: { login: SELF_LOGIN, type: 'Bot' }
      }
      const list = state.comments.get(key) ?? []
      list.push(comment)
      state.comments.set(key, list)
      return { status: 201, body: comment }
    }
    return methodNotAllowed(method)
  }

  m = path.match(/^\/repos\/([^/]+)\/([^/]+)\/issues\/comments\/(\d+)$/)
  if (m && method === 'PATCH') {
    const text = str(body, 'body')
    if (typeof text !== 'string') return invalid('body is required')
    for (const comments of state.comments.values()) {
      const comment = comments.find((c) => String(c.id) === m![3])
      if (comment) {
        comment.body = text
        return { status: 200, body: comment }
      }
    }
    return notFound(`comment ${m[3]}`)
  }

  // Reactions: on issue comments, review comments and issues.
  m = path.match(
    /^\/repos\/([^/]+)\/([^/]+)\/(issues\/(?:comments\/\d+|\d+)|pulls\/comments\/\d+)\/reactions$/
  )
  if (m && method === 'POST') {
    return {
      status: 201,
      body: { id: id(), content: 'eyes', user: { login: SELF_LOGIN } }
    }
  }

  return notFound(`no mock for ${method} ${path}`)
}

function computer(computerId: string): unknown {
  return {
    id: computerId,
    name: 'qa-mock-computer',
    status: 'active',
    clonedRepoDirectories: [MOCK_CLONE_DIR]
  }
}

function str(body: unknown, key: string): string | undefined {
  if (!body || typeof body !== 'object') return undefined
  const value = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function notFound(detail: string): RouteResult {
  return {
    status: 404,
    body: { message: 'Not Found', title: 'Not Found', detail }
  }
}

function invalid(detail: string): RouteResult {
  return { status: 422, body: { title: 'Validation Error', detail } }
}

function methodNotAllowed(method: string): RouteResult {
  return { status: 405, body: { title: 'Method Not Allowed', detail: method } }
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  if (body === undefined) {
    res.statusCode = status
    res.end()
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(raw)
      }
    })
    req.on('error', reject)
  })
}

if (import.meta.main) {
  const port =
    Number(process.env.PORT) || Number(process.argv[2]) || DEFAULT_PORT
  const api = await startMockServer(port)
  console.log(`Mock APIs listening on ${api.url}`)
  console.log(`  GitHub:  ${api.url}/repos/{owner}/{repo}/...`)
  console.log(`           -> set GITHUB_API_URL=${api.url}`)
  console.log(`  Factory: ${api.url}/api/v0/...`)
  console.log(`           -> set INPUT_FACTORY-API-URL=${api.url}`)
  console.log(`  Log:     GET ${api.url}/__log   POST ${api.url}/__reset`)
}
