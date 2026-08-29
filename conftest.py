import os
import tempfile

# db.py が読み込まれる前に DB_PATH を一時ファイルへ差し替え、
# テストが本番用の data/app.db を汚さないようにする。
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(), "test.db"))
