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

## 認証(Apple / Google / GitHub でのログイン) — マルチユーザー・Web強制ログイン対応

`/generate` `/history*` `/sessions*` `/me` はすべて `Authorization: Bearer <token>` を要求し、`generations` / `sessions` はDB上でuser_idごとに分離されます(他人のデータは一覧にも出ないし、直接IDを指定しても404になります)。フロントエンドも強制ログイン制で、未ログインだと専用のログイン画面が表示されます。

**ログイン方法は3つ**、いずれもフロントエンドのログイン画面から使えます:

| プロバイダー | フロントエンドに必要な設定 | バックエンドに必要な設定 |
|---|---|---|
| Apple | `frontend/.env` の `VITE_APPLE_CLIENT_ID` | `.env` の `APPLE_CLIENT_ID` |
| Google | `frontend/.env` の `VITE_GOOGLE_CLIENT_ID` | `.env` の `GOOGLE_CLIENT_ID` |
| GitHub | `frontend/.env` の `VITE_GITHUB_CLIENT_ID` / `VITE_GITHUB_REDIRECT_URI` | `.env` の `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` |

各プロバイダーのクライアントID等は無料で取得できます(Apple Developer Programは登録自体が有料の$99/年)。未設定のプロバイダーはログイン画面でボタンが無効表示になるだけで、他のプロバイダーやアプリ全体の動作には影響しません。

**⚠️ 同じ人でもプロバイダーが違えば別アカウント扱いです**(例: Appleでログインした後にGoogleでログインしても、内部的には別ユーザーとしてデータが分かれます)。自動アカウント統合は未実装です。

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

プラン枠は`app.py`の`PLAN_TOKEN_QUOTAS`で定義(デフォルト free=20,000 / pro=200,000 / max=1,000,000)。**現時点では決済(Stripe/StoreKit)は未接続**で、プラン変更は`db.py`の`set_plan(user_id, plan)`を直接呼ぶ手動運用です(将来、決済のWebhookから呼ぶ想定)。

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

## テスト

```bash
./venv/bin/python -m pytest         # バックエンド
cd frontend && npm test             # フロントエンド(Vitest + Testing Library)
```

## 構成

- `app.py`: Web API(`/auth/apple`, `/auth/google`, `/auth/github`, `/auth/dev`, `/generate`, `/health`, `/history`, `/history/{id}`, `/history/{id}/private`, `/me`, `/sessions`, `/sessions/{id}`)。ファイルアップロードの読み取り・OpenAlex検索の並列付加もここ。`frontend/dist/`が存在する場合はそれを`/`に静的マウントする。
- `auth.py`: Apple/Googleのidentity token検証(共通のOIDC検証ロジック)、GitHubの認可コード交換、アプリ独自セッションJWTの発行・検証。
- `outline.py`: Claudeを使ったアウトライン生成(`generate_outline`)。APIキー未設定時はルールベースのフォールバック。生成時のトークン利用量も返す。
- `search.py`: OpenAlexで関連文献を検索(`search_literature`)。
- `db.py`: ユーザー・生成履歴・タブ(セッション)・利用量エンタイトルメントをSQLiteに保存・参照する。すべてuser_idでスコープされる。
- `frontend/`: React(Vite)フロントエンド。強制ログイン制のSlack風チャットUIで、参考資料・フォーマット指定ファイル・プロンプトを送信できる。

## App Store公開に向けたロードマップ

今回実装したのはマルチユーザー化 + マルチプロバイダーログイン + トークン利用量のゲート機構 + 非公開履歴。残りは以下の順で進める想定:

- サブスク課金の実接続(App Store Server Notifications V2 / Stripe Webhookからのプラン変更、`set_plan`の自動化)
- クラウドへの常時デプロイ(Dockerfile・ホスティング・HTTPS)
- Capacitorで既存Reactをラップした iOS アプリ化(ネイティブログイン・StoreKit)
- Apple Developer Program登録・App Store Connectでのアプリ/課金商品登録・審査提出(ここはユーザー本人のApple IDでの操作が必須)
