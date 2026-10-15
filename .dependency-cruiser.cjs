// Module boundaries for the action. AGENTS.md (Project layout) explains them.
// See: https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular imports make the entry chain order-dependent.',
      from: {},
      to: { circular: true }
    },
    {
      name: 'no-orphans',
      severity: 'error',
      comment:
        'A module nothing imports and that imports nothing is dead. Scripts ' +
        'under script/ are standalone entry points run with bun.',
      from: { orphan: true, pathNot: ['\\.d\\.ts$', '^script/'] },
      to: {}
    },
    {
      name: 'prompts-are-pure',
      severity: 'error',
      comment:
        'src/prompts/ only builds text: it may use other prompt modules and ' +
        'the Trigger types, never API clients, orchestration or packages.',
      from: { path: '^src/prompts/' },
      to: {
        pathNot: ['^src/prompts/', '^src/trigger\\.ts$', '^src/inputs\\.ts$']
      }
    },
    {
      name: 'prompts-use-input-types-only',
      severity: 'error',
      comment:
        'inputs.ts reads @actions/core at runtime; prompts need only its types.',
      from: { path: '^src/prompts/' },
      to: { path: '^src/inputs\\.ts$', dependencyTypesNot: ['type-only'] }
    },
    {
      name: 'leaf-modules-stay-leaves',
      severity: 'error',
      comment:
        'Event parsing, authorization, inputs, state and the GitHub wrapper ' +
        'must not reach the Factory client, compute, prompts or orchestration.',
      from: { path: '^src/(authz|github|inputs|state|trigger)\\.ts$' },
      to: {
        path: '^src/(cleanup|compute|delegate|factory|index|main)\\.ts$|^src/prompts/'
      }
    },
    {
      name: 'github-client-in-github-ts',
      severity: 'error',
      comment:
        'The GitHub token is used only by github.ts (and main.ts reads the ' +
        'event context), so no other module may import @actions/github.',
      from: { path: '^src/', pathNot: '^src/(github|main)\\.ts$' },
      to: { path: '^node_modules/@actions/github/' }
    },
    {
      name: 'only-index-runs-main',
      severity: 'error',
      comment: 'main.ts is the entry chain: index.ts (and its tests) call it.',
      from: { pathNot: '^src/index\\.ts$|^__tests__/' },
      to: { path: '^src/main\\.ts$' }
    },
    {
      name: 'src-is-self-contained',
      severity: 'error',
      comment: 'Shipped code must not import tests, fixtures or dev scripts.',
      from: { path: '^src/' },
      to: { path: '^(__tests__|__fixtures__|script)/' }
    },
    {
      name: 'src-uses-runtime-deps-only',
      severity: 'error',
      comment:
        'dist/ bundles what src/ imports; devDependencies must not ship.',
      from: { path: '^src/' },
      to: { dependencyTypes: ['npm-dev'], dependencyTypesNot: ['type-only'] }
    },
    {
      name: 'no-unlisted-deps',
      severity: 'error',
      comment: 'Every package import must be declared in package.json.',
      from: {},
      to: { dependencyTypes: ['npm-no-pkg', 'npm-unknown'] }
    },
    {
      name: 'not-to-unresolvable',
      severity: 'error',
      comment: 'An import that does not resolve fails at runtime.',
      from: {},
      to: { couldNotResolve: true }
    }
  ],
  options: {
    doNotFollow: { path: ['node_modules'] },
    exclude: { path: ['^dist/', '^coverage/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['module', 'main', 'types', 'typings']
    },
    reporterOptions: {
      text: { highlightFocused: true }
    }
  }
}
