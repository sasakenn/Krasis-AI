import os
import tempfile

import pytest

# db.py が読み込まれる前に DB_PATH を一時ファイルへ差し替え、
# テストが本番用の data/app.db を汚さないようにする。
os.environ.setdefault("DB_PATH", os.path.join(tempfile.mkdtemp(), "test.db"))


@pytest.fixture(autouse=True)
def _reset_generate_rate_limit_state():
    """/generate のレート制限状態はモジュールグローバルなので、テスト間で共有されて
    後続のテストが誤って429になるのを防ぐため、各テストの前後でリセットする。"""
    import app as app_module

    app_module._rate_limit_state = {}
    yield
    app_module._rate_limit_state = {}
