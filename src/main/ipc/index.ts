import { ipcMain } from 'electron'
import type { IpcApiChannel } from '@shared/ipc'
import type { Engine } from '../engine/Engine'

/**
 * Registers one ipcMain.handle per IpcApi method. Channel names match the
 * method names in the IpcApi contract, so the preload bridge stays in lockstep
 * with the renderer's typed surface.
 */
export function registerIpc(engine: Engine): void {
  const handlers: Record<IpcApiChannel, (...args: any[]) => unknown> = {
    getSettings: () => engine.getSettings(),
    saveSettings: (settings) => engine.saveSettings(settings),
    testMcp: (server) => engine.testMcp(server),
    pingLlm: () => engine.pingLlm(),

    regenerateOverview: (id) => engine.regenerateOverview(id),

    listCampaigns: () => engine.listCampaigns(),
    createCampaign: (input) => engine.createCampaign(input),
    deleteCampaign: (id) => engine.deleteCampaign(id),
    getSnapshot: (id) => engine.getSnapshot(id),

    startCampaign: (id) => engine.startCampaign(id),
    pauseCampaign: (id) => engine.pauseCampaign(id),
    resumeCampaign: (id) => engine.resumeCampaign(id),
    stopCampaign: (id) => engine.stopCampaign(id),

    refineGoal: (id, addendum) => engine.refineGoal(id, addendum),
    submitExpertDesign: (input) => engine.submitExpertDesign(input),
    submitExpertReview: (input) => engine.submitExpertReview(input),
    flagDesign: (designId, flagged) => engine.flagDesign(designId, flagged)
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (_event, ...args) => handler(...args))
  }
}
