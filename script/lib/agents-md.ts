import { basename } from 'node:path'

/**
 * Checks the references in AGENTS.md against the repository, so the agents'
 * operating brief does not drift from the code: every file or directory path
 * and every `bun run <script>` in a code span must exist, and every module
 * under `src/` must be named (by path, file name or a parent directory such
 * as `prompts/`).
 */
export interface RepoFacts {
  /** Tracked files that exist in the working tree. */
  files: string[]
  /** Names of the package.json scripts. */
  scripts: string[]
}

export interface Problem {
  /** 1-based line in AGENTS.md; 0 for problems that have no line. */
  line: number
  message: string
}

/**
 * Code spans with a slash that are not repository paths, such as the
 * fictional `owner/repo` used in fixtures.
 */
const NOT_PATHS = new Set(['acme/widgets'])

/** Paths that exist in a checkout but are not tracked. */
const UNTRACKED_PREFIXES = ['.git/']

const CODE_SPAN = /`([^`\n]+)`/g
const BUN_RUN = /\bbun run (?:--[\w-]+ )*([\w:.-]+)/g
const PATH_TOKEN = /^\.?[\w-][\w.-]*(?:\/[\w.-]+)*\/?$/

export function checkAgentsMd(text: string, facts: RepoFacts): Problem[] {
  const paths = new Set([...facts.files, ...directoriesOf(facts.files)])
  const scripts = new Set(facts.scripts)
  const mentioned = new Set<string>()
  const problems: Problem[] = []

  text.split('\n').forEach((lineText, index) => {
    const line = index + 1
    for (const [, span] of lineText.matchAll(CODE_SPAN)) {
      for (const [, script] of span.matchAll(BUN_RUN)) {
        if (!scripts.has(script)) {
          problems.push({ line, message: `no package.json script "${script}"` })
        }
      }
      if (!isPath(span)) continue
      mentioned.add(span)
      if (!resolves(span, paths)) {
        problems.push({ line, message: `no file or directory "${span}"` })
      }
    }
  })

  for (const file of facts.files) {
    if (isSourceModule(file) && !isMentioned(file, mentioned)) {
      problems.push({
        line: 0,
        message: `${file} is not described in the project layout`
      })
    }
  }
  return problems
}

function isPath(span: string): boolean {
  // Versions and version patterns such as `v0.3.0` or `vX.Y.Z`.
  const isVersion = /^v?[\dX]+\./.test(span)
  if (NOT_PATHS.has(span) || !PATH_TOKEN.test(span) || isVersion) {
    return false
  }
  if (UNTRACKED_PREFIXES.some((prefix) => span.startsWith(prefix))) {
    return false
  }
  return span.includes('/') || span.startsWith('.') || /\.[a-z]+$/i.test(span)
}

/** Exact paths from the root, or a unique-enough suffix such as `main.ts`. */
function resolves(span: string, paths: Set<string>): boolean {
  const target = span.endsWith('/') ? span : span.replace(/\/$/, '')
  if (paths.has(target)) return true
  for (const path of paths) {
    if (path.endsWith(`/${target}`)) return true
  }
  return false
}

function directoriesOf(files: string[]): Set<string> {
  const dirs = new Set<string>()
  for (const file of files) {
    const parts = file.split('/')
    for (let i = 1; i < parts.length; i++) {
      dirs.add(`${parts.slice(0, i).join('/')}/`)
    }
  }
  return dirs
}

function isSourceModule(file: string): boolean {
  return file.startsWith('src/') && file.endsWith('.ts')
}

function isMentioned(file: string, mentioned: Set<string>): boolean {
  if (mentioned.has(file) || mentioned.has(basename(file))) return true
  // A parent directory below src/ (`src/prompts/` or `prompts/`) covers its
  // files; src/ itself does not.
  const parts = file.split('/')
  for (let i = 2; i < parts.length; i++) {
    const dir = parts.slice(1, i).join('/')
    if (mentioned.has(`src/${dir}/`) || mentioned.has(`${dir}/`)) return true
  }
  return false
}
