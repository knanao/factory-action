import * as core from '@actions/core'
import { context } from '@actions/github'
import { delegate } from './delegate.js'
import { FactoryClient } from './factory.js'
import { createGitHubApi } from './github.js'
import { getInputs } from './inputs.js'
import { log } from './logger.js'
import { parseEvent } from './trigger.js'

export async function run(): Promise<void> {
  try {
    const inputs = getInputs()
    const { owner, repo } = context.repo
    const trigger = parseEvent(context.eventName, context.payload, owner, repo)

    log.info('run.started', {
      repo: `${owner}/${repo}`,
      github_event: context.eventName,
      mode: inputs.mode,
      lane: inputs.lane
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
            { data: 'Reused', header: true }
          ],
          [
            inputs.mode === 'cleanup' ? 'cleanup' : inputs.lane,
            outcome.sessionUrl
              ? `<a href="${outcome.sessionUrl}">${outcome.sessionId}</a>`
              : (outcome.sessionId ?? ''),
            outcome.computerId ?? '',
            String(outcome.reused)
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
