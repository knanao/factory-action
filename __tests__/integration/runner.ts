/**
 * Builds the action bundle and runs it as a subprocess, the way a GitHub
 * runner would: a webhook payload file for the event, INPUT_* variables for
 * the inputs and output/summary files for the results. The bundle is built
 * with the same flags as `bun run package`, so the tests always exercise the
 * code that will actually ship to dist/.
 */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const REPO_ROOT = path.join(import.meta.dir, '..', '..')

const DEFAULT_INPUTS: Record<string, string> = {
  'factory-api-key': 'fk-test',
  'computer-id': 'comp-1',
  'github-token': 'gh-test'
}

/** Environment the child must not inherit (it would shadow the test setup). */
const STRIP_ENV = [/^GITHUB_/, /^INPUT_/, /^RUNNER_/, /proxy/i, /^TRACEPARENT$/]

let bundleEntry: string | undefined
const tempDirs: string[] = []

export interface ActionRunOptions {
  eventName: string
  payload: unknown
  /** Action inputs by their action.yml name, e.g. mode, computer-id. */
  inputs?: Record<string, string>
  githubUrl: string
  factoryUrl: string
  /** Extra environment for the step, e.g. TRACEPARENT. */
  env?: Record<string, string>
}

export interface ActionRun {
  exitCode: number | null
  stdout: string
  stderr: string
  /** Values the action wrote to $GITHUB_OUTPUT. */
  outputs: Record<string, string>
  /** Job summary written to $GITHUB_STEP_SUMMARY. */
  summary: string
}

/** Builds the bundle once per test run and returns its entry file. */
export async function buildAction(): Promise<string> {
  if (bundleEntry) return bundleEntry
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-action-it-'))
  tempDirs.push(outDir)
  const build = Bun.spawn(
    [
      process.execPath,
      'build',
      path.join(REPO_ROOT, 'src', 'index.ts'),
      '--target=node',
      '--format=esm',
      '--sourcemap=linked',
      `--outdir=${outDir}`
    ],
    { cwd: REPO_ROOT, stdout: 'pipe', stderr: 'pipe' }
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    build.exited,
    new Response(build.stdout).text(),
    new Response(build.stderr).text()
  ])
  if (exitCode !== 0) {
    throw new Error(`bun build failed (${exitCode}): ${stderr || stdout}`)
  }
  bundleEntry = path.join(outDir, 'index.js')
  return bundleEntry
}

export async function runAction(opts: ActionRunOptions): Promise<ActionRun> {
  const entry = await buildAction()
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'factory-action-run-'))
  tempDirs.push(workDir)
  const eventPath = path.join(workDir, 'event.json')
  const outputPath = path.join(workDir, 'outputs.txt')
  const summaryPath = path.join(workDir, 'summary.md')
  fs.writeFileSync(eventPath, JSON.stringify(opts.payload))
  // @actions/core appends to these and fails when they do not exist.
  fs.writeFileSync(outputPath, '')
  fs.writeFileSync(summaryPath, '')

  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(process.env)) {
    if (typeof value !== 'string') continue
    if (STRIP_ENV.some((re) => re.test(name))) continue
    env[name] = value
  }
  Object.assign(env, {
    GITHUB_ACTIONS: 'true',
    GITHUB_REPOSITORY: 'acme/widgets',
    GITHUB_EVENT_NAME: opts.eventName,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_API_URL: opts.githubUrl,
    GITHUB_GRAPHQL_URL: `${opts.githubUrl}/graphql`,
    GITHUB_SERVER_URL: 'https://github.test',
    GITHUB_RUN_ID: '12345',
    GITHUB_RUN_NUMBER: '1',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_WORKFLOW: 'integration-test',
    GITHUB_JOB: 'test',
    GITHUB_ACTION: '__factory-action-it',
    GITHUB_SHA: 'head000',
    GITHUB_REF: 'refs/heads/main',
    GITHUB_WORKSPACE: workDir,
    RUNNER_TEMP: workDir,
    GITHUB_OUTPUT: outputPath,
    GITHUB_STEP_SUMMARY: summaryPath,
    ...opts.env
  })
  const inputs = {
    ...DEFAULT_INPUTS,
    'factory-api-url': opts.factoryUrl,
    ...opts.inputs
  }
  // The action requires exactly one of computer-id and environment-id, so
  // environment-mode runs opt out of the computer-id default.
  if (inputs['environment-id'] && !opts.inputs?.['computer-id']) {
    delete inputs['computer-id']
  }
  for (const [name, value] of Object.entries(inputs)) {
    env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = value
  }

  const proc = Bun.spawn([process.execPath, entry], {
    cwd: REPO_ROOT,
    env,
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const guard = setTimeout(() => proc.kill(), 30_000)
  const [exitCode, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text()
  ])
  clearTimeout(guard)

  return {
    exitCode,
    stdout,
    stderr,
    outputs: parseOutputs(fs.readFileSync(outputPath, 'utf8')),
    summary: fs.readFileSync(summaryPath, 'utf8')
  }
}

/** Removes every temporary directory the runner created. */
export function cleanupRunner(): void {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop() as string, { recursive: true, force: true })
  }
  bundleEntry = undefined
}

/**
 * Parses the $GITHUB_OUTPUT format: one `key=value` line, or a
 * `key<<delimiter` block when the value can span several lines.
 */
function parseOutputs(content: string): Record<string, string> {
  const outputs: Record<string, string> = {}
  const lines = content.split('\n')
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    i += 1
    if (!line) continue
    const block = /^(.+?)<<(.+)$/.exec(line)
    if (block) {
      const [, key, delimiter] = block
      const value: string[] = []
      while (i < lines.length && lines[i] !== delimiter) {
        value.push(lines[i])
        i += 1
      }
      i += 1 // closing delimiter
      outputs[key] = value.join('\n')
    } else {
      const eq = line.indexOf('=')
      if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1)
    }
  }
  return outputs
}
