/**
 * Real HTTP stubs for the two services the action talks to in production: the
 * GitHub REST API (through Octokit) and the Factory Sessions API (through
 * fetch). Unlike the unit-test fixtures nothing is mocked at module level; the
 * bundled action runs as its own process and makes real requests to these
 * servers over real sockets, so the integration tests cover the full network
 * path, including authentication headers, pagination and error handling.
 */

import type { SessionStatus } from '../../src/factory.js'

export interface RecordedRequest {
  method: string
  path: string
  headers: Record<string, string>
  body?: unknown
}

interface Route {
  method: string
  pattern: RegExp
  handle: (
    params: string[],
    body: unknown,
    search: URLSearchParams
  ) => Response | undefined
}

async function readBody(req: Request): Promise<unknown> {
  const text = await req.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** A localhost HTTP server that records every request it receives. */
class RecordingServer {
  readonly requests: RecordedRequest[] = []
  private server: Bun.Server | undefined

  get url(): string {
    if (!this.server) throw new Error('stub server is not started')
    return `http://127.0.0.1:${this.server.port}`
  }

  async start(routes: Route[]): Promise<void> {
    this.server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: async (req) => {
        const url = new URL(req.url)
        const body = await readBody(req)
        this.requests.push({
          method: req.method,
          path: url.pathname + url.search,
          headers: {
            authorization: req.headers.get('authorization') ?? '',
            accept: req.headers.get('accept') ?? '',
            'content-type': req.headers.get('content-type') ?? '',
            traceparent: req.headers.get('traceparent') ?? ''
          },
          body
        })
        for (const route of routes) {
          if (route.method !== req.method) continue
          const match = url.pathname.match(route.pattern)
          if (!match) continue
          const response = route.handle(match.slice(1), body, url.searchParams)
          if (response) return response
        }
        return Response.json(
          { message: `no stub route for ${req.method} ${url.pathname}` },
          { status: 404 }
        )
      }
    })
  }

  async stop(): Promise<void> {
    if (this.server) await this.server.stop(true)
    this.server = undefined
  }

  sent(method: string, path: string): RecordedRequest[] {
    return this.requests.filter((r) => r.method === method && r.path === path)
  }
}

export interface StubComment {
  id: number
  body: string
  user: { login: string }
}

/**
 * Emulates the handful of GitHub endpoints the action uses. Comments created
 * here are visible to later runs, which is how the tracking comment survives
 * from one run to the next.
 */
export class GitHubStub extends RecordingServer {
  /** The identity behind the token, used to find the action's own comments. */
  selfLogin = 'factory-action-bot'
  /** Collaborator permission by login, used by the authorization fallback. */
  readonly permissions: Record<string, string> = {}
  readonly issueComments = new Map<number, StubComment[]>()
  private nextCommentId = 5000
  private nextReactionId = 9000

  async start(): Promise<void> {
    await super.start([
      {
        method: 'GET',
        pattern: /^\/user$/,
        handle: () => Response.json({ login: this.selfLogin, type: 'Bot' })
      },
      {
        method: 'GET',
        pattern:
          /^\/repos\/([^/]+)\/([^/]+)\/collaborators\/([^/]+)\/permission$/,
        handle: ([login]) =>
          Response.json({ permission: this.permissions[login] ?? 'none' })
      },
      {
        method: 'GET',
        pattern: /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/,
        handle: ([number], _body, search) => {
          const comments = this.issueComments.get(Number(number)) ?? []
          // Octokit paginates through the Link header; with fewer comments
          // than per_page a single response ends the pagination.
          const page = Number(search.get('page') ?? 1)
          const perPage = Number(search.get('per_page') ?? 30)
          return Response.json(
            comments.slice((page - 1) * perPage, page * perPage)
          )
        }
      },
      {
        method: 'POST',
        pattern: /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/comments$/,
        handle: ([number], body) => {
          const comment: StubComment = {
            id: ++this.nextCommentId,
            body: readField(body, 'body') ?? '',
            user: { login: this.selfLogin }
          }
          const key = Number(number)
          const comments = this.issueComments.get(key) ?? []
          comments.push(comment)
          this.issueComments.set(key, comments)
          return Response.json(comment, { status: 201 })
        }
      },
      {
        method: 'PATCH',
        pattern: /^\/repos\/([^/]+)\/([^/]+)\/issues\/comments\/(\d+)$/,
        handle: ([id], body) => {
          const comment = this.findComment(Number(id))
          if (!comment) return notFound()
          comment.body = readField(body, 'body') ?? ''
          return Response.json(comment)
        }
      },
      {
        method: 'POST',
        pattern:
          /^\/repos\/([^/]+)\/([^/]+)\/issues\/comments\/(\d+)\/reactions$/,
        handle: (_params, body) =>
          this.addReaction(readField(body, 'content') ?? null)
      },
      {
        method: 'POST',
        pattern:
          /^\/repos\/([^/]+)\/([^/]+)\/pulls\/\d+\/comments\/(\d+)\/reactions$/,
        handle: (_params, body) =>
          this.addReaction(readField(body, 'content') ?? null)
      },
      {
        method: 'POST',
        pattern: /^\/repos\/([^/]+)\/([^/]+)\/issues\/(\d+)\/reactions$/,
        handle: (_params, body) =>
          this.addReaction(readField(body, 'content') ?? null)
      }
    ])
  }

  private findComment(id: number): StubComment | undefined {
    for (const comments of this.issueComments.values()) {
      const found = comments.find((c) => c.id === id)
      if (found) return found
    }
    return undefined
  }

  private addReaction(content: string | null): Response {
    return Response.json(
      { id: ++this.nextReactionId, content },
      { status: 201 }
    )
  }
}

function notFound(): Response {
  return Response.json(
    { message: 'Not Found' },
    { status: 404, headers: { 'content-type': 'application/json' } }
  )
}

function readField(body: unknown, field: string): string | undefined {
  const value = (body as Record<string, unknown> | undefined)?.[field]
  return typeof value === 'string' ? value : undefined
}

export interface StubSession {
  sessionId: string
  status: SessionStatus
  computerId: string
}

export interface StubComputer {
  id: string
  name: string
  status: 'provisioning' | 'active' | 'error'
  isListed?: boolean | null
  clonedRepoDirectories?: string[]
  computerSource?: { kind: string; templateId?: string } | null
}

/** Emulates the Factory Sessions API endpoints the action uses. */
export class FactoryStub extends RecordingServer {
  readonly sessions = new Map<string, StubSession>()
  /** sessionId → every message text posted to it, in order. */
  readonly messages = new Map<string, string[]>()
  /** Bodies of the POST /api/v0/sessions requests. */
  readonly createdSessions: Record<string, unknown>[] = []
  /** Bodies of the POST /api/v0/computers requests (Environment mode). */
  readonly createdComputers: Record<string, unknown>[] = []
  /** The one computer the tests run on when they set computer-id. */
  readonly computer = {
    id: 'comp-1',
    name: 'droid-01',
    status: 'active' as const,
    clonedRepoDirectories: ['/home/factory-user/projects/widgets']
  }
  /** Clone directory reported by computers created from an Environment. */
  environmentDirectory = '/home/droid/widgets'
  /** Computers created from an Environment, by id. */
  readonly computers = new Map<string, StubComputer>()
  /** When set, POST /api/v0/sessions always answers with this failure. */
  createFailure?: { status: number; title: string; detail: string }
  /** One-off failures handed to the next POST /messages requests. */
  readonly messageFailures: number[] = []
  private nextSession = 0
  private nextComputer = 0
  private nextMessageId = 0

  async start(): Promise<void> {
    await super.start([
      {
        method: 'GET',
        pattern: /^\/api\/v0\/computers\/name\/([^/]+)$/,
        handle: ([name]) => {
          const computer = this.findByName(decodeURIComponent(name))
          return computer ? Response.json(computer) : notFound()
        }
      },
      {
        method: 'GET',
        pattern: /^\/api\/v0\/computers\/([^/]+)$/,
        handle: ([id]) => {
          const computer = this.findById(decodeURIComponent(id))
          return computer ? Response.json(computer) : notFound()
        }
      },
      {
        method: 'GET',
        pattern: /^\/api\/v0\/computers$/,
        handle: () => Response.json({ computers: [...this.computers.values()] })
      },
      {
        method: 'POST',
        pattern: /^\/api\/v0\/computers$/,
        handle: (_params, body) => {
          const request = body as {
            name?: string
            source?: { environmentId?: string }
          }
          this.createdComputers.push(request as Record<string, unknown>)
          const computer: StubComputer = {
            id: `comp-env-${++this.nextComputer}`,
            name: request.name ?? '',
            status: 'active',
            isListed: false,
            clonedRepoDirectories: [this.environmentDirectory],
            computerSource: {
              kind: 'template',
              templateId: request.source?.environmentId
            }
          }
          this.computers.set(computer.id, computer)
          return Response.json(computer, { status: 201 })
        }
      },
      {
        method: 'DELETE',
        pattern: /^\/api\/v0\/computers\/([^/]+)$/,
        handle: ([id]) => {
          if (!this.computers.delete(decodeURIComponent(id))) return notFound()
          return new Response(null, { status: 204 })
        }
      },
      {
        method: 'POST',
        pattern: /^\/api\/v0\/sessions$/,
        handle: (_params, body) => {
          if (this.createFailure) {
            const { status, title, detail } = this.createFailure
            return Response.json({ status, title, detail }, { status })
          }
          const request = body as Record<string, unknown>
          this.createdSessions.push(request)
          const session: StubSession = {
            sessionId: `sess-${++this.nextSession}`,
            status: 'pending',
            computerId: String(request.computerId ?? '')
          }
          this.sessions.set(session.sessionId, session)
          return Response.json(session, { status: 201 })
        }
      },
      {
        method: 'GET',
        pattern: /^\/api\/v0\/sessions\/([^/]+)$/,
        handle: ([id]) => {
          const session = this.sessions.get(decodeURIComponent(id))
          return session
            ? Response.json(session)
            : Response.json(
                { status: 404, title: 'Not Found', detail: 'no such session' },
                { status: 404 }
              )
        }
      },
      {
        method: 'POST',
        pattern: /^\/api\/v0\/sessions\/([^/]+)\/interrupt$/,
        handle: ([id]) => {
          const session = this.sessions.get(decodeURIComponent(id))
          if (!session) return notFound()
          session.status = 'idle'
          return new Response(null, { status: 204 })
        }
      },
      {
        method: 'POST',
        pattern: /^\/api\/v0\/sessions\/([^/]+)\/messages$/,
        handle: ([id], body) => {
          const sessionId = decodeURIComponent(id)
          const session = this.sessions.get(sessionId)
          if (!session) return notFound()
          if (this.messageFailures.length > 0) {
            const status = this.messageFailures.shift() as number
            return Response.json(
              { status, title: 'Service Unavailable', detail: 'try again' },
              { status }
            )
          }
          const texts = this.messages.get(sessionId) ?? []
          texts.push(String(readField(body, 'text') ?? ''))
          this.messages.set(sessionId, texts)
          session.status = 'running'
          return Response.json(
            { messageId: `msg-${++this.nextMessageId}`, status: 'running' },
            { status: 201 }
          )
        }
      }
    ])
  }

  private findByName(name: string): StubComputer | undefined {
    for (const computer of this.computers.values()) {
      if (computer.name === name) return computer
    }
    return name === this.computer.name ? { ...this.computer } : undefined
  }

  private findById(id: string): StubComputer | undefined {
    const found = this.computers.get(id)
    return found ?? (id === this.computer.id ? { ...this.computer } : undefined)
  }
}
