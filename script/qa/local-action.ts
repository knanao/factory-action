/**
 * Runs the action locally through @github/local-action, the same way the raw
 * CLI would, with two fixes that make it reliable under Bun:
 *
 * 1. Bun's script runner prepends a temporary directory (matching
 *    `bun-node-*`) containing a `node` shim (bun itself) to PATH.
 *    local-action's toolchain (`npm exec` → `tsx` → node → module stubbing)
 *    then runs under bun, where its stubbing of `@actions/*` stalls forever.
 *    The wrapper filters those shim directories out of PATH, so the real
 *    node/npm chain is used.
 * 2. local-action's `@actions/github` stub captures `GITHUB_API_URL` when its
 *    modules load — before the dotenv file is applied — so a mock API URL
 *    that only lives in `.env` is ignored. The wrapper reads it from the
 *    dotenv file and puts it into the environment when it is missing.
 *
 * Usage: `bun run local-action [dotenv-file]` (defaults to `.env`).
 */

import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')
const dotenvFile = process.argv[2] ?? '.env'
const dotenvPath = path.resolve(ROOT, dotenvFile)

if (!existsSync(dotenvPath)) {
  console.error(
    `Environment file '${dotenvFile}' not found. Copy the template first:\n` +
      '  cp .env.example .env'
  )
  process.exit(1)
}

const PATH_ENV = (process.env.PATH ?? '')
  .split(path.delimiter)
  .filter((dir) => dir !== '' && !/bun-node-/.test(dir))
  .join(path.delimiter)

const env: NodeJS.ProcessEnv = { ...process.env, PATH: PATH_ENV }
if (!process.env.GITHUB_API_URL) {
  const match = readFileSync(dotenvPath, 'utf8').match(
    /^\s*GITHUB_API_URL=(\S+)\s*$/m
  )
  if (match) env.GITHUB_API_URL = match[1]
}

const bin = path.join(ROOT, 'node_modules', '.bin', 'local-action')
if (!existsSync(bin)) {
  console.error(`${bin} not found. Run 'bun install' first.`)
  process.exit(1)
}

const child = spawn('node', [bin, '.', 'src/main.ts', dotenvFile], {
  stdio: 'inherit',
  cwd: ROOT,
  env
})

child.on('error', (err) => {
  console.error(err)
  process.exit(1)
})
child.on('close', (code) => process.exit(code ?? 1))
