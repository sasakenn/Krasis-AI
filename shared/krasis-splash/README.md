# Krasis Splash

krasis.xyz の起動演出（ニューラルネットワークの投影 → ロゴ → フェードアウト）を、ほかのアプリでも使い回せるように切り出した部品です。描画の内容とタイミングは、`site/index.html` の演出と同じです。

| ファイル | 役割 |
|---|---|
| `krasis-splash.js` | 本体。読み込むと `window.KrasisSplash` が使えるようになる。依存ライブラリはない |
| `krasis-splash.css` | 見た目。JS にも同じ内容が入っていて自動で挿入されるが、CSP が厳しいアプリでは必ず `<link>` で読み込む |
| `demo.html` | 動作確認用。ブラウザで開くと再生される |

## 使い方

### 普通の HTML ページ

```html
<link rel="stylesheet" href="krasis-splash.css">
<script src="krasis-splash.js"></script>
<script>KrasisSplash.play();</script>
```

### React / Vite（THYNORA の frontend など）

1. 2つのファイルを `public/` に置く。
2. `index.html` に `<link>` と `<script src="/krasis-splash.js">` を足す。
3. 起動時に `window.KrasisSplash.play()` を呼ぶ。

`main.jsx` の中で呼ぶ場合は、たとえば `useEffect(() => window.KrasisSplash?.play(), [])` とする。

### Electron / Capacitor（desktop/、mobile/）

中身は Web 版をそのまま表示しているので、Web 版に入れれば両方に反映される。

## オプション

```js
KrasisSplash.play({
  title: 'KRASIS',          // 中央のロゴ文字（THYNORA 用なら 'THYNORA'）
  tagline: 'THINK BEYOND.', // その下の一行
  duration: 2.6,            // 秒。全体のタイミングがこの長さに合わせて伸び縮みする
  force: false,             // true にすると、「視差効果を減らす」設定の人にも再生する
  skippable: true,          // クリック・キー入力で飛ばせる
  showLog: true,            // 左下の "> load model graph" ログ
  onDone: () => {},         // 消え終わったときに呼ばれる
  until: promise,           // 渡すと、演出が終わってもこれが解決するまでロゴを出したまま待つ
  maxWait: 6000,            // until を待つ上限(ミリ秒)。過ぎたら必ず消える
});
KrasisSplash.skip();        // 外から終わらせる
```

## 注意

- 同じファイルのコピーが2か所にある。こちらを直したら、両方にもコピーすること。
  - `frontend/public/`：THYNORAアプリ（Web版・iPhone版・Android版）の起動画面
  - `desktop/splash/`：デスクトップ版（Windows・Mac）の起動画面
- OS で「視差効果を減らす」（prefers-reduced-motion）を有効にしている人には、既定では表示しない。`force: true` を渡すと表示する。
- 画面全体を覆う（`z-index: 2147483000`）。
- JS より先に黒い画面を出したいときは、`#nn-splash` のマークアップ（`frontend/index.html` を参照）を HTML に直接書いておく。JS はそれを再利用する。
- フォントは IBM Plex Mono。読み込んでいなければ、等幅の代わりのフォントで表示される。
- CSP で `style-src 'unsafe-inline'` を許可していないアプリでは、JS による CSS の自動挿入がブロックされる。`krasis-splash.css` を `<link>` で読み込めば動く。読み込み済みなら、JS は CSS を挿入しない。

## 各OSでの起動の流れ

| OS | 最初に出るもの | そのあと |
|---|---|---|
| Web | `frontend/index.html` に置いた黒い枠 | Web版の起動演出（このファイル）を再生し、アプリが描画されたら消える |
| Windows / Mac | `desktop/splash/`（ローカルファイル）の起動演出を、本体の読み込み中に別ウィンドウで再生 | 本体の読み込みが終わったら切り替える。Web版の起動演出は二重にならないよう省く |
| iPhone / Android | ネイティブの起動画面（暗い背景にニューロンマークの静止画） | Web版の起動演出を再生する |
