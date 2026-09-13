import hashlib
import hmac
import io
import os
import secrets
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

import stripe
from docx import Document
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from pypdf import PdfReader

from auth import (
    AuthError,
    create_app_token,
    decode_app_token,
    exchange_github_code_for_user,
    verify_apple_identity_token,
    verify_google_id_token,
)
from db import (
    add_token_usage,
    create_code_login,
    create_session,
    delete_generation,
    delete_session,
    get_code_login_by_email,
    get_generation,
    get_or_create_entitlement,
    get_user_id_by_stripe_customer,
    init_db,
    list_generations,
    list_sessions,
    save_generation,
    set_generation_privacy,
    set_plan,
    set_stripe_customer,
    update_code_login_hash,
    update_session,
    upsert_user,
)
from mailer import send_email
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

# 開発時のみ: この値を設定すると、Apple/Google/GitHubでのログインを経ずに
# `X-Dev-User-Id` ヘッダーで任意のuser_idを名乗ってアクセスできる。
# 本番環境では絶対に設定しないこと(誰でも他人になりすませてしまう)。
DEV_BYPASS_USER_ID = os.getenv("DEV_BYPASS_USER_ID", "").strip()

# /generate 1件あたりClaude APIを呼ぶため、誤操作や不具合でのコスト暴走を防ぐための
# 簡易レート制限(ユーザーごとの1分あたりの上限リクエスト数)。0以下で無効化。
GENERATE_RATE_LIMIT_PER_MINUTE = int(os.getenv("GENERATE_RATE_LIMIT_PER_MINUTE", "20"))

# メール+ログインコード方式のサインアップ/再発行の乱用(他人のメールへの
# スパム送信等)を防ぐための、メールアドレスごとの1分あたりの上限リクエスト数。
CODE_AUTH_RATE_LIMIT_PER_MINUTE = int(os.getenv("CODE_AUTH_RATE_LIMIT_PER_MINUTE", "5"))

# 月額プランごとのトークン枠(仮の数値)。
PLAN_TOKEN_QUOTAS: Dict[str, int] = {"free": 20_000, "pro": 200_000, "max": 1_000_000}

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


def get_current_user(
    authorization: Optional[str] = Header(default=None),
    x_dev_user_id: Optional[str] = Header(default=None),
) -> str:
    """Bearerトークン(アプリ独自のセッションJWT)を検証し、user_idを返す。

    DEV_BYPASS_USER_ID が設定されている開発環境に限り、X-Dev-User-Id ヘッダーで
    Sign in with Appleを経ずにuser_idを直接指定できる(ローカルでの動作確認用)。
    """
    if DEV_BYPASS_USER_ID and x_dev_user_id:
        return x_dev_user_id

    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")

    token = authorization[len("Bearer "):].strip()
    try:
        return decode_app_token(token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


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


class AppleSignInRequest(BaseModel):
    identity_token: str


class GoogleSignInRequest(BaseModel):
    id_token: str


class GitHubSignInRequest(BaseModel):
    code: str


class CodeSignupRequest(BaseModel):
    email: str


class CodeLoginRequest(BaseModel):
    email: str
    code: str


class CodeReissueRequest(BaseModel):
    email: str


class PrivacyUpdate(BaseModel):
    is_private: bool


class CheckoutRequest(BaseModel):
    plan: str


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


def _issue_session_token(provider: str, claims: dict) -> dict:
    """検証済みclaimsから内部user_id(provider:sub)を組み立て、セッショントークンを発行する。

    プロバイダーが違えば同じ人でも別アカウント扱いになる(自動アカウント統合はしない)。
    """
    user_id = f"{provider}:{claims['sub']}"
    upsert_user(user_id, claims.get("email"))
    return {"token": create_app_token(user_id)}


@app.post("/auth/apple")
def auth_apple(payload: AppleSignInRequest):
    try:
        claims = verify_apple_identity_token(payload.identity_token)
        return _issue_session_token("apple", claims)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.post("/auth/google")
def auth_google(payload: GoogleSignInRequest):
    try:
        claims = verify_google_id_token(payload.id_token)
        return _issue_session_token("google", claims)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.post("/auth/github")
def auth_github(payload: GitHubSignInRequest):
    try:
        claims = exchange_github_code_for_user(payload.code)
        return _issue_session_token("github", claims)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


@app.post("/auth/dev")
def auth_dev():
    """開発用: DEV_BYPASS_USER_ID設定時のみ、ブラウザのログイン画面からワンクリックで
    その固定ユーザーとしてのトークンを取得できる(本番では404)。"""
    if not DEV_BYPASS_USER_ID:
        raise HTTPException(status_code=404, detail="not found")
    return {"token": create_app_token(DEV_BYPASS_USER_ID)}


def _normalize_email(email: str) -> str:
    return email.strip().lower()


def _generate_login_code() -> str:
    """メール+コードログイン用の、紙にメモしやすい12桁(16進数)の乱数コードを生成する。"""
    return secrets.token_hex(6)


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.strip().encode("utf-8")).hexdigest()


@app.post("/auth/code/signup")
def auth_code_signup(payload: CodeSignupRequest):
    """メールアドレスだけで新規アカウントを作り、ログイン用の乱数コードを発行する。

    コードはAPIレスポンスでも返す(画面に表示して「紙にメモしてください」と
    案内するため、パスワードマネージャーのマスターキー等と同様に一度きりの
    表示になる)。あわせてメール(SMTP未設定ならログ出力)でも送る。
    """
    email = _normalize_email(payload.email)
    if "@" not in email or len(email) < 3:
        raise HTTPException(status_code=400, detail="有効なメールアドレスを入力してください")

    _enforce_code_auth_rate_limit(email)

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

    return {"token": create_app_token(user_id), "code": code}


@app.post("/auth/code/login")
def auth_code_login(payload: CodeLoginRequest):
    email = _normalize_email(payload.email)
    _enforce_code_auth_rate_limit(email)

    record = get_code_login_by_email(email)
    if not record or not hmac.compare_digest(record["code_hash"], _hash_code(payload.code)):
        raise HTTPException(status_code=401, detail="メールアドレスまたはコードが正しくありません")

    return {"token": create_app_token(record["user_id"])}


@app.post("/auth/code/reissue")
def auth_code_reissue(payload: CodeReissueRequest):
    """コードを忘れた場合、新しいコードを生成してメールで送り直す(古いコードは失効する)。

    登録の有無を外部に漏らさないため、メールが未登録でも同じレスポンスを返す。
    """
    email = _normalize_email(payload.email)
    _enforce_code_auth_rate_limit(email)

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

    entitlement = get_or_create_entitlement(user_id)
    quota = PLAN_TOKEN_QUOTAS.get(entitlement["plan"], PLAN_TOKEN_QUOTAS["free"])
    if entitlement["tokens_used"] >= quota:
        raise HTTPException(
            status_code=402,
            detail="今月のトークン上限に達しました。プランのアップグレードは近日対応予定です。",
        )

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


@app.get("/me")
def me(user_id: str = Depends(get_current_user)):
    entitlement = get_or_create_entitlement(user_id)
    quota = PLAN_TOKEN_QUOTAS.get(entitlement["plan"], PLAN_TOKEN_QUOTAS["free"])
    return {**entitlement, "tokens_quota": quota}


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
    import uvicorn

    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)
