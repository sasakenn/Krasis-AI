import React, { useCallback, useEffect, useRef, useState } from 'react'

const DEFAULT_FIELD = '一般'
const NEW_TAB_TITLE = '新規タブ'
const ACTIVE_SESSION_STORAGE_KEY = 'paper-assistant-active-session-id'
const API_KEY_STORAGE_KEY = 'paper-assistant-api-key'

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

function getStoredApiKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

// サーバー側でAPI_AUTH_TOKENが設定されている場合のみ、保存済みのAPIキーを
// X-API-Keyヘッダーに付与する(未設定なら何も付けず、これまで通り動作する)。
function apiFetch(url, options = {}) {
  const apiKey = getStoredApiKey()
  if (!apiKey) return fetch(url, options)
  return fetch(url, { ...options, headers: { ...(options.headers || {}), 'X-API-Key': apiKey } })
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
        <h2>{outline.title}</h2>
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

function Workspace({ messages, onMessages, onFirstTopic, onGenerated }) {
  const [topic, setTopic] = useState('')
  const [field, setField] = useState(DEFAULT_FIELD)
  const [referenceFiles, setReferenceFiles] = useState([])
  const [formatFile, setFormatFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [focused, setFocused] = useState(false)
  const [pendingRequest, setPendingRequest] = useState(null)
  const [awaitingLength, setAwaitingLength] = useState(false)

  const referenceInputRef = useRef(null)
  const formatInputRef = useRef(null)

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

  async function submitGenerate({ topic: t, field: f, referenceFiles: rf, formatFile: ff, targetLength }) {
    const formData = new FormData()
    formData.append('topic', t)
    formData.append('field', f)
    if (targetLength) formData.append('target_length', targetLength)
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

    const requestSnapshot = { topic, field, referenceFiles, formatFile }
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
                <button type="button" className="chip-remove" onClick={() => removeReferenceFile(i)}>×</button>
              </span>
            ))}
            {formatFile && (
              <span className="chip">
                📐 {formatFile.name}
                <button type="button" className="chip-remove" onClick={() => setFormatFile(null)}>×</button>
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
  // サーバー側でAPI_AUTH_TOKENが設定されている場合のみ必要になる任意のAPIキー。
  const [apiKey, setApiKey] = useState(() => getStoredApiKey())

  function handleApiKeyChange(value) {
    setApiKey(value)
    try {
      if (value) localStorage.setItem(API_KEY_STORAGE_KEY, value)
      else localStorage.removeItem(API_KEY_STORAGE_KEY)
    } catch {
      // ストレージが使えない環境では保存を諦める(このセッション内でのみ有効)
    }
  }

  // タブ(セッション)はサーバー側SQLiteに保存し、ブラウザを変えても復元できるようにする。
  const [sessions, setSessions] = useState([])
  const [activeId, setActiveId] = useState(null)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const savedSnapshots = useRef({})

  useEffect(() => {
    let cancelled = false

    async function loadSessions() {
      let items = []
      try {
        const resp = await apiFetch('/sessions')
        if (resp.ok) {
          const data = await resp.json()
          items = data.items ?? []
        }
      } catch {
        // サーバーに接続できない場合は後段のフォールバックで単一タブとして動作する
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
  }, [])

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
      }).catch(() => {
        // 保存に失敗しても致命的ではない(次の変更時に再送される)
      })
    })
  }, [sessions, sessionsLoaded])

  const [historyItems, setHistoryItems] = useState([])
  const [historyQuery, setHistoryQuery] = useState('')

  const fetchHistory = useCallback(async (query) => {
    try {
      const params = new URLSearchParams()
      if (query && query.trim()) params.set('q', query.trim())
      const resp = await apiFetch(`/history${params.toString() ? `?${params}` : ''}`)
      if (!resp.ok) return
      const data = await resp.json()
      setHistoryItems(data.items ?? [])
    } catch {
      // 履歴の取得に失敗しても致命的ではないので黙って諦める
    }
  }, [])

  useEffect(() => {
    const handle = setTimeout(() => fetchHistory(historyQuery), historyQuery ? 300 : 0)
    return () => clearTimeout(handle)
  }, [historyQuery, fetchHistory])

  async function handleDeleteHistoryItem(e, id) {
    e.stopPropagation()
    if (!window.confirm('この履歴を削除しますか？')) return
    try {
      const resp = await apiFetch(`/history/${id}`, { method: 'DELETE' })
      if (resp.ok) fetchHistory(historyQuery)
    } catch {
      // 削除に失敗しても致命的ではないので黙って諦める
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
    const created = await createSessionOnServer(NEW_TAB_TITLE)
    if (!created) return
    savedSnapshots.current[created.id] = JSON.stringify({ title: created.title, messages: created.messages })
    setSessions((prev) => [...prev, created])
    setActiveId(created.id)
  }

  async function openHistoryItem(item) {
    try {
      const resp = await apiFetch(`/history/${item.id}`)
      if (!resp.ok) return
      const record = await resp.json()

      const created = await createSessionOnServer((record.title || NEW_TAB_TITLE).slice(0, 20))
      if (!created) return

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
    } catch {
      // 履歴の読み込みに失敗しても致命的ではないので黙って諦める
    }
  }

  async function closeTab(id) {
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
            onClick={() => setActiveId(s.id)}
          >
            <span className="tab-title">{s.title}</span>
            {sessions.length > 1 && (
              <button
                type="button"
                className="tab-close"
                onClick={(e) => { e.stopPropagation(); closeTab(s.id) }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button type="button" className="tab-add" onClick={addTab}>＋</button>
      </div>

      <div className="app-shell">
        <aside className="sidebar">
          <div className="sidebar-brand">📚 Paper Assistant</div>
          <div className="sidebar-channel active"># outline-generator</div>

          <div className="sidebar-history">
            <div className="sidebar-history-title">履歴</div>
            <input
              type="search"
              className="sidebar-history-search"
              placeholder="履歴を検索"
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
            />
            {historyItems.length === 0 ? (
              <div className="sidebar-history-empty">
                {historyQuery.trim() ? '該当する履歴がありません' : 'まだ生成履歴がありません'}
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
                      className="history-item-delete"
                      title="この履歴を削除"
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
            <label className="sidebar-settings-label" htmlFor="api-key-input">
              APIキー(サーバーで必須の場合のみ)
            </label>
            <input
              id="api-key-input"
              type="password"
              className="sidebar-settings-input"
              placeholder="未設定なら空のままでOK"
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
            />
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
            onGenerated={() => fetchHistory(historyQuery)}
          />
        </div>
      </div>
    </div>
  )
}
