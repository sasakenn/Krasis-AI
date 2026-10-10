# スマホ版(iOS/Android)の公開準備

`desktop/`(Electron版Mac/Windows)と同じ考え方で、既存のReactフロントエンド(Web版)を
Capacitorでラップし、iOS/Androidアプリとして配布するための設定です。フロント資産をアプリに
同梱せず、`config.example.json`の`webUrl`(公開済みのWeb版URL)をネイティブのWebViewで
表示するだけの薄いラッパーにしてあります。ログイン・課金・API通信はすべて既存のWeb版と同じ
サーバー(FastAPI + Stripe)を使うため、バックエンド側の追加実装は不要です。

## 前提

- WebブラウザからアクセスできるURLで、Web版がHTTPS公開済みであること
- `config.example.json`の`webUrl`を本番URLへ変更してから同期・ビルドする
- Stripeの秘密鍵、JWT秘密鍵、Anthropic APIキーなどのサーバー秘密情報はアプリに含めない
  (すべてサーバー側にあり、アプリはWebViewとしてアクセスするだけなので問題ない)

## 現在の状態

`android/`と`ios/`のネイティブプロジェクトは生成・`cap sync`済みです。アプリアイコンは
`assets/`の元画像から`npx @capacitor/assets generate --iconBackgroundColor '#1F3BAE' --android --ios`
で生成しています(ブランド色の背景に本のアイコン)。

- Android: debug APKのビルドとエミュレータでの起動を確認済み。署名・リリースビルドは未実施。
- iOS: Simulator向けビルドと起動を確認済み。署名・実機・TestFlight・App Store提出は未実施(保留中)。

## ビルド環境の要件(ローカルでビルドする場合)

- Node.js 20以上
- Android: JDK 21(Temurin等)とAndroid SDK(`platforms;android-35`、`build-tools;35.0.0`)。
  `JAVA_HOME`と`ANDROID_HOME`を設定してから`cd android && ./gradlew assembleDebug`
  (出力: `android/app/build/outputs/apk/debug/app-debug.apk`)。
- iOS: Xcodeと、そのXcodeに対応するiOSプラットフォーム(Xcode > Settings > Components、または
  `xcodebuild -downloadPlatform iOS`)、CocoaPods。
  - OS付属のRuby 2.6ではCocoaPodsの導入が難しい。Homebrewの`cocoapods`を使うのが簡単。
  - Homebrewを使わない場合は`gem install --user-install`でユーザー領域に入れ、
    `GEM_HOME`と`PATH`(`~/.gem/ruby/2.6.0/bin`)を通す。ネイティブ拡張(`nkf`・`ffi`)が
    ビルドできないことがあり、`ffi`は古いバージョン(1.15.5)を使う必要があった。
  - Simulator向けビルド:
    `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build`

## セットアップ手順(このリポジトリを開発機で作業する人向け)

```bash
cd mobile
npm install

# 1. config.example.json の webUrl を本番URLに変更する

# 2. iOS: CocoaPodsを用意してからプラットフォームを追加
#    (Homebrewでのrbenv/CocoaPods導入例。詳細は https://capacitorjs.com/docs/getting-started/environment-setup )
#    brew install cocoapods
#    ios/ がまだない場合のみ実行
npx cap add ios

# 3. Android: Android Studioをインストールし、SDKのパスを通してから
#    android/ がまだない場合のみ実行
npx cap add android

# 4. webUrlをcapacitor.config.jsonへ反映してネイティブプロジェクトに同期
npm run sync
```

## 開発中の起動・実機確認

```bash
npm run open:ios      # Xcodeが開く。シミュレータ/実機で実行
npm run open:android  # Android Studioが開く。エミュレータ/実機で実行
```

`config.example.json`の`webUrl`を変更した場合は、`npm run sync`(内部で`apply-config.cjs`が
`capacitor.config.json`のserver.urlを書き換えたうえで`cap sync`する)を再実行してから
Xcode/Android Studioでビルドし直してください。

## ログイン(Sign in with Apple / Google)について

Web版の`frontend/index.html`はApple/GoogleのJS SDKをブラウザ上で読み込む方式です。
CapacitorのWebView内でも同じ方式で動作しますが、ネイティブアプリとしてストア審査に出す場合は
下記の追加対応を検討してください。

- iOS: Sign in with Appleをアプリ内に含める場合、Appleの審査ガイドライン上
  「他の外部ログイン手段を提供するなら、Sign in with Appleも選択肢として必須」になることが多い。
  すでにバックエンド(`auth.py`)はApple識別情報トークンの検証に対応済みなので、
  ネイティブの`Sign in with Apple`プラグイン(例: `@capacitor-community/apple-sign-in`)を
  追加してAPIに渡すidentity tokenの取得元をネイティブSDKに置き換えると、よりアプリらしい体験になる
- Android: Googleログインは現状のWebベースのフローで基本的に問題ないが、
  `@capacitor/google-sign-in`系のプラグインでネイティブ化するとUXが向上する

## ストア提出に向けたロードマップ

- **iOS**: Apple Developer Program登録(有料、$99/年)、App Store Connectでのアプリ登録、
  アプリアイコン・スクリーンショット・プライバシーポリシーの用意、審査提出
  - Mac App Store同様、アプリ内課金(サブスク)をストア経由で販売する場合はStoreKitへの
    切り替えが必要(`desktop/README.md`の該当節を参照)。Web版からの直接誘導のみであれば
    既存のStripe Checkoutをそのまま利用できる場合もあるが、iOSはApp内で外部決済への誘導を
    強く制限しているため、実際に販売する前にAppleの規約を確認すること
- **Android**: Google Playデベロッパー登録(有料、$25の一度払い)、Play Consoleでのアプリ登録、
  同様にアイコン・スクリーンショット・プライバシーポリシーの用意、審査提出
  - Google Playの課金ポリシーも、デジタルコンテンツの購入にはGoogle Play請求システムの
    利用を求められる場合があるため、販売前に確認すること

## 現状のまとめ

- ✅ Capacitorプロジェクトの雛形(`capacitor.config.json`・依存パッケージ・同期スクリプト)
- ✅ Android/iOSネイティブプロジェクト生成と`cap sync`
- ✅ Android debug APKのビルド・エミュレータ起動確認
- ✅ iOS Simulatorビルド・起動確認
- ⬜ 署名・リリースビルド(Android: キーストア作成、iOS: Developerアカウントが必要)
- ⬜ 実機での動作確認
- ⬜ ストアアカウント登録・審査提出

## 起動画面

- **ネイティブの起動画面**：暗い背景（#08090b）の中央に、ニューロンマークとうっすらしたネットワークを置いた静止画。
  - Android：`res/drawable*/splash.png` と、Android 12 以降用の `values/splash.xml`・`drawable/splash_mark.xml`
  - iOS：`Assets.xcassets/Splash.imageset` と `LaunchScreen.storyboard` の背景色
- **WebView の背景色**：`capacitor.config.json` の `backgroundColor` で同じ色にしている。読み込み中に白い画面が挟まらない。
- **その後の流れ**：Web 版が読み込まれると、ニューラルネットワークの起動演出（`frontend/public/krasis-splash.js`）が再生される。
