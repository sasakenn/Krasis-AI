import io
import os
from concurrent.futures import ThreadPoolExecutor
from typing import Any, List, Optional

from docx import Document
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from pypdf import PdfReader

from db import (
    create_session,
    delete_generation,
    delete_session,
    get_generation,
    init_db,
    list_generations,
    list_sessions,
    save_generation,
    update_session,
)
from outline import generate_outline
from search import search_literature

app = FastAPI()
init_db()

# 内容を抜粋してプロンプトに含める対応ファイル形式。それ以外はファイル名のみ考慮する。
TEXT_FILE_EXTENSIONS = {".txt", ".md", ".markdown", ".csv"}
PDF_EXTENSIONS = {".pdf"}
DOCX_EXTENSIONS = {".docx"}
MAX_EXCERPT_CHARS = 4000

# 初回プロンプト送信時に確認する分量(文字数)の選択肢。
LENGTH_OPTIONS = [
    {"key": "1-100", "label": "1〜100文字"},
    {"key": "101-1000", "label": "101〜1000文字"},
    {"key": "1001-3000", "label": "1001〜3000文字"},
    {"key": "3001-5000", "label": "3001〜5000文字"},
    {"key": "5001-10000", "label": "5001〜10000文字"},
]
LENGTH_OPTION_KEYS = {opt["key"] for opt in LENGTH_OPTIONS}


class SessionCreate(BaseModel):
    title: str = "新規タブ"


class SessionUpdate(BaseModel):
    title: str
    messages: List[Any] = []


def _extract_pdf_text(raw: bytes) -> str:
    reader = PdfReader(io.BytesIO(raw))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages).strip()


def _extract_docx_text(raw: bytes) -> str:
    document = Document(io.BytesIO(raw))
    paragraphs = [p.text for p in document.paragraphs]
    return "\n".join(paragraphs).strip()


async def _describe_upload(upload: UploadFile) -> str:
    """アップロードされたファイルを Claude のプロンプトに含める形式のテキストにする。

    テキスト系ファイル・PDF・Word(.docx)は内容を抜粋し、それ以外
    (画像、旧形式の.docなど)はパース処理を持たないためファイル名のみを伝える。
    """
    filename = upload.filename or "(無題ファイル)"
    ext = os.path.splitext(filename)[1].lower()
    raw = await upload.read()

    if ext in TEXT_FILE_EXTENSIONS:
        try:
            text = raw.decode("utf-8").strip()
        except UnicodeDecodeError:
            return f"- {filename} (テキストとして読み込めませんでした)"
        return f"- {filename}:\n{text[:MAX_EXCERPT_CHARS]}"

    if ext in PDF_EXTENSIONS:
        try:
            text = _extract_pdf_text(raw)
        except Exception:
            return f"- {filename} (PDFの読み取りに失敗しました。ファイル名のみ考慮してください)"
        if not text:
            return f"- {filename} (PDFからテキストを抽出できませんでした。画像のみのPDFの可能性があります)"
        return f"- {filename}:\n{text[:MAX_EXCERPT_CHARS]}"

    if ext in DOCX_EXTENSIONS:
        try:
            text = _extract_docx_text(raw)
        except Exception:
            return f"- {filename} (Wordファイルの読み取りに失敗しました。ファイル名のみ考慮してください)"
        if not text:
            return f"- {filename} (Wordファイルからテキストを抽出できませんでした)"
        return f"- {filename}:\n{text[:MAX_EXCERPT_CHARS]}"

    return f"- {filename} (このファイル形式は内容を解析していません。ファイル名のみ考慮してください)"


def _attach_literature(outline: dict, limit: int = 3) -> dict:
    """各セクションの search_query で OpenAlex を検索し、結果を付加する。

    セクションごとに別リクエストになるため ThreadPoolExecutor で並列化する。
    一部のセクションで検索が失敗しても、そのセクションの literature を
    空リストにするだけで残りのレスポンスは返す。
    """
    sections = outline.get("sections", [])
    if not sections:
        return outline

    with ThreadPoolExecutor(max_workers=len(sections)) as executor:
        futures = {
            executor.submit(search_literature, section["search_query"], limit): section
            for section in sections
        }
        for future, section in futures.items():
            try:
                section["literature"] = future.result()
            except Exception:
                section["literature"] = []

    return outline


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/generate")
async def generate(
    topic: str = Form(...),
    field: str = Form("一般"),
    target_length: Optional[str] = Form(default=None),
    reference_files: Optional[List[UploadFile]] = File(default=None),
    format_file: Optional[UploadFile] = File(default=None),
):
    if not topic or not topic.strip():
        raise HTTPException(status_code=400, detail="topic is required")

    # 初回プロンプト(まだ分量が指定されていないリクエスト)には、
    # 生成前にアウトラインではなく分量選択の質問を返す。
    if not target_length:
        return {
            "type": "length_question",
            "message": "生成する分量の目安を選んでください。",
            "options": LENGTH_OPTIONS,
        }

    if target_length not in LENGTH_OPTION_KEYS:
        raise HTTPException(status_code=400, detail="invalid target_length")

    reference_notes = ""
    if reference_files:
        notes = [await _describe_upload(f) for f in reference_files if f.filename]
        reference_notes = "\n\n".join(notes)

    format_notes = ""
    if format_file and format_file.filename:
        format_notes = await _describe_upload(format_file)

    outline = generate_outline(topic, field, reference_notes, format_notes, target_length)
    outline = _attach_literature(outline)
    outline["type"] = "outline"
    outline["id"] = save_generation(topic, field, target_length, outline)
    return outline


@app.get("/history")
def history(limit: int = 50, q: Optional[str] = None):
    return {"items": list_generations(limit=limit, q=q)}


@app.get("/history/{generation_id}")
def history_detail(generation_id: int):
    record = get_generation(generation_id)
    if record is None:
        raise HTTPException(status_code=404, detail="generation not found")
    return record


@app.delete("/history/{generation_id}")
def history_delete(generation_id: int):
    if not delete_generation(generation_id):
        raise HTTPException(status_code=404, detail="generation not found")
    return {"status": "deleted"}


@app.get("/sessions")
def sessions():
    return {"items": list_sessions()}


@app.post("/sessions")
def sessions_create(payload: SessionCreate):
    return create_session(payload.title)


@app.put("/sessions/{session_id}")
def sessions_update(session_id: int, payload: SessionUpdate):
    if not update_session(session_id, payload.title, payload.messages):
        raise HTTPException(status_code=404, detail="session not found")
    return {"status": "ok"}


@app.delete("/sessions/{session_id}")
def sessions_delete(session_id: int):
    if not delete_session(session_id):
        raise HTTPException(status_code=404, detail="session not found")
    return {"status": "deleted"}


if __name__ == '__main__':
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
