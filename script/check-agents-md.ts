/**
 * Fails when AGENTS.md names a file, directory or package.json script that
 * does not exist, or leaves a module under src/ out of the project layout.
 * The rules are in script/lib/agents-md.ts.
 *
 * Usage: bun script/check-agents-md.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { checkAgentsMd } from './lib/agents-md.js'
import { trackedFiles } from './lib/tracked-files.js'

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>
}
const problems = checkAgentsMd(readFileSync('AGENTS.md', 'utf8'), {
  files: trackedFiles().filter((path) => existsSync(path)),
  scripts: Object.keys(pkg.scripts ?? {})
})

if (problems.length > 0) {
  console.error(
    `AGENTS.md is out of date (${problems.length} problem(s)):\n` +
      problems
        .map(
          (p) => `  ${p.line > 0 ? `AGENTS.md:${p.line}: ` : ''}${p.message}`
        )
        .join('\n')
  )
  console.error(
    '\nUpdate AGENTS.md to match the repository (or the repository to match it).'
  )
  process.exit(1)
}
console.log('AGENTS.md OK: every named path and script exists.')
