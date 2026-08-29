import React, { useEffect, useRef, useState } from 'react'

const DEFAULT_FIELD = '一般'
const NEW_TAB_TITLE = '新規タブ'
const STORAGE_KEY = 'paper-assistant-sessions'

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

function loadStoredSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed.sessions) || parsed.sessions.length === 0) return null
    return parsed
  } catch {
    return null
  }
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

    const resp = await fetch('/generate', { method: 'POST', body: formData })
    if (!resp.ok) throw new Error(await resp.text())
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
  const stored = loadStoredSessions()
  const [sessions, setSessions] = useState(stored?.sessions ?? [makeSession(1)])
  const [activeId, setActiveId] = useState(stored?.activeId ?? stored?.sessions?.[0]?.id ?? 1)
  const nextId = useRef(Math.max(1, ...(stored?.sessions ?? [{ id: 1 }]).map((s) => s.id)) + 1)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions, activeId }))
    } catch {
      // ストレージが使えない環境(プライベートブラウズ等)では永続化を諦める
    }
  }, [sessions, activeId])

  const [historyItems, setHistoryItems] = useState([])

  async function refreshHistory() {
    try {
      const resp = await fetch('/history')
      if (!resp.ok) return
      const data = await resp.json()
      setHistoryItems(data.items ?? [])
    } catch {
      // 履歴の取得に失敗しても致命的ではないので黙って諦める
    }
  }

  useEffect(() => {
    refreshHistory()
  }, [])

  const activeSession = sessions.find((s) => s.id === activeId) ?? sessions[0]

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

  function addTab() {
    const id = nextId.current++
    setSessions((prev) => [...prev, makeSession(id)])
    setActiveId(id)
  }

  async function openHistoryItem(item) {
    try {
      const resp = await fetch(`/history/${item.id}`)
      if (!resp.ok) return
      const record = await resp.json()

      const id = nextId.current++
      setSessions((prev) => [
        ...prev,
        {
          id,
          title: (record.title || NEW_TAB_TITLE).slice(0, 20),
          messages: [
            {
              role: 'user',
              topic: record.topic,
              field: record.field,
              referenceFileNames: [],
              formatFileName: null,
            },
            { role: 'assistant', outline: record.outline },
          ],
        },
      ])
      setActiveId(id)
    } catch {
      // 履歴の読み込みに失敗しても致命的ではないので黙って諦める
    }
  }

  function closeTab(id) {
    const index = sessions.findIndex((s) => s.id === id)
    const remaining = sessions.filter((s) => s.id !== id)

    if (remaining.length === 0) {
      const freshId = nextId.current++
      setSessions([makeSession(freshId)])
      setActiveId(freshId)
      return
    }

    setSessions(remaining)
    if (id === activeId) {
      const neighbor = remaining[Math.max(0, index - 1)] ?? remaining[0]
      setActiveId(neighbor.id)
    }
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
            {historyItems.length === 0 ? (
              <div className="sidebar-history-empty">まだ生成履歴がありません</div>
            ) : (
              <ul className="sidebar-history-list">
                {historyItems.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => openHistoryItem(item)}>
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
                  </li>
                ))}
              </ul>
            )}
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
            onGenerated={refreshHistory}
          />
        </div>
      </div>
    </div>
  )
}
