import { BrowserWindow, dialog, ipcMain } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { ExportFileInput, ExportFileResult, IpcApiChannel } from '@shared/ipc'
import type { Engine } from '../engine/Engine'
import { ipcArguments } from '@shared/validation'
import type { IpcMainInvokeEvent } from 'electron'

/** Show a native save dialog and write the supplied contents to disk. */
async function exportFile(input: ExportFileInput): Promise<ExportFileResult> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? undefined
  const opts = {
    defaultPath: input.defaultName,
    filters: input.filters ?? [{ name: 'All Files', extensions: ['*'] }]
  }
  const result = win
    ? await dialog.showSaveDialog(win, opts)
    : await dialog.showSaveDialog(opts)
  if (result.canceled || !result.filePath) return { ok: false, cancelled: true }
  try {
    await writeFile(result.filePath, input.contents, 'utf8')
    return { ok: true, path: result.filePath }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Registers one ipcMain.handle per IpcApi method. Channel names match the
 * method names in the IpcApi contract, so the preload bridge stays in lockstep
 * with the renderer's typed surface.
 */
export function registerIpc(engine: Engine, isTrusted: (event: IpcMainInvokeEvent) => boolean): void {
  const handlers: Record<IpcApiChannel, (...args: any[]) => unknown> = {
    getSettings: () => engine.getSettings(),
    saveSettings: (settings) => engine.saveSettings(settings),
    testMcp: (server) => engine.testMcp(server),
    pingLlm: () => engine.pingLlm(),
    listProviderModels: (provider) => engine.listProviderModels(provider),

    regenerateOverview: (id) => engine.regenerateOverview(id),

    exportFile: (input) => exportFile(input),

    listCampaigns: () => engine.listCampaigns(),
    createCampaign: (input) => engine.createCampaign(input),
    deleteCampaign: (id) => engine.deleteCampaign(id),
    getSnapshot: (id) => engine.getSnapshot(id),
    updateTournamentConfig: (id, config) => engine.updateTournamentConfig(id, config),

    startCampaign: (id) => engine.startCampaign(id),
    pauseCampaign: (id) => engine.pauseCampaign(id),
    resumeCampaign: (id) => engine.resumeCampaign(id),
    stopCampaign: (id) => engine.stopCampaign(id),

    updateLabContext: (id, context) => engine.updateLabContext(id, context),
    refineGoal: (id, addendum) => engine.refineGoal(id, addendum),
    submitExpertDesign: (input) => engine.submitExpertDesign(input),
    submitExpertReview: (input) => engine.submitExpertReview(input),
    flagDesign: (designId, flagged) => engine.flagDesign(designId, flagged),

    recordExperimentalResult: (input) => engine.recordExperimentalResult(input),
    disputeResult: (campaignId, resultId, disputed) =>
      engine.disputeResult(campaignId, resultId, disputed),
    reopenCampaign: (id) => engine.reopenCampaign(id)
  }

  for (const [channel, handler] of Object.entries(handlers)) {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isTrusted(event)) throw new Error('Untrusted IPC sender')
      const parsed = ipcArguments[channel as IpcApiChannel].safeParse(args)
      if (!parsed.success) {
        throw new Error(`Invalid ${channel} request: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
      }
      return handler(...parsed.data)
    })
  }
}
