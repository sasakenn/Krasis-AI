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

`.env.example` を `.env` にコピーし、`ANTHROPIC_API_KEY` を設定してください(未設定でも `generate_outline` は簡易フォールバックで動作します)。

```bash
cp .env.example .env
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

## 構成

- `app.py`: Web API(`/generate`, `/health`)。ファイルアップロードの読み取り・OpenAlex検索の並列付加もここ。
- `outline.py`: Claudeを使ったアウトライン生成(`generate_outline`)。APIキー未設定時はルールベースのフォールバック。
- `search.py`: OpenAlexで関連文献を検索(`search_literature`)。
- `frontend/`: React(Vite)フロントエンド。Slack風のチャットUIで、参考資料・フォーマット指定ファイル・プロンプトを送信できる。
