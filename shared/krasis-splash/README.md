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
});
KrasisSplash.skip();        // 外から終わらせる
```

## 注意

- OS で「視差効果を減らす」（prefers-reduced-motion）を有効にしている人には、既定では表示しない。`force: true` を渡すと表示する。
- 画面全体を覆う（`z-index: 2147483000`）。
- フォントは IBM Plex Mono。読み込んでいなければ、等幅の代わりのフォントで表示される。
- CSP で `style-src 'unsafe-inline'` を許可していないアプリでは、JS による CSS の自動挿入がブロックされる。`krasis-splash.css` を `<link>` で読み込めば動く。読み込み済みなら、JS は CSS を挿入しない。
