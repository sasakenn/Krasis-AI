# THYNORA 配布アプリ 残りのタスク

最終更新: 2026-10-27 / iOS を優先して進行中（macOS は保留）

## 現状の成果物（すべて未署名）
- Android: `mobile/android/app/build/outputs/apk/debug/app-debug.apk`（エミュレータで起動確認済み）
- Windows: `desktop/release/Paper Assistant Setup 1.0.0.exe`（x64、未署名。Windows 機でインストール・起動・ログインまで確認済み）
- macOS: `desktop/release/Paper Assistant-1.0.0-arm64.dmg`（保留。古いアイコンのまま）
- iOS: `mobile/ios/` にプロジェクト生成済み（保留。Simulator では起動確認済み）

## 完了済み
- [x] `mobile/README.md`・`desktop/README.md` にビルド環境の要件を追記
- [x] `.gitignore` の整理
- [x] favicon を本のアイコンに変更
- [x] `desktop/package.json` の整備（author、description、icon）
- [x] 変更のコミットと push（`main`）
- [x] Microsoft ログインの有効化（Azure のマルチテナント化とリダイレクト URI の登録、Render の環境変数）
- [x] ログイン失敗時のエラー表示、Microsoft の戻り先 URI の正規化
- [x] Google ログインのボタンが消える不具合を修正（公開サイトで確認済み）
- [x] Windows 版 EXE の動作確認（インストール・起動・ログイン）

## Windows
- [x] Windows 機で EXE のインストール・起動・ログインを確認
- [ ] 法人化の判断後、OV コードサイニング証明書を購入
- [ ] 証明書の受け取り方（USB トークン／クラウド署名）に合わせて署名設定
- [ ] Windows on ARM の需要を確認

## Android
- [x] 署名設定の仕組みを用意（`keystore.properties` があれば自動署名。手順は `mobile/README.md`）
- [ ] **署名用キーストアを自分で作成し、バックアップする（紛失すると更新できない）**
- [ ] 署名設定を入れて `assembleRelease`（APK）／`bundleRelease`（AAB）を作る
- [ ] Google Play の登録と公開（個人か法人かの判断が先）

## iOS（進行中。いちばん優先）
完了済み:
- [x] Apple Developer Program に登録、Team ID を Xcode に設定、署名（自動）と実機ビルド
- [x] Sign in with Apple（実機で動作確認済み）、`PrivacyInfo.xcprivacy`、entitlements
- [x] アカウント削除機能（`DELETE /me`）
- [x] アプリ内課金のコード（サーバーの Webhook、画面の購入・復元、RevenueCat プラグイン）
- [x] RevenueCat: アプリ登録、App Store Connect との接続、Offering `default`（`$rc_pro`・`$rc_max`）、Webhook、公開 SDK キー（公開サイトに反映済み）
- [x] App Store Connect: アプリ作成、サブスク 2 つ（Pro 1,400 円・Max 3,300 円）、審査用スクリーンショット
- [x] iOS のアプリ内では Google ボタンを非表示（Google は WebView でのログインを拒否するため）
- [x] 上部バーとステータスバー（時刻）の重なりを修正

未完了:
- [ ] **有料アプリ契約を「有効」にする**（署名・口座・税金・連絡先。口座は登録済み。ステータス要確認）
- [ ] 商品が App Store Connect から取得できるか確認（RevenueCat で「Pull from store」、Store Status が Missing Metadata でなくなること）
- [ ] サンドボックスのテスターを作り、iPhone で購入・復元・失効を試す
- [ ] プライバシーポリシーを完成させて公開（`PRIVACY.md` の角括弧を埋める。公開 URL が提出に必須）
- [ ] App Store Connect のアプリ情報（説明文、スクリーンショット、カテゴリ、年齢制限、サポート URL、プライバシー URL、「App のプライバシー」申告）
- [ ] TestFlight で配布して確認 → 審査に提出
- [ ] Xcode の黄色い警告「Update to recommended settings」を確認（任意）
- [ ] RevenueCat の確認メールのリンクを押す（未確認だと一部機能が使えない）
- [ ] RevenueCat の Test Store のサンプル商品（Lifetime・Yearly・Monthly）を整理（任意）

## macOS（保留）
- [ ] Developer ID 署名と公証、新アイコンで DMG を作り直す

## 依存パッケージ
- [ ] `npm audit` の high 8 件（開発用ツールの `http-cache-semantics` が原因。上流の修正待ち。`--omit=dev` では 0 件）
- [ ] `.github/dependabot.yml` の設定内容を確認

## 判断が必要なこと
- [ ] 法人化するか、いつするか（署名・ストア登録に影響）
- [ ] ストア公開の時期

## 補足
- 回避策: RevenueCat 5.67.1 は Xcode 27 でそのままだとビルドできないため、`mobile/ios/App/Podfile` の post_install で 1 か所を自動修正している。RevenueCat が修正版を出したら削除する。
- Render の環境変数（RevenueCat 関連）: `VITE_REVENUECAT_IOS_API_KEY`、`REVENUECAT_WEBHOOK_AUTH`、`APPLE_CLIENT_ID`（`com.thynora.app` を含める）は設定済み。
