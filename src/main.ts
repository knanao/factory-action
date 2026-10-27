import * as core from '@actions/core'
import { context } from '@actions/github'
import { delegate } from './delegate.js'
import { FactoryClient } from './factory.js'
import { createGitHubApi } from './github.js'
import { getInputs } from './inputs.js'
import { log, setLogContext } from './logger.js'
import { cicdAttributes, startTrace, traceLogFields } from './trace.js'
import { parseEvent } from './trigger.js'

export async function run(): Promise<void> {
  const trace = startTrace()
  setLogContext(traceLogFields(trace))
  core.setOutput('trace-id', trace.traceId)
  try {
    const inputs = getInputs()
    const { owner, repo } = context.repo
    const trigger = parseEvent(context.eventName, context.payload, owner, repo)

    log.info('run.started', {
      repo: `${owner}/${repo}`,
      github_event: context.eventName,
      mode: inputs.mode,
      lane: inputs.lane,
      trace_inherited: trace.inherited,
      ...cicdAttributes()
    })

    const outcome = await delegate(inputs, trigger, {
      github: createGitHubApi(inputs.githubToken, owner, repo),
      factory: new FactoryClient({
        apiKey: inputs.factoryApiKey,
        baseUrl: inputs.factoryApiUrl
      }),
      runUrl: `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}`,
      runId: context.runId
    })

    core.setOutput('skipped', outcome.skipped)
    core.setOutput('session-id', outcome.sessionId ?? '')
    core.setOutput('session-url', outcome.sessionUrl ?? '')
    core.setOutput('reused', String(outcome.reused ?? false))
    core.setOutput('computer-id', outcome.computerId ?? '')

    if (outcome.sessionId || outcome.computerId) {
      await core.summary
        .addHeading('Factory Droid', 3)
        .addTable([
          [
            { data: 'Lane', header: true },
            { data: 'Session', header: true },
            { data: 'Computer', header: true },
            { data: 'Reused', header: true },
            { data: 'Trace ID', header: true }
          ],
          [
            inputs.mode === 'cleanup' ? 'cleanup' : inputs.lane,
            outcome.sessionUrl
              ? `<a href="${outcome.sessionUrl}">${outcome.sessionId}</a>`
              : (outcome.sessionId ?? ''),
            outcome.computerId ?? '',
            String(outcome.reused),
            trace.traceId
          ]
        ])
        .write()
    }
  } catch (error) {
    log.error('run.failed', {
      error,
      stack: error instanceof Error ? error.stack : undefined
    })
    core.setFailed(error instanceof Error ? error.message : String(error))
  }
}
