// See: https://eslint.org/docs/latest/use/configure/configuration-files

import { FlatCompat } from '@eslint/eslintrc'
import js from '@eslint/js'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import prettier from 'eslint-plugin-prettier'
import globals from 'globals'

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all
})

// Naming conventions; AGENTS.md (Conventions) documents them.
const namingConvention = [
  'error',
  {
    selector: 'default',
    format: ['camelCase'],
    leadingUnderscore: 'allow',
    trailingUnderscore: 'forbid'
  },
  // UPPER_CASE is for module-level constants such as MODES or DROID_MARKER.
  {
    selector: 'variable',
    modifiers: ['const'],
    format: ['camelCase', 'UPPER_CASE']
  },
  { selector: 'import', format: ['camelCase', 'PascalCase'] },
  { selector: 'typeLike', format: ['PascalCase'] },
  { selector: 'enumMember', format: ['PascalCase', 'UPPER_CASE'] },
  // Properties mirror external shapes: GitHub webhook payloads and REST
  // bodies (snake_case), environment variables (UPPER_CASE).
  {
    selector: 'typeProperty',
    format: ['camelCase', 'snake_case', 'UPPER_CASE']
  },
  // Object literals also name HTTP headers (Authorization) and globals.
  {
    selector: 'objectLiteralProperty',
    format: ['camelCase', 'snake_case', 'UPPER_CASE', 'PascalCase']
  },
  // Keys that must be quoted (HTTP headers, 'pull_request.opened') are data.
  {
    selector: [
      'objectLiteralProperty',
      'objectLiteralMethod',
      'typeProperty',
      'typeMethod'
    ],
    modifiers: ['requiresQuotes'],
    format: null
  },
  // An option name typescript-eslint chose to look alarming.
  {
    selector: 'objectLiteralProperty',
    filter: {
      regex:
        '^maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING$',
      match: true
    },
    format: null
  }
]

export default [
  {
    ignores: ['**/coverage', '**/dist', '**/linter', '**/node_modules']
  },
  ...compat.extends(
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended'
  ),
  {
    plugins: {
      prettier,
      '@typescript-eslint': typescriptEslint
    },

    languageOptions: {
      globals: {
        ...globals.node,
        Atomics: 'readonly',
        SharedArrayBuffer: 'readonly'
      },

      parser: tsParser,
      ecmaVersion: 2023,
      sourceType: 'module',

      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '.dependency-cruiser.cjs',
            '__fixtures__/*.ts',
            '__tests__/*.ts',
            '__tests__/integration/*.ts',
            'script/*.ts',
            'script/lib/*.ts',
            'script/qa/*.ts',
            'eslint.config.mjs'
          ],
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 32
        },
        tsconfigRootDir: import.meta.dirname
      }
    },

    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: 'tsconfig.json'
        }
      }
    },

    rules: {
      camelcase: 'off',
      'eslint-comments/no-use': 'off',
      'eslint-comments/no-unused-disable': 'off',
      'i18n-text/no-en': 'off',
      'import/no-namespace': 'off',
      'no-console': 'off',
      'no-shadow': 'off',
      'no-unused-vars': 'off',
      'prettier/prettier': 'error',

      // Size and complexity budgets; AGENTS.md (Conventions) explains them.
      complexity: ['error', 15],
      'max-depth': ['error', 4],
      'max-params': ['error', 4],
      'max-lines': [
        'error',
        { max: 400, skipBlankLines: true, skipComments: true }
      ],

      '@typescript-eslint/naming-convention': namingConvention
    }
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' }
  },
  {
    // Table-driven test suites grow with each scenario; still cap them.
    files: ['__tests__/**/*.ts'],
    rules: {
      'max-lines': [
        'error',
        { max: 700, skipBlankLines: true, skipComments: true }
      ]
    }
  }
]
