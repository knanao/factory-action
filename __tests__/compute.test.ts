import { describe, expect, it, jest, mock } from 'bun:test'
import * as core from '../__fixtures__/core.js'
import { FactoryApiError } from '../src/factory.js'
import type { Computer } from '../src/factory.js'
import type { ComputeApi } from '../src/compute.js'

mock.module('@actions/core', () => core)

const {
  computerName,
  ensureComputer,
  isFromEnvironment,
  repoPrefix,
  threadPrefix
} = await import('../src/compute.js')

const testName = computerName('acme', 'widgets', '42', 'task')
const environmentComputer: Computer = {
  id: 'c1',
  name: testName,
  status: 'active',
  computerSource: { kind: 'template', templateId: 'env-1' }
}

function api(overrides: Partial<ComputeApi> = {}): ComputeApi {
  return {
    getComputerByName: jest
      .fn<ComputeApi['getComputerByName']>()
      .mockResolvedValue(undefined),
    createComputer: jest
      .fn<ComputeApi['createComputer']>()
      .mockResolvedValue(environmentComputer),
    getComputer: jest
      .fn<ComputeApi['getComputer']>()
      .mockResolvedValue(environmentComputer),
    deleteComputer: jest
      .fn<ComputeApi['deleteComputer']>()
      .mockResolvedValue(true),
    ...overrides
  }
}

describe('Environment computer names', () => {
  it('includes a readable repository, stable hash, thread and lane', () => {
    expect(repoPrefix('Acme', 'Widgets')).toMatch(/^fa-widgets-[a-f0-9]{6}-$/)
    expect(threadPrefix('acme', 'widgets', 42)).toMatch(
      /^fa-widgets-[a-f0-9]{6}-42-$/
    )
    expect(computerName('acme', 'widgets', '42', 'task')).toMatch(
      /^fa-widgets-[a-f0-9]{6}-42-task-[a-f0-9]{6}$/
    )
  })

  it('normalizes unsafe lane characters and keeps names valid and bounded', () => {
    const name = computerName('acme', 'widgets', '42', 'QA / Security')
    expect(name).toMatch(/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/)
    expect(name).toContain('qa-security-')
    expect(name.length).toBeLessThanOrEqual(63)
  })

  it('adds a hash when a lane needs truncation', () => {
    const laneA = `lane-${'x'.repeat(100)}-a`
    const laneB = `lane-${'x'.repeat(100)}-b`
    const nameA = computerName('acme', 'widgets', '42', laneA)
    const nameB = computerName('acme', 'widgets', '42', laneB)
    expect(nameA.length).toBeLessThanOrEqual(63)
    expect(nameB.length).toBeLessThanOrEqual(63)
    expect(nameA).not.toBe(nameB)
  })

  it('recognizes the source Environment by template ID', () => {
    expect(isFromEnvironment(environmentComputer, 'env-1')).toBe(true)
    expect(isFromEnvironment(environmentComputer, 'other')).toBe(false)
    expect(
      isFromEnvironment(
        {
          ...environmentComputer,
          computerSource: { kind: 'execution-template', templateId: 'env-1' }
        },
        'env-1'
      )
    ).toBe(false)
  })
})

describe('ensureComputer', () => {
  const options = {
    name: testName,
    environmentId: 'env-1',
    timeoutMs: 1000,
    pollMs: 0
  }

  it('creates an unlisted computer when the deterministic name is free', async () => {
    const client = api()
    await expect(ensureComputer(client, options)).resolves.toEqual(
      environmentComputer
    )
    expect(client.createComputer).toHaveBeenCalledWith({
      name: options.name,
      source: {
        kind: 'environment',
        environmentId: 'env-1',
        isListed: false
      }
    })
  })

  it('reuses an existing computer by name', async () => {
    const client = api({
      getComputerByName: jest
        .fn<ComputeApi['getComputerByName']>()
        .mockResolvedValue(environmentComputer)
    })
    await expect(ensureComputer(client, options)).resolves.toEqual(
      environmentComputer
    )
    expect(client.createComputer).not.toHaveBeenCalled()
  })

  it('recovers from a concurrent create that returns 409', async () => {
    const client = api({
      createComputer: jest
        .fn<ComputeApi['createComputer']>()
        .mockRejectedValueOnce(new FactoryApiError(409, 'Conflict', 'exists')),
      getComputerByName: jest
        .fn<ComputeApi['getComputerByName']>()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(environmentComputer)
    })
    await expect(ensureComputer(client, options)).resolves.toEqual(
      environmentComputer
    )
    expect(client.getComputerByName).toHaveBeenCalledTimes(2)
  })

  it('deletes a computer that enters the error state', async () => {
    const failed = { ...environmentComputer, status: 'error' as const }
    const client = api({
      createComputer: jest
        .fn<ComputeApi['createComputer']>()
        .mockResolvedValue(failed)
    })
    await expect(ensureComputer(client, options)).rejects.toThrow(
      /failed to provision and was deleted/
    )
    expect(client.deleteComputer).toHaveBeenCalledWith('c1')
  })

  it('leaves a provisioning computer for a later run after timeout', async () => {
    const provisioning = {
      ...environmentComputer,
      status: 'provisioning' as const
    }
    const client = api({
      createComputer: jest
        .fn<ComputeApi['createComputer']>()
        .mockResolvedValue(provisioning),
      getComputer: jest
        .fn<ComputeApi['getComputer']>()
        .mockResolvedValue(provisioning)
    })
    await expect(
      ensureComputer(client, { ...options, timeoutMs: 1 })
    ).rejects.toThrow(/still provisioning/)
    expect(client.deleteComputer).not.toHaveBeenCalled()
  })

  it('rejects a computer created from another Environment', async () => {
    const client = api({
      getComputerByName: jest
        .fn<ComputeApi['getComputerByName']>()
        .mockResolvedValue({
          ...environmentComputer,
          computerSource: { kind: 'template', templateId: 'other-env' }
        })
    })
    await expect(ensureComputer(client, options)).rejects.toThrow(
      /not created from Environment env-1/
    )
  })
})
