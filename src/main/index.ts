import { app, BrowserWindow, dialog, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ENGINE_EVENT_CHANNEL, type EngineEvent } from '@shared/ipc'
import { Engine } from './engine/Engine'
import { registerIpc } from './ipc'

let mainWindow: BrowserWindow | null = null
let engine: Engine | null = null
const rendererUrl = new URL(process.env['ELECTRON_RENDERER_URL'] ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href).href

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#11161d',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const target = new URL(url)
      if (['https:', 'http:'].includes(target.protocol) && !target.username && !target.password) {
        void shell.openExternal(target.href).catch(console.error)
      }
    } catch { /* Invalid external link. */ }
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function emitEngineEvent(event: EngineEvent): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(ENGINE_EVENT_CHANNEL, event)
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark'
  engine = new Engine(emitEngineEvent)
  registerIpc(engine, (event) => {
    return event.sender === mainWindow?.webContents &&
      event.senderFrame === event.sender.mainFrame &&
      event.senderFrame?.url === rendererUrl
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', async (e) => {
  if (engine) {
    e.preventDefault()
    const toClose = engine
    engine = null
    try {
      await toClose.shutdown()
      app.quit()
    } catch (err) {
      engine = toClose
      dialog.showErrorBox('Could not save application data', `The application remains open so you can retry quitting.\n\n${String(err)}`)
    }
  }
})
