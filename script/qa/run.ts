/**
 * Runs the action once, the way a GitHub runner would, against the mock API in
 * `mock-api.ts`, and prints its log and outputs.
 *
 *   bun run qa:run <event-file> [input=value ...] [--src]
 *
 * The event name is the file name up to the first dot, so
 * `script/qa/events/issue_comment.mention.json` is sent as `issue_comment`.
 * Inputs default to values the mock accepts; override any of them with
 * `input=value` (e.g. `mode=review`). By default the committed `dist/index.js`
 * runs on Node, exactly as on GitHub; `--src` runs `src/index.ts` with Bun.
 *
 * Exits non-zero when the action fails (`core.setFailed`).
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

const args = process.argv.slice(2)
const useSrc = args.includes('--src')
const [eventFile, ...overrides] = args.filter((a) => a !== '--src')
if (!eventFile) {
  console.error('usage: bun run qa:run <event-file> [input=value ...] [--src]')
  process.exit(2)
}

const port = process.env.QA_PORT ?? '4010'
const mockUrl = `http://127.0.0.1:${port}`

try {
  await fetch(`${mockUrl}/__qa/health`)
} catch {
  console.error(`Mock API is not reachable at ${mockUrl}. Run: bun run qa:mock`)
  process.exit(2)
}

const eventPath = resolve(eventFile)
const eventName = basename(eventPath).split('.')[0]
const payload = JSON.parse(readFileSync(eventPath, 'utf8')) as {
  repository?: { full_name?: string }
}

const inputs: Record<string, string> = {
  'factory-api-key': process.env.QA_FACTORY_API_KEY ?? 'qa-factory-key',
  'computer-id': 'qa-computer',
  'github-token': 'qa-github-token',
  'factory-api-url': mockUrl,
  'message-timeout-ms': '5000'
}
for (const o of overrides) {
  const i = o.indexOf('=')
  if (i <= 0) {
    console.error(`Expected input=value, got '${o}'`)
    process.exit(2)
  }
  inputs[o.slice(0, i)] = o.slice(i + 1)
}

const dir = mkdtempSync(join(tmpdir(), 'factory-action-qa-'))
const outputFile = join(dir, 'output')
const summaryFile = join(dir, 'summary.md')
writeFileSync(outputFile, '')
writeFileSync(summaryFile, '')

const env: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  HOME: process.env.HOME ?? '',
  GITHUB_ACTIONS: 'true',
  GITHUB_EVENT_NAME: eventName,
  GITHUB_EVENT_PATH: eventPath,
  GITHUB_REPOSITORY: payload.repository?.full_name ?? 'acme/widgets',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_API_URL: mockUrl,
  GITHUB_RUN_ID: '1',
  GITHUB_OUTPUT: outputFile,
  GITHUB_STEP_SUMMARY: summaryFile
}
for (const [name, value] of Object.entries(inputs)) {
  // Same mapping as core.getInput: spaces to underscores, upper-cased.
  env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = value
}

const cmd = useSrc ? ['bun', 'src/index.ts'] : ['node', 'dist/index.js']
console.log(`$ ${cmd.join(' ')}  (event: ${eventName}, ${eventFile})\n`)
const proc = Bun.spawnSync(cmd, {
  cwd: resolve(import.meta.dir, '../..'),
  env,
  stdout: 'inherit',
  stderr: 'inherit'
})

console.log('\n--- outputs ---')
console.log(
  JSON.stringify(parseOutputs(readFileSync(outputFile, 'utf8')), null, 2)
)
const summary = readFileSync(summaryFile, 'utf8').trim()
if (summary) console.log(`--- job summary ---\n${summary}`)

process.exit(proc.exitCode ?? 1)

/** Parses the `name<<delimiter` blocks that core.setOutput writes. */
function parseOutputs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(.+?)<<(.+)$/)
    if (!m) continue
    const value: string[] = []
    while (++i < lines.length && lines[i] !== m[2]) value.push(lines[i])
    out[m[1]] = value.join('\n')
  }
  return out
}
