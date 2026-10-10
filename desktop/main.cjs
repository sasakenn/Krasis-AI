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

// Web版(frontend/public/intro-splash.js)はこの印を見て、自分の起動演出を省く。
// デスクトップでは下の splashWindow が同じ演出を先に出しているため、二重に流さないようにする。
const SHELL_UA_MARK = 'THYNORA-Desktop'

// 本体の読み込み中に出す起動画面(desktop/splash/)。ネットワークを待たずにすぐ表示できるよう、
// ローカルのファイルを読み込む。本体と同じ大きさ・位置に出して、切り替わりを目立たなくする。
function createSplashWindow() {
  const splash = new BrowserWindow({
    width: 1280,
    height: 860,
    frame: false,
    resizable: false,
    movable: true,
    show: false,
    backgroundColor: '#08090b',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  splash.once('ready-to-show', () => splash.show())
  splash.loadFile(path.join(__dirname, 'splash', 'index.html'))
  return splash
}

async function createWindow() {
  const splash = createSplashWindow()
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
    show: false,
    backgroundColor: '#08090b',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  window.webContents.setUserAgent(`${window.webContents.getUserAgent()} ${SHELL_UA_MARK}`)

  // 起動画面の演出が終わった(タイトルが 'done' になった)ら本体に切り替える。
  // 起動画面が何かの理由で閉じられた・壊れた場合も、本体は必ず表示する。
  let shown = false
  const showMain = () => {
    if (shown) return
    shown = true
    if (!window.isDestroyed()) window.show()
    if (!splash.isDestroyed()) splash.close()
  }
  splash.on('page-title-updated', (_event, title) => { if (title === 'done') showMain() })
  splash.on('closed', showMain)
  setTimeout(showMain, 25000)

  try {
    await window.loadURL(config.webUrl)
  } finally {
    // 読み込みが終わった(または失敗した)ことを起動画面に伝える。演出が一通り終わってから閉じる。
    if (!splash.isDestroyed()) {
      splash.webContents.executeJavaScript('window.thynoraReady && window.thynoraReady()').catch(showMain)
    } else {
      showMain()
    }
  }
}

app.whenReady().then(() => createWindow().catch((error) => {
  dialog.showErrorBox('THYNORAを起動できません', error.message)
  app.quit()
}))

app.on('window-all-closed', () => {
  if (apiProcess) apiProcess.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (apiProcess) apiProcess.kill()
})
