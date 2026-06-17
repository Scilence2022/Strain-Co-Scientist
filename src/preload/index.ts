import { contextBridge, ipcRenderer } from 'electron'
import { ENGINE_EVENT_CHANNEL, type EngineEvent, type PreloadBridge } from '@shared/ipc'

/**
 * The typed bridge exposed to the renderer as `window.api`. Every method is a
 * thin ipcRenderer.invoke; engine events are pushed over a single channel.
 */
const api: PreloadBridge = {
  getSettings: () => ipcRenderer.invoke('getSettings'),
  saveSettings: (settings) => ipcRenderer.invoke('saveSettings', settings),
  testMcp: (server) => ipcRenderer.invoke('testMcp', server),
  pingLlm: () => ipcRenderer.invoke('pingLlm'),

  regenerateOverview: (id) => ipcRenderer.invoke('regenerateOverview', id),

  exportFile: (input) => ipcRenderer.invoke('exportFile', input),

  listCampaigns: () => ipcRenderer.invoke('listCampaigns'),
  createCampaign: (input) => ipcRenderer.invoke('createCampaign', input),
  deleteCampaign: (id) => ipcRenderer.invoke('deleteCampaign', id),
  getSnapshot: (id) => ipcRenderer.invoke('getSnapshot', id),

  startCampaign: (id) => ipcRenderer.invoke('startCampaign', id),
  pauseCampaign: (id) => ipcRenderer.invoke('pauseCampaign', id),
  resumeCampaign: (id) => ipcRenderer.invoke('resumeCampaign', id),
  stopCampaign: (id) => ipcRenderer.invoke('stopCampaign', id),

  refineGoal: (id, addendum) => ipcRenderer.invoke('refineGoal', id, addendum),
  submitExpertDesign: (input) => ipcRenderer.invoke('submitExpertDesign', input),
  submitExpertReview: (input) => ipcRenderer.invoke('submitExpertReview', input),
  flagDesign: (designId, flagged) => ipcRenderer.invoke('flagDesign', designId, flagged),

  onEngineEvent: (handler: (event: EngineEvent) => void) => {
    const listener = (_e: unknown, event: EngineEvent): void => handler(event)
    ipcRenderer.on(ENGINE_EVENT_CHANNEL, listener)
    return () => ipcRenderer.removeListener(ENGINE_EVENT_CHANNEL, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
