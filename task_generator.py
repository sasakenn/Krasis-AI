"""
task_generator.py
------------------
「task-generator」チャンネル用: 課題の説明文から、実際に提出できる成果物を生成する。

task_estimator.py(所要時間の見積もりだけ)とは異なり、こちらは成果物そのものを作る。
- generate_task_text: レポート・回答など、文章で完結する課題の内容を生成する。
- generate_task_spreadsheet: Excel(表計算)が必要な課題について、表の構造をJSONで
  Claudeに設計させる。実際の.xlsxバイト列への変換は build_xlsx_bytes が行う
  (Claudeはバイナリを直接出力できないため、JSON仕様 → openpyxlで組み立てる二段構え)。
"""

from __future__ import annotations

import io
import json
import logging
import os
import re

from anthropic import Anthropic
from dotenv import load_dotenv
from openpyxl import Workbook

load_dotenv()

logger = logging.getLogger(__name__)

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-5")
client = Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None

FALLBACK_TEXT = (
    "現在この機能を利用できません(APIキー未設定、または一時的なエラーです)。"
    "しばらく待ってから再試行してください。"
)

_INVALID_SHEET_NAME_CHARS = re.compile(r"[\\/*?:\[\]]")


def _parse_json_response(raw_text: str) -> dict:
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.split("```", 2)[1].replace("json", "", 1).strip() if "```" in text else text
    return json.loads(text)


def generate_task_text(description: str) -> dict:
    """文章で完結する課題(レポート・回答・要約など)の内容を生成する。

    Claudeが未設定/呼び出し失敗の場合は、その旨を伝えるフォールバック回答を返す
    (course_guide.answer_course_questionと同じ方針)。
    """
    no_usage = {"input_tokens": 0, "output_tokens": 0}
    clean = description.strip()

    if client is None:
        return {"content": FALLBACK_TEXT, "_token_usage": no_usage}

    prompt = f"""あなたは大学生の課題作成を支援するアシスタントです。

以下の課題に、実際に提出できる完成した文章で取り組んでください(構成案ではなく完成した内容にすること)。

課題内容: {clean}

要件:
- 日本語で執筆する
- Markdown形式で、必要に応じて見出し(## )や箇条書きを使う
- 前後に説明文やコードブロック記号は付けず、本文のみを返す"""

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=4000,
            messages=[{"role": "user", "content": prompt}],
        )
        text_block = next((b for b in resp.content if b.type == "text"), None)
        content = text_block.text.strip() if text_block else FALLBACK_TEXT
        return {
            "content": content,
            "_token_usage": {
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
        }
    except Exception:
        logger.warning(
            "Claude呼び出しに失敗したため課題生成のフォールバック回答を返します(description=%r)",
            clean,
            exc_info=True,
        )
        return {"content": FALLBACK_TEXT, "_token_usage": no_usage}


def _build_spreadsheet_prompt(description: str) -> str:
    return f"""あなたは大学生の課題作成を支援するアシスタントで、Excel(表計算)の課題を担当します。

以下の課題を満たす表を設計してください。

課題内容: {description}

要件:
- JSONのみを返す(前後に説明文やコードブロック記号は付けない)
- 出力形式:
{{
  "filename": "ファイル名(拡張子なし、日本語可)",
  "sheets": [
    {{
      "name": "シート名(31文字以内)",
      "headers": ["列見出し1", "列見出し2"],
      "rows": [
        ["セルの値", "セルの値"]
      ]
    }}
  ]
}}
- セルの値は、数値はJSONの数値型、文字列はJSON文字列型にする
- 合計・平均などが必要な場合は、セルの値をExcelの数式文字列(例: "=SUM(B2:B13)")にしてよい
  (見出し行が1行目になるので、データはheadersの次の行=2行目から始まる前提でセル位置を数えること)
- 課題に応じて複数シートにしてよい(例: 元データと集計を分ける)
- 架空のデータで構わないが、課題の要件(項目数・粒度など)を満たす具体的な内容にする"""


def _fallback_spreadsheet_spec() -> dict:
    return {
        "filename": "課題",
        "sheets": [
            {
                "name": "Sheet1",
                "headers": ["項目"],
                "rows": [["現在この機能を利用できません"]],
            }
        ],
    }


def generate_task_spreadsheet(description: str) -> dict:
    """Excel(表計算)が必要な課題について、表の構造(spec)をJSONで生成する。

    戻り値の "spec" を build_xlsx_bytes に渡すと、実際の.xlsxバイト列になる。
    Claudeが未設定/呼び出し失敗/JSON解析失敗の場合は、フォールバックの spec を返す。
    """
    no_usage = {"input_tokens": 0, "output_tokens": 0}
    clean = description.strip()

    if client is None:
        return {"spec": _fallback_spreadsheet_spec(), "_token_usage": no_usage}

    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=4000,
            messages=[{"role": "user", "content": _build_spreadsheet_prompt(clean)}],
        )
        text_block = next((b for b in resp.content if b.type == "text"), None)
        spec = _parse_json_response(text_block.text) if text_block else _fallback_spreadsheet_spec()
        return {
            "spec": spec,
            "_token_usage": {
                "input_tokens": resp.usage.input_tokens,
                "output_tokens": resp.usage.output_tokens,
            },
        }
    except Exception:
        logger.warning(
            "Claude呼び出しに失敗したため表計算課題のフォールバックを返します(description=%r)",
            clean,
            exc_info=True,
        )
        return {"spec": _fallback_spreadsheet_spec(), "_token_usage": no_usage}


def _sanitize_sheet_name(name: str, fallback: str) -> str:
    cleaned = _INVALID_SHEET_NAME_CHARS.sub("", (name or "").strip()) or fallback
    return cleaned[:31]


def build_xlsx_bytes(spec: dict) -> bytes:
    """generate_task_spreadsheetが返したJSON仕様から、実際の.xlsxバイト列を組み立てる。"""
    workbook = Workbook()
    workbook.remove(workbook.active)

    sheets = spec.get("sheets") or []
    for i, sheet_spec in enumerate(sheets):
        name = _sanitize_sheet_name(sheet_spec.get("name", ""), f"Sheet{i + 1}")
        worksheet = workbook.create_sheet(title=name)

        headers = sheet_spec.get("headers") or []
        if headers:
            worksheet.append(headers)

        for row in sheet_spec.get("rows") or []:
            worksheet.append(row)

    if not workbook.sheetnames:
        workbook.create_sheet(title="Sheet1")

    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()
