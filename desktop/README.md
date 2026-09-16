# デスクトップ版の公開準備

このフォルダは、既存のReact画面をElectronでMac/Windowsアプリとして配布するための設定です。

## 前提

- APIはHTTPSで公開されたFastAPIサーバーを使う
- Stripeの秘密鍵、JWT秘密鍵、Anthropic APIキーはアプリに含めない
- `desktop/config.example.json` の `webUrl` / `apiOrigin` を本番URLへ変更してからビルドする
- `frontend/.env` のOAuthクライアントIDと `VITE_API_ORIGIN` を設定してからフロントをビルドする

## Mac版

```bash
cd desktop
npm install
npm run dist:mac
```

`release/` に `.dmg` が生成されます。App Store提出にはApple Developer Program、署名用Developer ID、Notarization、App Store Connectの登録が別途必要です。

## Windows版

```powershell
cd desktop
npm install
npm run dist:win
```

`release/` にNSISインストーラーが生成されます。Microsoft Store提出時はパッケージ署名、ストア用メタデータ、プライバシーポリシーURLが必要です。

## 課金の扱い

- Web版と公式サイトから直接配布するデスクトップ版: 既存のStripe Checkout / Customer Portalを利用
- Mac App Store版: デジタル機能のサブスクはAppleのStoreKit課金へ差し替える必要がある。StripeをMac App Store内の購入導線として使わない
- Windows版: ストア規約を確認し、Web課金を使う場合も購入後のプラン反映はサーバー側のStripe Webhookで行う

Mac App Store向けのStoreKit実装は、App Store Connectで商品IDを作成した後、別の課金アダプターとして追加する。Web版のStripe APIはそのまま残し、配布チャネルごとに購入方法を分ける。

## 署名と公開前チェック

1. 本番APIをHTTPSで公開し、OAuthのリダイレクトURLを登録する
2. `STRIPE_WEBHOOK_SECRET` とPrice IDを本番環境だけに設定する
3. `/health`、新規ログイン、生成、Pro購入、解約、期限切れ反映を確認する
4. MacはDeveloper ID署名とNotarization、Windowsはコード署名を設定する
5. プライバシーポリシー、利用規約、サポートURL、アプリのスクリーンショットを用意する
