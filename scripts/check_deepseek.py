"""DeepSeekに接続できるかを、1回だけ確認するスクリプト。

使い方(キーは画面に表示されず、履歴にも残らないように、環境変数で渡す):
    cd ~/新規事業AI && source venv/bin/activate
    read -s "DEEPSEEK_API_KEY?DeepSeekのAPIキー: "; export DEEPSEEK_API_KEY
    python scripts/check_deepseek.py            # モデルは DEEPSEEK_MODEL(未指定なら既定値)
    python scripts/check_deepseek.py deepseek-v4-pro   # モデルを指定して試す
    unset DEEPSEEK_API_KEY

キー自体は出力しない。短い返事を1回だけ生成するので、費用はごくわずか。
"""
import os
import sys

import requests

import llm_providers

os.environ["LLM_PROVIDER"] = "deepseek"
if len(sys.argv) > 1:
    os.environ["DEEPSEEK_MODEL"] = sys.argv[1]

client = llm_providers.build_client()
if client is None:
    sys.exit("DEEPSEEK_API_KEY が設定されていません。")

model = llm_providers.model_name()
print(f"モデル: {model}")
try:
    resp = client.messages.create(
        model=model,
        max_tokens=60,
        system="日本語で、1文だけ答えてください。",
        messages=[{"role": "user", "content": "接続テストです。「接続できました」と返してください。"}],
    )
except requests.HTTPError as exc:
    body = exc.response.text[:300] if exc.response is not None else ""
    sys.exit(f"失敗: HTTP {exc.response.status_code if exc.response is not None else '?'} {body}\n"
             "(401=キーが違う、402=残高不足、400/404=モデル名が違う可能性)")
except requests.RequestException as exc:
    sys.exit(f"失敗: 通信エラー {type(exc).__name__}")

text = next((b.text for b in resp.content if b.type == "text"), "")
print(f"返事: {text}")
print(f"使用トークン: 入力 {resp.usage.input_tokens} / 出力 {resp.usage.output_tokens}")
print("成功: DeepSeekに接続できました。")
