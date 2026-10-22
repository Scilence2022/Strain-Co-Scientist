import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../src/shared/domain'
import { campaignInputSchema, ipcArguments, settingsSchema, tournamentConfigSchema } from '../src/shared/validation'
import { campaign } from './fixtures'

describe('IPC input validation', () => {
  it('accepts current defaults and a valid campaign', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true)
    expect(campaignInputSchema.safeParse(campaign()).success).toBe(true)
  })

  it.each([0, -1, 1.5, NaN, Infinity, 100])('rejects invalid concurrency %s', (concurrency) => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.run.concurrency = concurrency
    expect(settingsSchema.safeParse(settings).success).toBe(false)
  })

  it('rejects invalid budgets, custom hosts and empty goals', () => {
    const c = campaign()
    c.computeBudget.maxCycles = 0
    expect(campaignInputSchema.safeParse(c).success).toBe(false)
    const custom = campaign()
    custom.host = { preset: 'custom' }
    expect(campaignInputSchema.safeParse(custom).success).toBe(false)
    expect(campaignInputSchema.safeParse({ ...campaign(), goal: '  ' }).success).toBe(false)
  })

  it('rejects all-zero scoring weights', () => {
    const config = campaign().tournamentConfig
    for (const key of Object.keys(config.weights)) config.weights[key as keyof typeof config.weights] = 0
    expect(tournamentConfigSchema.safeParse(config).success).toBe(false)
  })

  it.each(['../escape', '/tmp/data', '', 'a/b'])('rejects unsafe identifiers %s', (id) => {
    expect(ipcArguments.deleteCampaign.safeParse([id]).success).toBe(false)
  })

  it('rejects nonfinite measurements and fractional replicate counts', () => {
    const input = { campaignId: 'campaign1', designId: 'design1', outcome: 'confirmed', observations: 'Test observation' }
    expect(ipcArguments.recordExperimentalResult.safeParse([{ ...input, measuredValue: Infinity }]).success).toBe(false)
    expect(ipcArguments.recordExperimentalResult.safeParse([{ ...input, replicates: 1.5 }]).success).toBe(false)
  })

  it.each(['file:///etc/passwd', 'javascript:alert(1)', 'http://user:secret@localhost'])('rejects unsafe server URLs %s', (url) => {
    const settings = structuredClone(DEFAULT_SETTINGS)
    settings.mcp.deepResearch = { enabled: true, url }
    expect(settingsSchema.safeParse(settings).success).toBe(false)
  })
})
