# セキュリティポリシー・インシデント対応手順

Paper Assistant のセキュリティ対策の実装箇所と、運用手順(インシデント対応・鍵管理・脆弱性管理・教育)をまとめる。
クレジット取引セキュリティ対策協議会のチェックリスト5分野に対応する。

## 脆弱性の報告

脆弱性を見つけた場合は、公開のIssueではなく `SECURITY_CONTACT_EMAIL`(`.env`)宛にメールで連絡する。
報告には再現手順・影響範囲・発見日時を含める。受領後2営業日以内に一次回答する。

## 1. アクセス制御

| 対策 | 実装箇所 |
|---|---|
| パスワードを自社で保存しない(Apple/Google/GitHub の外部認証、またはメール+ログインコード) | `auth.py`, `app.py` `/auth/*` |
| ログインコードはSHA-256ハッシュのみ保存し、定数時間比較で照合 | `app.py` `_hash_code`, `hmac.compare_digest` |
| TOTP方式の多要素認証(認証アプリ)。有効化するとログインコードだけではログインできない | `mfa.py`, `app.py` `/auth/mfa/*`, `db.py` `mfa_enrollments` |
| MFA入力待ちの仮認証トークンは5分で失効し、通常のAPIには使えない | `auth.py` `create_mfa_token` / `decode_mfa_token` |
| 連続ログイン失敗によるアカウント一時ロック(既定: 15分間に10回失敗でロック) | `app.py` `_register_login_failure`, `CODE_AUTH_MAX_FAILURES` |
| メールアドレス単位のレート制限(既定: 5回/分) | `app.py` `_enforce_code_auth_rate_limit` |
| APIキー・署名鍵はすべて環境変数(`.env`)で管理し、Gitに含めない | `.env.example`, `.gitignore` |

外部サービスの管理アカウント(Stripe / SendGrid / Cloudflare / Xserver / GitHub / Anthropic Console)は、
それぞれの管理画面で**必ず二要素認証を有効化**する。これはコードでは強制できないので、下記「教育・体制」のチェックリストで確認する。

## 2. データ管理(暗号化)

| 対策 | 実装箇所 |
|---|---|
| 通信の暗号化: `FORCE_HTTPS=1` でHTTP→HTTPSリダイレクトと `Strict-Transport-Security` を付与 | `app.py` `SecurityHeadersMiddleware` |
| セキュリティヘッダー(`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`)を全レスポンスに付与 | 同上 |
| 保存データの暗号化: 生成内容(`generations.outline_json`)とMFAシークレットを Fernet(AES-128-CBC + HMAC)で暗号化 | `crypto_utils.py`, `db.py` |
| カード情報は保存・処理・通過させない(Stripe Checkoutへのリダイレクト方式) | `app.py` `/billing/*` |

`DATA_ENCRYPTION_KEY` 未設定の場合は平文で保存される(起動時に警告)。**本番では必ず設定する。**
鍵を後から設定しても、それ以前の平文行はそのまま読める(暗号化済みの値には `enc:v1:` 接頭辞が付く)。

## 3. 脆弱性管理

- **Dependabot**(`.github/dependabot.yml`): pip / npm の依存を毎週月曜に確認し、更新PRを自動作成する。セキュリティアドバイザリが出た依存は即時PRになる。
- **手動チェック**: リリース前と月1回、`scripts/security_check.sh` を実行して結果を確認する。
- Dependabot のPRは1週間以内にレビューしてマージする。`severity: high` 以上は3営業日以内。
- Python / Node.js のランタイム、ホスティング環境のOSは四半期ごとにサポート状況を確認する。

## 4. インシデント対応手順

「インシデント」= 不正ログインの疑い、シークレットの漏えい(`.env` の誤コミット等)、依存ライブラリの重大脆弱性、データの漏えい・改ざん・消失、サービス停止。

### 4-1. 検知

- `security_events` テーブル(ログイン失敗・ロック・MFA変更が記録される)を確認する:
  ```bash
  sqlite3 data/app.db "SELECT created_at, event_type, subject, detail FROM security_events ORDER BY id DESC LIMIT 100;"
  ```
- `logs/backend.log` の `WARNING` / `ERROR` 行、Stripe / SendGrid ダッシュボードの異常な利用量を確認する。
- 利用者からの報告は「脆弱性の報告」窓口で受ける。

### 4-2. 初動(検知から1時間以内)

1. 発生日時・検知経路・影響の可能性がある範囲を `docs/incidents/YYYY-MM-DD.md` に記録し始める(時系列で追記する)。
2. 影響が拡大中なら、サービスを一時停止する: `./stop.sh`(launchd経由なら `launchctl bootout gui/$(id -u)/com.sasahiromichi.paperassistant.api`)。
3. 決済に関わる場合はStripeダッシュボードで該当の支払い・サブスクを確認し、必要ならStripeのサポートに連絡する。

### 4-3. 封じ込め・根絶

| 状況 | 対処 |
|---|---|
| セッショントークンの漏えい / 不正ログインの疑い | `.env` の `JWT_SECRET` を再生成する(`openssl rand -hex 32`)。**全ユーザーが強制ログアウト**され、既存トークンは全て無効になる |
| Stripe / SendGrid / Anthropic のAPIキー漏えい | 各ダッシュボードで該当キーを失効させ、新しいキーを `.env` に設定して再起動 |
| `DATA_ENCRYPTION_KEY` の漏えい | 新しい鍵を生成し、既存データを旧鍵で復号→新鍵で再暗号化する移行スクリプトを実行してから鍵を差し替える(鍵の削除だけでは既存データが読めなくなる) |
| 特定ユーザーの認証アプリ紛失・乗っ取り | 本人確認のうえ `sqlite3 data/app.db "DELETE FROM mfa_enrollments WHERE user_id='...'"` でMFAを解除し、ログインコードを再発行してもらう |
| 依存ライブラリの重大脆弱性 | 修正版へ更新して `pytest` / `npm test` を通し、再デプロイ |
| `.env` や鍵をGitに誤コミット | 直ちに該当の全シークレットをローテーションする(履歴から消しても漏えい済みとみなす) |

### 4-4. 復旧

1. 対処後、`./start.sh` でサービスを再開し、`curl http://127.0.0.1:8000/health` と実際のログイン・生成を確認する。
2. 影響を受けた利用者へ、事象・影響・こちらで行った対処・利用者側で必要な対応(再ログイン等)をメールで通知する。
3. カード情報・個人情報の漏えいが疑われる場合は、契約先の決済代行会社(Stripe)・アクワイアラへ報告し、個人情報保護委員会への報告要否を確認する。

### 4-5. 事後対応(復旧から1週間以内)

- 原因・時系列・影響範囲・再発防止策を `docs/incidents/YYYY-MM-DD.md` にまとめる。
- 再発防止策をIssue化し、必要ならこの文書と `.env.example` を更新する。

## 5. 教育・体制

この開発に関わる全員(新しく参加する人を含む)は、着手前に以下を確認し、年1回見直す。

### 着手時チェックリスト

- [ ] `.env` はGitに含めない。`.env.example` にはダミー値しか書かない。
- [ ] シークレットをチャット・Issue・スクリーンショットに貼らない。
- [ ] Stripe / SendGrid / Cloudflare / Xserver / GitHub / Anthropic Console の自分のアカウントで二要素認証を有効にした。
- [ ] 自分のPaper Assistantアカウントで、サイドバー「セキュリティ設定」から認証アプリ(MFA)を有効にした。
- [ ] `SECURITY.md`(この文書)のインシデント対応手順を読んだ。
- [ ] 本番の `.env` に `DATA_ENCRYPTION_KEY` / `FORCE_HTTPS=1` / 十分に長い `JWT_SECRET` が設定されていることを確認した。`DEV_BYPASS_USER_ID` は空である。

### 変更を入れるときのルール

- 認証・課金・メール送信に触る変更は、必ずテスト(`pytest`, `npm test`)を追加してから入れる。
- 新しい外部サービスを使うときは、そのAPIキーの権限を最小限(例: SendGridなら Mail Send のみ)にする。
- ログにメールアドレス以外の個人情報・トークン・コードを出力しない。
- ユーザー入力をプロンプトやSQLに渡すときは、既存のパラメータ化されたクエリ・Pydanticモデルを使う。

### 定期レビュー記録

| 実施日 | 実施者 | 内容 |
|---|---|---|
| | | 初回レビュー(記入してください) |
