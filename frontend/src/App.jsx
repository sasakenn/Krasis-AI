import React, { useCallback, useEffect, useRef, useState } from 'react'

// mermaidは重いので、logic-guideで図解が実際に必要になるまで読み込まない。
let mermaidPromise = null
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' })
      return mermaid
    })
  }
  return mermaidPromise
}
let mermaidDiagramCounter = 0

const DEFAULT_FIELD = '一般'
const NEW_TAB_TITLE = '新規タブ'
const ACTIVE_SESSION_STORAGE_KEY = 'paper-assistant-active-session-id'
const TOKEN_STORAGE_KEY = 'paper-assistant-token'
const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '')

// 授業案内チャンネル: 主要大学の学部一覧(候補になければ「その他」から自由入力できる)。
const OTHER_UNIVERSITY = 'その他(入力する)'
const UNIV_DATA = {
  '同志社大学': ['神学部', '文学部', '社会学部', '法学部', '経済学部', '商学部', '政策学部', '文化情報学部', '理工学部', '生命医科学部', 'スポーツ健康科学部', '心理学部', 'グローバル・コミュニケーション学部', 'グローバル地域文化学部'],
  '早稲田大学': ['政治経済学部', '法学部', '文学部', '文化構想学部', '教育学部', '商学部', '基幹理工学部', '創造理工学部', '先進理工学部', '社会科学部', '人間科学部', 'スポーツ科学部', '国際教養学部'],
  '慶應義塾大学': ['文学部', '経済学部', '法学部', '商学部', '医学部', '理工学部', '総合政策学部', '環境情報学部', '看護医療学部', '薬学部'],
  '東京大学': ['法学部', '医学部', '工学部', '文学部', '理学部', '農学部', '経済学部', '教養学部', '教育学部', '薬学部'],
  '京都大学': ['法学部', '経済学部', '文学部', '教育学部', '理学部', '医学部', '薬学部', '工学部', '農学部', '総合人間学部'],
  '大阪大学': ['法学部', '経済学部', '文学部', '人間科学部', '外国語学部', '理学部', '医学部', '歯学部', '薬学部', '工学部', '基礎工学部'],
  '一橋大学': ['商学部', '経済学部', '法学部', '社会学部'],
  '神戸大学': ['法学部', '経済学部', '経営学部', '文学部', '国際人間科学部', '理学部', '医学部', '工学部', '農学部', '海事科学部'],
  '立命館大学': ['法学部', '産業社会学部', '国際関係学部', '文学部', '映像学部', '経営学部', '政策科学部', '総合心理学部', '経済学部', 'スポーツ健康科学部', '食マネジメント学部', '理工学部', '情報理工学部', '生命科学部', '薬学部'],
  '関西大学': ['法学部', '文学部', '経済学部', '商学部', '社会学部', '政策創造学部', '外国語学部', '人間健康学部', '総合情報学部', '社会安全学部', 'システム理工学部', '環境都市工学部', '化学生命工学部'],
  '関西学院大学': ['神学部', '文学部', '社会学部', '法学部', '経済学部', '商学部', '人間福祉学部', '国際学部', '教育学部', '総合政策学部', '理学部', '工学部', '生命環境学部', '建築学部'],
  '明治大学': ['法学部', '商学部', '政治経済学部', '文学部', '理工学部', '農学部', '経営学部', '情報コミュニケーション学部', '国際日本学部', '総合数理学部'],
  '立教大学': ['文学部', '経済学部', '理学部', '社会学部', '法学部', '観光学部', 'コミュニティ福祉学部', '現代心理学部', '経営学部', '異文化コミュニケーション学部'],
  '中央大学': ['法学部', '経済学部', '商学部', '理工学部', '文学部', '総合政策学部', '国際経営学部', '国際情報学部'],
  '青山学院大学': ['文学部', '教育人間科学部', '経済学部', '法学部', '経営学部', '国際政治経済学部', '総合文化政策学部', '理工学部', '社会情報学部', '地球社会共生学部'],
  '法政大学': ['法学部', '文学部', '経済学部', '社会学部', '経営学部', '国際文化学部', '人間環境学部', '現代福祉学部', 'キャリアデザイン学部', 'デザイン工学部', '理工学部', '情報科学部'],
}
const UNIVERSITY_NAMES = [...Object.keys(UNIV_DATA), OTHER_UNIVERSITY]

function useFileDrop(onFiles) {
  return {
    onDragOver: (e) => e.preventDefault(),
    onDrop: (e) => {
      e.preventDefault()
      if (e.dataTransfer.files?.length) onFiles(e.dataTransfer.files)
    },
  }
}

function makeSession(id) {
  return { id, title: NEW_TAB_TITLE, messages: [] }
}

function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

// ログイン済みのセッショントークンをAuthorization: Bearerヘッダーに付与する。
// 401が返ってきたら(トークン失効・未ログイン)、Appにログイン画面へ戻すよう通知する。
function apiFetch(url, options = {}) {
  const token = getStoredToken()
  const headers = { ...(options.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`

  return fetch(`${API_ORIGIN}${url}`, { ...options, headers }).then((resp) => {
    if (resp.status === 401) {
      window.dispatchEvent(new Event('auth:unauthorized'))
    }
    return resp
  })
}

async function createSessionOnServer(title) {
  try {
    const resp = await apiFetch('/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!resp.ok) return null
    return await resp.json()
  } catch {
    return null
  }
}

async function readErrorMessage(resp) {
  const raw = await resp.text()
  try {
    const data = JSON.parse(raw)
    if (typeof data?.detail === 'string') return data.detail
    if (Array.isArray(data?.detail)) {
      return data.detail.map((d) => d?.msg || JSON.stringify(d)).join(' / ')
    }
  } catch {
    // JSON以外のレスポンス(素のテキストやHTML)はそのまま使う
  }
  return raw || `リクエストに失敗しました(status ${resp.status})`
}

function outlineToMarkdown(outline) {
  const lines = [`# ${outline.title}`, '', `**中心の問い**: ${outline.research_question}`, '']

  outline.sections.forEach((section, i) => {
    lines.push(`## ${i + 1}. ${section.heading}`, '', section.purpose, '')
    lines.push(`検索キーワード: \`${section.search_query}\``, '')

    if (section.literature && section.literature.length > 0) {
      lines.push('関連文献:')
      section.literature.forEach((paper) => {
        const authors = paper.authors && paper.authors.length > 0 ? paper.authors.join(', ') : '著者不明'
        const year = paper.year ? ` (${paper.year})` : ''
        lines.push(`- [${paper.title}](${paper.url}) — ${authors}${year}`)
      })
      lines.push('')
    }
  })

  if (outline.body) {
    lines.push('---', '', '# 本文', '', outline.body, '')
  }

  return lines.join('\n')
}

function downloadMarkdown(outline) {
  const markdown = outlineToMarkdown(outline)
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${outline.title.slice(0, 50) || 'outline'}.md`
  link.click()
  URL.revokeObjectURL(url)
}

function OutlineResult({ outline, onUpdateOutline, idPrefix = 'section' }) {
  const [bodyLoading, setBodyLoading] = useState(false)
  const [bodyError, setBodyError] = useState(null)

  async function handleGenerateBody() {
    setBodyLoading(true)
    setBodyError(null)
    try {
      const resp = await apiFetch('/generate/body', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: outline.title,
          research_question: outline.research_question,
          sections: outline.sections,
        }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      onUpdateOutline?.({ ...outline, body: data.body })
    } catch (err) {
      setBodyError(String(err))
    } finally {
      setBodyLoading(false)
    }
  }

  return (
    <div className="result">
      <div className="result-header">
        <h2>
          {outline.title}
          {outline.is_private && <span className="private-badge" title="シークレット保存">🔒</span>}
        </h2>
        <button type="button" className="export-button" onClick={() => downloadMarkdown(outline)}>
          📄 Markdownでダウンロード
        </button>
      </div>
      <p className="research-question">{outline.research_question}</p>
      <div className="sections">
        {outline.sections.map((section, i) => (
          <div className="section-card" id={`${idPrefix}-${i}`} key={i}>
            <h3>{i + 1}. {section.heading}</h3>
            <p className="purpose">{section.purpose}</p>
            <p className="search-query">検索キーワード: <code>{section.search_query}</code></p>
            {section.literature && section.literature.length > 0 ? (
              <ul className="literature">
                {section.literature.map((paper, j) => (
                  <li key={j}>
                    <a href={paper.url} target="_blank" rel="noreferrer">{paper.title}</a>
                    <div className="paper-meta">
                      {paper.authors && paper.authors.length > 0 ? paper.authors.join(', ') : '著者不明'}
                      {paper.year ? ` · ${paper.year}` : ''}
                      {paper.language ? ` · ${paper.language}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="no-literature">関連文献が見つかりませんでした。</p>
            )}
          </div>
        ))}
      </div>

      <div className="paper-body-section">
        {outline.body ? (
          <>
            <h3>本文</h3>
            <div className="paper-body">
              <PaperBodyContent content={outline.body} />
            </div>
            <button type="button" className="export-button" onClick={handleGenerateBody} disabled={bodyLoading}>
              {bodyLoading ? '再生成中…' : '🔁 本文を再生成'}
            </button>
          </>
        ) : (
          <button type="button" className="generate-body-button" onClick={handleGenerateBody} disabled={bodyLoading}>
            {bodyLoading ? '本文を生成中…' : '📝 論文本文を生成'}
          </button>
        )}
        {bodyError && <div className="error">Error: {bodyError}</div>}
      </div>
    </div>
  )
}

function LengthQuestion({ question, onChoose }) {
  return (
    <div className="length-question">
      <p>{question.message}</p>
      <div className="length-options">
        {question.options.map((opt) => (
          <button
            key={opt.key}
            type="button"
            className={`length-option ${question.chosen === opt.key ? 'chosen' : ''}`}
            disabled={!!question.chosen}
            onClick={() => onChoose(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function LoginScreen({ onToken }) {
  const appleClientId = import.meta.env.VITE_APPLE_CLIENT_ID
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const githubClientId = import.meta.env.VITE_GITHUB_CLIENT_ID
  const githubRedirectUri = import.meta.env.VITE_GITHUB_REDIRECT_URI || window.location.origin

  const [error, setError] = useState(null)
  const [devLoading, setDevLoading] = useState(false)

  // メールアドレス+乱数コードでのログイン(Google/GitHub等のアカウントを使いたくない場合向け)。
  // ログインコードは画面には出さず、メールでのみ届ける(SMTP未設定時はサーバーログに出力)。
  const [codeMode, setCodeMode] = useState('signup') // 'signup' | 'login' | 'forgot'
  const [codeEmail, setCodeEmail] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const [reissueMessage, setReissueMessage] = useState(null)

  // 多要素認証(認証アプリ)が有効なアカウントの場合、ログインコード確認後に
  // このmfaTokenを使って6桁コードの入力を求める(セッショントークンはまだ発行されない)。
  const [mfaToken, setMfaToken] = useState(null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)

  function switchCodeMode(mode) {
    setCodeMode(mode)
    setError(null)
    setReissueMessage(null)
  }

  async function handleCodeSignup(e) {
    e.preventDefault()
    setError(null)
    setCodeLoading(true)
    try {
      const resp = await fetch(`${API_ORIGIN}/auth/code/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: codeEmail }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      onToken(data.token)
    } catch (err) {
      setError(String(err))
    } finally {
      setCodeLoading(false)
    }
  }

  async function handleCodeLogin(e) {
    e.preventDefault()
    setError(null)
    setCodeLoading(true)
    try {
      const resp = await fetch(`${API_ORIGIN}/auth/code/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: codeEmail, code: codeInput }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      if (data.mfa_required) {
        setMfaToken(data.mfa_token)
      } else {
        onToken(data.token)
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setCodeLoading(false)
    }
  }

  async function handleMfaVerify(e) {
    e.preventDefault()
    setError(null)
    setMfaLoading(true)
    try {
      const resp = await fetch(`${API_ORIGIN}/auth/mfa/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mfa_token: mfaToken, code: mfaCode }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      onToken(data.token)
    } catch (err) {
      setError(String(err))
    } finally {
      setMfaLoading(false)
    }
  }

  async function handleCodeReissue(e) {
    e.preventDefault()
    setError(null)
    setReissueMessage(null)
    setCodeLoading(true)
    try {
      const resp = await fetch(`${API_ORIGIN}/auth/code/reissue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: codeEmail }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      setReissueMessage(data.message)
    } catch (err) {
      setError(String(err))
    } finally {
      setCodeLoading(false)
    }
  }

  useEffect(() => {
    if (!appleClientId || !window.AppleID) return
    window.AppleID.auth.init({
      clientId: appleClientId,
      scope: 'email',
      redirectURI: window.location.origin,
      usePopup: true,
    })
  }, [appleClientId])

  useEffect(() => {
    if (!googleClientId || !window.google) return
    window.google.accounts.id.initialize({
      client_id: googleClientId,
      callback: async (response) => {
        setError(null)
        try {
          const resp = await fetch(`${API_ORIGIN}/auth/google`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id_token: response.credential }),
          })
          if (!resp.ok) throw new Error(await readErrorMessage(resp))
          const data = await resp.json()
          onToken(data.token)
        } catch (err) {
          setError(String(err))
        }
      },
    })
    const container = document.getElementById('google-signin-button')
    if (container) {
      window.google.accounts.id.renderButton(container, { theme: 'filled_black', size: 'large', width: 260 })
    }
  }, [googleClientId, onToken])

  async function handleAppleSignIn() {
    setError(null)
    try {
      const result = await window.AppleID.auth.signIn()
      const resp = await fetch(`${API_ORIGIN}/auth/apple`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity_token: result.authorization.id_token }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      onToken(data.token)
    } catch (err) {
      setError(String(err))
    }
  }

  function handleGitHubSignIn() {
    const params = new URLSearchParams({
      client_id: githubClientId,
      redirect_uri: githubRedirectUri,
      scope: 'read:user user:email',
    })
    window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`
  }

  async function handleDevLogin() {
    setError(null)
    setDevLoading(true)
    try {
      const resp = await fetch(`${API_ORIGIN}/auth/dev`, { method: 'POST' })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      onToken(data.token)
    } catch (err) {
      setError(String(err))
    } finally {
      setDevLoading(false)
    }
  }

  if (mfaToken) {
    return (
      <div className="app-root login-screen">
        <div className="login-card">
          <div className="sidebar-brand">📚 Novera</div>
          <p className="login-subtitle">認証アプリに表示されている6桁のコードを入力してください</p>

          <form className="code-auth-form" onSubmit={handleMfaVerify}>
            <input
              type="text"
              required
              inputMode="numeric"
              autoFocus
              placeholder="6桁のコード"
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
            />
            <button type="submit" className="login-button" disabled={mfaLoading}>
              {mfaLoading ? '確認中…' : 'コードを確認してログイン'}
            </button>
            <button
              type="button"
              className="login-button login-button-secondary"
              onClick={() => { setMfaToken(null); setMfaCode(''); setError(null) }}
            >
              戻る
            </button>
          </form>

          {error && <div className="error">Error: {error}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="app-root login-screen">
      <div className="login-card">
        <div className="sidebar-brand">📚 Novera</div>
        <p className="login-subtitle">続けるにはログインしてください</p>

        <div className="login-options">
          <button
            type="button"
            className="login-button login-button-apple"
            disabled={!appleClientId}
            onClick={handleAppleSignIn}
          >
             Appleでサインイン
          </button>
          {!appleClientId && <small className="login-hint">サーバーでAPPLE_CLIENT_IDが未設定です</small>}

          {googleClientId ? (
            <div id="google-signin-button" className="login-google-button" />
          ) : (
            <>
              <button type="button" className="login-button" disabled>
                Googleでサインイン
              </button>
              <small className="login-hint">サーバーでGOOGLE_CLIENT_IDが未設定です</small>
            </>
          )}

          <button
            type="button"
            className="login-button login-button-github"
            disabled={!githubClientId}
            onClick={handleGitHubSignIn}
          >
            GitHubでサインイン
          </button>
          {!githubClientId && <small className="login-hint">サーバーでGITHUB_CLIENT_IDが未設定です</small>}

          <div className="login-divider">または</div>

          <div className="code-auth">
            <div className="code-auth-tabs">
              <button
                type="button"
                className={codeMode === 'signup' ? 'active' : ''}
                onClick={() => switchCodeMode('signup')}
              >
                新規登録
              </button>
              <button
                type="button"
                className={codeMode === 'login' ? 'active' : ''}
                onClick={() => switchCodeMode('login')}
              >
                ログイン
              </button>
              <button
                type="button"
                className={codeMode === 'forgot' ? 'active' : ''}
                onClick={() => switchCodeMode('forgot')}
              >
                ログインコードを忘れた
              </button>
            </div>

            {codeMode === 'signup' && (
              <form className="code-auth-form" onSubmit={handleCodeSignup}>
                <input
                  type="email"
                  required
                  placeholder="メールアドレス"
                  value={codeEmail}
                  onChange={(e) => setCodeEmail(e.target.value)}
                />
                <button type="submit" className="login-button" disabled={codeLoading}>
                  {codeLoading ? '処理中…' : 'メールで登録してログインコードを発行'}
                </button>
              </form>
            )}

            {codeMode === 'login' && (
              <form className="code-auth-form" onSubmit={handleCodeLogin}>
                <input
                  type="email"
                  required
                  placeholder="メールアドレス"
                  value={codeEmail}
                  onChange={(e) => setCodeEmail(e.target.value)}
                />
                <input
                  type="text"
                  required
                  placeholder="12桁のログインコード"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                />
                <button type="submit" className="login-button" disabled={codeLoading}>
                  {codeLoading ? '処理中…' : 'ログインコードでログイン'}
                </button>
              </form>
            )}

            {codeMode === 'forgot' && (
              <form className="code-auth-form" onSubmit={handleCodeReissue}>
                <input
                  type="email"
                  required
                  placeholder="メールアドレス"
                  value={codeEmail}
                  onChange={(e) => setCodeEmail(e.target.value)}
                />
                <button type="submit" className="login-button" disabled={codeLoading}>
                  {codeLoading ? '処理中…' : 'ログインコードを再発行してメールで送る'}
                </button>
                {reissueMessage && <p className="login-hint">{reissueMessage}</p>}
              </form>
            )}
          </div>

          {import.meta.env.DEV && (
            <button type="button" className="login-button login-button-dev" onClick={handleDevLogin} disabled={devLoading}>
              {devLoading ? '処理中…' : '🛠 開発用ログイン'}
            </button>
          )}
        </div>

        {error && <div className="error">Error: {error}</div>}

        <p className="login-credit">Made by Krasis</p>
      </div>
    </div>
  )
}

function Workspace({ messages, onMessages, onFirstTopic, onGenerated, onDirtyChange }) {
  const [topic, setTopic] = useState('')
  const [field, setField] = useState(DEFAULT_FIELD)
  const [referenceFiles, setReferenceFiles] = useState([])
  const [formatFile, setFormatFile] = useState(null)
  const [isPrivate, setIsPrivate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [focused, setFocused] = useState(false)
  const [pendingRequest, setPendingRequest] = useState(null)
  const [awaitingLength, setAwaitingLength] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)

  const referenceInputRef = useRef(null)
  const formatInputRef = useRef(null)

  // 送信前のテーマ入力・添付ファイルはこのコンポーネントのローカルstateにしか無く、
  // タブ切り替えやページ再読み込みで消えてしまうため、呼び出し元に「未送信の入力がある」ことを伝える。
  const isDirty = Boolean(topic.trim()) || referenceFiles.length > 0 || Boolean(formatFile)

  useEffect(() => {
    onDirtyChange?.(isDirty)
  }, [isDirty, onDirtyChange])

  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!isDirty) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [isDirty])

  function addReferenceFiles(fileList) {
    const incoming = Array.from(fileList)
    setReferenceFiles((prev) => {
      const existing = new Set(prev.map((f) => `${f.name}:${f.size}`))
      const merged = [...prev]
      for (const f of incoming) {
        const key = `${f.name}:${f.size}`
        if (!existing.has(key)) {
          merged.push(f)
          existing.add(key)
        }
      }
      return merged
    })
  }

  function removeReferenceFile(index) {
    setReferenceFiles((prev) => prev.filter((_, i) => i !== index))
  }

  function setFormatFileFromList(fileList) {
    if (fileList[0]) setFormatFile(fileList[0])
  }

  const referenceDrop = useFileDrop(addReferenceFiles)
  const formatDrop = useFileDrop(setFormatFileFromList)

  async function submitGenerate({ topic: t, field: f, referenceFiles: rf, formatFile: ff, targetLength, isPrivate: priv }) {
    const formData = new FormData()
    formData.append('topic', t)
    formData.append('field', f)
    if (targetLength) formData.append('target_length', targetLength)
    formData.append('private', priv ? 'true' : 'false')
    rf.forEach((file) => formData.append('reference_files', file))
    if (ff) formData.append('format_file', ff)

    const resp = await apiFetch('/generate', { method: 'POST', body: formData })
    if (!resp.ok) throw new Error(await readErrorMessage(resp))
    return resp.json()
  }

  function resetComposer() {
    setTopic('')
    setReferenceFiles([])
    setFormatFile(null)
    setIsPrivate(false)
    setPendingRequest(null)
    setAwaitingLength(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!topic.trim()) {
      setError('プロンプトを入力してください')
      return
    }

    const userMessage = {
      role: 'user',
      topic,
      field,
      referenceFileNames: referenceFiles.map((f) => f.name),
      formatFileName: formatFile ? formatFile.name : null,
    }
    onMessages((prev) => [...prev, userMessage])
    if (messages.length === 0) onFirstTopic(topic)

    const requestSnapshot = { topic, field, referenceFiles, formatFile, isPrivate }
    setLoading(true)

    try {
      const data = await submitGenerate({ ...requestSnapshot, targetLength: null })

      if (data.type === 'length_question') {
        setPendingRequest(requestSnapshot)
        setAwaitingLength(true)
        onMessages((prev) => [...prev, { role: 'assistant', lengthQuestion: data }])
      } else {
        onMessages((prev) => [...prev, { role: 'assistant', outline: data }])
        resetComposer()
        onGenerated?.()
      }
    } catch (err) {
      setError(String(err))
      onMessages((prev) => [...prev, { role: 'assistant', error: String(err) }])
    } finally {
      setLoading(false)
    }
  }

  async function handleLengthChoice(messageIndex, optionKey) {
    if (!pendingRequest) return

    onMessages((prev) =>
      prev.map((m, idx) =>
        idx === messageIndex ? { ...m, lengthQuestion: { ...m.lengthQuestion, chosen: optionKey } } : m
      )
    )
    setLoading(true)

    try {
      const data = await submitGenerate({ ...pendingRequest, targetLength: optionKey })
      onMessages((prev) => [...prev, { role: 'assistant', outline: data }])
      resetComposer()
      onGenerated?.()
    } catch (err) {
      setError(String(err))
      onMessages((prev) => [...prev, { role: 'assistant', error: String(err) }])
      setAwaitingLength(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="thread">
        {messages.length === 0 && (
          <div className="empty-state">
            下のボックスにテーマを入力し、必要なら参考資料やフォーマット指定ファイルを添付して送信してください。
          </div>
        )}

        {messages.map((m, i) => (
          <div className={`message message-${m.role}`} key={i}>
            {m.role === 'user' ? (
              <>
                <div className="message-author">You</div>
                <div className="message-body">
                  <p>{m.topic}</p>
                  <span className="message-tag">分野: {m.field}</span>
                  {(m.referenceFileNames.length > 0 || m.formatFileName) && (
                    <div className="message-attachments">
                      {m.referenceFileNames.map((name, j) => (
                        <span className="chip" key={`r-${j}`}>📎 {name}</span>
                      ))}
                      {m.formatFileName && <span className="chip">📐 {m.formatFileName}</span>}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="message-author">Assistant</div>
                <div className="message-body">
                  {m.error && <div className="error">Error: {m.error}</div>}
                  {m.lengthQuestion && (
                    <LengthQuestion
                      question={m.lengthQuestion}
                      onChoose={(key) => handleLengthChoice(i, key)}
                    />
                  )}
                  {m.outline && (
                    <OutlineResult
                      outline={m.outline}
                      idPrefix={`section-${i}`}
                      onUpdateOutline={(nextOutline) =>
                        onMessages((prev) =>
                          prev.map((msg, idx) => (idx === i ? { ...msg, outline: nextOutline } : msg))
                        )
                      }
                    />
                  )}
                </div>
              </>
            )}
          </div>
        ))}

        {loading && (
          <div className="message message-assistant">
            <div className="message-author">Assistant</div>
            <div className="message-body"><span className="typing">生成中…</span></div>
          </div>
        )}
      </div>

      <form className={`composer ${focused ? 'composer-focused' : ''}`} onSubmit={handleSubmit}>
        <button
          type="button"
          className="attach-toggle"
          aria-expanded={attachOpen}
          onClick={() => setAttachOpen((v) => !v)}
        >
          <span className={`attach-toggle-caret ${attachOpen ? 'open' : ''}`}>▸</span>
          添付ファイル(参考資料・フォーマット指定)
          {(referenceFiles.length > 0 || formatFile) && !attachOpen && (
            <span className="attach-toggle-count">
              {referenceFiles.length + (formatFile ? 1 : 0)}
            </span>
          )}
        </button>

        {attachOpen && (
          <div className="composer-attachzone">
            <div className="attach-box" {...referenceDrop} onClick={() => referenceInputRef.current?.click()}>
              <input
                ref={referenceInputRef}
                type="file"
                multiple
                hidden
                accept=".txt,.md,.markdown,.csv,.pdf,.docx"
                onChange={(e) => { addReferenceFiles(e.target.files); e.target.value = '' }}
              />
              <span className="attach-icon">📎</span>
              <span className="attach-label">参考資料を追加</span>
              <small>txt/md/pdf/docxは中身を読み込みます(複数可、それ以外はファイル名のみ)</small>
            </div>

            <div className="attach-box" {...formatDrop} onClick={() => formatInputRef.current?.click()}>
              <input
                ref={formatInputRef}
                type="file"
                hidden
                accept=".txt,.md,.markdown,.csv,.pdf,.docx"
                onChange={(e) => { setFormatFileFromList(e.target.files); e.target.value = '' }}
              />
              <span className="attach-icon">📐</span>
              <span className="attach-label">フォーマット指定ファイルを追加</span>
              <small>生成する論文の形式を指定するファイル(1件、txt/md/pdf/docx対応)</small>
            </div>
          </div>
        )}

        {(referenceFiles.length > 0 || formatFile) && (
          <div className="composer-chips">
            {referenceFiles.map((f, i) => (
              <span className="chip" key={`rf-${i}`}>
                📎 {f.name}
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={`${f.name}を添付から削除`}
                  onClick={() => removeReferenceFile(i)}
                >
                  ×
                </button>
              </span>
            ))}
            {formatFile && (
              <span className="chip">
                📐 {formatFile.name}
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={`${formatFile.name}を添付から削除`}
                  onClick={() => setFormatFile(null)}
                >
                  ×
                </button>
              </span>
            )}
          </div>
        )}

        {awaitingLength && (
          <div className="composer-hint">上のメッセージで生成する分量を選んでください</div>
        )}

        <textarea
          className="prompt-box"
          placeholder="例: 生成AIが学術論文の執筆プロセスに与える影響について調査計画を作りたい"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          rows={3}
          disabled={awaitingLength}
        />

        <div className="composer-toolbar">
          <input
            className="field-input"
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder="分野(例: 教育技術)"
            disabled={awaitingLength}
          />
          <label className="private-toggle">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              disabled={awaitingLength}
            />
            🔒 シークレットとして保存
          </label>
          <button type="submit" className="send-button" disabled={loading || !topic.trim() || awaitingLength}>
            {loading ? '生成中…' : '送信 ➤'}
          </button>
        </div>

        {error && <div className="error">Error: {error}</div>}
      </form>
    </>
  )
}

// 回答中の```mermaid ... ```コードブロックと、それ以外の地の文を交互の配列に分ける。
function splitMermaidBlocks(content) {
  const parts = []
  const regex = /```mermaid\n([\s\S]*?)```/g
  let lastIndex = 0
  let match
  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', value: content.slice(lastIndex, match.index) })
    }
    parts.push({ type: 'mermaid', value: match[1].trim() })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < content.length) {
    parts.push({ type: 'text', value: content.slice(lastIndex) })
  }
  return parts
}

function MermaidDiagram({ code }) {
  const containerRef = useRef(null)
  const [renderError, setRenderError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setRenderError(false)
    const id = `mermaid-diagram-${++mermaidDiagramCounter}`

    loadMermaid()
      .then((mermaid) => mermaid.render(id, code))
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg
      })
      .catch(() => {
        if (!cancelled) setRenderError(true)
      })

    return () => { cancelled = true }
  }, [code])

  if (renderError) {
    return <pre className="mermaid-fallback">{code}</pre>
  }

  return <div className="mermaid-diagram" ref={containerRef} />
}

function MessageContent({ content }) {
  return (
    <>
      {splitMermaidBlocks(content).map((part, i) =>
        part.type === 'mermaid' ? (
          <MermaidDiagram key={i} code={part.value} />
        ) : (
          part.value.trim() && <p key={i}>{part.value.trim()}</p>
        )
      )}
    </>
  )
}

// 本文生成では「## 見出し」形式のMarkdown見出しを使うよう指示しているため、
// それだけを簡易的にパースして描画する(それ以外の地の文は段落として扱う)。
function PaperBodyContent({ content }) {
  return (
    <>
      {splitMermaidBlocks(content).map((part, pi) => {
        if (part.type === 'mermaid') return <MermaidDiagram key={pi} code={part.value} />

        return part.value
          .split(/\n{2,}/)
          .map((block) => block.trim())
          .filter(Boolean)
          .map((block, bi) => {
            const headingMatch = block.match(/^(#{1,3})\s+(.+)$/)
            if (headingMatch) {
              const key = `${pi}-${bi}`
              return headingMatch[1].length === 1 ? (
                <h3 key={key}>{headingMatch[2]}</h3>
              ) : (
                <h4 key={key}>{headingMatch[2]}</h4>
              )
            }
            return (
              <p key={`${pi}-${bi}`}>{block}</p>
            )
          })
      })}
    </>
  )
}

function CourseGuide() {
  const [university, setUniversity] = useState('')
  const [customUniversity, setCustomUniversity] = useState('')
  const [faculty, setFaculty] = useState('')
  const [customFaculty, setCustomFaculty] = useState('')
  const [department, setDepartment] = useState('')
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const isCustomUniv = university === OTHER_UNIVERSITY
  const facultyOptions = isCustomUniv ? [] : (UNIV_DATA[university] || [])
  const isCustomFaculty = faculty === OTHER_UNIVERSITY

  const effectiveUniversity = (isCustomUniv ? customUniversity : university).trim()
  const effectiveFaculty = (isCustomFaculty ? customFaculty : faculty).trim()
  const canChat = effectiveUniversity.length > 0 && effectiveFaculty.length > 0
  const locked = messages.length > 0

  function handleUniversityChange(e) {
    setUniversity(e.target.value)
    setFaculty('')
    setCustomFaculty('')
  }

  function handleReset() {
    setMessages([])
    setError(null)
  }

  async function handleSend(e) {
    e.preventDefault()
    const q = input.trim()
    if (!q || loading || !canChat) return

    const nextMessages = [...messages, { role: 'user', content: q }]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const resp = await apiFetch('/course-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          university: effectiveUniversity,
          faculty: effectiveFaculty,
          department: department.trim(),
          messages: nextMessages,
        }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer }])
    } catch (err) {
      setError(String(err))
      setMessages((prev) => [...prev, { role: 'assistant', error: String(err) }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="course-picker">
        <select value={university} onChange={handleUniversityChange} disabled={locked}>
          <option value="">大学を選択</option>
          {UNIVERSITY_NAMES.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        {isCustomUniv && (
          <input
            type="text"
            placeholder="大学名を入力"
            value={customUniversity}
            onChange={(e) => setCustomUniversity(e.target.value)}
            disabled={locked}
          />
        )}

        {university && (
          isCustomUniv ? (
            <input
              type="text"
              placeholder="学部名を入力"
              value={customFaculty}
              onChange={(e) => setCustomFaculty(e.target.value)}
              disabled={locked}
            />
          ) : (
            <>
              <select value={faculty} onChange={(e) => setFaculty(e.target.value)} disabled={locked}>
                <option value="">学部を選択</option>
                {facultyOptions.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
                <option value={OTHER_UNIVERSITY}>{OTHER_UNIVERSITY}</option>
              </select>
              {isCustomFaculty && (
                <input
                  type="text"
                  placeholder="学部名を入力"
                  value={customFaculty}
                  onChange={(e) => setCustomFaculty(e.target.value)}
                  disabled={locked}
                />
              )}
            </>
          )
        )}

        {canChat && (
          <input
            type="text"
            placeholder="学科・専攻(任意)"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            disabled={locked}
          />
        )}

        {canChat && (
          <span className="course-picker-target">
            {effectiveUniversity} ／ {effectiveFaculty}{department.trim() && ` ／ ${department.trim()}`}
          </span>
        )}

        {locked && (
          <button type="button" className="course-picker-reset" onClick={handleReset}>
            ↺ 対象を変更
          </button>
        )}
      </div>

      <div className="thread">
        {messages.length === 0 && (
          <div className="empty-state">
            {canChat
              ? '気になる授業について、下のボックスから質問してください。'
              : '上で大学と学部を選択すると、質問できるようになります。'}
          </div>
        )}

        {messages.map((m, i) => (
          <div className={`message message-${m.role}`} key={i}>
            {m.role === 'user' ? (
              <>
                <div className="message-author">You</div>
                <div className="message-body"><p>{m.content}</p></div>
              </>
            ) : (
              <>
                <div className="message-author">Assistant</div>
                <div className="message-body">
                  {m.error ? <div className="error">Error: {m.error}</div> : <MessageContent content={m.content} />}
                </div>
              </>
            )}
          </div>
        ))}

        {loading && (
          <div className="message message-assistant">
            <div className="message-author">Assistant</div>
            <div className="message-body"><span className="typing">考え中…</span></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="composer" onSubmit={handleSend}>
        <textarea
          className="prompt-box"
          placeholder={canChat ? '例: 民法の授業は何を勉強しますか？' : '上で大学・学部を選択すると入力できます'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          disabled={!canChat || loading}
        />
        <div className="composer-toolbar">
          <button type="submit" className="send-button" disabled={!canChat || loading || !input.trim()}>
            {loading ? '送信中…' : '送信 ➤'}
          </button>
        </div>
        {error && <div className="error">Error: {error}</div>}
      </form>
    </>
  )
}

function formatMinutes(minutes) {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest > 0 ? `${hours}時間${rest}分` : `${hours}時間`
  }
  return `${minutes}分`
}

function formatDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function TaskReminders() {
  const [tasks, setTasks] = useState([])
  const [description, setDescription] = useState('')
  const [deadline, setDeadline] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [listLoaded, setListLoaded] = useState(false)

  const fetchTasks = useCallback(async () => {
    try {
      const resp = await apiFetch('/tasks')
      if (!resp.ok) return
      const data = await resp.json()
      setTasks(data.items || [])
    } catch {
      // 一覧の取得に失敗しても、フォームからの新規作成は引き続き試せるようにする
    } finally {
      setListLoaded(true)
    }
  }, [])

  useEffect(() => {
    fetchTasks()
  }, [fetchTasks])

  async function handleSubmit(e) {
    e.preventDefault()
    const text = description.trim()
    if (!text || loading) return

    setLoading(true)
    setError(null)
    try {
      const resp = await apiFetch('/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: text,
          deadline: deadline ? new Date(deadline).toISOString() : null,
        }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const created = await resp.json()
      setTasks((prev) => [...prev, created].sort((a, b) => a.remind_at.localeCompare(b.remind_at)))
      setDescription('')
      setDeadline('')
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleToggleStatus(task) {
    const nextStatus = task.status === 'done' ? 'pending' : 'done'
    const resp = await apiFetch(`/tasks/${task.id}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: nextStatus }),
    })
    if (!resp.ok) return
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, status: nextStatus } : t)))
  }

  async function handleDelete(task) {
    const resp = await apiFetch(`/tasks/${task.id}`, { method: 'DELETE' })
    if (!resp.ok) return
    setTasks((prev) => prev.filter((t) => t.id !== task.id))
  }

  return (
    <>
      <form className="task-form" onSubmit={handleSubmit}>
        <textarea
          className="prompt-box"
          placeholder="例: 経済学のレポート(3000字)を書く"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          disabled={loading}
        />
        <div className="task-form-row">
          <label className="task-deadline-label">
            締切(任意)
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              disabled={loading}
            />
          </label>
          <button type="submit" className="send-button" disabled={loading || !description.trim()}>
            {loading ? '見積もり中…' : 'AIに見積もってもらう'}
          </button>
        </div>
        {error && <div className="error">Error: {error}</div>}
      </form>

      <ul className="task-list">
        {listLoaded && tasks.length === 0 && (
          <div className="empty-state">まだタスクがありません。上のフォームから追加してください。</div>
        )}
        {tasks.map((task) => (
          <li key={task.id} className={`task-item ${task.status === 'done' ? 'task-item-done' : ''}`}>
            <div className="task-item-main">
              <div className="task-item-description">{task.description}</div>
              <div className="task-item-meta">
                所要時間の目安: 約{formatMinutes(task.estimated_minutes)}
                {task.deadline && <> ・ 締切: {formatDateTime(task.deadline)}</>}
                ・ リマインド予定: {formatDateTime(task.remind_at)}
              </div>
              {task.reasoning && <div className="task-item-reasoning">{task.reasoning}</div>}
            </div>
            <div className="task-item-actions">
              <button type="button" onClick={() => handleToggleStatus(task)}>
                {task.status === 'done' ? '未完了に戻す' : '完了にする'}
              </button>
              <button type="button" className="task-item-delete" onClick={() => handleDelete(task)}>
                🗑
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

function downloadTaskText(item) {
  const blob = new Blob([item.content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${item.description.slice(0, 30) || 'task'}.md`
  link.click()
  URL.revokeObjectURL(url)
}

function downloadTaskExcel(item) {
  const link = document.createElement('a')
  link.href = item.fileUrl
  link.download = item.filename
  link.click()
}

function TaskGenerator() {
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState('text')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [items, setItems] = useState([])

  async function handleSubmit(e) {
    e.preventDefault()
    const text = description.trim()
    if (!text || loading) return

    setLoading(true)
    setError(null)
    try {
      const resp = await apiFetch('/task-generator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: text, kind }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))

      if (kind === 'excel') {
        const blob = await resp.blob()
        const disposition = resp.headers.get('Content-Disposition') || ''
        const match = disposition.match(/filename\*=UTF-8''([^;]+)/)
        const filename = match ? decodeURIComponent(match[1]) : `${text.slice(0, 30) || 'task'}.xlsx`
        const fileUrl = URL.createObjectURL(blob)
        setItems((prev) => [{ id: Date.now(), description: text, kind, filename, fileUrl }, ...prev])
      } else {
        const data = await resp.json()
        setItems((prev) => [{ id: Date.now(), description: text, kind, content: data.content }, ...prev])
      }
      setDescription('')
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <form className="task-form" onSubmit={handleSubmit}>
        <textarea
          className="prompt-box"
          placeholder="例: 4月〜9月の売上集計表をExcelで作って / 江戸時代の身分制度についてレポートをまとめて"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          disabled={loading}
        />
        <div className="task-form-row">
          <select
            className="field-input"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={loading}
          >
            <option value="text">文章の課題(レポート・回答など)</option>
            <option value="excel">Excelの課題(表計算)</option>
          </select>
          <button type="submit" className="send-button" disabled={loading || !description.trim()}>
            {loading ? '作成中…' : 'AIに課題を完成させてもらう'}
          </button>
        </div>
        {error && <div className="error">Error: {error}</div>}
      </form>

      <div className="task-generator-list">
        {items.length === 0 && (
          <div className="empty-state">まだ生成した課題はありません。上のフォームから依頼してください。</div>
        )}
        {items.map((item) => (
          <div className="task-generator-item" key={item.id}>
            <div className="task-generator-item-header">
              <span className="task-generator-item-desc">{item.description}</span>
              <span className="message-tag">{item.kind === 'excel' ? 'Excel' : '文章'}</span>
            </div>
            {item.kind === 'excel' ? (
              <button type="button" className="export-button" onClick={() => downloadTaskExcel(item)}>
                📊 {item.filename} をダウンロード
              </button>
            ) : (
              <>
                <div className="paper-body">
                  <PaperBodyContent content={item.content} />
                </div>
                <button type="button" className="export-button" onClick={() => downloadTaskText(item)}>
                  📄 Markdownでダウンロード
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function StudyNotes() {
  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [focus, setFocus] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [items, setItems] = useState([])
  const fileInputRef = useRef(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    if (!text.trim() && !file) {
      setError('レポート・資料のテキストを貼り付けるか、ファイルを添付してください')
      return
    }

    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('text', text)
      formData.append('focus', focus)
      if (file) formData.append('file', file)

      const resp = await apiFetch('/study-notes', { method: 'POST', body: formData })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()

      setItems((prev) => [
        { id: Date.now(), label: file ? file.name : text.slice(0, 40), content: data.content },
        ...prev,
      ])
      setText('')
      setFile(null)
      setFocus('')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <form className="task-form" onSubmit={handleSubmit}>
        <textarea
          className="prompt-box"
          placeholder="レポート・資料の本文をここに貼り付け(またはファイルを添付)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          disabled={loading}
        />
        <div className="task-form-row">
          <label className="study-notes-file-input">
            📎 ファイルを添付
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept=".txt,.md,.markdown,.csv,.pdf,.docx"
              onChange={(e) => setFile(e.target.files[0] || null)}
              disabled={loading}
            />
          </label>
          {file && (
            <span className="chip">
              📎 {file.name}
              <button
                type="button"
                className="chip-remove"
                aria-label={`${file.name}を添付から削除`}
                onClick={() => {
                  setFile(null)
                  if (fileInputRef.current) fileInputRef.current.value = ''
                }}
              >
                ×
              </button>
            </span>
          )}
        </div>
        <div className="task-form-row">
          <input
            className="field-input"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
            placeholder="重視したい観点(任意、例: 試験に出そうな数値や定義)"
            disabled={loading}
          />
          <button type="submit" className="send-button" disabled={loading || (!text.trim() && !file)}>
            {loading ? '分析中…' : '要点を整理してもらう'}
          </button>
        </div>
        {error && <div className="error">Error: {error}</div>}
      </form>

      <div className="task-generator-list">
        {items.length === 0 && (
          <div className="empty-state">
            まだ整理した資料はありません。レポートの本文を貼り付けるかファイルを添付して送信してください。
          </div>
        )}
        {items.map((item) => (
          <div className="task-generator-item" key={item.id}>
            <div className="task-generator-item-header">
              <span className="task-generator-item-desc">{item.label}</span>
            </div>
            <div className="paper-body">
              <PaperBodyContent content={item.content} />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// 左サイドバーのモード一覧・ヘッダー・コマンドパレットで共有する、5機能の静的な定義。
// tag/idは既存のchannel値・見出しと1対1(バックエンドの実際の機能に対応させてある)。
const MODE_DEFS = [
  {
    id: 'outline',
    tag: '# outline-generator',
    short: 'テーマ・参考資料・フォーマット指定を送ると、調査アウトラインと関連文献を生成します',
    key: '⌘1',
  },
  {
    id: 'logic-guide',
    tag: '# logic-guide',
    short: '大学・学部・学科を選んで、気になる授業内容をAIに質問できます',
    key: '⌘2',
  },
  {
    id: 'task-generator',
    tag: '# task-generator',
    short: '課題の内容を送ると、AIが文章やExcelの表など、実際に提出できる成果物を作成します',
    key: '⌘3',
  },
  {
    id: 'tasks',
    tag: '# task-reminders',
    short: 'タスク内容を送ると、AIが所要時間を見積もり、頃合いにメールでリマインドします',
    key: '⌘4',
  },
  {
    id: 'study-notes',
    tag: '# study-notes',
    short: 'レポート・資料を貼り付けるか添付すると、暗記すべき要点と全体の流れを整理します',
    key: '⌘5',
  },
]

function Toast({ message }) {
  if (!message) return null
  return <div className="toast">{message}</div>
}

function CommandPalette({ items, query, onQuery, activeIndex, onKeyDown, onClose }) {
  return (
    <div className="palette-overlay" onClick={onClose}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input-row">
          <span className="palette-caret">›</span>
          <input
            autoFocus
            className="palette-input"
            placeholder="モード、履歴、コマンドを検索…"
            value={query}
            onChange={onQuery}
            onKeyDown={onKeyDown}
          />
          <span className="palette-esc">esc</span>
        </div>
        <div className="palette-list">
          {items.length === 0 && <p className="palette-empty">一致する項目はありません。</p>}
          {items.map((item, i) => (
            <button
              type="button"
              key={i}
              className={`palette-item ${i === activeIndex ? 'active' : ''}`}
              onClick={item.run}
            >
              <span className="palette-kind">{item.kind}</span>
              <span className="palette-label">{item.label}</span>
              {item.hint && <span className="palette-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// 選択された文献を、実際のデータ(タイトル・著者・年)だけから組み立てる2つの実在フォーマット。
// mockアップにあった「APA/MLA/Chicago/J-STAGE」切り替えは見た目だけで実際には整形結果が
// 変わらなかったため採用せず、本当に異なる出力になる2形式(文献リスト/BibTeX)に絞った。
function formatCitationList(papers) {
  return papers
    .map((p, i) => {
      const authors = p.authors && p.authors.length > 0 ? p.authors.join(', ') : '著者不明'
      const year = p.year ? p.year : '年不明'
      return `${i + 1}. ${authors} (${year}). ${p.title}.`
    })
    .join('\n')
}

function formatBibtex(papers) {
  return papers
    .map((p, i) => {
      const authors = p.authors && p.authors.length > 0 ? p.authors.join(' and ') : '著者不明'
      return `@article{ref${i + 1},\n  title={${p.title}},\n  author={${authors}},\n  year={${p.year || ''}}\n}`
    })
    .join('\n\n')
}

// 右パネル: 現在のスレッドで最後に生成されたアウトラインの目次(ジャンプ付き)と、
// 全節の関連文献をまとめて選択・コピーできる。outlineモードでのみ表示する。
function OutlinePanel({ outline, idPrefix, onFlash }) {
  const [selected, setSelected] = useState({})
  const [style, setStyle] = useState('list')

  const sections = outline.sections || []
  const papers = []
  sections.forEach((section, si) => {
    ;(section.literature || []).forEach((paper, pi) => {
      papers.push({ key: `${si}-${pi}`, sectionLabel: `${si + 1}. ${section.heading}`, ...paper })
    })
  })
  const selectedCount = Object.values(selected).filter(Boolean).length
  const targets = selectedCount > 0 ? papers.filter((p) => selected[p.key]) : papers

  function toggleSelect(key) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function jumpTo(i) {
    document.getElementById(`${idPrefix}-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function copyBibliography() {
    const text = style === 'bibtex' ? formatBibtex(targets) : formatCitationList(targets)
    try {
      await navigator.clipboard.writeText(text)
      onFlash?.(`${targets.length}件をコピーしました`)
    } catch {
      onFlash?.('コピーに失敗しました(クリップボードを利用できません)')
    }
  }

  return (
    <aside className="outline-panel">
      <div className="outline-panel-section">
        <div className="outline-panel-heading">
          <span>アウトライン</span>
          <span className="outline-panel-count">{sections.length ? `${sections.length}章` : ''}</span>
        </div>
        <div className="outline-toc">
          {sections.map((s, i) => (
            <button type="button" key={i} className="outline-toc-item" onClick={() => jumpTo(i)}>
              <span className="outline-toc-n">{i + 1}</span>
              <span className="outline-toc-title">{s.heading}</span>
              <span className="outline-toc-count">{(s.literature || []).length}件</span>
            </button>
          ))}
        </div>
      </div>

      <div className="outline-panel-section outline-panel-scroll">
        <div className="outline-panel-heading">
          <span>関連文献</span>
          <span className="outline-panel-count">{papers.length ? `${papers.length}件` : ''}</span>
        </div>
        <div className="outline-panel-papers">
          {papers.length === 0 && <p className="outline-panel-empty">まだ文献はありません。</p>}
          {papers.map((p) => (
            <div className="paper-card" key={p.key}>
              <div className="paper-card-row">
                <button
                  type="button"
                  className={`paper-check ${selected[p.key] ? 'checked' : ''}`}
                  onClick={() => toggleSelect(p.key)}
                  aria-label={selected[p.key] ? '選択を解除' : '引用に選択'}
                >
                  {selected[p.key] ? '✓' : ''}
                </button>
                <a href={p.url} target="_blank" rel="noreferrer" className="paper-card-link">
                  <span className="paper-card-title">{p.title}</span>
                  <span className="paper-card-meta">
                    {p.authors && p.authors.length > 0 ? p.authors.join(', ') : '著者不明'}
                    {p.year ? ` · ${p.year}` : ''}
                    {p.language ? ` · ${p.language}` : ''}
                  </span>
                </a>
              </div>
              <span className="paper-card-section">{p.sectionLabel}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="outline-panel-footer">
        <div className="outline-panel-footer-row">
          <span>選択中 {selectedCount}件</span>
          <button
            type="button"
            className="outline-style-toggle"
            onClick={() => setStyle((s) => (s === 'list' ? 'bibtex' : 'list'))}
          >
            {style === 'bibtex' ? 'BibTeX' : '文献リスト'} ▾
          </button>
        </div>
        <button type="button" className="outline-panel-button" onClick={copyBibliography} disabled={papers.length === 0}>
          {selectedCount ? `選択した${selectedCount}件をコピー` : `全${papers.length}件をコピー`}
        </button>
        <button
          type="button"
          className="outline-panel-button outline-panel-button-primary"
          onClick={() => { downloadMarkdown(outline); onFlash?.('Markdownで書き出しました') }}
        >
          ⤓ Markdownで書き出す
        </button>
      </div>
    </aside>
  )
}

function formatEventType(type) {
  const labels = {
    login_success: 'ログイン成功',
    login_failed: 'ログイン失敗',
    login_locked: 'アカウント一時ロック',
    mfa_enabled: '多要素認証を有効化',
    mfa_disabled: '多要素認証を無効化',
    mfa_failed: '認証アプリのコード不一致',
    mfa_confirm_failed: '認証アプリの登録確認に失敗',
    mfa_disable_failed: '無効化時のコード不一致',
  }
  return labels[type] || type
}

function SecuritySettings({ onClose }) {
  const [status, setStatus] = useState(null) // { enabled, pending }
  const [secret, setSecret] = useState(null)
  const [otpauthUrl, setOtpauthUrl] = useState(null)
  const [confirmCode, setConfirmCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [message, setMessage] = useState(null)

  const refresh = useCallback(async () => {
    try {
      const [statusResp, eventsResp] = await Promise.all([
        apiFetch('/auth/mfa/status'),
        apiFetch('/auth/security-events'),
      ])
      if (statusResp.ok) setStatus(await statusResp.json())
      if (eventsResp.ok) setEvents((await eventsResp.json()).items || [])
    } catch {
      // 取得に失敗しても設定パネル自体は開けるようにする
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  async function handleStartSetup() {
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      const resp = await apiFetch('/auth/mfa/setup', { method: 'POST' })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      setSecret(data.secret)
      setOtpauthUrl(data.otpauth_url)
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      const resp = await apiFetch('/auth/mfa/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: confirmCode }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      setSecret(null)
      setOtpauthUrl(null)
      setConfirmCode('')
      setMessage('多要素認証を有効にしました。')
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleDisable(e) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    setLoading(true)
    try {
      const resp = await apiFetch('/auth/mfa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: disableCode }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      setDisableCode('')
      setMessage('多要素認証を無効にしました。')
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="security-panel">
      <div className="security-panel-header">
        <h3>🔒 セキュリティ設定</h3>
        <button type="button" className="security-panel-close" onClick={onClose} aria-label="閉じる">×</button>
      </div>

      <section className="security-panel-section">
        <h4>多要素認証(認証アプリ)</h4>
        {status?.enabled && (
          <>
            <p className="security-panel-status security-panel-status-on">✓ 有効になっています</p>
            <form className="code-auth-form" onSubmit={handleDisable}>
              <input
                type="text"
                required
                inputMode="numeric"
                placeholder="無効にするには現在の6桁コード"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
              />
              <button type="submit" className="login-button" disabled={loading}>
                {loading ? '処理中…' : '多要素認証を無効にする'}
              </button>
            </form>
          </>
        )}

        {status && !status.enabled && !secret && (
          <>
            <p className="security-panel-status">
              {status.pending ? '設定途中です。もう一度シークレットを発行してください。' : '現在、無効です。'}
            </p>
            <button type="button" className="upgrade-button" onClick={handleStartSetup} disabled={loading}>
              {loading ? '準備中…' : '多要素認証を設定する'}
            </button>
          </>
        )}

        {secret && (
          <div className="security-mfa-setup">
            <p>認証アプリ(Google Authenticator等)で以下のキーを手動追加してください。</p>
            <code className="security-mfa-secret">{secret}</code>
            <p className="security-panel-hint">otpauth URL: {otpauthUrl}</p>
            <form className="code-auth-form" onSubmit={handleConfirm}>
              <input
                type="text"
                required
                inputMode="numeric"
                placeholder="表示された6桁のコード"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
              />
              <button type="submit" className="login-button" disabled={loading}>
                {loading ? '確認中…' : 'コードを確認して有効化'}
              </button>
            </form>
          </div>
        )}

        {message && <p className="security-panel-status security-panel-status-on">{message}</p>}
        {error && <div className="error">Error: {error}</div>}
      </section>

      <section className="security-panel-section">
        <h4>直近のログイン・セキュリティイベント</h4>
        {events.length === 0 ? (
          <p className="security-panel-hint">まだ記録がありません。</p>
        ) : (
          <ul className="security-event-list">
            {events.map((ev) => (
              <li key={ev.id}>
                <span className="security-event-type">{formatEventType(ev.event_type)}</span>
                <span className="security-event-date">
                  {new Date(ev.created_at).toLocaleString('ja-JP', {
                    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

export default function App() {
  // どのチャンネル(機能)を表示するか。'outline'=論文アウトライン生成、'logic-guide'=大学授業案内チャット、
  // 'tasks'=学習タスクの所要時間見積もり・リマインド、'task-generator'=課題の成果物(文章・Excel等)の生成、
  // 'study-notes'=レポート・資料から暗記すべき要点や流れを整理。
  const [channel, setChannel] = useState('outline')

  // スマホ幅ではサイドバーをオフキャンバス(ドロワー)化するための開閉状態。
  // デスクトップ幅ではCSS側でこの状態自体を無視するので、常にトグル可能にしておいて問題ない。
  const [sidebarOpen, setSidebarOpen] = useState(false)

  function selectChannel(next) {
    setChannel(next)
    setSidebarOpen(false)
  }

  // ログイン状態(Apple/Google/GitHub/開発用ログインのいずれかで取得したセッショントークン)。
  const [authToken, setAuthTokenState] = useState(() => getStoredToken())
  const [authExchanging, setAuthExchanging] = useState(false)

  function setAuthToken(token) {
    setAuthTokenState(token)
    try {
      if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token)
      else localStorage.removeItem(TOKEN_STORAGE_KEY)
    } catch {
      // ストレージが使えない環境ではこのセッション内でのみ有効
    }
  }

  // apiFetchが401を受け取ったら(トークン失効・未ログイン)ログイン画面に戻す。
  useEffect(() => {
    function handleUnauthorized() {
      setAuthToken(null)
    }
    window.addEventListener('auth:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized)
  }, [])

  // GitHubのOAuth認可コード(?code=...)がURLに付いていたら、トークンに交換する。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code) return

    setAuthExchanging(true)
    fetch(`${API_ORIGIN}/auth/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    })
      .then(async (resp) => {
        if (resp.ok) {
          const data = await resp.json()
          setAuthToken(data.token)
        }
      })
      .finally(() => {
        setAuthExchanging(false)
        window.history.replaceState({}, '', window.location.pathname)
      })
  }, [])

  function handleLogout() {
    setAuthToken(null)
  }

  const [showSecurityPanel, setShowSecurityPanel] = useState(false)

  // 利用量(トークン)表示。ログイン後・生成成功後に更新する。
  const [usage, setUsage] = useState(null)

  const fetchUsage = useCallback(async () => {
    try {
      const resp = await apiFetch('/me')
      if (resp.ok) setUsage(await resp.json())
    } catch {
      // 使用量表示の取得に失敗しても致命的ではないので黙って諦める
    }
  }, [])

  useEffect(() => {
    if (authToken) fetchUsage()
  }, [authToken, fetchUsage])

  const [billingLoading, setBillingLoading] = useState(false)

  async function handleUpgrade(plan) {
    setSidebarError(null)
    setBillingLoading(true)
    try {
      const resp = await apiFetch('/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      window.location.href = data.checkout_url
    } catch (err) {
      setSidebarError(`アップグレードに失敗しました: ${String(err)}`)
      setBillingLoading(false)
    }
  }

  async function handleManageBilling() {
    setSidebarError(null)
    setBillingLoading(true)
    try {
      const resp = await apiFetch('/billing/portal', { method: 'POST' })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      window.location.href = data.portal_url
    } catch (err) {
      setSidebarError(`プラン管理画面を開けませんでした: ${String(err)}`)
      setBillingLoading(false)
    }
  }

  // サイドバー系の裏側フェッチ(履歴・タブの読み込み/保存)は失敗しても画面が壊れないように
  // 個別にcatchしているが、原因(APIキー誤り・サーバー未接続など)が分かるようここに表示する。
  const [sidebarError, setSidebarError] = useState(null)

  // 未送信のテーマ・添付ファイルがある状態でタブを切り替えると内容が消えるため、
  // Workspaceから「未送信の入力がある」ことを受け取り、切り替え前に確認する。
  const [composerDirty, setComposerDirty] = useState(false)

  function confirmDiscardComposerIfNeeded() {
    if (!composerDirty) return true
    return window.confirm('入力中のテーマや添付ファイル(未送信)は失われます。このまま続けますか？')
  }

  // タブ(セッション)はサーバー側SQLiteに保存し、ブラウザを変えても復元できるようにする。
  const [sessions, setSessions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const savedSnapshots = useRef({})

  useEffect(() => {
    if (!authToken) return
    let cancelled = false

    async function loadSessions() {
      let items = []
      try {
        const resp = await apiFetch('/sessions')
        if (resp.ok) {
          const data = await resp.json()
          items = data.items ?? []
        } else {
          setSidebarError(`タブの読み込みに失敗しました: ${await readErrorMessage(resp)}`)
        }
      } catch (err) {
        // サーバーに接続できない場合は後段のフォールバックで単一タブとして動作する
        setSidebarError(`タブの読み込みに失敗しました: ${String(err)}`)
      }

      if (items.length === 0) {
        const created = await createSessionOnServer(NEW_TAB_TITLE)
        items = [created ?? makeSession(1)]
      }

      if (cancelled) return

      items.forEach((s) => {
        savedSnapshots.current[s.id] = JSON.stringify({ title: s.title, messages: s.messages })
      })
      setSessions(items)

      let storedActiveId = null
      try {
        storedActiveId = Number(localStorage.getItem(ACTIVE_SESSION_STORAGE_KEY))
      } catch {
        // ストレージが使えない環境では無視する
      }
      const initial = items.find((s) => s.id === storedActiveId) ?? items[0]
      setActiveId(initial.id)
      setSessionsLoaded(true)
    }

    loadSessions()
    return () => {
      cancelled = true
    }
  }, [authToken])

  useEffect(() => {
    if (!sessionsLoaded || activeId == null) return
    try {
      localStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, String(activeId))
    } catch {
      // ストレージが使えない環境では永続化を諦める
    }
  }, [activeId, sessionsLoaded])

  // messages/titleが変わったタブだけをサーバーに保存する(差分がなければ何もしない)。
  useEffect(() => {
    if (!sessionsLoaded) return
    sessions.forEach((s) => {
      const snapshot = JSON.stringify({ title: s.title, messages: s.messages })
      if (savedSnapshots.current[s.id] === snapshot) return
      savedSnapshots.current[s.id] = snapshot
      apiFetch(`/sessions/${s.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: s.title, messages: s.messages }),
      })
        .then(async (resp) => {
          if (!resp.ok) {
            setSidebarError(`タブの保存に失敗しました: ${await readErrorMessage(resp)}`)
          }
        })
        .catch((err) => {
          // 保存に失敗しても画面は止めない(次の変更時に再送される)が、原因は表示する
          setSidebarError(`タブの保存に失敗しました: ${String(err)}`)
        })
    })
  }, [sessions, sessionsLoaded])

  const [historyItems, setHistoryItems] = useState([])
  const [historyQuery, setHistoryQuery] = useState('')
  // ON にすると通常の履歴一覧の代わりに🔒シークレット履歴だけを表示する(混在させない)。
  const [showSecretHistory, setShowSecretHistory] = useState(false)

  const fetchHistory = useCallback(async (query, scope) => {
    try {
      const params = new URLSearchParams()
      if (query && query.trim()) params.set('q', query.trim())
      if (scope) params.set('scope', scope)
      const resp = await apiFetch(`/history${params.toString() ? `?${params}` : ''}`)
      if (!resp.ok) {
        setSidebarError(`履歴の取得に失敗しました: ${await readErrorMessage(resp)}`)
        return
      }
      const data = await resp.json()
      setHistoryItems(data.items ?? [])
    } catch (err) {
      setSidebarError(`履歴の取得に失敗しました: ${String(err)}`)
    }
  }, [])

  const refreshHistory = useCallback(
    () => fetchHistory(historyQuery, showSecretHistory ? 'private' : undefined),
    [fetchHistory, historyQuery, showSecretHistory]
  )

  useEffect(() => {
    if (!authToken) return
    const handle = setTimeout(refreshHistory, historyQuery ? 300 : 0)
    return () => clearTimeout(handle)
  }, [authToken, historyQuery, showSecretHistory, refreshHistory])

  async function handleDeleteHistoryItem(e, id) {
    e.stopPropagation()
    if (!window.confirm('この履歴を削除しますか？')) return
    try {
      const resp = await apiFetch(`/history/${id}`, { method: 'DELETE' })
      if (resp.ok) {
        refreshHistory()
      } else {
        setSidebarError(`履歴の削除に失敗しました: ${await readErrorMessage(resp)}`)
      }
    } catch (err) {
      setSidebarError(`履歴の削除に失敗しました: ${String(err)}`)
    }
  }

  async function handleTogglePrivacy(e, item) {
    e.stopPropagation()
    try {
      const resp = await apiFetch(`/history/${item.id}/private`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_private: !item.is_private }),
      })
      if (resp.ok) {
        refreshHistory()
      } else {
        setSidebarError(`シークレット設定の変更に失敗しました: ${await readErrorMessage(resp)}`)
      }
    } catch (err) {
      setSidebarError(`シークレット設定の変更に失敗しました: ${String(err)}`)
    }
  }

  const activeSession = sessions.find((s) => s.id === activeId)

  function updateSession(id, updater) {
    setSessions((prev) => prev.map((s) => (s.id === id ? updater(s) : s)))
  }

  function setMessagesFor(id, messagesOrUpdater) {
    updateSession(id, (s) => ({
      ...s,
      messages: typeof messagesOrUpdater === 'function' ? messagesOrUpdater(s.messages) : messagesOrUpdater,
    }))
  }

  function setTitleFor(id, topic) {
    updateSession(id, (s) => (s.title === NEW_TAB_TITLE ? { ...s, title: topic.slice(0, 20) } : s))
  }

  async function addTab() {
    if (!confirmDiscardComposerIfNeeded()) return
    const created = await createSessionOnServer(NEW_TAB_TITLE)
    if (!created) {
      setSidebarError('新しいタブの作成に失敗しました。サーバーへの接続やAPIキーを確認してください。')
      return
    }
    savedSnapshots.current[created.id] = JSON.stringify({ title: created.title, messages: created.messages })
    setSessions((prev) => [...prev, created])
    setActiveId(created.id)
  }

  async function openHistoryItem(item) {
    if (!confirmDiscardComposerIfNeeded()) return
    try {
      const resp = await apiFetch(`/history/${item.id}`)
      if (!resp.ok) {
        setSidebarError(`履歴の読み込みに失敗しました: ${await readErrorMessage(resp)}`)
        return
      }
      const record = await resp.json()

      const created = await createSessionOnServer((record.title || NEW_TAB_TITLE).slice(0, 20))
      if (!created) {
        setSidebarError('新しいタブの作成に失敗しました。サーバーへの接続やAPIキーを確認してください。')
        return
      }

      const messages = [
        {
          role: 'user',
          topic: record.topic,
          field: record.field,
          referenceFileNames: [],
          formatFileName: null,
        },
        { role: 'assistant', outline: record.outline },
      ]

      // サーバー上はまだ空メッセージで作成されているので、保存済みsnapshotをずらして再保存を促す
      savedSnapshots.current[created.id] = null
      setSessions((prev) => [...prev, { ...created, messages }])
      setActiveId(created.id)
    } catch (err) {
      setSidebarError(`履歴の読み込みに失敗しました: ${String(err)}`)
    }
  }

  async function closeTab(id) {
    if (id === activeId && !confirmDiscardComposerIfNeeded()) return

    const index = sessions.findIndex((s) => s.id === id)
    const remaining = sessions.filter((s) => s.id !== id)
    delete savedSnapshots.current[id]
    apiFetch(`/sessions/${id}`, { method: 'DELETE' }).catch(() => {})

    if (remaining.length === 0) {
      const created = await createSessionOnServer(NEW_TAB_TITLE)
      const fresh = created ?? makeSession(Date.now())
      savedSnapshots.current[fresh.id] = JSON.stringify({ title: fresh.title, messages: fresh.messages })
      setSessions([fresh])
      setActiveId(fresh.id)
      return
    }

    setSessions(remaining)
    if (id === activeId) {
      const neighbor = remaining[Math.max(0, index - 1)] ?? remaining[0]
      setActiveId(neighbor.id)
    }
  }

  // コマンドパレット(⌘K)とトースト通知。デザインのモックアップにある機能だが、
  // 中身(モード・履歴・コマンド)はすべて実データ・実処理に接続する。
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteIndex, setPaletteIndex] = useState(0)
  const [toast, setToast] = useState('')
  const toastTimer = useRef(null)

  function flash(message) {
    setToast(message)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(''), 2200)
  }

  function openPalette() {
    setPaletteOpen(true)
    setPaletteQuery('')
    setPaletteIndex(0)
  }
  function closePalette() {
    setPaletteOpen(false)
    setPaletteQuery('')
    setPaletteIndex(0)
  }

  function buildPaletteItems() {
    const q = paletteQuery.trim().toLowerCase()
    const items = MODE_DEFS.map((m) => ({
      kind: 'MODE',
      label: `${m.tag}  ${m.short}`,
      hint: m.key,
      run: () => { selectChannel(m.id); closePalette() },
    }))
    if (channel === 'outline') {
      historyItems.slice(0, 8).forEach((h) => {
        items.push({ kind: '履歴', label: h.title, hint: '', run: () => { openHistoryItem(h); closePalette() } })
      })
      items.push({ kind: 'CMD', label: '新規スレッド', hint: '⌘N', run: () => { closePalette(); addTab() } })
    }
    items.push({ kind: 'CMD', label: 'ログアウト', hint: '', run: () => { closePalette(); handleLogout() } })
    return q ? items.filter((it) => it.label.toLowerCase().includes(q)) : items
  }

  const paletteItems = paletteOpen ? buildPaletteItems() : []

  function handlePaletteKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setPaletteIndex((i) => Math.min(paletteItems.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setPaletteIndex((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter' && paletteItems[paletteIndex]) {
      paletteItems[paletteIndex].run()
    } else if (e.key === 'Escape') {
      closePalette()
    }
  }

  // ⌘K パレット、⌘1-5 モード切り替え、⌘N 新規スレッド(outlineのみ)。依存配列を付けず
  // 毎レンダー後に張り直すことで、ハンドラ内から常に最新のchannel/historyItems等を参照できる。
  useEffect(() => {
    function onKeyDown(e) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        paletteOpen ? closePalette() : openPalette()
      } else if (meta && e.key.toLowerCase() === 'n' && channel === 'outline') {
        e.preventDefault()
        addTab()
      } else if (meta && ['1', '2', '3', '4', '5'].includes(e.key)) {
        e.preventDefault()
        const mode = MODE_DEFS[Number(e.key) - 1]
        if (mode) selectChannel(mode.id)
      } else if (e.key === 'Escape' && paletteOpen) {
        closePalette()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  // outlineモードの右パネル(目次・文献)に渡す、現在のスレッドで最後に生成されたアウトライン。
  const outlineMessages = activeSession?.messages
    ?.map((m, i) => ({ m, i }))
    .filter(({ m }) => m.role === 'assistant' && m.outline)
  const lastOutlineEntry = outlineMessages && outlineMessages.length > 0
    ? outlineMessages[outlineMessages.length - 1]
    : null

  const activeMode = MODE_DEFS.find((m) => m.id === channel) ?? MODE_DEFS[0]
  // outlineモードだけスレッド(セッション)を持つので、タイトルはそのタブ名を表示する。
  // それ以外のモードは単一のスレッドしかないので、モードのタグ名を代わりに出す。
  const topbarTitle = channel === 'outline' ? (activeSession?.title || NEW_TAB_TITLE) : activeMode.tag

  if (authExchanging) {
    return <div className="app-root app-loading">サインイン処理中…</div>
  }

  if (!authToken) {
    return <LoginScreen onToken={setAuthToken} />
  }

  if (!sessionsLoaded || !activeSession) {
    return <div className="app-root app-loading">読み込み中…</div>
  }

  return (
    <div className="app-root">
      <div className="topbar">
        <button
          type="button"
          className="sidebar-toggle"
          aria-label="メニューを開く"
          onClick={() => setSidebarOpen(true)}
        >
          ☰
        </button>
        <span className="topbar-brand">NOVERA</span>
        <span className="topbar-sep">/</span>
        <span className="topbar-title">{topbarTitle}</span>
        <div className="topbar-spacer" />
        <button type="button" className="topbar-search" onClick={openPalette}>
          モード・履歴を検索<span className="topbar-kbd">⌘K</span>
        </button>
        {usage && (
          <span className="topbar-plan">{usage.plan === 'free' ? 'FREE' : usage.plan === 'pro' ? 'PRO' : 'MAX'}</span>
        )}
      </div>

      {channel === 'outline' && (
        <div className="tabbar">
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`tab ${s.id === activeId ? 'active' : ''}`}
              onClick={() => {
                if (s.id === activeId) return
                if (!confirmDiscardComposerIfNeeded()) return
                setActiveId(s.id)
              }}
            >
              <span className="tab-title">{s.title}</span>
              {sessions.length > 1 && (
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`タブ「${s.title}」を閉じる`}
                  onClick={(e) => { e.stopPropagation(); closeTab(s.id) }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" className="tab-add" aria-label="新しいタブを追加" onClick={addTab}>＋</button>
        </div>
      )}

      {sidebarError && (
        <div className="global-error">
          <span>{sidebarError}</span>
          <button
            type="button"
            className="global-error-dismiss"
            aria-label="エラーを閉じる"
            onClick={() => setSidebarError(null)}
          >
            ×
          </button>
        </div>
      )}

      <div className="app-shell">
        {sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        )}
        <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
          <div className="sidebar-header-row">
            <div className="sidebar-brand">📚 Novera</div>
            <button
              type="button"
              className="sidebar-close"
              aria-label="メニューを閉じる"
              onClick={() => setSidebarOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="mode-list">
            {MODE_DEFS.map((m) => (
              <button
                type="button"
                key={m.id}
                aria-label={m.tag}
                className={`mode-item ${channel === m.id ? 'active' : ''}`}
                onClick={() => selectChannel(m.id)}
              >
                <span className="mode-item-bar" />
                <span className="mode-item-body">
                  <span className="mode-item-tag">{m.tag}</span>
                  <span className="mode-item-short">{m.short}</span>
                </span>
                <span className="mode-item-key">{m.key}</span>
              </button>
            ))}
          </div>

          {channel === 'outline' && (
          <div className="sidebar-history">
            <div className="sidebar-history-header">
              <div className="sidebar-history-title">
                {showSecretHistory ? '🔒 シークレット履歴' : '履歴'}
              </div>
              <label className="secret-toggle" title="シークレット履歴を表示">
                <input
                  type="checkbox"
                  checked={showSecretHistory}
                  onChange={(e) => setShowSecretHistory(e.target.checked)}
                />
                🔒
              </label>
            </div>
            <input
              type="search"
              className="sidebar-history-search"
              placeholder="履歴を検索"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
            />
            {historyItems.length === 0 ? (
              <div className="sidebar-history-empty">
                {historyQuery.trim()
                  ? '該当する履歴がありません'
                  : showSecretHistory
                  ? 'シークレット履歴はまだありません'
                  : 'まだ生成履歴がありません'}
              </div>
            ) : (
              <ul className="sidebar-history-list">
                {historyItems.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="history-item-open" onClick={() => openHistoryItem(item)}>
                      <span className="history-item-title">{item.title}</span>
                      <span className="history-item-date">
                        {new Date(item.created_at).toLocaleString('ja-JP', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="history-item-privacy-toggle"
                      title={item.is_private ? '公開に戻す' : 'シークレットにする'}
                      aria-label={`${item.title}を${item.is_private ? '公開に戻す' : 'シークレットにする'}`}
                      onClick={(e) => handleTogglePrivacy(e, item)}
                    >
                      {item.is_private ? '🔓' : '🔒'}
                    </button>
                    <button
                      type="button"
                      className="history-item-delete"
                      title="この履歴を削除"
                      aria-label={`${item.title}を削除`}
                      onClick={(e) => handleDeleteHistoryItem(e, item.id)}
                    >
                      🗑
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className="sidebar-new-thread" aria-label="新規スレッド" onClick={addTab}>
              ＋ 新規スレッド <span className="topbar-kbd">⌘N</span>
            </button>
          </div>
          )}

          <div className="sidebar-settings">
            {usage && (
              <div className={`usage-indicator ${usage.tokens_used >= usage.tokens_quota ? 'usage-indicator-over' : ''}`}>
                <div className="usage-indicator-row">
                  <span>TOKENS · 今月</span>
                  <span>{usage.tokens_used.toLocaleString()} / {usage.tokens_quota.toLocaleString()}</span>
                </div>
                <div className="usage-meter">
                  <div
                    className="usage-meter-fill"
                    style={{ width: `${Math.min(100, Math.round((usage.tokens_used / usage.tokens_quota) * 100))}%` }}
                  />
                </div>
              </div>
            )}

            {usage?.plan === 'free' ? (
              <div className="upgrade-buttons">
                <button
                  type="button"
                  className="upgrade-button"
                  disabled={billingLoading}
                  onClick={() => handleUpgrade('pro')}
                >
                  Proにアップグレード
                </button>
                <button
                  type="button"
                  className="upgrade-button"
                  disabled={billingLoading}
                  onClick={() => handleUpgrade('max')}
                >
                  Maxにアップグレード
                </button>
              </div>
            ) : (
              usage && (
                <button
                  type="button"
                  className="upgrade-button"
                  disabled={billingLoading}
                  onClick={handleManageBilling}
                >
                  プランを管理
                </button>
              )
            )}

            <button type="button" className="security-settings-button" onClick={() => setShowSecurityPanel(true)}>
              🔒 セキュリティ設定
            </button>
            <button type="button" className="logout-button" onClick={handleLogout}>
              ログアウト
            </button>
          </div>
        </aside>

        {showSecurityPanel && (
          <div className="security-panel-overlay" onClick={() => setShowSecurityPanel(false)}>
            <div onClick={(e) => e.stopPropagation()}>
              <SecuritySettings onClose={() => setShowSecurityPanel(false)} />
            </div>
          </div>
        )}

        <div className="main">
          {channel === 'outline' ? (
            <>
              <header className="main-header">
                <h1># outline-generator</h1>
                <p>テーマ・参考資料・フォーマット指定を送ると、調査アウトラインと関連文献を生成します</p>
              </header>

              <Workspace
                key={activeSession.id}
                messages={activeSession.messages}
                onMessages={(updater) => setMessagesFor(activeSession.id, updater)}
                onFirstTopic={(topic) => setTitleFor(activeSession.id, topic)}
                onGenerated={() => { refreshHistory(); fetchUsage() }}
                onDirtyChange={setComposerDirty}
              />
            </>
          ) : channel === 'logic-guide' ? (
            <>
              <header className="main-header">
                <h1># logic-guide</h1>
                <p>大学・学部・学科を選んで、気になる授業内容をAIに質問できます</p>
              </header>

              <CourseGuide />
            </>
          ) : channel === 'tasks' ? (
            <>
              <header className="main-header">
                <h1># task-reminders</h1>
                <p>タスク内容を送ると、AIが所要時間を見積もり、頃合いにメールでリマインドします</p>
              </header>

              <TaskReminders />
            </>
          ) : channel === 'task-generator' ? (
            <>
              <header className="main-header">
                <h1># task-generator</h1>
                <p>課題の内容を送ると、AIが文章やExcelの表など、実際に提出できる成果物を作成します</p>
              </header>

              <TaskGenerator />
            </>
          ) : (
            <>
              <header className="main-header">
                <h1># study-notes</h1>
                <p>レポート・資料を貼り付けるか添付すると、暗記すべき要点と全体の流れを整理します</p>
              </header>

              <StudyNotes />
            </>
          )}
        </div>

        {channel === 'outline' && lastOutlineEntry && (
          <OutlinePanel
            outline={lastOutlineEntry.m.outline}
            idPrefix={`section-${lastOutlineEntry.i}`}
            onFlash={flash}
          />
        )}
      </div>

      {paletteOpen && (
        <CommandPalette
          items={paletteItems}
          query={paletteQuery}
          onQuery={(e) => { setPaletteQuery(e.target.value); setPaletteIndex(0) }}
          activeIndex={paletteIndex}
          onKeyDown={handlePaletteKeyDown}
          onClose={closePalette}
        />
      )}

      <Toast message={toast} />
    </div>
  )
}
