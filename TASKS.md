# THYNORA 配布アプリ 残りのタスク

最終更新: 2026-10-17 / Apple 版（iOS・macOS）は保留中

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

## iOS アプリ内課金（コードは実装済み。アカウントと商品登録が必要）
- [x] サーバー: RevenueCat Webhook（`/billing/revenuecat/webhook`）、プランの出どころ管理（Stripe/Apple）
- [x] 画面: iOS アプリ内で購入・復元・サブスク管理（`frontend/src/iap.js`）
- [x] アカウント削除機能（`DELETE /me`）
- [ ] RevenueCat のアカウント作成、商品・Offering の登録、Render の環境変数設定（手順は `mobile/README.md`）
- [ ] サンドボックスで購入・復元・失効のテスト（Apple Developer アカウントが必要）
- [ ] Sign in with Apple のボタン、プライバシーポリシーのページ、`PrivacyInfo.xcprivacy`

## Apple 版（保留）
- [ ] Apple Developer Program の登録（個人か組織か）
- [ ] iOS: 署名、実機テスト、TestFlight、App Store 提出
- [ ] macOS: Developer ID 署名と公証、新アイコンで DMG を作り直す

## 依存パッケージ
- [ ] `npm audit` の high 8 件（開発用ツールの `http-cache-semantics` が原因。上流の修正待ち。`--omit=dev` では 0 件）
- [ ] `.github/dependabot.yml` の設定内容を確認

## 判断が必要なこと
- [ ] 法人化するか、いつするか（署名・ストア登録に影響）
- [ ] ストア公開の時期

## 仕様や資格情報がなく、未実装・未実行のもの
- ストア課金、アカウント削除機能、プライバシー対応（ストア審査で必須になることが多い）
- 審査提出
