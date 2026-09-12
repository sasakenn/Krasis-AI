import React, { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_FIELD = '一般'
const NEW_TAB_TITLE = '新規タブ'
const ACTIVE_SESSION_STORAGE_KEY = 'paper-assistant-active-session-id'
const TOKEN_STORAGE_KEY = 'paper-assistant-token'

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

  return fetch(url, { ...options, headers }).then((resp) => {
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

function OutlineResult({ outline }) {
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
          <div className="section-card" key={i}>
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
          const resp = await fetch('/auth/google', {
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
      const resp = await fetch('/auth/apple', {
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
      const resp = await fetch('/auth/dev', { method: 'POST' })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      onToken(data.token)
    } catch (err) {
      setError(String(err))
    } finally {
      setDevLoading(false)
    }
  }

  return (
    <div className="app-root login-screen">
      <div className="login-card">
        <div className="sidebar-brand">📚 Paper Assistant</div>
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

          {import.meta.env.DEV && (
            <button type="button" className="login-button login-button-dev" onClick={handleDevLogin} disabled={devLoading}>
              {devLoading ? '処理中…' : '🛠 開発用ログイン'}
            </button>
          )}
        </div>

        {error && <div className="error">Error: {error}</div>}
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
                <div className="message-author">あなた</div>
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
                <div className="message-author">アシスタント</div>
                <div className="message-body">
                  {m.error && <div className="error">Error: {m.error}</div>}
                  {m.lengthQuestion && (
                    <LengthQuestion
                      question={m.lengthQuestion}
                      onChoose={(key) => handleLengthChoice(i, key)}
                    />
                  )}
                  {m.outline && <OutlineResult outline={m.outline} />}
                </div>
              </>
            )}
          </div>
        ))}

        {loading && (
          <div className="message message-assistant">
            <div className="message-author">アシスタント</div>
            <div className="message-body"><span className="typing">生成中…</span></div>
          </div>
        )}
      </div>

      <form className={`composer ${focused ? 'composer-focused' : ''}`} onSubmit={handleSubmit}>
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

export default function App() {
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
    fetch('/auth/github', {
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
        <aside className="sidebar">
          <div className="sidebar-brand">📚 Paper Assistant</div>
          <div className="sidebar-channel active"># outline-generator</div>

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
          </div>

          <div className="sidebar-settings">
            {usage && (
              <div className="usage-indicator">
                プラン: {usage.plan === 'free' ? 'Free' : usage.plan === 'pro' ? 'Pro' : 'Max'}
                <br />
                {usage.tokens_used.toLocaleString()} / {usage.tokens_quota.toLocaleString()} トークン
              </div>
            )}
            <button type="button" className="logout-button" onClick={handleLogout}>
              ログアウト
            </button>
          </div>
        </aside>

        <div className="main">
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
        </div>
      </div>
    </div>
  )
}
