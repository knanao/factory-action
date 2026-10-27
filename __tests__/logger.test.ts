import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import * as core from '../__fixtures__/core.js'

mock.module('@actions/core', () => core)

const {
  log,
  minLogLevel,
  renderRecord,
  resetLogLevel,
  setLogContext,
  setLogLevel
} = await import('../src/logger.js')

const LEVEL_ENV = 'FACTORY_ACTION_LOG_LEVEL'

function clearEmitters(): void {
  core.debug.mockClear()
  core.info.mockClear()
  core.notice.mockClear()
  core.warning.mockClear()
  core.error.mockClear()
}

describe('renderRecord', () => {
  it('renders level, event, and fields in order', () => {
    expect(
      renderRecord('info', 'session.created', {
        session_id: 'sid-1',
        reused: false,
        max_comments: 30
      })
    ).toBe(
      'level=info event=session.created session_id=sid-1 reused=false max_comments=30'
    )
  })

  it('quotes values with whitespace or quotes and escapes them', () => {
    expect(
      renderRecord('warning', 'tracking.write_failed', {
        msg: 'line "one"\nline two'
      })
    ).toBe(
      'level=warning event=tracking.write_failed msg="line \\"one\\"\\nline two"'
    )
  })

  it('quotes empty strings and values containing equals', () => {
    expect(renderRecord('info', 'x', { a: '', b: 'k=v' })).toBe(
      'level=info event=x a="" b="k=v"'
    )
  })

  it('drops undefined and null fields', () => {
    expect(
      renderRecord('info', 'run.failed', { error: null, stack: undefined })
    ).toBe('level=info event=run.failed')
  })

  it('serializes errors as name and message', () => {
    expect(
      renderRecord('error', 'run.failed', { error: new TypeError('boom') })
    ).toBe('level=error event=run.failed error="TypeError: boom"')
  })

  it('serializes other structured values as compact JSON', () => {
    expect(
      renderRecord('info', 'session.created', { tags: { repo: 'acme/w' } })
    ).toBe('level=info event=session.created tags="{\\"repo\\":\\"acme/w\\"}"')
  })

  it('sanitizes unsafe keys and event names', () => {
    expect(renderRecord('info', 'weird event!', { 'Bad Key?': 'v' })).toBe(
      'level=info event=weird_event_ Bad_Key_=v'
    )
  })
})

describe('log routing', () => {
  beforeEach(() => {
    clearEmitters()
    resetLogLevel()
    setLogLevel('debug')
  })

  afterEach(() => resetLogLevel())

  it('routes each level to its matching @actions/core function', () => {
    log.debug('e.debug', { k: 1 })
    log.info('e.info', { k: 1 })
    log.notice('e.notice', { k: 1 })
    log.warning('e.warning', { k: 1 })
    log.error('e.error', { k: 1 })

    expect(core.debug).toHaveBeenCalledWith('level=debug event=e.debug k=1')
    expect(core.info).toHaveBeenCalledWith('level=info event=e.info k=1')
    expect(core.notice).toHaveBeenCalledWith('level=notice event=e.notice k=1')
    expect(core.warning).toHaveBeenCalledWith(
      'level=warning event=e.warning k=1'
    )
    expect(core.error).toHaveBeenCalledWith('level=error event=e.error k=1')
  })
})

describe('log context', () => {
  beforeEach(() => {
    clearEmitters()
    setLogLevel('debug')
  })

  afterEach(() => {
    setLogContext()
    resetLogLevel()
  })

  it('appends the context to every record and wins over record fields', () => {
    setLogContext({ trace_id: 't-1', span_id: 's-1' })
    log.info('session.created', { session_id: 'sid-1', trace_id: 'spoofed' })
    log.warning('tracking.write_failed')

    expect(core.info).toHaveBeenCalledWith(
      'level=info event=session.created session_id=sid-1 trace_id=t-1 span_id=s-1'
    )
    expect(core.warning).toHaveBeenCalledWith(
      'level=warning event=tracking.write_failed trace_id=t-1 span_id=s-1'
    )
  })

  it('clears the context when called without fields', () => {
    setLogContext({ trace_id: 't-1' })
    setLogContext()
    log.info('e.info')
    expect(core.info).toHaveBeenCalledWith('level=info event=e.info')
  })
})

describe('level filtering', () => {
  const saved: Record<string, string | undefined> = {}

  beforeEach(() => {
    saved[LEVEL_ENV] = process.env[LEVEL_ENV]
    saved.ACTIONS_STEP_DEBUG = process.env.ACTIONS_STEP_DEBUG
    delete process.env[LEVEL_ENV]
    delete process.env.ACTIONS_STEP_DEBUG
    resetLogLevel()
    clearEmitters()
  })

  afterEach(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    resetLogLevel()
  })

  it('emits info and above, hiding debug, by default', () => {
    expect(minLogLevel()).toBe('info')
    log.debug('hidden.debug')
    log.info('shown.info')
    expect(core.debug).not.toHaveBeenCalled()
    expect(core.info).toHaveBeenCalledWith('level=info event=shown.info')
  })

  it('shows debug records when FACTORY_ACTION_LOG_LEVEL=debug', () => {
    process.env[LEVEL_ENV] = 'debug'
    log.debug('shown.debug')
    expect(core.debug).toHaveBeenCalledWith('level=debug event=shown.debug')
  })

  it('accepts case-insensitive level names', () => {
    process.env[LEVEL_ENV] = 'WARNING'
    expect(minLogLevel()).toBe('warning')
    log.info('hidden.info')
    expect(core.info).not.toHaveBeenCalled()
  })

  it('honors the runner step-debug flag', () => {
    process.env.ACTIONS_STEP_DEBUG = 'true'
    log.debug('shown.debug')
    expect(core.debug).toHaveBeenCalledWith('level=debug event=shown.debug')
  })

  it('prefers the explicit level over the runner step-debug flag', () => {
    process.env[LEVEL_ENV] = 'warning'
    process.env.ACTIONS_STEP_DEBUG = 'true'
    log.debug('hidden.debug')
    log.info('hidden.info')
    log.warning('shown.warning')
    expect(core.debug).not.toHaveBeenCalled()
    expect(core.info).not.toHaveBeenCalled()
    expect(core.warning).toHaveBeenCalledWith(
      'level=warning event=shown.warning'
    )
  })

  it('falls back to info for invalid levels', () => {
    process.env[LEVEL_ENV] = 'loud'
    expect(minLogLevel()).toBe('info')
    log.debug('hidden.debug')
    expect(core.debug).not.toHaveBeenCalled()
  })

  it('setLogLevel overrides the environment until resetLogLevel', () => {
    process.env[LEVEL_ENV] = 'error'
    setLogLevel('debug')
    log.debug('shown.debug')
    expect(core.debug).toHaveBeenCalledTimes(1)

    resetLogLevel()
    log.debug('hidden.debug')
    expect(core.debug).toHaveBeenCalledTimes(1)
  })
})
