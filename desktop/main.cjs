const { app, BrowserWindow, dialog } = require('electron')
const fs = require('fs')
const http = require('http')
const path = require('path')
const { spawn } = require('child_process')

let apiProcess = null

function readConfig() {
  const configPath = app.isPackaged
    ? path.join(process.resourcesPath, 'config.example.json')
    : path.join(__dirname, 'config.example.json')
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'))
  } catch {
    return { webUrl: 'https://app.example.com', apiOrigin: 'https://api.example.com', startLocalApi: false }
  }
}

function waitForApi(url, timeoutMs = 15000) {
  const startedAt = Date.now()
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(`${url}/health`, (response) => {
        response.resume()
        if (response.statusCode === 200) return resolve()
        retry()
      })
      request.on('error', retry)
      request.setTimeout(1000, () => request.destroy())
    }
    const retry = () => {
      if (Date.now() - startedAt > timeoutMs) return reject(new Error(`API did not start: ${url}`))
      setTimeout(check, 250)
    }
    check()
  })
}

function startLocalApi() {
  const executableName = process.platform === 'win32' ? 'paper-assistant-api.exe' : 'paper-assistant-api'
  const executablePath = app.isPackaged
    ? path.join(process.resourcesPath, 'api', executableName)
    : process.env.PAPER_ASSISTANT_API_EXECUTABLE
  if (!executablePath || !fs.existsSync(executablePath)) return null
  return spawn(executablePath, [], {
    env: { ...process.env, DESKTOP_MODE: '1', PORT: '8000' },
    stdio: 'ignore',
    windowsHide: true,
  })
}

async function createWindow() {
  const config = readConfig()
  if (config.startLocalApi) {
    apiProcess = startLocalApi()
    await waitForApi(config.apiOrigin)
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  await window.loadURL(config.webUrl)
}

app.whenReady().then(() => createWindow().catch((error) => {
  dialog.showErrorBox('Paper Assistantを起動できません', error.message)
  app.quit()
}))

app.on('window-all-closed', () => {
  if (apiProcess) apiProcess.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (apiProcess) apiProcess.kill()
})
