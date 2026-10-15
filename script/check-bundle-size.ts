/**
 * Fails when the shipped bundle, dist/index.js, outgrows its byte budget, and
 * reports which packages make up the bundle so heavy dependencies stand out.
 * Run `bun run package` first; the bundle is read, never rewritten. In GitHub
 * Actions the report also goes to the job summary.
 *
 * Usage: bun script/check-bundle-size.ts
 */
import { appendFileSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BUNDLE = 'dist/index.js'

/**
 * About 14% above the 965,918 bytes the bundle measured when this budget was
 * set. Raise it deliberately, in the same change that explains the growth.
 */
const BUDGET_BYTES = 1_100_000

const TOP = 10

const bundleBytes = statSync(BUNDLE).size
const packages = await packageSizes()
const rows = packages
  .slice(0, TOP)
  .map(
    ([name, bytes]) =>
      `| ${name} | ${kib(bytes)} | ${percent(bytes, bundleBytes)} |`
  )
const status = bundleBytes <= BUDGET_BYTES ? 'within' : 'OVER'
const heading = `Bundle size: ${BUNDLE} is ${kib(bundleBytes)}, ${status} the ${kib(BUDGET_BYTES)} budget (${percent(bundleBytes, BUDGET_BYTES)})`
const report = [
  heading,
  '',
  `Largest contributors (top ${TOP} of ${packages.length}):`,
  '',
  '| Package | Bytes in bundle | Share |',
  '| --- | ---: | ---: |',
  ...rows
].join('\n')

console.log(report)
const summaryPath = process.env.GITHUB_STEP_SUMMARY
if (summaryPath) appendFileSync(summaryPath, `### ${report}\n\n`)

if (bundleBytes > BUDGET_BYTES) {
  console.error(
    `\n${BUNDLE} exceeds its budget by ${kib(bundleBytes - BUDGET_BYTES)}. Drop or replace the heavy dependency, or raise BUDGET_BYTES in script/check-bundle-size.ts with a reason.`
  )
  process.exit(1)
}

/**
 * Bytes each package contributes, from the metafile of a throwaway build with
 * the same options as `bun run package`, written outside dist/.
 */
async function packageSizes(): Promise<[string, number][]> {
  const outdir = mkdtempSync(join(tmpdir(), 'factory-action-bundle-'))
  try {
    const build = await Bun.build({
      entrypoints: ['src/index.ts'],
      target: 'node',
      format: 'esm',
      sourcemap: 'linked',
      outdir,
      metafile: true
    })
    if (!build.success || !build.metafile) {
      throw new Error(`Build failed:\n${build.logs.join('\n')}`)
    }
    const sizes = new Map<string, number>()
    for (const output of Object.values(build.metafile.outputs)) {
      for (const [input, { bytesInOutput }] of Object.entries(output.inputs)) {
        const name = packageOf(input)
        sizes.set(name, (sizes.get(name) ?? 0) + bytesInOutput)
      }
    }
    return [...sizes].sort((a, b) => b[1] - a[1])
  } finally {
    rmSync(outdir, { recursive: true, force: true })
  }
}

/** The innermost node_modules package of a path, or first-party source. */
function packageOf(input: string): string {
  const parts = input.split('/')
  const at = parts.lastIndexOf('node_modules')
  if (at === -1) return '(first-party src/)'
  const name = parts[at + 1]
  return name.startsWith('@') ? `${name}/${parts[at + 2]}` : name
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function percent(part: number, whole: number): string {
  return `${((part / whole) * 100).toFixed(1)}%`
}
