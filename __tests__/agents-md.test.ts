import { describe, expect, it } from 'bun:test'
import { checkAgentsMd, type RepoFacts } from '../script/lib/agents-md.js'

const FACTS: RepoFacts = {
  files: [
    'AGENTS.md',
    '.bun-version',
    '.github/workflows/ci.yml',
    '.github/ISSUE_TEMPLATE/bug_report.yml',
    'script/check-todos.ts',
    'src/index.ts',
    'src/main.ts',
    'src/prompts/review.ts'
  ],
  scripts: ['lint', 'check:static', 'typecheck']
}

const LAYOUT = '`src/index.ts`, `main.ts` and `src/prompts/`'

function check(text: string, facts: RepoFacts = FACTS) {
  return checkAgentsMd(`${LAYOUT}\n${text}`, facts)
}

describe('checkAgentsMd', () => {
  it('accepts paths, suffixes, directories and scripts that exist', () => {
    expect(
      check(
        [
          'Run `bun run lint` and `bun run --silent check:static`.',
          'See `.github/workflows/ci.yml`, `ci.yml`, `ISSUE_TEMPLATE/`,',
          '`script/check-todos.ts`, `.bun-version` and `src/`.'
        ].join('\n')
      )
    ).toEqual([])
  })

  it('reports a missing path with its line', () => {
    expect(check('ok\nSee `script/release` and `gone.yml`.')).toEqual([
      { line: 3, message: 'no file or directory "script/release"' },
      { line: 3, message: 'no file or directory "gone.yml"' }
    ])
  })

  it('reports a script that package.json does not define', () => {
    expect(check('Run `bun run lint && bun run check:gone`.')).toEqual([
      { line: 2, message: 'no package.json script "check:gone"' }
    ])
  })

  it('ignores spans that are not paths', () => {
    expect(
      check(
        [
          '`@actions/core`, `acme/widgets`, `vX.Y.Z`, `v0.3.0`, `0.9`,',
          '`git commit --no-verify`, `node24`, `INPUT_MODE`, `script/*.ts`,',
          '`.git/hooks` and `<!-- factory-droid -->`.'
        ].join('\n')
      )
    ).toEqual([])
  })

  it('reports a module under src/ that the layout leaves out', () => {
    const facts = { ...FACTS, files: [...FACTS.files, 'src/trace.ts'] }
    expect(check('', facts)).toEqual([
      {
        line: 0,
        message: 'src/trace.ts is not described in the project layout'
      }
    ])
  })

  it('counts a module as described through its parent directory', () => {
    const facts = { ...FACTS, files: [...FACTS.files, 'src/prompts/qa.ts'] }
    expect(checkAgentsMd('`index.ts`, `main.ts`, `prompts/`', facts)).toEqual(
      []
    )
    expect(checkAgentsMd('`index.ts`, `main.ts`, `src/`', facts)).toEqual([
      {
        line: 0,
        message: 'src/prompts/review.ts is not described in the project layout'
      },
      {
        line: 0,
        message: 'src/prompts/qa.ts is not described in the project layout'
      }
    ])
  })
})
