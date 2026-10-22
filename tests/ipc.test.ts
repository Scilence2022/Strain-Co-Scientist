import { describe, expect, it, vi } from 'vitest'
import type { Engine } from '../src/main/engine/Engine'

const state = vi.hoisted(() => ({ handlers: new Map<string, (...args: any[]) => Promise<unknown>>() }))
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: (...args: any[]) => Promise<unknown>) => state.handlers.set(name, handler) }, BrowserWindow: {}, dialog: {} }))
import { registerIpc } from '../src/main/ipc'

describe('privileged IPC boundary', () => {
  it('rejects an untrusted sender before accessing the engine', async () => {
    const getSettings = vi.fn()
    registerIpc({ getSettings } as unknown as Engine, () => false)
    await expect(state.handlers.get('getSettings')!({})).rejects.toThrow('Untrusted IPC sender')
    expect(getSettings).not.toHaveBeenCalled()
  })

  it('rejects invalid inputs before mutating campaign data', async () => {
    const deleteCampaign = vi.fn()
    registerIpc({ deleteCampaign } as unknown as Engine, () => true)
    await expect(state.handlers.get('deleteCampaign')!({}, '../escape')).rejects.toThrow('Invalid deleteCampaign request')
    expect(deleteCampaign).not.toHaveBeenCalled()
    await state.handlers.get('deleteCampaign')!({}, 'campaign1')
    expect(deleteCampaign).toHaveBeenCalledWith('campaign1')
  })
})
