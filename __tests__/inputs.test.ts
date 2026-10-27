import { beforeEach, describe, expect, it, jest, mock } from 'bun:test'
import * as core from '../__fixtures__/core.js'

mock.module('@actions/core', () => core)

const { getInputs } = await import('../src/inputs.js')

const REQUIRED: Record<string, string> = {
  'factory-api-key': 'fk-test',
  'computer-id': 'comp-1',
  'github-token': 'gh-test'
}

/** Sets the raw input values on top of the required ones. */
function given(values: Record<string, string> = {}): void {
  const all = { ...REQUIRED, ...values }
  core.getInput.mockImplementation((name) => all[name] ?? '')
  core.getBooleanInput.mockImplementation((name) => all[name] === 'true')
}

describe('getInputs', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    given()
  })

  it('applies the defaults and masks the API key', () => {
    expect(getInputs()).toMatchObject({
      mode: 'mention',
      lane: 'task',
      triggerPhrase: '@factory',
      allowedBots: [],
      permissionFallback: true,
      reuseSession: true,
      maxComments: 30,
      messageTimeoutMs: 15000,
      factoryApiUrl: 'https://api.factory.ai'
    })
    expect(core.setSecret).toHaveBeenCalledWith('fk-test')
    expect(core.getBooleanInput).not.toHaveBeenCalled()
    expect(core.warning).not.toHaveBeenCalled()
  })

  it('normalizes lists and the API URL', () => {
    given({
      mode: 'review',
      'allowed-bots': 'Renovate[bot], dependabot[bot]',
      'allowed-associations': 'owner member',
      commands: '/Verify,qa',
      'factory-api-url': 'https://api.test//'
    })
    expect(getInputs()).toMatchObject({
      lane: 'review',
      allowedBots: ['renovate[bot]', 'dependabot[bot]'],
      allowedAssociations: ['OWNER', 'MEMBER'],
      commands: ['verify', 'qa'],
      factoryApiUrl: 'https://api.test'
    })
  })

  it('reads boolean inputs that are set', () => {
    given({ 'permission-fallback': 'false', 'reuse-session': 'true' })
    expect(getInputs()).toMatchObject({
      permissionFallback: false,
      reuseSession: true
    })
    expect(core.getBooleanInput).toHaveBeenCalledWith('permission-fallback')
  })

  it('requires a prompt in custom mode', () => {
    given({ mode: 'custom' })
    expect(() => getInputs()).toThrow(
      "Input 'prompt' is required when mode is 'custom'"
    )

    given({ mode: 'custom', prompt: 'Audit the repo.' })
    expect(getInputs()).toMatchObject({ mode: 'custom', lane: 'custom' })
  })

  it('warns when autonomy is below high', () => {
    given({ 'autonomy-level': 'medium' })
    expect(getInputs().autonomyLevel).toBe('medium')
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'level=warning event=input.autonomy_below_high autonomy_level=medium'
      )
    )
  })

  it.each(['0', '-5', '1.5', 'many'])(
    'rejects a max-comments of %p',
    (value) => {
      given({ 'max-comments': value })
      expect(() => getInputs()).toThrow(
        `Input 'max-comments' must be a positive integer, got '${value}'`
      )
    }
  )

  it.each([
    ['mode', 'chat'],
    ['autonomy-level', 'full']
  ])('rejects an unknown %s', (name, value) => {
    given({ [name]: value })
    expect(() => getInputs()).toThrow(
      new RegExp(`^Input '${name}' must be one of .*, got '${value}'$`)
    )
  })
})
