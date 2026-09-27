// desktop/main.cjsと同じ方針: config.example.jsonのwebUrlを、ビルド前に
// capacitor.config.jsonのserver.urlへ反映する(ネイティブアプリはリモートのWeb版を
// WebViewで表示するだけの薄いラッパーなので、フロント資産をアプリに同梱しない)。
const fs = require('fs')
const path = require('path')

const configPath = path.join(__dirname, 'config.example.json')
const capacitorConfigPath = path.join(__dirname, 'capacitor.config.json')

const { webUrl } = JSON.parse(fs.readFileSync(configPath, 'utf8'))
if (!webUrl || webUrl === 'https://app.example.com') {
  console.warn(
    '警告: config.example.jsonのwebUrlが本番URLに変更されていません。' +
      'そのまま同期するとサンプルURLを読み込むアプリになります。'
  )
}

const capacitorConfig = JSON.parse(fs.readFileSync(capacitorConfigPath, 'utf8'))
capacitorConfig.server = { ...capacitorConfig.server, url: webUrl, cleartext: false }
fs.writeFileSync(capacitorConfigPath, JSON.stringify(capacitorConfig, null, 2) + '\n')

console.log(`capacitor.config.json の server.url を ${webUrl} に設定しました。`)
