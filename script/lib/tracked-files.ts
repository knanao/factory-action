import { readFileSync } from 'node:fs'

/** Paths git tracks, including newly staged files. */
export function trackedFiles(): string[] {
  const result = Bun.spawnSync(['git', 'ls-files', '-z'])
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.toString()}`)
  }
  return result.stdout.toString().split('\0').filter(Boolean)
}

/** Undefined for paths deleted from the working tree but not yet unstaged. */
export function readTracked(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}
