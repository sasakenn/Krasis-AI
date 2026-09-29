import asyncio
import hashlib
import hmac
import io
import logging
import os
import secrets
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Annotated, Any, Dict, List, Optional, Tuple
from urllib.parse import quote

from contextlib import asynccontextmanager

import crypto_utils
import stripe
from docx import Document
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from pypdf import PdfReader

from fastapi.responses import RedirectResponse
from starlette.middleware.base import BaseHTTPMiddleware

from auth import (
    AuthError,
    create_app_token,
    create_mfa_token,
    decode_app_token,
    decode_mfa_token,
    exchange_github_code_for_user,
    exchange_microsoft_code_for_user,
    verify_apple_identity_token,
    verify_google_id_token,
)
from db import (
    add_token_usage,
    create_code_login,
    create_session,
    create_task,
    delete_generation,
    delete_history_entry,
    delete_mfa,
    delete_session,
    delete_task,
    enable_mfa,
    get_activity_summary,
    get_admin_overview,
    get_code_login_by_email,
    get_generation,
    get_history_entry,
    get_mfa_enrollment,
    get_or_create_entitlement,
    get_user_email,
    get_user_id_by_stripe_customer,
    init_db,
    is_mfa_enabled,
    list_due_reminders,
    list_generations,
    list_history_entries,
    list_login_events,
    list_security_events,
    list_sessions,
    list_tasks,
    mark_task_reminded,
    record_activity_ping,
    record_security_event,
    save_generation,
    save_history_entry,
    set_generation_privacy,
    set_history_entry_privacy,
    set_mfa_secret,
    set_plan,
    set_stripe_customer,
    set_task_status,
    update_code_login_hash,
    update_history_entry,
    update_session,
    upsert_user,
)
from mfa import generate_secret as generate_mfa_secret
from mfa import provisioning_uri as mfa_provisioning_uri
from mfa import verify_code as verify_mfa_code
from course_guide import answer_course_question
from exclamation import brush_off_if_exclamation
from mailer import is_configured as is_mail_configured
from mailer import send_email
from outline import generate_outline
from paper_writer import generate_paper_body
from search import search_literature_diverse
from study_notes import generate_study_notes
from task_estimator import estimate_task_duration
from task_generator import build_xlsx_bytes, generate_task_spreadsheet, generate_task_text
from translate import LANGUAGE_NAMES, translate_titles

logger = logging.getLogger(__name__)


def _send_due_task_reminders() -> None:
    now_iso = datetime.now(timezone.utc).isoformat()
    for task in list_due_reminders(now_iso):
        if task.get("email"):
            deadline_line = f"締切: {task['deadline']}\n" if task.get("deadline") else ""
            send_email(
                task["email"],
                "【Paper Assistant】タスクのリマインド",
                f"見積もっていた作業時間の目安になりました:\n\n"
                f"{task['description']}\n\n"
                f"見積もり所要時間: 約{task['estimated_minutes']}分\n"
                f"{deadline_line}\n"
                "アプリを開いて進み具合を確認しましょう。",
            )
        # メール未登録のユーザーは送れないが、無限に再試行し続けないよう既読扱いにする。
        mark_task_reminded(task["id"])


async def _task_reminder_loop() -> None:
    while True:
        try:
            _send_due_task_reminders()
        except Exception:
            logger.exception("タスクリマインダーの送信処理でエラーが発生しました")
        await asyncio.sleep(TASK_REMINDER_POLL_SECONDS)


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    reminder_task = asyncio.create_task(_task_reminder_loop())
    try:
        yield
    finally:
        reminder_task.cancel()


# フロントエンド(frontend/index.html)が実際に読み込む外部オリジンだけを許可する
# Content-Security-Policy。トークンはlocalStorageに保存しているため、万一XSSが
# 混入しても任意ドメインへの持ち出し(exfiltration)やインラインスクリプト実行を
# CSPで塞ぐのが狙い。新たに外部スクリプト/APIを追加した場合はここも更新すること。
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self' https://appleid.cdn-apple.com https://accounts.google.com",
    # Viteのビルド出力に含まれる<style>タグ(起動演出)のためstyle-srcのみ'unsafe-inline'を許容する。
    # スクリプトの実行はscript-srcで厳格に絞っているため、XSSの主な入口はここでは塞がれたまま。
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self' https://appleid.apple.com https://accounts.google.com",
    "frame-src https://accounts.google.com https://appleid.apple.com",
    "frame-ancestors 'self'",
    "base-uri 'none'",
    "form-action 'self'",
])


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """通信の保護: FORCE_HTTPS時はHTTPをHTTPSへリダイレクトしHSTSを付与する。
    あわせて基本的なセキュリティヘッダーを全レスポンスに付ける。"""

    async def dispatch(self, request: Request, call_next):
        if FORCE_HTTPS:
            scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
            host = request.url.hostname or ""
            if scheme == "http" and host not in ("localhost", "127.0.0.1"):
                return RedirectResponse(str(request.url.replace(scheme="https")), status_code=308)

        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        response.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        if FORCE_HTTPS:
            # preload: HSTS事前読み込みリスト(hstspreload.org)への登録を見据えて付与する。
            # ヘッダーを送るだけでは自動登録されない(登録には別途申請が必要)ため、
            # 現時点では「登録した場合に備えて矛盾のない設定にしておく」意味合い。
            response.headers.setdefault(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload"
            )
        return response


app = FastAPI(lifespan=_lifespan)
app.add_middleware(SecurityHeadersMiddleware)
init_db()

# 内容を抜粋してプロンプトに含める対応ファイル形式。それ以外はファイル名のみ考慮する。
TEXT_FILE_EXTENSIONS = {".txt", ".md", ".markdown", ".csv"}
PDF_EXTENSIONS = {".pdf"}
DOCX_EXTENSIONS = {".docx"}
MAX_EXCERPT_CHARS = 4000

# /study-notes は分析対象そのものが資料本文なので、参考資料としての抜粋(MAX_EXCERPT_CHARS)より
# 大きく取る。
STUDY_NOTES_MAX_CHARS = 20000

# アップロードファイル1件あたりの上限サイズ。無制限だとメモリ枯渇や
# Claude APIへの巨大プロンプト送信(コスト暴走)につながるため、抜粋に使う分量
# よりかなり大きめだが有限の上限を設ける。
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "20")) * 1024 * 1024

# 以下、Claude APIに渡すリクエストの分量に上限を設ける定数。無制限だと
# 1リクエストでの巨大プロンプト送信(コスト暴走・メモリ圧迫)を許してしまう。
MAX_DESCRIPTION_LENGTH = 4000
MAX_COURSE_CHAT_MESSAGES = 60
MAX_PAPER_BODY_SECTIONS = 30
MAX_TRANSLATE_TITLES = 50
MAX_TOPIC_LENGTH = 2000
MAX_STUDY_NOTES_FOCUS_LENGTH = 500

# 初回プロンプト送信時に確認する分量(文字数)の選択肢。
LENGTH_OPTIONS = [
    {"key": "1-100", "label": "1〜100文字"},
    {"key": "101-1000", "label": "101〜1000文字"},
    {"key": "1001-3000", "label": "1001〜3000文字"},
    {"key": "3001-5000", "label": "3001〜5000文字"},
    {"key": "5001-10000", "label": "5001〜10000文字"},
]
LENGTH_OPTION_KEYS = {opt["key"] for opt in LENGTH_OPTIONS}

# 開発時のみ: この値を設定すると、Apple/Google/GitHubでのログインを経ずに
# `X-Dev-User-Id` ヘッダーで任意のuser_idを名乗ってアクセスできる。
# 本番環境では絶対に設定しないこと(誰でも他人になりすませてしまう)。
DEV_BYPASS_USER_ID = os.getenv("DEV_BYPASS_USER_ID", "").strip()

# 運営者向け管理ダッシュボード(/admin/overview)へのアクセスを許可するアカウント。
# カンマ区切りで複数指定可能。どちらも未設定なら誰も/admin/overviewにアクセスできない。
# ADMIN_EMAILS: users.emailと突き合わせる(Apple/Google/GitHub/メールログインの全方式で使える)。
# ADMIN_USER_IDS: user_idと直接突き合わせる(DEV_BYPASS_USER_IDでのローカル確認用)。
ADMIN_EMAILS = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}
ADMIN_USER_IDS = {u.strip() for u in os.getenv("ADMIN_USER_IDS", "").split(",") if u.strip()}

# /generate 1件あたりClaude APIを呼ぶため、誤操作や不具合でのコスト暴走を防ぐための
# 簡易レート制限(ユーザーごとの1分あたりの上限リクエスト数)。0以下で無効化。
GENERATE_RATE_LIMIT_PER_MINUTE = int(os.getenv("GENERATE_RATE_LIMIT_PER_MINUTE", "20"))

# メール+ログインコード方式のサインアップ/再発行の乱用(他人のメールへの
# スパム送信等)を防ぐための、メールアドレスごとの1分あたりの上限リクエスト数。
CODE_AUTH_RATE_LIMIT_PER_MINUTE = int(os.getenv("CODE_AUTH_RATE_LIMIT_PER_MINUTE", "5"))

# ログインコード/MFAコードの連続失敗によるアカウント一時ロック。
# 直近LOCKOUT_SECONDSの間にMAX_FAILURES回失敗すると、最後の失敗からLOCKOUT_SECONDSの間は
# そのメールアドレスでのログインを拒否する。MAX_FAILURESが0以下なら無効。
CODE_AUTH_MAX_FAILURES = int(os.getenv("CODE_AUTH_MAX_FAILURES", "10"))
CODE_AUTH_LOCKOUT_SECONDS = int(os.getenv("CODE_AUTH_LOCKOUT_SECONDS", "900"))

# 本番で1にすると、HTTPアクセスをHTTPSへリダイレクトしHSTSヘッダーを付与する。
FORCE_HTTPS = os.getenv("FORCE_HTTPS", "").strip() in ("1", "true", "yes")
# Renderは全サービスにRENDER=trueを自動設定する。ローカル開発(SMTP未設定でログ出力に
# フォールバックする)と本番(メール送信が必須)を区別するために使う。
IS_PRODUCTION = bool(os.getenv("RENDER"))

# 保存データの暗号化(AES-256-GCM、crypto_utils参照)は本番では必須にする。
# DATA_ENCRYPTION_KEY未設定のまま気づかず本番稼働し、生成内容やMFAシークレットが
# 平文でSQLiteに保存され続ける事態を防ぐための起動時フェイルファスト。
if IS_PRODUCTION and not crypto_utils.is_configured():
    raise RuntimeError(
        "本番環境ではDATA_ENCRYPTION_KEY(保存データのAES-256-GCM暗号化鍵)の設定が必須です。"
        "python -c \"from crypto_utils import generate_key; print(generate_key())\" で生成し、"
        "Renderの環境変数に設定してください。"
    )

# /course-chat 1件あたりClaude APIを呼ぶため、/generateと同様にユーザーごとの
# 1分あたりの上限リクエスト数でコスト暴走を防ぐ。0以下で無効化。
COURSE_CHAT_RATE_LIMIT_PER_MINUTE = int(os.getenv("COURSE_CHAT_RATE_LIMIT_PER_MINUTE", "20"))

# /tasks 1件あたりClaude APIを呼ぶため、同様にユーザーごとの1分あたりの上限リクエスト数で
# コスト暴走を防ぐ。0以下で無効化。
TASK_RATE_LIMIT_PER_MINUTE = int(os.getenv("TASK_RATE_LIMIT_PER_MINUTE", "20"))

# /task-generator 1件あたりClaude APIを呼ぶため(Excelの場合はさらにファイル組み立ても
# 発生する)、同様にユーザーごとの1分あたりの上限リクエスト数でコスト暴走を防ぐ。0以下で無効化。
TASK_GENERATOR_RATE_LIMIT_PER_MINUTE = int(os.getenv("TASK_GENERATOR_RATE_LIMIT_PER_MINUTE", "20"))

# /study-notes 1件あたりClaude APIを呼ぶため、同様にユーザーごとの1分あたりの上限リクエスト数で
# コスト暴走を防ぐ。0以下で無効化。
STUDY_NOTES_RATE_LIMIT_PER_MINUTE = int(os.getenv("STUDY_NOTES_RATE_LIMIT_PER_MINUTE", "20"))

# /literature/translate 1件あたりClaude APIを呼ぶため、同様にユーザーごとの
# 1分あたりの上限リクエスト数でコスト暴走を防ぐ。0以下で無効化。
TRANSLATE_RATE_LIMIT_PER_MINUTE = int(os.getenv("TRANSLATE_RATE_LIMIT_PER_MINUTE", "20"))

# /activity/ping はClaude APIを呼ばないが、フロントは60秒に1回叩くだけなので、
# 想定外の連打だけを弾ける程度の緩い上限にしておく。0以下で無効化。
ACTIVITY_PING_RATE_LIMIT_PER_MINUTE = int(os.getenv("ACTIVITY_PING_RATE_LIMIT_PER_MINUTE", "6"))

# タスクのリマインド時刻を何秒おきにチェックしてメール送信するか。
TASK_REMINDER_POLL_SECONDS = int(os.getenv("TASK_REMINDER_POLL_SECONDS", "60"))

# 月額プランごとのトークン枠(仮の数値)。従来値の25%(75%減)で運用。
PLAN_TOKEN_QUOTAS: Dict[str, int] = {"free": 50_000, "pro": 300_000, "max": 1_500_000}

# --- Stripe(サブスク課金) ---
# 空のままなら/billing/*は503を返すだけで、それ以外の機能には一切影響しない。
stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "").strip()
STRIPE_WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
# チェックアウト完了後にユーザーを戻す先(本番ではデプロイ先のフロントエンドURLを設定する)。
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").rstrip("/")

# Stripeで作成した月額プランのPrice ID。プラン名→Price ID、Price ID→プラン名の両方向で使う。
STRIPE_PLAN_PRICE_IDS: Dict[str, str] = {
    "pro": os.getenv("STRIPE_PRICE_ID_PRO", "").strip(),
    "max": os.getenv("STRIPE_PRICE_ID_MAX", "").strip(),
}
STRIPE_PRICE_ID_TO_PLAN: Dict[str, str] = {
    price_id: plan for plan, price_id in STRIPE_PLAN_PRICE_IDS.items() if price_id
}

_rate_limit_lock = Lock()
_rate_limit_state: Dict[str, Tuple[int, int]] = {}

# メールアドレス → (最後に失敗した時刻, 直近ウィンドウ内の連続失敗回数)
_login_failure_state: Dict[str, Tuple[float, int]] = {}

LOCKED_MESSAGE = "ログインの失敗が続いたため、このアカウントは一時的にロックされています。しばらく待ってから再試行してください。"


def _enforce_not_locked(key: str) -> None:
    if CODE_AUTH_MAX_FAILURES <= 0:
        return
    with _rate_limit_lock:
        state = _login_failure_state.get(key)
        if state is None:
            return
        last_failure, count = state
        if time.time() - last_failure >= CODE_AUTH_LOCKOUT_SECONDS:
            del _login_failure_state[key]
            return
        locked = count >= CODE_AUTH_MAX_FAILURES
    if locked:
        raise HTTPException(status_code=423, detail=LOCKED_MESSAGE)


def _register_login_failure(key: str) -> None:
    """失敗を記録し、上限に達した時点でロックをセキュリティイベントとして残す。"""
    if CODE_AUTH_MAX_FAILURES <= 0:
        return
    now = time.time()
    with _rate_limit_lock:
        last_failure, count = _login_failure_state.get(key, (now, 0))
        if now - last_failure >= CODE_AUTH_LOCKOUT_SECONDS:
            count = 0
        count += 1
        _login_failure_state[key] = (now, count)
    if count == CODE_AUTH_MAX_FAILURES:
        record_security_event("login_locked", key, f"{count}回連続で失敗したため{CODE_AUTH_LOCKOUT_SECONDS}秒間ロック")


def _clear_login_failures(key: str) -> None:
    with _rate_limit_lock:
        _login_failure_state.pop(key, None)


def get_current_user(
    authorization: Optional[str] = Header(default=None),
    x_dev_user_id: Optional[str] = Header(default=None),
) -> str:
    """Bearerトークン(アプリ独自のセッションJWT)を検証し、user_idを返す。

    DEV_BYPASS_USER_ID が設定されている開発環境に限り、X-Dev-User-Id ヘッダーで
    Sign in with Appleを経ずにuser_idを直接指定できる(ローカルでの動作確認用)。

    IS_PRODUCTION(Render上での実行)の場合は、DEV_BYPASS_USER_IDが誤って
    設定されていてもこのバイパスを無効化する(任意のuser_idへのなりすましを
    許してしまうため、環境変数の設定ミス1つで本番が突破される事態を防ぐ)。
    """
    if DEV_BYPASS_USER_ID and x_dev_user_id and not IS_PRODUCTION:
        return x_dev_user_id

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    token = authorization[len("Bearer "):].strip()
    try:
        return decode_app_token(token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _is_admin(user_id: str) -> bool:
    if not ADMIN_EMAILS and not ADMIN_USER_IDS:
        return False
    if user_id in ADMIN_USER_IDS:
        return True
    email = get_user_email(user_id)
    return bool(email and email.strip().lower() in ADMIN_EMAILS)


def require_admin(user_id: str = Depends(get_current_user)) -> str:
    if not _is_admin(user_id):
        raise HTTPException(status_code=403, detail="管理者権限が必要です")
    return user_id


def _enforce_rate_limit(bucket: str, key: str, limit: int, message: str) -> None:
    if limit <= 0:
        return

    state_key = f"{bucket}:{key}"
    window = int(time.time() // 60)
    with _rate_limit_lock:
        window_start, count = _rate_limit_state.get(state_key, (window, 0))
        if window_start != window:
            window_start, count = window, 0
        count += 1
        _rate_limit_state[state_key] = (window_start, count)

    if count > limit:
        raise HTTPException(status_code=429, detail=message)


def _enforce_generate_rate_limit(key: str) -> None:
    _enforce_rate_limit(
        "generate",
        key,
        GENERATE_RATE_LIMIT_PER_MINUTE,
        "generateのレート制限を超えました。しばらく待って再試行してください。",
    )


def _enforce_code_auth_rate_limit(email: str) -> None:
    _enforce_rate_limit(
        "code-auth",
        email,
        CODE_AUTH_RATE_LIMIT_PER_MINUTE,
        "リクエストが多すぎます。しばらく待って再試行してください。",
    )


def _enforce_course_chat_rate_limit(key: str) -> None:
    _enforce_rate_limit(
        "course-chat",
        key,
        COURSE_CHAT_RATE_LIMIT_PER_MINUTE,
        "course-chatのレート制限を超えました。しばらく待って再試行してください。",
    )


def _enforce_translate_rate_limit(key: str) -> None:
    _enforce_rate_limit(
        "literature-translate",
        key,
        TRANSLATE_RATE_LIMIT_PER_MINUTE,
        "翻訳のレート制限を超えました。しばらく待って再試行してください。",
    )


def _enforce_activity_ping_rate_limit(key: str) -> None:
    _enforce_rate_limit(
        "activity-ping",
        key,
        ACTIVITY_PING_RATE_LIMIT_PER_MINUTE,
        "activity pingのレート制限を超えました。",
    )


def _enforce_task_rate_limit(key: str) -> None:
    _enforce_rate_limit(
        "tasks",
        key,
        TASK_RATE_LIMIT_PER_MINUTE,
        "タスク作成のレート制限を超えました。しばらく待って再試行してください。",
    )


def _enforce_task_generator_rate_limit(key: str) -> None:
    _enforce_rate_limit(
        "task-generator",
        key,
        TASK_GENERATOR_RATE_LIMIT_PER_MINUTE,
        "task-generatorのレート制限を超えました。しばらく待って再試行してください。",
    )


def _enforce_study_notes_rate_limit(key: str) -> None:
    _enforce_rate_limit(
        "study-notes",
        key,
        STUDY_NOTES_RATE_LIMIT_PER_MINUTE,
        "study-notesのレート制限を超えました。しばらく待って再試行してください。",
    )


class AppleSignInRequest(BaseModel):
    identity_token: str


class GoogleSignInRequest(BaseModel):
    id_token: str


class GitHubSignInRequest(BaseModel):
    code: str


class MicrosoftSignInRequest(BaseModel):
    code: str
    redirect_uri: str


# 以下、Fieldのmax_lengthは「壊れた入力を拒否する」ためではなく、無制限の巨大な
# リクエストボディでメモリ・Claude APIコストを消費させる攻撃(DoS/コスト暴走)を
# 防ぐための上限。実際の利用で必要な長さより十分大きく取ってある。

class CodeSignupRequest(BaseModel):
    email: str = Field(max_length=254)  # RFC 5321の最大長


class CodeLoginRequest(BaseModel):
    email: str = Field(max_length=254)
    code: str = Field(max_length=64)


class CodeReissueRequest(BaseModel):
    email: str = Field(max_length=254)


class MfaCodeRequest(BaseModel):
    code: str = Field(max_length=32)


class MfaVerifyRequest(BaseModel):
    mfa_token: str = Field(max_length=4000)
    code: str = Field(max_length=32)


class PrivacyUpdate(BaseModel):
    is_private: bool


class CheckoutRequest(BaseModel):
    plan: str


class SessionCreate(BaseModel):
    title: str = "新規タブ"


class SessionUpdate(BaseModel):
    title: str
    messages: List[Any] = []


class CourseChatMessage(BaseModel):
    role: str = Field(max_length=20)
    content: str = Field(max_length=8000)


class CourseChatRequest(BaseModel):
    university: str = Field(max_length=200)
    faculty: str = Field(max_length=200)
    department: str = Field(default="", max_length=200)
    messages: List[CourseChatMessage] = Field(max_length=MAX_COURSE_CHAT_MESSAGES)
    history_id: Optional[int] = None


class PaperBodyRequest(BaseModel):
    title: str = Field(max_length=300)
    research_question: str = Field(default="", max_length=2000)
    sections: List[Dict[str, Any]] = Field(max_length=MAX_PAPER_BODY_SECTIONS)
    target_length: str = ""


class TranslateTitlesRequest(BaseModel):
    titles: List[Annotated[str, Field(max_length=1000)]] = Field(max_length=MAX_TRANSLATE_TITLES)
    target_lang: str


class TaskCreateRequest(BaseModel):
    description: str = Field(max_length=MAX_DESCRIPTION_LENGTH)
    deadline: Optional[str] = None  # ISO8601文字列(任意)


class TaskStatusUpdate(BaseModel):
    status: str  # "pending" | "done"


class TaskGeneratorRequest(BaseModel):
    description: str = Field(max_length=MAX_DESCRIPTION_LENGTH)
    kind: str = "text"  # "text" | "excel"


def _extract_pdf_text(raw: bytes) -> str:
    reader = PdfReader(io.BytesIO(raw))
    pages = [page.extract_text() or "" for page in reader.pages]
    return "\n".join(pages).strip()


def _extract_docx_text(raw: bytes) -> str:
    document = Document(io.BytesIO(raw))
    paragraphs = [p.text for p in document.paragraphs]
    return "\n".join(paragraphs).strip()


async def _read_upload_within_limit(upload: UploadFile) -> bytes:
    """アップロードファイルをMAX_UPLOAD_BYTESまでのサイズ上限付きで読み込む。

    UploadFile.read()に上限がないため、無制限だとメモリ枯渇やClaude APIへの
    巨大プロンプト送信(コスト暴走)につながる。チャンク単位で読み、上限を
    超えた時点で即座に413を返す(全部読み切ってからチェックすると、その
    「全部読む」こと自体がメモリを圧迫してしまうため)。
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"ファイルサイズが上限({MAX_UPLOAD_BYTES // (1024 * 1024)}MB)を超えています",
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def _describe_upload(upload: UploadFile) -> str:
    """アップロードされたファイルを Claude のプロンプトに含める形式のテキストにする。

    テキスト系ファイル・PDF・Word(.docx)は内容を抜粋し、それ以外
    (画像、旧形式の.docなど)はパース処理を持たないためファイル名のみを伝える。
    """
    filename = upload.filename or "(無題ファイル)"
    ext = os.path.splitext(filename)[1].lower()
    raw = await _read_upload_within_limit(upload)

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


async def _extract_study_notes_file_text(upload: UploadFile) -> str:
    """/study-notes向けに、アップロードされたファイルから分析対象の本文全体を抜き出す。

    _describe_uploadと違い、こちらはファイル内容そのものが分析対象なので、
    非対応形式やテキスト抽出に失敗した場合は(黙って無視せず)エラーを返す。
    """
    filename = upload.filename or "(無題ファイル)"
    ext = os.path.splitext(filename)[1].lower()
    raw = await _read_upload_within_limit(upload)

    if ext in TEXT_FILE_EXTENSIONS:
        try:
            return raw.decode("utf-8").strip()
        except UnicodeDecodeError:
            raise HTTPException(status_code=400, detail=f"{filename} をテキストとして読み込めませんでした")

    if ext in PDF_EXTENSIONS:
        try:
            text = _extract_pdf_text(raw)
        except Exception:
            raise HTTPException(status_code=400, detail=f"{filename} の読み取りに失敗しました")
        if not text:
            raise HTTPException(
                status_code=400,
                detail=f"{filename} からテキストを抽出できませんでした(画像のみのPDFの可能性があります)",
            )
        return text

    if ext in DOCX_EXTENSIONS:
        try:
            text = _extract_docx_text(raw)
        except Exception:
            raise HTTPException(status_code=400, detail=f"{filename} の読み取りに失敗しました")
        if not text:
            raise HTTPException(status_code=400, detail=f"{filename} からテキストを抽出できませんでした")
        return text

    raise HTTPException(
        status_code=400,
        detail=f"{filename} はサポートされていないファイル形式です(.txt/.md/.csv/.pdf/.docxのみ対応)",
    )


def _attach_literature(outline: dict, limit: int = 3) -> dict:
    """各セクションの search_query / search_query_native で OpenAlex を検索し、結果を付加する。

    国際的な(主に英語圏の)文献とテーマの言語圏で発行された文献の両方を混ぜることで、
    引用が特定の国・言語に偏りすぎないようにする(search_literature_diverse参照)。
    セクションごとに別リクエストになるため ThreadPoolExecutor で並列化する。
    一部のセクションで検索が失敗しても、そのセクションの literature を
    空リストにするだけで残りのレスポンスは返す。
    """
    sections = outline.get("sections", [])
    if not sections:
        return outline

    with ThreadPoolExecutor(max_workers=len(sections)) as executor:
        futures = {
            executor.submit(
                search_literature_diverse,
                section["search_query"],
                section.get("search_query_native", ""),
                limit,
            ): section
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
    return {"status": "ok", "mail_configured": is_mail_configured()}


def _client_ip(request: Request) -> str:
    """プロキシ(Render等)経由のリクエストでも発信元IPを取れるよう、
    まずX-Forwarded-Forの先頭(クライアントに最も近い側)を見る。"""
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else ""


def _client_user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "")[:300]


PROVIDER_LABELS = {"apple": "Apple", "google": "Google", "github": "GitHub", "microsoft": "Microsoft"}


def _issue_session_token(provider: str, claims: dict, request: Request) -> dict:
    """検証済みclaimsから内部user_id(provider:sub)を組み立て、セッショントークンを発行する。

    プロバイダーが違えば同じ人でも別アカウント扱いになる(自動アカウント統合はしない)。

    このアカウントでMFA(認証アプリ)が有効な場合は、Apple/Google/GitHubでの
    認証だけでは即座にセッションを発行せず、/auth/code/loginと同様に短命の
    仮認証トークンを返す(/auth/mfa/verifyで6桁コードを確認してから本発行する)。
    これが無いと、ログインコード方式にだけMFAが効いてOAuth方式では素通りできて
    しまい、MFAを有効化した意味がなくなる。
    """
    user_id = f"{provider}:{claims['sub']}"
    upsert_user(user_id, claims.get("email"))

    if is_mfa_enabled(user_id):
        return {"mfa_required": True, "mfa_token": create_mfa_token(user_id)}

    record_security_event(
        "login_success",
        user_id,
        PROVIDER_LABELS.get(provider, provider),
        ip_address=_client_ip(request),
        user_agent=_client_user_agent(request),
    )
    return {"token": create_app_token(user_id)}


@app.post("/auth/apple")
def auth_apple(payload: AppleSignInRequest, request: Request):
    try:
        claims = verify_apple_identity_token(payload.identity_token)
        return _issue_session_token("apple", claims, request)
    except AuthError as exc:
        record_security_event(
            "login_failed", "apple", str(exc), ip_address=_client_ip(request), user_agent=_client_user_agent(request)
        )
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.post("/auth/google")
def auth_google(payload: GoogleSignInRequest, request: Request):
    try:
        claims = verify_google_id_token(payload.id_token)
        return _issue_session_token("google", claims, request)
    except AuthError as exc:
        record_security_event(
            "login_failed", "google", str(exc), ip_address=_client_ip(request), user_agent=_client_user_agent(request)
        )
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.post("/auth/github")
def auth_github(payload: GitHubSignInRequest, request: Request):
    try:
        claims = exchange_github_code_for_user(payload.code)
        return _issue_session_token("github", claims, request)
    except AuthError as exc:
        record_security_event(
            "login_failed", "github", str(exc), ip_address=_client_ip(request), user_agent=_client_user_agent(request)
        )
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.post("/auth/microsoft")
def auth_microsoft(payload: MicrosoftSignInRequest, request: Request):
    try:
        claims = exchange_microsoft_code_for_user(payload.code, payload.redirect_uri)
        return _issue_session_token("microsoft", claims, request)
    except AuthError as exc:
        record_security_event(
            "login_failed", "microsoft", str(exc), ip_address=_client_ip(request), user_agent=_client_user_agent(request)
        )
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.post("/auth/dev")
def auth_dev():
    """開発用: DEV_BYPASS_USER_ID設定時のみ、ブラウザのログイン画面からワンクリックで
    その固定ユーザーとしてのトークンを取得できる(本番(IS_PRODUCTION)では
    設定ミスがあっても常に404にする)。"""
    if not DEV_BYPASS_USER_ID or IS_PRODUCTION:
        raise HTTPException(status_code=404, detail="not found")
    return {"token": create_app_token(DEV_BYPASS_USER_ID)}


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _generate_login_code() -> str:
    """メール+コードログイン用の、紙にメモしやすい12桁(16進数)の乱数コードを生成する。"""
    return secrets.token_hex(6)


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.strip().encode("utf-8")).hexdigest()


def _require_mail_configured() -> None:
    """本番でSMTP未設定のまま「送信しました」と嘘をつかないためのガード。

    ローカル開発ではSMTP未設定でもログ出力にフォールバックして動作確認できるままにし、
    本番(RENDER環境変数あり)でのみ、設定漏れを503で即座に気づけるようにする。
    """
    if IS_PRODUCTION and not is_mail_configured():
        raise HTTPException(
            status_code=503,
            detail="メール送信が設定されていません(SMTP_HOST/SMTP_USER/SMTP_PASSWORD未設定)。管理者に連絡してください。",
        )


@app.post("/auth/code/signup")
def auth_code_signup(payload: CodeSignupRequest):
    """メールアドレスだけで新規アカウントを作り、ログイン用の乱数コードを発行する。

    コードはメール(SMTP未設定時はログ出力)でのみ届け、APIレスポンスには含めない。
    画面や通信ログにコードが残らないようにするため。

    重要: この時点ではまだセッショントークンを発行しない。発行してしまうと、
    メールを受信できない攻撃者が「他人のメールアドレス」を指定して叩くだけで
    (相手はまだ会員登録していない前提)、コードを一切知らずにそのメールアドレス
    宛のアカウントへ即ログインできてしまう(なりすまし)。実際にコードが
    メールボックスに届いたことを本人が確認できて初めて、/auth/code/login で
    トークンを発行する。
    """
    email = _normalize_email(payload.email)
    if "@" not in email or len(email) < 3:
        raise HTTPException(status_code=400, detail="有効なメールアドレスを入力してください")

    _enforce_code_auth_rate_limit(email)
    _require_mail_configured()

    if get_code_login_by_email(email):
        raise HTTPException(
            status_code=409,
            detail="このメールアドレスは既に登録されています。ログインまたはコードの再発行をご利用ください。",
        )

    user_id = f"code:{uuid.uuid4().hex}"
    code = _generate_login_code()
    create_code_login(user_id, email, _hash_code(code))
    upsert_user(user_id, email)

    send_email(
        email,
        "【Paper Assistant】ログインコードの発行",
        f"あなたのログインコードは次の通りです:\n\n{code}\n\n"
        "このコードはログインに必要です。他人に教えず、紙などに控えて安全に保管してください。",
    )

    return {"message": "ログインコードをメールで送信しました。届いたコードでログインしてください。"}


@app.post("/auth/code/login")
def auth_code_login(payload: CodeLoginRequest, request: Request):
    """ログインコードを検証する。MFAが有効なアカウントには、セッショントークンの代わりに
    短命の仮認証トークンを返し、/auth/mfa/verify で認証アプリのコードを確認してから発行する。"""
    email = _normalize_email(payload.email)
    ip_address = _client_ip(request)
    user_agent = _client_user_agent(request)
    _enforce_code_auth_rate_limit(email)
    _enforce_not_locked(email)

    record = get_code_login_by_email(email)
    if not record or not hmac.compare_digest(record["code_hash"], _hash_code(payload.code)):
        _register_login_failure(email)
        record_security_event("login_failed", email, "ログインコード不一致", ip_address=ip_address, user_agent=user_agent)
        raise HTTPException(status_code=401, detail="メールアドレスまたはコードが正しくありません")

    user_id = record["user_id"]
    if is_mfa_enabled(user_id):
        return {"mfa_required": True, "mfa_token": create_mfa_token(user_id)}

    _clear_login_failures(email)
    record_security_event("login_success", user_id, "ログインコード", ip_address=ip_address, user_agent=user_agent)
    return {"token": create_app_token(user_id)}


@app.post("/auth/mfa/verify")
def auth_mfa_verify(payload: MfaVerifyRequest, request: Request):
    """仮認証トークン+認証アプリの6桁コードで、本物のセッショントークンを発行する。

    一次認証(メール+ログインコード、またはApple/Google/GitHub)がMFA必須の
    アカウントで成功した後、共通してここに合流する。
    """
    try:
        user_id = decode_mfa_token(payload.mfa_token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail="認証の有効期限が切れました。最初からやり直してください。") from exc

    ip_address = _client_ip(request)
    user_agent = _client_user_agent(request)
    lock_key = get_user_email(user_id) or user_id
    _enforce_not_locked(lock_key)

    enrollment = get_mfa_enrollment(user_id)
    if not enrollment or not enrollment["enabled"]:
        raise HTTPException(status_code=400, detail="このアカウントでは多要素認証が有効になっていません")

    if not verify_mfa_code(enrollment["secret"], payload.code):
        _register_login_failure(lock_key)
        record_security_event("mfa_failed", user_id, "認証アプリのコード不一致", ip_address=ip_address, user_agent=user_agent)
        raise HTTPException(status_code=401, detail="認証アプリのコードが正しくありません")

    _clear_login_failures(lock_key)
    first_factor = PROVIDER_LABELS.get(user_id.split(":", 1)[0], "ログインコード")
    record_security_event(
        "login_success", user_id, f"{first_factor}+認証アプリ", ip_address=ip_address, user_agent=user_agent
    )
    return {"token": create_app_token(user_id)}


@app.post("/auth/code/reissue")
def auth_code_reissue(payload: CodeReissueRequest):
    """コードを忘れた場合、新しいコードを生成してメールで送り直す(古いコードは失効する)。

    登録の有無を外部に漏らさないため、メールが未登録でも同じレスポンスを返す。
    """
    email = _normalize_email(payload.email)
    _enforce_code_auth_rate_limit(email)
    _require_mail_configured()

    record = get_code_login_by_email(email)
    if record:
        new_code = _generate_login_code()
        update_code_login_hash(record["user_id"], _hash_code(new_code))
        send_email(
            email,
            "【Paper Assistant】ログインコードの再発行",
            f"新しいログインコードは次の通りです:\n\n{new_code}\n\n"
            "以前のコードは無効になりました。他人に教えず、紙などに控えて安全に保管してください。",
        )

    return {"message": "このメールアドレスが登録されていれば、新しいコードを送信しました。"}


@app.post("/generate")
async def generate(
    topic: str = Form(...),
    field: str = Form("一般"),
    target_length: Optional[str] = Form(default=None),
    private: bool = Form(False),
    reference_files: Optional[List[UploadFile]] = File(default=None),
    format_file: Optional[UploadFile] = File(default=None),
    user_id: str = Depends(get_current_user),
):
    _enforce_generate_rate_limit(user_id)

    if not topic or not topic.strip():
        raise HTTPException(status_code=400, detail="topic is required")
    if len(topic) > MAX_TOPIC_LENGTH:
        raise HTTPException(status_code=400, detail=f"topicは{MAX_TOPIC_LENGTH}文字以内で入力してください")

    entitlement = get_or_create_entitlement(user_id)
    quota = PLAN_TOKEN_QUOTAS.get(entitlement["plan"], PLAN_TOKEN_QUOTAS["free"])
    if entitlement["tokens_used"] >= quota:
        raise HTTPException(
            status_code=402,
            detail="今月のトークン上限に達しました。プランのアップグレードは近日対応予定です。",
        )

    # 初回プロンプト(まだ分量が指定されていないリクエスト)には、
    # 生成前にアウトラインではなく分量選択の質問を返す。ただし「いいね」のような
    # 実質的な依頼を含まない感嘆文だけの場合は、質問を挟まず短く受け流す。
    if not target_length:
        brush_off = brush_off_if_exclamation(topic)
        usage = brush_off.pop("_token_usage", {"input_tokens": 0, "output_tokens": 0})
        add_token_usage(user_id, usage["input_tokens"] + usage["output_tokens"])
        if brush_off["reply"]:
            return {"type": "brush_off", "message": brush_off["reply"]}

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

    usage = outline.pop("_token_usage", {"input_tokens": 0, "output_tokens": 0})
    add_token_usage(user_id, usage["input_tokens"] + usage["output_tokens"])

    outline["type"] = "outline"
    outline["id"] = save_generation(user_id, topic, field, target_length, outline, is_private=private)
    outline["is_private"] = private
    return outline


@app.post("/generate/body")
def generate_body(payload: PaperBodyRequest, user_id: str = Depends(get_current_user)):
    """既に生成済みのアウトライン(タイトル・中心の問い・節構成・引用文献)から、
    実際に読める論文の本文(Markdown)を生成する。/generateと同じレート制限・
    トークンクォータを共有する(いずれもClaude APIを呼ぶコストのかかる操作のため)。
    """
    _enforce_generate_rate_limit(user_id)

    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="title is required")
    if not payload.sections:
        raise HTTPException(status_code=400, detail="sections is required")

    entitlement = get_or_create_entitlement(user_id)
    quota = PLAN_TOKEN_QUOTAS.get(entitlement["plan"], PLAN_TOKEN_QUOTAS["free"])
    if entitlement["tokens_used"] >= quota:
        raise HTTPException(
            status_code=402,
            detail="今月のトークン上限に達しました。プランのアップグレードは近日対応予定です。",
        )

    result = generate_paper_body(
        payload.title.strip(),
        payload.research_question,
        payload.sections,
        payload.target_length,
    )

    usage = result.pop("_token_usage", {"input_tokens": 0, "output_tokens": 0})
    add_token_usage(user_id, usage["input_tokens"] + usage["output_tokens"])

    return result


@app.post("/course-chat")
def course_chat(payload: CourseChatRequest, user_id: str = Depends(get_current_user)):
    _enforce_course_chat_rate_limit(user_id)

    if not payload.university.strip() or not payload.faculty.strip():
        raise HTTPException(status_code=400, detail="university and faculty are required")
    if not payload.messages:
        raise HTTPException(status_code=400, detail="messages is required")

    entitlement = get_or_create_entitlement(user_id)
    quota = PLAN_TOKEN_QUOTAS.get(entitlement["plan"], PLAN_TOKEN_QUOTAS["free"])
    if entitlement["tokens_used"] >= quota:
        raise HTTPException(
            status_code=402,
            detail="今月のトークン上限に達しました。プランのアップグレードは近日対応予定です。",
        )

    # 直近の発言が「いいね」のような、実質的な依頼を含まない感嘆文・相槌だけの場合は、
    # 授業内容の回答フロー(検索・履歴保存を含む)に入らず短く受け流す。
    last_message = payload.messages[-1]
    if last_message.role == "user":
        brush_off = brush_off_if_exclamation(last_message.content)
        brush_off_usage = brush_off.pop("_token_usage", {"input_tokens": 0, "output_tokens": 0})
        add_token_usage(user_id, brush_off_usage["input_tokens"] + brush_off_usage["output_tokens"])
        if brush_off["reply"]:
            return {"answer": brush_off["reply"]}

    result = answer_course_question(
        payload.university.strip(),
        payload.faculty.strip(),
        payload.department,
        [m.model_dump() for m in payload.messages],
    )

    usage = result.pop("_token_usage", {"input_tokens": 0, "output_tokens": 0})
    add_token_usage(user_id, usage["input_tokens"] + usage["output_tokens"])

    university = payload.university.strip()
    faculty = payload.faculty.strip()
    title = f"{university} / {faculty}"
    history_payload = {
        "university": university,
        "faculty": faculty,
        "department": payload.department,
        "messages": [m.model_dump() for m in payload.messages] + [{"role": "assistant", "content": result["answer"]}],
    }
    if payload.history_id and update_history_entry(user_id, payload.history_id, "logic-guide", title, history_payload):
        result["history_id"] = payload.history_id
    else:
        entry = save_history_entry(user_id, "logic-guide", title, history_payload)
        result["history_id"] = entry["id"]

    return result


@app.post("/literature/translate")
def translate_literature_titles(payload: TranslateTitlesRequest, user_id: str = Depends(get_current_user)):
    """関連文献パネルの言語セレクタから呼ばれ、文献タイトルの一覧をまとめて翻訳する。
    Claude APIを呼ぶため、/course-chatと同様にレート制限・トークンクォータを適用する。
    """
    _enforce_translate_rate_limit(user_id)

    if not payload.titles:
        raise HTTPException(status_code=400, detail="titles is required")
    if payload.target_lang not in LANGUAGE_NAMES:
        raise HTTPException(status_code=400, detail="invalid target_lang")

    entitlement = get_or_create_entitlement(user_id)
    quota = PLAN_TOKEN_QUOTAS.get(entitlement["plan"], PLAN_TOKEN_QUOTAS["free"])
    if entitlement["tokens_used"] >= quota:
        raise HTTPException(
            status_code=402,
            detail="今月のトークン上限に達しました。プランのアップグレードは近日対応予定です。",
        )

    result = translate_titles(payload.titles, payload.target_lang)

    usage = result.pop("_token_usage", {"input_tokens": 0, "output_tokens": 0})
    add_token_usage(user_id, usage["input_tokens"] + usage["output_tokens"])

    return result


def _parse_deadline(raw: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(raw)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="deadlineの形式が正しくありません(ISO8601)") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


@app.post("/tasks")
def tasks_create(payload: TaskCreateRequest, user_id: str = Depends(get_current_user)):
    """タスクの説明(+任意の締切)からAIが所要時間を見積もり、リマインド予定を作成する。

    締切があれば「締切 - 所要時間」を、無ければ「今 + 所要時間」をリマインド時刻にする。
    """
    _enforce_task_rate_limit(user_id)

    description = payload.description.strip()
    if not description:
        raise HTTPException(status_code=400, detail="description is required")

    entitlement = get_or_create_entitlement(user_id)
    quota = PLAN_TOKEN_QUOTAS.get(entitlement["plan"], PLAN_TOKEN_QUOTAS["free"])
    if entitlement["tokens_used"] >= quota:
        raise HTTPException(
            status_code=402,
            detail="今月のトークン上限に達しました。プランのアップグレードは近日対応予定です。",
        )

    deadline_dt = _parse_deadline(payload.deadline) if payload.deadline else None

    result = estimate_task_duration(description)
    usage = result.pop("_token_usage", {"input_tokens": 0, "output_tokens": 0})
    add_token_usage(user_id, usage["input_tokens"] + usage["output_tokens"])
    estimated_minutes = result["estimated_minutes"]

    now = datetime.now(timezone.utc)
    if deadline_dt is not None:
        remind_at = max(deadline_dt - timedelta(minutes=estimated_minutes), now)
    else:
        remind_at = now + timedelta(minutes=estimated_minutes)

    created = create_task(
        user_id,
        description,
        payload.deadline,
        estimated_minutes,
        remind_at.isoformat(),
        result.get("reasoning", ""),
    )

    save_history_entry(
        user_id,
        "tasks",
        description[:60],
        {
            "description": description,
            "deadline": payload.deadline,
            "estimated_minutes": estimated_minutes,
            "remind_at": remind_at.isoformat(),
            "reasoning": result.get("reasoning", ""),
        },
    )

    return created


@app.get("/tasks")
def tasks_list(user_id: str = Depends(get_current_user)):
    return {"items": list_tasks(user_id)}


@app.put("/tasks/{task_id}/status")
def tasks_update_status(task_id: int, payload: TaskStatusUpdate, user_id: str = Depends(get_current_user)):
    if payload.status not in ("pending", "done"):
        raise HTTPException(status_code=400, detail="invalid status")
    if not set_task_status(user_id, task_id, payload.status):
        raise HTTPException(status_code=404, detail="task not found")
    return {"status": "ok"}


@app.delete("/tasks/{task_id}")
def tasks_delete(task_id: int, user_id: str = Depends(get_current_user)):
    if not delete_task(user_id, task_id):
        raise HTTPException(status_code=404, detail="task not found")
    return {"status": "deleted"}


def _content_disposition(filename: str) -> str:
    """日本語ファイル名を含むContent-Disposition値を組み立てる(RFC 5987)。"""
    return f"attachment; filename*=UTF-8''{quote(filename)}"


@app.post("/task-generator")
def task_generator(payload: TaskGeneratorRequest, user_id: str = Depends(get_current_user)):
    """課題の説明文から、実際に提出できる成果物(文章またはExcelファイル)を生成する。

    kind="excel"の場合はJSONではなく.xlsxファイルそのものをレスポンスとして返す。
    """
    _enforce_task_generator_rate_limit(user_id)

    description = payload.description.strip()
    if not description:
        raise HTTPException(status_code=400, detail="description is required")
    if payload.kind not in ("text", "excel"):
        raise HTTPException(status_code=400, detail="invalid kind")

    entitlement = get_or_create_entitlement(user_id)
    quota = PLAN_TOKEN_QUOTAS.get(entitlement["plan"], PLAN_TOKEN_QUOTAS["free"])
    if entitlement["tokens_used"] >= quota:
        raise HTTPException(
            status_code=402,
            detail="今月のトークン上限に達しました。プランのアップグレードは近日対応予定です。",
        )

    if payload.kind == "excel":
        result = generate_task_spreadsheet(description)
        usage = result.pop("_token_usage", {"input_tokens": 0, "output_tokens": 0})
        add_token_usage(user_id, usage["input_tokens"] + usage["output_tokens"])

        spec = result["spec"]
        xlsx_bytes = build_xlsx_bytes(spec)
        filename = f"{(spec.get('filename') or '課題').strip()}.xlsx"

        save_history_entry(
            user_id,
            "task-generator",
            description[:60],
            {"kind": "excel", "description": description, "spec": spec, "filename": filename},
        )

        return Response(
            content=xlsx_bytes,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": _content_disposition(filename)},
        )

    result = generate_task_text(description)
    usage = result.pop("_token_usage", {"input_tokens": 0, "output_tokens": 0})
    add_token_usage(user_id, usage["input_tokens"] + usage["output_tokens"])

    save_history_entry(
        user_id,
        "task-generator",
        description[:60],
        {"kind": "text", "description": description, "content": result["content"]},
    )

    return {"kind": "text", "content": result["content"]}


@app.post("/study-notes")
async def study_notes(
    text: str = Form(""),
    focus: str = Form(""),
    file: Optional[UploadFile] = File(default=None),
    user_id: str = Depends(get_current_user),
):
    """レポート・資料(貼り付けテキストまたはファイル)を分析し、暗記すべき要点と
    全体の流れ・復習用の質問を整理して返す。
    """
    _enforce_study_notes_rate_limit(user_id)

    if len(focus) > MAX_STUDY_NOTES_FOCUS_LENGTH:
        raise HTTPException(
            status_code=400, detail=f"focusは{MAX_STUDY_NOTES_FOCUS_LENGTH}文字以内で入力してください"
        )

    document_text = text.strip()
    if file and file.filename:
        file_text = await _extract_study_notes_file_text(file)
        document_text = f"{document_text}\n\n{file_text}".strip() if document_text else file_text

    if not document_text:
        raise HTTPException(status_code=400, detail="text or file is required")

    entitlement = get_or_create_entitlement(user_id)
    quota = PLAN_TOKEN_QUOTAS.get(entitlement["plan"], PLAN_TOKEN_QUOTAS["free"])
    if entitlement["tokens_used"] >= quota:
        raise HTTPException(
            status_code=402,
            detail="今月のトークン上限に達しました。プランのアップグレードは近日対応予定です。",
        )

    result = generate_study_notes(document_text[:STUDY_NOTES_MAX_CHARS], focus.strip())
    usage = result.pop("_token_usage", {"input_tokens": 0, "output_tokens": 0})
    add_token_usage(user_id, usage["input_tokens"] + usage["output_tokens"])

    label = file.filename if file and file.filename else document_text[:40]
    save_history_entry(user_id, "study-notes", label[:60], {"label": label, "content": result["content"]})

    return {"content": result["content"]}


@app.get("/history")
def history(
    limit: int = 50,
    q: Optional[str] = None,
    scope: Optional[str] = None,
    user_id: str = Depends(get_current_user),
):
    return {"items": list_generations(user_id, limit=limit, q=q, only_private=(scope == "private"))}


@app.get("/history/{generation_id}")
def history_detail(generation_id: int, user_id: str = Depends(get_current_user)):
    record = get_generation(user_id, generation_id)
    if record is None:
        raise HTTPException(status_code=404, detail="generation not found")
    return record


@app.delete("/history/{generation_id}")
def history_delete(generation_id: int, user_id: str = Depends(get_current_user)):
    if not delete_generation(user_id, generation_id):
        raise HTTPException(status_code=404, detail="generation not found")
    return {"status": "deleted"}


@app.put("/history/{generation_id}/private")
def history_set_private(generation_id: int, payload: PrivacyUpdate, user_id: str = Depends(get_current_user)):
    if not set_generation_privacy(user_id, generation_id, payload.is_private):
        raise HTTPException(status_code=404, detail="generation not found")
    return {"status": "ok"}


# outline以外の4モード(logic-guide/task-generator/study-notes/tasks)共通の履歴。
# outlineだけスレッド(セッション)を再構築する専用UIを持つので/historyのまま独立させ、
# こちらはどのタブを選んでも同じ場所・同じ形で閲覧できる読み取り専用の履歴として使う。
MODE_HISTORY_MODES = {"logic-guide", "task-generator", "study-notes", "tasks"}


@app.get("/mode-history")
def mode_history(
    mode: str,
    limit: int = 50,
    q: Optional[str] = None,
    scope: Optional[str] = None,
    user_id: str = Depends(get_current_user),
):
    if mode not in MODE_HISTORY_MODES:
        raise HTTPException(status_code=400, detail="invalid mode")
    return {"items": list_history_entries(user_id, mode, limit=limit, q=q, only_private=(scope == "private"))}


@app.get("/mode-history/{entry_id}")
def mode_history_detail(entry_id: int, user_id: str = Depends(get_current_user)):
    record = get_history_entry(user_id, entry_id)
    if record is None:
        raise HTTPException(status_code=404, detail="history entry not found")
    return record


@app.get("/mode-history/{entry_id}/download")
def mode_history_download(entry_id: int, user_id: str = Depends(get_current_user)):
    """task-generatorのExcel履歴を、保存しておいたspecから再生成してダウンロードさせる。"""
    record = get_history_entry(user_id, entry_id)
    if record is None or record["mode"] != "task-generator" or record["payload"].get("kind") != "excel":
        raise HTTPException(status_code=404, detail="downloadable file not found")

    spec = record["payload"]["spec"]
    filename = record["payload"].get("filename") or "課題.xlsx"
    xlsx_bytes = build_xlsx_bytes(spec)
    return Response(
        content=xlsx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": _content_disposition(filename)},
    )


@app.delete("/mode-history/{entry_id}")
def mode_history_delete(entry_id: int, user_id: str = Depends(get_current_user)):
    if not delete_history_entry(user_id, entry_id):
        raise HTTPException(status_code=404, detail="history entry not found")
    return {"status": "deleted"}


@app.put("/mode-history/{entry_id}/private")
def mode_history_set_private(entry_id: int, payload: PrivacyUpdate, user_id: str = Depends(get_current_user)):
    if not set_history_entry_privacy(user_id, entry_id, payload.is_private):
        raise HTTPException(status_code=404, detail="history entry not found")
    return {"status": "ok"}


@app.get("/auth/mfa/status")
def auth_mfa_status(user_id: str = Depends(get_current_user)):
    enrollment = get_mfa_enrollment(user_id)
    return {
        "enabled": bool(enrollment and enrollment["enabled"]),
        "pending": bool(enrollment and not enrollment["enabled"]),
    }


@app.post("/auth/mfa/setup")
def auth_mfa_setup(user_id: str = Depends(get_current_user)):
    """認証アプリに登録するシークレットを発行する(この時点ではまだ有効化されない)。"""
    if is_mfa_enabled(user_id):
        raise HTTPException(status_code=409, detail="多要素認証は既に有効です。変更するには一度無効にしてください。")

    secret = generate_mfa_secret()
    set_mfa_secret(user_id, secret)
    account_name = get_user_email(user_id) or user_id
    return {"secret": secret, "otpauth_url": mfa_provisioning_uri(secret, account_name)}


@app.post("/auth/mfa/confirm")
def auth_mfa_confirm(payload: MfaCodeRequest, user_id: str = Depends(get_current_user)):
    """認証アプリが正しく登録できたことをコードで確認してから有効化する(登録ミスによる締め出し防止)。"""
    enrollment = get_mfa_enrollment(user_id)
    if not enrollment:
        raise HTTPException(status_code=400, detail="先に /auth/mfa/setup でシークレットを発行してください")
    if enrollment["enabled"]:
        raise HTTPException(status_code=409, detail="多要素認証は既に有効です")

    if not verify_mfa_code(enrollment["secret"], payload.code):
        record_security_event("mfa_confirm_failed", user_id, "有効化時のコード不一致")
        raise HTTPException(status_code=400, detail="認証アプリのコードが正しくありません。時刻が合っているか確認してください。")

    enable_mfa(user_id)
    record_security_event("mfa_enabled", user_id)
    return {"enabled": True}


@app.post("/auth/mfa/disable")
def auth_mfa_disable(payload: MfaCodeRequest, user_id: str = Depends(get_current_user)):
    """無効化には現在有効なコードを要求する(セッションを盗まれただけでは解除できないようにする)。"""
    enrollment = get_mfa_enrollment(user_id)
    if not enrollment:
        raise HTTPException(status_code=400, detail="多要素認証は設定されていません")

    if enrollment["enabled"] and not verify_mfa_code(enrollment["secret"], payload.code):
        record_security_event("mfa_disable_failed", user_id, "無効化時のコード不一致")
        raise HTTPException(status_code=401, detail="認証アプリのコードが正しくありません")

    delete_mfa(user_id)
    record_security_event("mfa_disabled", user_id)
    return {"enabled": False}


@app.get("/auth/security-events")
def auth_security_events(user_id: str = Depends(get_current_user)):
    """自分のアカウントに関する直近のセキュリティイベント(ログイン失敗・ロック・MFA変更)。"""
    events = list_security_events(user_id)
    email = get_user_email(user_id)
    if email:
        events += list_security_events(email)
    events.sort(key=lambda e: e["id"], reverse=True)
    return {"items": events[:20]}


@app.get("/me")
def me(user_id: str = Depends(get_current_user)):
    entitlement = get_or_create_entitlement(user_id)
    quota = PLAN_TOKEN_QUOTAS.get(entitlement["plan"], PLAN_TOKEN_QUOTAS["free"])
    return {**entitlement, "tokens_quota": quota, "is_admin": _is_admin(user_id)}


@app.get("/admin/overview")
def admin_overview(_admin_user_id: str = Depends(require_admin)):
    """運営者向け管理ダッシュボード用の集計値(ユーザー数・プラン内訳・利用量・生成件数など)。

    ADMIN_EMAILS/ADMIN_USER_IDSのいずれにも該当しないユーザーは403になる。
    """
    return get_admin_overview()


ADMIN_LOGIN_LOG_PAGE_SIZE_MAX = 200


@app.get("/admin/logins")
def admin_logins(
    limit: int = 50,
    offset: int = 0,
    event_type: Optional[str] = None,
    q: Optional[str] = None,
    _admin_user_id: str = Depends(require_admin),
):
    """運営者向け「ログイン履歴」。Apple/Google/GitHub/メールコードの全ログイン方式・
    成功/失敗/ロック/MFA関連イベントを、日時降順でページングして返す。

    qはsubject(user_id/メールアドレス)とdetailの部分一致で絞り込む。
    """
    limit = max(1, min(limit, ADMIN_LOGIN_LOG_PAGE_SIZE_MAX))
    offset = max(0, offset)
    items, total = list_login_events(limit=limit, offset=offset, event_type=event_type, q=q)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@app.post("/activity/ping")
def activity_ping(user_id: str = Depends(get_current_user)):
    """ホーム画面の利用時間グラフ向けに、画面を開いている間の生存確認を1件記録する。

    フロントは60秒おきにこれを呼ぶだけで、Claude APIは呼ばないためトークン消費はない。
    """
    _enforce_activity_ping_rate_limit(user_id)
    record_activity_ping(user_id)
    return {"status": "ok"}


@app.get("/activity/summary")
def activity_summary(granularity: str = "day", user_id: str = Depends(get_current_user)):
    """ホーム画面のグラフ向けに、日('day')/週('week')/年('year')単位の利用時間(分)を返す。"""
    if granularity not in ("day", "week", "year"):
        raise HTTPException(status_code=400, detail="granularity must be one of: day, week, year")
    return {"granularity": granularity, "items": get_activity_summary(user_id, granularity)}


@app.post("/billing/checkout")
def billing_checkout(payload: CheckoutRequest, user_id: str = Depends(get_current_user)):
    """指定プランへのアップグレード用に、Stripe Checkoutのセッションを作成してURLを返す。"""
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="決済機能はまだ設定されていません(STRIPE_SECRET_KEY未設定)")

    price_id = STRIPE_PLAN_PRICE_IDS.get(payload.plan)
    if not price_id:
        raise HTTPException(status_code=400, detail=f"unknown or unconfigured plan: {payload.plan}")

    entitlement = get_or_create_entitlement(user_id)
    session_params = {
        "mode": "subscription",
        "line_items": [{"price": price_id, "quantity": 1}],
        "success_url": f"{FRONTEND_ORIGIN}/?checkout=success",
        "cancel_url": f"{FRONTEND_ORIGIN}/?checkout=cancel",
        "client_reference_id": user_id,
    }
    if entitlement.get("stripe_customer_id"):
        session_params["customer"] = entitlement["stripe_customer_id"]

    try:
        session = stripe.checkout.Session.create(**session_params)
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=502, detail=f"Stripeでの決済セッション作成に失敗しました: {exc}") from exc

    return {"checkout_url": session.url}


@app.post("/billing/portal")
def billing_portal(user_id: str = Depends(get_current_user)):
    """既存の契約を管理・解約するためのStripeカスタマーポータルのURLを返す。"""
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="決済機能はまだ設定されていません(STRIPE_SECRET_KEY未設定)")

    entitlement = get_or_create_entitlement(user_id)
    customer_id = entitlement.get("stripe_customer_id")
    if not customer_id:
        raise HTTPException(status_code=400, detail="まだ決済履歴がありません")

    try:
        session = stripe.billing_portal.Session.create(customer=customer_id, return_url=FRONTEND_ORIGIN)
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=502, detail=f"Stripeカスタマーポータルの作成に失敗しました: {exc}") from exc

    return {"portal_url": session.url}


@app.post("/billing/webhook")
async def billing_webhook(request: Request):
    """Stripeからのイベント通知を受け取り、プラン変更をentitlementsに反映する。

    このエンドポイントだけは(Stripeから直接叩かれるため)get_current_userを使わず、
    代わりにStripeの署名検証(STRIPE_WEBHOOK_SECRET)で真正性を確認する。
    """
    if not STRIPE_WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhookはまだ設定されていません(STRIPE_WEBHOOK_SECRET未設定)")

    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(payload, signature, STRIPE_WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError) as exc:
        raise HTTPException(status_code=400, detail=f"invalid webhook payload: {exc}") from exc

    event_type = event["type"]
    data = event["data"]["object"]

    if event_type == "checkout.session.completed":
        user_id = data.get("client_reference_id")
        customer_id = data.get("customer")
        if user_id and customer_id:
            set_stripe_customer(user_id, customer_id)

    elif event_type in ("customer.subscription.created", "customer.subscription.updated"):
        customer_id = data.get("customer")
        items = data.get("items", {}).get("data", [])
        price_id = items[0]["price"]["id"] if items else None
        plan = STRIPE_PRICE_ID_TO_PLAN.get(price_id)
        user_id = get_user_id_by_stripe_customer(customer_id) if customer_id else None
        # サブスクが有効なステータスでなければ(未払い等)課金プランとして扱わない
        if user_id and plan and data.get("status") in ("active", "trialing"):
            set_plan(user_id, plan)

    elif event_type == "customer.subscription.deleted":
        customer_id = data.get("customer")
        user_id = get_user_id_by_stripe_customer(customer_id) if customer_id else None
        if user_id:
            set_plan(user_id, "free")

    return {"status": "ok"}


@app.get("/sessions")
def sessions(user_id: str = Depends(get_current_user)):
    return {"items": list_sessions(user_id)}


@app.post("/sessions")
def sessions_create(payload: SessionCreate, user_id: str = Depends(get_current_user)):
    return create_session(user_id, payload.title)


@app.put("/sessions/{session_id}")
def sessions_update(session_id: int, payload: SessionUpdate, user_id: str = Depends(get_current_user)):
    if not update_session(user_id, session_id, payload.title, payload.messages):
        raise HTTPException(status_code=404, detail="session not found")
    return {"status": "ok"}


@app.delete("/sessions/{session_id}")
def sessions_delete(session_id: int, user_id: str = Depends(get_current_user)):
    if not delete_session(user_id, session_id):
        raise HTTPException(status_code=404, detail="session not found")
    return {"status": "deleted"}


# `cd frontend && npm run build` 済みなら、Viteの開発用プロキシ(devサーバー限定)なしでも
# バックエンドと同一オリジンで配信できるように静的ファイルとしてマウントする。
# ビルドしていない開発時はこのディレクトリが存在しないため何もしない(devサーバー+プロキシ運用のまま)。
_FRONTEND_DIST_DIR = os.path.join(os.path.dirname(__file__), "frontend", "dist")
if os.path.isdir(_FRONTEND_DIST_DIR):
    app.mount("/", StaticFiles(directory=_FRONTEND_DIST_DIR, html=True), name="frontend")


if __name__ == '__main__':
    import ssl

    import uvicorn

    desktop_mode = os.getenv("DESKTOP_MODE", "").strip().lower() in {"1", "true", "yes"}
    # デスクトップ版はローカルのElectronだけから叩ければよいので127.0.0.1に留める。
    # クラウド(Render等)のコンテナはホスト側から到達できるよう0.0.0.0で待ち受ける必要がある。
    host = "127.0.0.1" if desktop_mode else os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))

    # Render等のPaaSではエッジ(ロードバランサー)がTLSを終端し、コンテナへは平文HTTPで
    # 転送されるのが通常の構成であり、それ自体は脆弱性ではない(施設内のプライベート
    # ネットワークを経由する)。一方、Renderを介さずこのアプリを直接インターネットに
    # 公開する場合(自前サーバー等)に備えて、SSL_CERTFILE/SSL_KEYFILEが設定されていれば
    # uvicorn自身がTLS 1.2未満(SSLv3/TLSv1.0/TLSv1.1)を拒否するサーバーとして
    # 起動できるようにしておく(SECURITY.md「暗号化仕様」参照)。
    ssl_certfile = os.getenv("SSL_CERTFILE", "").strip() or None
    ssl_keyfile = os.getenv("SSL_KEYFILE", "").strip() or None

    if ssl_certfile:
        config = uvicorn.Config(
            "app:app", host=host, port=port, ssl_certfile=ssl_certfile, ssl_keyfile=ssl_keyfile
        )
        config.load()
        config.ssl.minimum_version = ssl.TLSVersion.TLSv1_2  # TLS 1.2未満を拒否
        uvicorn.Server(config).run()
    else:
        uvicorn.run("app:app", host=host, port=port, reload=not desktop_mode and not IS_PRODUCTION)
