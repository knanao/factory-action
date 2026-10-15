/**
 * Fails when a file tracked by git (including newly staged ones) is larger
 * than its byte budget, so logs, archives or generated output do not slip into
 * the repository by accident.
 *
 * Usage: bun script/check-file-size.ts
 */
import { statSync } from 'node:fs'
import { trackedFiles } from './lib/tracked-files.js'

const KIB = 1024

/** The budget for any tracked file without a budget of its own. */
const DEFAULT_BUDGET = 100 * KIB

/** Exact paths with their own budget. */
const BUDGETS = new Map<string, number>([
  // The lockfile grows with the dependency tree; about 140 KiB today.
  ['bun.lock', 256 * KIB]
])

/**
 * Generated output with a check of its own: script/check-bundle-size.ts
 * budgets dist/index.js, and the source map is derived from it.
 */
const EXCLUDED_PREFIXES = ['dist/']

const files = trackedFiles()
const oversized: string[] = []
let largest = { path: '', bytes: 0 }
let checked = 0
for (const path of files) {
  if (EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix))) continue
  const bytes = sizeOf(path)
  if (bytes === undefined) continue
  checked++
  if (bytes > largest.bytes) largest = { path, bytes }
  const budget = BUDGETS.get(path) ?? DEFAULT_BUDGET
  if (bytes > budget) {
    oversized.push(`  ${path}: ${kib(bytes)} (budget ${kib(budget)})`)
  }
}

if (oversized.length > 0) {
  console.error(
    `Files over their size budget (default ${kib(DEFAULT_BUDGET)}):\n${oversized.join('\n')}`
  )
  console.error(
    'Keep large or generated files out of git, or give a file an explicit budget in script/check-file-size.ts.'
  )
  process.exit(1)
}
console.log(
  `File sizes OK: ${checked} tracked files within budget (largest: ${largest.path}, ${kib(largest.bytes)}).`
)

/** Undefined for paths deleted from the working tree but not yet unstaged. */
function sizeOf(path: string): number | undefined {
  try {
    const stat = statSync(path)
    return stat.isFile() ? stat.size : undefined
  } catch {
    return undefined
  }
}

function kib(bytes: number): string {
  return `${(bytes / KIB).toFixed(1)} KiB`
}
