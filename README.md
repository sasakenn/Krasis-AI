Paper Writing Assistant

FastAPI バックエンド(`generate_outline` + OpenAlex文献検索)と、React(Vite)フロントエンドで構成された調査アウトライン生成アシスタントです。

## 起動・停止(推奨)

バックエンドとフロントエンドをまとめて起動・停止できるスクリプトを用意しています。既に起動中のポートは自動でスキップするので、何度実行しても安全です。

```bash
./start.sh   # バックエンド(:8000)とフロントエンドを(:5173)をバックグラウンドで起動
./status.sh  # 起動状態を確認
./stop.sh    # 両方とも停止
```

- ログは `logs/backend.log` / `logs/frontend.log` に出力されます。
- プロセスのpidは `.run/backend.pid` / `.run/frontend.pid` に記録されます(手動で消して問題ありません)。
- 起動後、ブラウザで http://localhost:5173 を開いてください(`/generate` などのAPIリクエストはViteのプロキシ設定でバックエンドに転送されます)。

## 手動で起動する場合

1) 依存関係のインストール:

```bash
./venv/bin/python -m pip install -r requirements.txt
cd frontend && npm install
```

2) バックエンドを起動:

```bash
./venv/bin/python app.py
```

3) フロントエンドを起動(別ターミナル):

```bash
cd frontend && npm run dev
```

## ログイン時の自動起動(launchd)

macOSのlaunchdにバックエンド/フロントエンドを登録すると、ログイン時に自動起動し、落ちたら自動再起動するようになります。

```bash
./launchd/install.sh    # 登録して起動確認まで行う
./launchd/uninstall.sh  # 登録解除(start.sh/stop.shでの手動運用に戻る)
```

- plistは `$HOME/Library/LaunchAgents/` にコピーされます(リポジトリ内のパスをフルパスで参照するため、クローン先が異なる場合は plist 内のパスを合わせてください)。
- ログは `logs/backend.log` / `logs/frontend.log` に出力されます(start.sh/stop.shと共通)。

## APIキーの設定

`.env.example` を `.env` にコピーし、`ANTHROPIC_API_KEY` を設定してください(未設定でも `generate_outline` は簡易フォールバックで動作します)。ログイン機能を試すには、少なくとも `JWT_SECRET` と `DEV_BYPASS_USER_ID` の設定を推奨します(下記「認証」セクション参照)。

```bash
cp .env.example .env
cp frontend/.env.example frontend/.env   # 任意: Apple/Google/GitHubの実クライアントIDを使う場合のみ
```

## APIの動作確認(curl)

`/generate` は multipart/form-data を受け取ります。初回は分量(文字数)未指定で質問が返るので、`target_length` を付けて再送してください。

```bash
# 1回目: 分量の選択肢が返る
curl -X POST http://127.0.0.1:8000/generate \
  -F "topic=生成AIが学術論文の執筆プロセスに与える影響" \
  -F "field=教育技術"

# 2回目: target_length を指定して実際に生成
curl -X POST http://127.0.0.1:8000/generate \
  -F "topic=生成AIが学術論文の執筆プロセスに与える影響" \
  -F "field=教育技術" \
  -F "target_length=1001-3000"
```

任意で参考資料・フォーマット指定ファイルも添付できます: `-F "reference_files=@notes.txt" -F "format_file=@format.txt"`

## 認証(Apple / Google / GitHub / Microsoft でのログイン) — マルチユーザー・Web強制ログイン対応

`/generate` `/history*` `/sessions*` `/me` はすべて `Authorization: Bearer <token>` を要求し、`generations` / `sessions` はDB上でuser_idごとに分離されます(他人のデータは一覧にも出ないし、直接IDを指定しても404になります)。フロントエンドも強制ログイン制で、未ログインだと専用のログイン画面が表示されます。

**ログイン方法は5つ**、いずれもフロントエンドのログイン画面から使えます:

| 方法 | フロントエンドに必要な設定 | バックエンドに必要な設定 |
|---|---|---|
| Apple | `frontend/.env` の `VITE_APPLE_CLIENT_ID` | `.env` の `APPLE_CLIENT_ID` |
| Google | `frontend/.env` の `VITE_GOOGLE_CLIENT_ID` | `.env` の `GOOGLE_CLIENT_ID` |
| GitHub | `frontend/.env` の `VITE_GITHUB_CLIENT_ID` / `VITE_GITHUB_REDIRECT_URI` | `.env` の `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` |
| Microsoft | `frontend/.env` の `VITE_MICROSOFT_CLIENT_ID` / `VITE_MICROSOFT_REDIRECT_URI` | `.env` の `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` |
| メール+ログインコード | 設定不要(常に使える) | 任意で`SMTP_*`(下記) |

各プロバイダーのクライアントID等は無料で取得できます(Apple Developer Programのみ登録自体が有料の$99/年、Google/GitHub/Microsoftはアプリ登録自体は無料)。未設定のプロバイダーはログイン画面でボタンが無効表示になるだけで、他のプロバイダーやアプリ全体の動作には影響しません。

Microsoftは個人アカウント・組織(Microsoft 365等)アカウントのどちらでもログインできるマルチテナント設定を前提にしています(Azure Portal→「アプリの登録」→「サポートされているアカウントの種類」で「任意の組織のディレクトリ内のアカウントと個人のMicrosoftアカウント」を選択)。GitHubと同じ認可コード方式(OIDCではない)で、Microsoft Graph APIの`/me`からプロフィールを取得します。「リダイレクトURI」には本番URL(例: `https://app.krasis.xyz`)を「Web」プラットフォームとして登録してください。

**⚠️ 同じ人でもプロバイダー(方法)が違えば別アカウント扱いです**(例: Appleでログインした後にGoogleでログインしても、内部的には別ユーザーとしてデータが分かれます)。自動アカウント統合は未実装です。

### メール+ログインコードでのログイン

Google/GitHubのアカウントを使いたくない場合向けに、外部アカウント不要のログイン方式も用意されています。ログイン画面で:

1. **新規登録**: メールアドレスを入力すると、12桁の乱数コード(例: `a3f9e2b71c4d`)がメールでのみ届きます(画面やAPIレスポンスには一切表示されません)。この時点ではまだログインしておらず、続けて「ログイン」タブでそのコードを入力する必要があります(コードの持ち主であることを確認する前にセッションを発行しない仕様。他人のメールアドレスを指定するだけでそのアカウントに侵入できてしまう脆弱性を防ぐため)。
2. **ログイン**: 登録済みのメールアドレス+コードでログインします。
3. **コードを忘れた**: メールアドレスを入力すると新しいコードが発行され、メールで送られます(古いコードは失効します)。登録の有無を外部に漏らさないため、未登録のメールアドレスでも同じ完了メッセージが表示されます。

コードは平文では保存されずSHA-256のハッシュのみDBに保持します。乱用防止のため、同じメールアドレスに対する新規登録・再発行は`CODE_AUTH_RATE_LIMIT_PER_MINUTE`(デフォルト5件/分)でレート制限されます。

**メール送信の設定**(任意): `.env`の`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM`を設定すると実際にメールが届きます(Gmailなら「アプリパスワード」が簡単)。未設定でも機能自体は問題なく動作し、コードは画面にも表示されるほか、メール本文はサーバーのログ(`logs/backend.log`)に出力されます。

**ローカルでの動作確認**(実プロバイダーの認証情報が無くてもOK): `.env` に `DEV_BYPASS_USER_ID` を設定すると、

1. ログイン画面に「🛠 開発用ログイン」ボタンが現れ、ワンクリックでその固定ユーザーとしてログインできる
2. curl等から `X-Dev-User-Id` ヘッダーで任意のuser_idを名乗ってAPIを直接叩ける

**本番環境では絶対に設定しないこと**(誰でも他人になりすませてしまう)。

```bash
# .env(ローカル開発用)
DEV_BYPASS_USER_ID=local-dev-user
```

```bash
curl http://127.0.0.1:8000/history -H "X-Dev-User-Id: local-dev-user"
```

なお、user_id列の追加前に作成された既存データは、`legacy-local-user` という固定IDの所有として自動的に引き継がれます(`db.py`の`init_db()`が起動時に一度だけマイグレーションする)。

また、誤操作や不具合でのClaude APIコスト暴走を防ぐため、`/generate`にはユーザーごとに1分あたりのリクエスト数の簡易レート制限があります(デフォルト20件、`.env`の`GENERATE_RATE_LIMIT_PER_MINUTE`で変更、0以下で無効化)。

## トークン利用量・プラン(月額サブスクの土台)

ユーザーごとに`free`/`pro`/`max`プランとトークン使用量(`entitlements`テーブル)を持ち、`/generate`はClaudeの実トークン消費量(`input_tokens + output_tokens`)を積算し、月初(UTC基準)に自動でリセットします。上限に達すると`/generate`は`402`を返し、フロントエンドにわかりやすいメッセージが表示されます。

```bash
curl http://127.0.0.1:8000/me -H "X-Dev-User-Id: local-dev-user"
# → {"user_id": "...", "plan": "free", "tokens_used": 123, "period_start": "...", "tokens_quota": 20000}
```

プラン枠は`app.py`の`PLAN_TOKEN_QUOTAS`で定義(デフォルト free=20,000 / pro=200,000 / max=1,000,000)。

## 課金(Stripeサブスク)

Pro/MaxプランはStripe Checkout(サブスク)で購入し、Stripe Webhookでの通知を受けて自動的にプランが切り替わります。`.env`の`STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_MAX`が未設定の間は`/billing/*`は`503`を返すだけで、それ以外の機能(生成・履歴・ログイン等)には一切影響しません。

**設定手順**(Stripeアカウント作成後):

1. Stripeダッシュボードで月額プラン(商品)を2つ作成し、それぞれのPrice IDを`STRIPE_PRICE_ID_PRO` / `STRIPE_PRICE_ID_MAX`に設定
2. ダッシュボードの「開発者」→「APIキー」からシークレットキーを取得し`STRIPE_SECRET_KEY`に設定
3. Webhookエンドポイントとして `<公開URL>/billing/webhook` を登録し、発行された署名シークレットを`STRIPE_WEBHOOK_SECRET`に設定(ローカル確認には `stripe listen --forward-to localhost:8000/billing/webhook` が使える)
4. `FRONTEND_ORIGIN`にフロントエンドの実際のURLを設定(Checkout/ポータル完了後の戻り先になる)

```bash
curl -X POST http://127.0.0.1:8000/billing/checkout -d '{"plan":"pro"}' -H 'Content-Type: application/json' -H "X-Dev-User-Id: local-dev-user"
# → {"checkout_url": "https://checkout.stripe.com/..."}  フロントエンドはこのURLへリダイレクトする

curl -X POST http://127.0.0.1:8000/billing/portal -H "X-Dev-User-Id: local-dev-user"
# → {"portal_url": "https://billing.stripe.com/..."}  契約者向けの管理・解約ポータル
```

フロントエンドはFreeプランのユーザーにサイドバーで「Proにアップグレード」「Maxにアップグレード」ボタンを、契約者には「プランを管理」ボタンを表示します。Webhookが処理するイベントは `checkout.session.completed`(StripeのCustomer IDを紐付け)、`customer.subscription.created` / `.updated`(プラン反映、`active`/`trialing`以外のステータスは反映しない)、`customer.subscription.deleted`(freeへ自動ダウングレード)です。

## シークレット(非公開)履歴

生成時にコンポーザーの「🔒 シークレットとして保存」にチェックを入れると、その履歴は通常の一覧から除外され、サイドバーの「🔒」トグルをONにしたときだけ表示されます(混在はしません)。後から個々の履歴を🔒/🔓ボタンで公開⇄非公開に切り替えることもできます。アクセス制御ではなく可視性フラグなので、URLやIDを直接知っていれば(同じユーザー本人なら)スコープに関係なく取得できます。

```bash
curl -X POST http://127.0.0.1:8000/generate -F "topic=..." -F "target_length=1-100" -F "private=true" -H "X-Dev-User-Id: local-dev-user"
curl "http://127.0.0.1:8000/history?scope=private" -H "X-Dev-User-Id: local-dev-user"
curl -X PUT http://127.0.0.1:8000/history/1/private -d '{"is_private": true}' -H 'Content-Type: application/json' -H "X-Dev-User-Id: local-dev-user"
```

## 生成履歴(SQLite)

`/generate` で生成に成功したアウトラインは、サーバー側のSQLite(`data/app.db`、初回起動時に自動作成)へ自動保存されます。

```bash
curl http://127.0.0.1:8000/history                       # 履歴一覧(新しい順、非公開は除く)
curl "http://127.0.0.1:8000/history?q=キーワード"          # topic/titleでの部分一致検索
curl "http://127.0.0.1:8000/history?scope=private"        # 非公開(シークレット)履歴のみ
curl http://127.0.0.1:8000/history/1                      # 特定の履歴の詳細(アウトライン全体を含む)
curl -X DELETE http://127.0.0.1:8000/history/1            # 履歴の削除
```

(いずれも認証ヘッダーが必要。上記「認証」セクション参照)

フロントエンドのサイドバーにも「履歴」として一覧表示され、検索ボックスで絞り込み、クリックすると新しいタブでその内容を開き直せます。各項目にカーソルを合わせると削除ボタンが表示されます。`data/` は`.gitignore`対象です。

## タブ(セッション)の永続化

チャットのタブ(セッション)はブラウザのlocalStorageではなくサーバー側SQLiteに保存されるため、別のブラウザ・別の端末から開いても同じタブ構成が復元されます。

```bash
curl http://127.0.0.1:8000/sessions                                  # タブ一覧
curl -X POST http://127.0.0.1:8000/sessions -d '{"title":"新規タブ"}' -H 'Content-Type: application/json'
curl -X PUT http://127.0.0.1:8000/sessions/1 -d '{"title":"...", "messages":[...]}' -H 'Content-Type: application/json'
curl -X DELETE http://127.0.0.1:8000/sessions/1
```

## 本番ビルドを単一プロセスで配信する場合

開発時は`./start.sh`でViteの開発サーバー(:5173、`/generate`等はプロキシ設定でバックエンドへ転送)を使いますが、フロントエンドをビルド済みにすれば、バックエンド(:8000)単体でAPIと画面の両方を同一オリジンから配信できます(devサーバーやリバースプロキシ不要)。

```bash
cd frontend && npm run build   # frontend/dist/ が作られる
cd .. && ./venv/bin/python app.py
# → http://127.0.0.1:8000/ を開くとAPIと画面が両方この1プロセスから配信される
```

`frontend/dist/`が存在しない場合(通常の開発時)は何も変わらず、これまで通りVite開発サーバー経由での利用になります。

## クラウドへのデプロイ(Render)

`Dockerfile`と`render.yaml`を用意済みです。SQLite(`data/app.db`)を使うため、永続ディスクが使えるプラン(Renderなら Starter 以上)が必要です。

1. GitHubにこのリポジトリをpushする(未作成の場合はGitHubで新規リポジトリを作成してから):
   ```bash
   git remote add origin <GitHubリポジトリのURL>
   git push -u origin main
   ```
2. [Render](https://dashboard.render.com/)で「New +」→「Blueprint」から、上記リポジトリを選ぶ。`render.yaml`を検出して、Webサービス(Docker)と永続ディスク(`/data`)が自動作成される。
3. Renderのダッシュボードで、`sync: false`になっている環境変数(`STRIPE_SECRET_KEY`・`JWT_SECRET`・`DATA_ENCRYPTION_KEY`など)に値を入力する。ローカル開発用の値を使い回さず、本番用に新しく発行し直すこと。
4. カスタムドメインを使う場合は、Renderの「Settings → Custom Domain」で追加し、表示されるCNAMEレコードをDNS側(ドメインのレジストラ/DNSサービス)に追加する。RenderがLet's EncryptでHTTPSを自動発行する。
5. Stripeの本番Webhookエンドポイント(`https://<本番ドメイン>/billing/webhook`)をStripeダッシュボードの「開発者→Webhook」で作成し、`checkout.session.completed`・`customer.subscription.created`・`customer.subscription.updated`・`customer.subscription.deleted`を選択。発行された署名シークレット(`whsec_...`)を`STRIPE_WEBHOOK_SECRET`に設定する。
6. Apple/Google/GitHubの各OAuth設定(各デベロッパーコンソール)に、本番ドメインのリダイレクトURI/オリジンを追加する。
7. `FRONTEND_ORIGIN`は本番ドメイン(`https://<本番ドメイン>`)に設定する(Checkout/カスタマーポータル完了後の戻り先になる)。

## テスト

```bash
./venv/bin/python -m pytest         # バックエンド
cd frontend && npm test             # フロントエンド(Vitest + Testing Library)
```

## 構成

- `app.py`: Web API(`/auth/apple`, `/auth/google`, `/auth/github`, `/auth/dev`, `/auth/code/signup`, `/auth/code/login`, `/auth/code/reissue`, `/generate`, `/generate/body`, `/course-chat`, `/tasks`, `/task-generator`, `/study-notes`, `/health`, `/history`, `/history/{id}`, `/history/{id}/private`, `/me`, `/billing/checkout`, `/billing/portal`, `/billing/webhook`, `/sessions`, `/sessions/{id}`)。ファイルアップロードの読み取り・OpenAlex検索の並列付加もここ。`frontend/dist/`が存在する場合はそれを`/`に静的マウントする。
- `auth.py`: Apple/Googleのidentity token検証(共通のOIDC検証ロジック)、GitHubの認可コード交換、アプリ独自セッションJWTの発行・検証。
- `mailer.py`: メール+ログインコード用の通知メール送信(SMTP設定があれば送信、無ければログ出力のみ)。
- `outline.py`: Claudeを使ったアウトライン生成(`generate_outline`)。APIキー未設定時はルールベースのフォールバック。生成時のトークン利用量も返す。
- `search.py`: OpenAlexで関連文献を検索(`search_literature`)。
- `study_notes.py`: レポート・資料のテキストから、暗記すべき要点・全体の流れ(Mermaidのflowchart)・復習用の質問を整理する(`generate_study_notes`)。フロントエンドの`# study-notes`チャンネルからテキスト貼り付けまたはtxt/md/pdf/docxファイルの添付で利用できる。
- `db.py`: ユーザー・生成履歴・タブ(セッション)・利用量エンタイトルメント・Stripe顧客ID・メールログインコードをSQLiteに保存・参照する。すべてuser_idでスコープされる。
- `frontend/`: React(Vite)フロントエンド。強制ログイン制のSlack風チャットUIで、参考資料・フォーマット指定ファイル・プロンプトを送信できる。サイドバーにプラン利用量・アップグレード導線もある。

## App Store公開に向けたロードマップ

今回実装したのはマルチユーザー化 + マルチプロバイダーログイン + トークン利用量のゲート機構 + 非公開履歴 + Stripeサブスク連携。残りは以下の想定(いずれもユーザー本人のアカウント作成・契約が前提):

- Google Cloud Console / GitHub でのOAuthクライアント作成、Stripeアカウント開設・商品作成(いずれも無料、Stripeのみ本人確認あり)
- クラウドへの常時デプロイ(Dockerfile・ホスティング・HTTPS)
- Electronで既存Reactをラップした Mac/Windows版の配布設定を`desktop/`に追加済み。Mac App Store向けにはStoreKit課金への切り替えが別途必要
- Capacitorで既存Reactをラップした iOS/Android版の配布設定を`mobile/`に追加済み(WebViewでWeb版URLを表示する薄いラッパー)。このマシンにはCocoaPods/Android SDKが未導入のため、`ios/`・`android/`ネイティブプロジェクトの生成はまだ未実施。手順は`mobile/README.md`を参照
- Apple Developer Program登録(有料、$99/年)・App Store Connectでのアプリ登録・審査提出(ここはユーザー本人のApple IDでの操作が必須)
- Android版はGoogle Playデベロッパー登録(有料、$25の一度払い)・Play Consoleでのアプリ登録・審査提出が別途必要

### 課金・Mac/Windows/スマホ配布

- Web版と公式サイトからの直接配布は、実装済みのStripe Checkout / Customer Portalを利用する
- Mac App Store・Google Playでデジタル機能を販売する場合は、各ストアの規約上StoreKit/Google Play請求システムへの切り替えが必要になることがある。App Store Connect/Play Consoleで商品を作成する
- Windows版は`desktop/README.md`の手順でNSISインストーラーを作成できる。Microsoft Store提出には署名とストア用メタデータが必要
- デスクトップ版・スマホ版からAPIを別ドメインへ接続する場合は、`frontend/.env`の`VITE_API_ORIGIN`(Web版ビルド)と`mobile/config.example.json`の`webUrl`(スマホ版が読み込むWeb版URL)を設定する。Stripe秘密鍵などのサーバー秘密情報はアプリに含めない
