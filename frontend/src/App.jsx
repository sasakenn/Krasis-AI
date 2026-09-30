import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  BookOpenText,
  Download,
  FileSpreadsheet,
  House,
  LockKeyhole,
  LockKeyholeOpen,
  LayoutDashboard,
  Menu,
  PencilLine,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { AI_LANGUAGE_NAMES, LANGUAGES, getStoredLanguage, localeFor, useLanguage } from './i18n'

// mermaidは重いので、logic-guideで図解が実際に必要になるまで読み込まない。
// アプリ全体が紙のような明るい配色(style.cssの--bg-app等)なので、既定の'dark'テーマだと
// 図だけ浮いて見える。'base'テーマ+themeVariablesで、アプリの配色に合わせたパステル調に統一する。
let mermaidPromise = null
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        securityLevel: 'strict',
        themeVariables: {
          fontFamily: "'Noto Sans JP', system-ui, sans-serif",
          background: '#ffffff',
          textColor: '#14161A',
          lineColor: '#B0AA9B',

          primaryColor: '#DCE6FB',
          primaryTextColor: '#14161A',
          primaryBorderColor: '#7C93D8',

          secondaryColor: '#FBE3E3',
          secondaryTextColor: '#14161A',
          secondaryBorderColor: '#D89A9A',

          tertiaryColor: '#DFF3EC',
          tertiaryTextColor: '#14161A',
          tertiaryBorderColor: '#8FC7B4',

          // mindmapなど、枝ごとに色を巡回させる図で使われるパレット。
          cScale0: '#DCE6FB', cScaleLabel0: '#14161A',
          cScale1: '#FBE3E3', cScaleLabel1: '#14161A',
          cScale2: '#DFF3EC', cScaleLabel2: '#14161A',
          cScale3: '#FDEFD9', cScaleLabel3: '#14161A',
          cScale4: '#EBE1FA', cScaleLabel4: '#14161A',
          cScale5: '#D9F1F5', cScaleLabel5: '#14161A',
          cScale6: '#FBE8D5', cScaleLabel6: '#14161A',
          cScale7: '#E6EFD9', cScaleLabel7: '#14161A',
          cScale8: '#FAE1EE', cScaleLabel8: '#14161A',
          cScale9: '#DEE7F7', cScaleLabel9: '#14161A',
          cScale10: '#F3E6D8', cScaleLabel10: '#14161A',
          cScale11: '#E1F0E6', cScaleLabel11: '#14161A',
        },
      })
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

function BrandMark({ className = '' }) {
  return <BookOpenText className={`brand-mark ${className}`} aria-hidden="true" strokeWidth={1.8} />
}

function BrandLockup({ className = '' }) {
  return <span className={`brand-lockup ${className}`}><BrandMark /> <span>THYNORA</span></span>
}

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
  const genericMessages = {
    ja: `リクエストに失敗しました(status ${resp.status})`,
    en: `Request failed (status ${resp.status})`,
    ko: `요청에 실패했습니다(status ${resp.status})`,
  }
  return raw || genericMessages[getStoredLanguage()] || genericMessages.ja
}

const _MARKDOWN_EXPORT_LABELS = {
  ja: { question: '中心の問い', searchQuery: '検索キーワード', literature: '関連文献:', unknownAuthor: '著者不明' },
  en: { question: 'Central question', searchQuery: 'Search keywords', literature: 'Related literature:', unknownAuthor: 'Unknown author' },
  ko: { question: '핵심 질문', searchQuery: '검색 키워드', literature: '관련 문헌:', unknownAuthor: '저자 미상' },
}

function outlineToMarkdown(outline) {
  const l = _MARKDOWN_EXPORT_LABELS[getStoredLanguage()] || _MARKDOWN_EXPORT_LABELS.ja
  const lines = [`# ${outline.title}`, '', `**${l.question}**: ${outline.research_question}`, '']

  outline.sections.forEach((section, i) => {
    lines.push(`## ${i + 1}. ${section.heading}`, '', section.purpose, '')
    lines.push(`${l.searchQuery}: \`${section.search_query}\``, '')

    if (section.literature && section.literature.length > 0) {
      lines.push(l.literature)
      section.literature.forEach((paper) => {
        const authors = paper.authors && paper.authors.length > 0 ? paper.authors.join(', ') : l.unknownAuthor
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
  const { lang } = useLanguage()
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
          lang,
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
          {outline.is_private && <LockKeyhole className="private-badge" aria-label="シークレット保存" />}
        </h2>
        <button type="button" className="export-button" onClick={() => downloadMarkdown(outline)}>
          <Download aria-hidden="true" /> Markdownでダウンロード
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
              {bodyLoading ? '再生成中…' : <><RefreshCw aria-hidden="true" /> 本文を再生成</>}
            </button>
          </>
        ) : (
          <button type="button" className="generate-body-button" onClick={handleGenerateBody} disabled={bodyLoading}>
            {bodyLoading ? '本文を生成中…' : <><PencilLine aria-hidden="true" /> 論文本文を生成</>}
          </button>
        )}
        {bodyError && <div className="error">Error: {bodyError}</div>}
      </div>
    </div>
  )
}

// 「Loading」の文字の後に、色は現在のtext-color(currentColor)を継承する
// 3つの点を時間差でパルスさせる、汎用のローディング表示。
function LoadingDots({ label = 'Loading' }) {
  return (
    <span className="loading-dots">
      {label}
      <span className="loading-dots-anim" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </span>
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

// 日本語・英語・韓国語を切り替える共通スイッチャー。ログイン画面とログイン後の
// サイドバー設定の両方から使う(切り替えはlocalStorageに保存され、アプリ全体・
// AIの回答言語にも反映される)。
function LanguageSwitcher({ className = '' }) {
  const { lang, setLang } = useLanguage()
  return (
    <div className={`language-switcher ${className}`}>
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          className={`language-switcher-option ${lang === l.code ? 'active' : ''}`}
          onClick={() => setLang(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  )
}

function LoginScreen({ onToken, initialMfaToken }) {
  const { t } = useLanguage()
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID
  const githubClientId = import.meta.env.VITE_GITHUB_CLIENT_ID
  const githubRedirectUri = import.meta.env.VITE_GITHUB_REDIRECT_URI || window.location.origin
  const microsoftClientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID
  const microsoftRedirectUri = import.meta.env.VITE_MICROSOFT_REDIRECT_URI || window.location.origin

  const [error, setError] = useState(null)
  const [devLoading, setDevLoading] = useState(false)

  // メールアドレス+乱数コードでのログイン(Google/GitHub等のアカウントを使いたくない場合向け)。
  // ログインコードは画面には出さず、メールでのみ届ける(SMTP未設定時はサーバーログに出力)。
  const [codeMode, setCodeMode] = useState('signup') // 'signup' | 'login' | 'forgot'
  const [codeEmail, setCodeEmail] = useState('')
  const [codeInput, setCodeInput] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const [codeAuthNotice, setCodeAuthNotice] = useState(null)

  // 多要素認証(認証アプリ)が有効なアカウントの場合、一次認証(ログインコード、
  // またはApple/Google/GitHub)の後にこのmfaTokenを使って6桁コードの入力を求める
  // (セッショントークンはまだ発行されない)。GitHubは画面遷移を伴うリダイレクト
  // フローなので、親コンポーネント側で交換した結果をinitialMfaTokenで受け取る。
  const [mfaToken, setMfaToken] = useState(initialMfaToken || null)
  const [mfaCode, setMfaCode] = useState('')
  const [mfaLoading, setMfaLoading] = useState(false)

  useEffect(() => {
    if (initialMfaToken) setMfaToken(initialMfaToken)
  }, [initialMfaToken])

  function switchCodeMode(mode) {
    setCodeMode(mode)
    setError(null)
    setCodeAuthNotice(null)
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
      // サインアップ単体ではセッションを発行しない(コードの持ち主であることを
      // 確認する前にログインさせない仕様)。届いたコードを入力する画面へ誘導する。
      setCodeAuthNotice(data.message)
      setCodeMode('login')
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
    setCodeAuthNotice(null)
    setCodeLoading(true)
    try {
      const resp = await fetch(`${API_ORIGIN}/auth/code/reissue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: codeEmail }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      setCodeAuthNotice(data.message)
    } catch (err) {
      setError(String(err))
    } finally {
      setCodeLoading(false)
    }
  }

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
          if (data.mfa_required) {
            setMfaToken(data.mfa_token)
          } else {
            onToken(data.token)
          }
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

  function handleGitHubSignIn() {
    const params = new URLSearchParams({
      client_id: githubClientId,
      redirect_uri: githubRedirectUri,
      scope: 'read:user user:email',
      state: 'github',
    })
    window.location.href = `https://github.com/login/oauth/authorize?${params.toString()}`
  }

  function handleMicrosoftSignIn() {
    const params = new URLSearchParams({
      client_id: microsoftClientId,
      redirect_uri: microsoftRedirectUri,
      response_type: 'code',
      response_mode: 'query',
      scope: 'openid profile email User.Read',
      state: 'microsoft',
    })
    window.location.href = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params.toString()}`
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
          <BrandLockup className="sidebar-brand" />
          <LanguageSwitcher className="login-language-switcher" />
          <p className="login-subtitle">{t('login.mfaSubtitle')}</p>

          <form className="code-auth-form" onSubmit={handleMfaVerify}>
            <input
              type="text"
              required
              inputMode="numeric"
              autoFocus
              placeholder={t('login.mfaPlaceholder')}
              value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)}
            />
            <button type="submit" className="login-button" disabled={mfaLoading}>
              {mfaLoading ? t('common.checking') : t('login.mfaSubmit')}
            </button>
            <button
              type="button"
              className="login-button login-button-secondary"
              onClick={() => { setMfaToken(null); setMfaCode(''); setError(null) }}
            >
              {t('common.back')}
            </button>
          </form>

          {error && <div className="error">{t('common.error')}: {error}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="app-root login-screen">
      <div className="login-card">
        <BrandLockup className="sidebar-brand" />
        <LanguageSwitcher className="login-language-switcher" />
        <p className="login-subtitle">{t('login.subtitle')}</p>

        <div className="login-options">
          {googleClientId ? (
            <div id="google-signin-button" className="login-google-button" />
          ) : (
            <>
              <button type="button" className="login-button" disabled>
                {t('login.googleSignIn')}
              </button>
              <small className="login-hint">{t('login.googleMissing')}</small>
            </>
          )}

          <button
            type="button"
            className="login-button login-button-github"
            disabled={!githubClientId}
            onClick={handleGitHubSignIn}
          >
            {t('login.githubSignIn')}
          </button>
          {!githubClientId && <small className="login-hint">{t('login.githubMissing')}</small>}

          <button
            type="button"
            className="login-button login-button-microsoft"
            disabled={!microsoftClientId}
            onClick={handleMicrosoftSignIn}
          >
            {t('login.microsoftSignIn')}
          </button>
          {!microsoftClientId && <small className="login-hint">{t('login.microsoftMissing')}</small>}

          <div className="login-divider">{t('login.divider')}</div>

          <div className="code-auth">
            <div className="code-auth-tabs">
              <button
                type="button"
                className={codeMode === 'signup' ? 'active' : ''}
                onClick={() => switchCodeMode('signup')}
              >
                {t('login.tabSignup')}
              </button>
              <button
                type="button"
                className={codeMode === 'login' ? 'active' : ''}
                onClick={() => switchCodeMode('login')}
              >
                {t('login.tabLogin')}
              </button>
              <button
                type="button"
                className={codeMode === 'forgot' ? 'active' : ''}
                onClick={() => switchCodeMode('forgot')}
              >
                {t('login.tabForgot')}
              </button>
            </div>

            {codeMode === 'signup' && (
              <form className="code-auth-form" onSubmit={handleCodeSignup}>
                <input
                  type="email"
                  required
                  placeholder={t('login.emailPlaceholder')}
                  value={codeEmail}
                  onChange={(e) => setCodeEmail(e.target.value)}
                />
                <button type="submit" className="login-button" disabled={codeLoading}>
                  {codeLoading ? t('common.loadingEllipsis') : t('login.signupSubmit')}
                </button>
              </form>
            )}

            {codeMode === 'login' && (
              <form className="code-auth-form" onSubmit={handleCodeLogin}>
                <input
                  type="email"
                  required
                  placeholder={t('login.emailPlaceholder')}
                  value={codeEmail}
                  onChange={(e) => setCodeEmail(e.target.value)}
                />
                <input
                  type="text"
                  required
                  placeholder={t('login.codePlaceholder')}
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                />
                <button type="submit" className="login-button" disabled={codeLoading}>
                  {codeLoading ? t('common.loadingEllipsis') : t('login.loginSubmit')}
                </button>
                {codeAuthNotice && <p className="login-hint">{codeAuthNotice}</p>}
              </form>
            )}

            {codeMode === 'forgot' && (
              <form className="code-auth-form" onSubmit={handleCodeReissue}>
                <input
                  type="email"
                  required
                  placeholder={t('login.emailPlaceholder')}
                  value={codeEmail}
                  onChange={(e) => setCodeEmail(e.target.value)}
                />
                <button type="submit" className="login-button" disabled={codeLoading}>
                  {codeLoading ? t('common.loadingEllipsis') : t('login.reissueSubmit')}
                </button>
                {codeAuthNotice && <p className="login-hint">{codeAuthNotice}</p>}
              </form>
            )}
          </div>

          {import.meta.env.DEV && (
            <button type="button" className="login-button login-button-dev" onClick={handleDevLogin} disabled={devLoading}>
              {devLoading ? t('common.loadingEllipsis') : <><Settings2 aria-hidden="true" /> {t('login.devLogin')}</>}
            </button>
          )}
        </div>

        {error && <div className="error">{t('common.error')}: {error}</div>}

        <p className="login-credit">{t('login.credit')}</p>
      </div>
    </div>
  )
}

function Workspace({ messages, onMessages, onFirstTopic, onGenerated, onDirtyChange }) {
  const { lang, t } = useLanguage()
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

  async function submitGenerate({ topic: topicArg, field: fieldArg, referenceFiles: rf, formatFile: ff, targetLength, isPrivate: priv }) {
    const formData = new FormData()
    formData.append('topic', topicArg)
    formData.append('field', fieldArg)
    if (targetLength) formData.append('target_length', targetLength)
    formData.append('private', priv ? 'true' : 'false')
    formData.append('lang', lang)
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
      setError(t('outline.promptRequired'))
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

      if (data.type === 'brush_off') {
        onMessages((prev) => [...prev, { role: 'assistant', brushOff: data.message }])
        resetComposer()
      } else if (data.type === 'length_question') {
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
            {t('outline.empty')}
          </div>
        )}

        {messages.map((m, i) => (
          <div className={`message message-${m.role}`} key={i}>
            {m.role === 'user' ? (
              <>
                <div className="message-author">{t('common.you')}</div>
                <div className="message-body">
                  <p>{m.topic}</p>
                  <span className="message-tag">{t('outline.fieldTag', { field: m.field })}</span>
                  {(m.referenceFileNames.length > 0 || m.formatFileName) && (
                    <div className="message-attachments">
                      {m.referenceFileNames.map((name, j) => (
                        <span className="chip" key={`r-${j}`}>⊕ {name}</span>
                      ))}
                      {m.formatFileName && <span className="chip">▦ {m.formatFileName}</span>}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="message-author">{t('common.assistant')}</div>
                <div className="message-body">
                  {m.error && <div className="error">Error: {m.error}</div>}
                  {m.brushOff && <p className="brush-off">{m.brushOff}</p>}
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
            <div className="message-author">{t('common.assistant')}</div>
            <div className="message-body"><span className="typing"><LoadingDots /></span></div>
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
          {t('outline.attachToggle')}
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
              <span className="attach-icon">⊕</span>
              <span className="attach-label">{t('outline.addReference')}</span>
              <small>{t('outline.referenceHint')}</small>
            </div>

            <div className="attach-box" {...formatDrop} onClick={() => formatInputRef.current?.click()}>
              <input
                ref={formatInputRef}
                type="file"
                hidden
                accept=".txt,.md,.markdown,.csv,.pdf,.docx"
                onChange={(e) => { setFormatFileFromList(e.target.files); e.target.value = '' }}
              />
              <span className="attach-icon">▦</span>
              <span className="attach-label">{t('outline.addFormat')}</span>
              <small>{t('outline.formatHint')}</small>
            </div>
          </div>
        )}

        {(referenceFiles.length > 0 || formatFile) && (
          <div className="composer-chips">
            {referenceFiles.map((f, i) => (
              <span className="chip" key={`rf-${i}`}>
                ⊕ {f.name}
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={t('outline.removeAttachmentAria', { name: f.name })}
                  onClick={() => removeReferenceFile(i)}
                >
                  ×
                </button>
              </span>
            ))}
            {formatFile && (
              <span className="chip">
                ▦ {formatFile.name}
                <button
                  type="button"
                  className="chip-remove"
                  aria-label={t('outline.removeAttachmentAria', { name: formatFile.name })}
                  onClick={() => setFormatFile(null)}
                >
                  ×
                </button>
              </span>
            )}
          </div>
        )}

        {awaitingLength && (
          <div className="composer-hint">{t('outline.chooseLengthHint')}</div>
        )}

        <textarea
          className="prompt-box"
          placeholder={t('outline.topicPlaceholder')}
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
            placeholder={t('outline.fieldPlaceholder')}
            disabled={awaitingLength}
          />
          <label className="private-toggle">
            <input
              type="checkbox"
              checked={isPrivate}
              onChange={(e) => setIsPrivate(e.target.checked)}
              disabled={awaitingLength}
            />
            <LockKeyhole aria-hidden="true" /> {t('outline.savePrivate')}
          </label>
          <button type="submit" className="send-button" disabled={loading || !topic.trim() || awaitingLength}>
            {loading ? <LoadingDots /> : t('common.send')}
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

// 「# 見出し」「## 見出し」形式のMarkdown見出しを、地の文(段落)とは別の要素として
// パースする(本文生成・ai-agentsの解説などが共通してこの形式の見出しを使うため)。
// 見出しはh3/h4として描画され、CSS側で本文(p)とは別のフォント(serif)を当てる。
// 見出しの直後に空行を挟まず本文(箇条書き等)が続くことが多いため、ブロック全体では
// なくブロックの先頭行だけを見出し判定し、残りはそのまま段落として描画する。
function renderMarkdownBlocks(text, keyPrefix) {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .flatMap((block, bi) => {
      const lines = block.split('\n')
      const headingMatch = lines[0].match(/^(#{1,3})\s+(.+)$/)
      if (!headingMatch) {
        return [<p key={`${keyPrefix}-${bi}`}>{block}</p>]
      }

      const HeadingTag = headingMatch[1].length === 1 ? 'h3' : 'h4'
      const nodes = [<HeadingTag key={`${keyPrefix}-${bi}-h`}>{headingMatch[2]}</HeadingTag>]
      const rest = lines.slice(1).join('\n').trim()
      if (rest) nodes.push(<p key={`${keyPrefix}-${bi}-p`}>{rest}</p>)
      return nodes
    })
}

function MessageContent({ content }) {
  return (
    <>
      {splitMermaidBlocks(content).map((part, i) =>
        part.type === 'mermaid' ? (
          <MermaidDiagram key={i} code={part.value} />
        ) : (
          renderMarkdownBlocks(part.value, i)
        )
      )}
    </>
  )
}

function PaperBodyContent({ content }) {
  return (
    <>
      {splitMermaidBlocks(content).map((part, pi) =>
        part.type === 'mermaid' ? <MermaidDiagram key={pi} code={part.value} /> : renderMarkdownBlocks(part.value, pi)
      )}
    </>
  )
}

function CourseGuide({ onGenerated }) {
  const { lang, t } = useLanguage()
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
  // 会話が続く限り同じ履歴項目を上書き更新するための、サーバー側の履歴ID
  const historyIdRef = useRef(null)

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
    historyIdRef.current = null
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
          history_id: historyIdRef.current,
          lang,
        }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      if (data.history_id) historyIdRef.current = data.history_id
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer }])
      onGenerated?.()
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
          <option value="">{t('courseGuide.selectUniversity')}</option>
          {UNIVERSITY_NAMES.map((name) => (
            <option key={name} value={name}>{name === OTHER_UNIVERSITY ? t('courseGuide.otherUniversity') : name}</option>
          ))}
        </select>
        {isCustomUniv && (
          <input
            type="text"
            placeholder={t('courseGuide.universityPlaceholder')}
            value={customUniversity}
            onChange={(e) => setCustomUniversity(e.target.value)}
            disabled={locked}
          />
        )}

        {university && (
          isCustomUniv ? (
            <input
              type="text"
              placeholder={t('courseGuide.facultyPlaceholder')}
              value={customFaculty}
              onChange={(e) => setCustomFaculty(e.target.value)}
              disabled={locked}
            />
          ) : (
            <>
              <select value={faculty} onChange={(e) => setFaculty(e.target.value)} disabled={locked}>
                <option value="">{t('courseGuide.selectFaculty')}</option>
                {facultyOptions.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
                <option value={OTHER_UNIVERSITY}>{t('courseGuide.otherUniversity')}</option>
              </select>
              {isCustomFaculty && (
                <input
                  type="text"
                  placeholder={t('courseGuide.facultyPlaceholder')}
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
            placeholder={t('courseGuide.departmentPlaceholder')}
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
            {t('courseGuide.changeTarget')}
          </button>
        )}
      </div>

      <div className="thread">
        {messages.length === 0 && (
          <div className="empty-state">
            {canChat
              ? t('courseGuide.emptyReady')
              : t('courseGuide.emptyNotReady')}
          </div>
        )}

        {messages.map((m, i) => (
          <div className={`message message-${m.role}`} key={i}>
            {m.role === 'user' ? (
              <>
                <div className="message-author">{t('common.you')}</div>
                <div className="message-body"><p>{m.content}</p></div>
              </>
            ) : (
              <>
                <div className="message-author">{t('common.assistant')}</div>
                <div className="message-body">
                  {m.error ? <div className="error">Error: {m.error}</div> : <MessageContent content={m.content} />}
                </div>
              </>
            )}
          </div>
        ))}

        {loading && (
          <div className="message message-assistant">
            <div className="message-author">{t('common.assistant')}</div>
            <div className="message-body"><span className="typing"><LoadingDots label={t('common.thinking')} /></span></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form className="composer" onSubmit={handleSend}>
        <textarea
          className="prompt-box"
          placeholder={canChat ? t('courseGuide.inputPlaceholderReady') : t('courseGuide.inputPlaceholderNotReady')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          disabled={!canChat || loading}
        />
        <div className="composer-toolbar">
          <button type="submit" className="send-button" disabled={!canChat || loading || !input.trim()}>
            {loading ? t('common.sending') : t('common.send')}
          </button>
        </div>
        {error && <div className="error">Error: {error}</div>}
      </form>
    </>
  )
}

// ai-agentsのプロフィール選択肢。level/role/category/region の id はバックエンド
// (ai_agents.py の LEVEL_LABELS 等)のキーと1対1なので、変更する場合はバックエンド側も
// 合わせて変更すること。purpose は自由記述欄なのでidにラベルそのものを使う。
// labelはi18n.jsxのaiAgents.*キー(t()で解決する)。idはバックエンド(ai_agents.py)の
// キーと1対1(purposeを除く)なので、値を変更する場合はバックエンド側も合わせて変更すること。
const AI_AGENTS_LEVEL_OPTIONS = [
  { id: 'beginner', label: 'aiAgents.levelBeginner' },
  { id: 'intermediate', label: 'aiAgents.levelIntermediate' },
  { id: 'advanced', label: 'aiAgents.levelAdvanced' },
]

const AI_AGENTS_ROLE_OPTIONS = [
  { id: 'student', label: 'aiAgents.roleStudent' },
  { id: 'employee', label: 'aiAgents.roleEmployee' },
  { id: 'executive', label: 'aiAgents.roleExecutive' },
  { id: 'founder', label: 'aiAgents.roleFounder' },
  { id: 'investor', label: 'aiAgents.roleInvestor' },
  { id: 'researcher', label: 'aiAgents.roleResearcher' },
  { id: 'other', label: 'aiAgents.roleOther' },
]

// purposeは自由記述欄としてバックエンドに送るので、idはUI内だけで使う安定したスラッグにし、
// 送信時にt(label)で現在の言語のテキストへ変換する(resolveAiAgentsPurpose参照)。
const AI_AGENTS_PURPOSE_OPTIONS = [
  { id: 'economics-study', label: 'aiAgents.purposeEconomicsStudy' },
  { id: 'daily-news', label: 'aiAgents.purposeDailyNews' },
  { id: 'stock-investing', label: 'aiAgents.purposeStockInvesting' },
  { id: 'business-management', label: 'aiAgents.purposeBusinessManagement' },
  { id: 'market-analysis', label: 'aiAgents.purposeMarketAnalysis' },
  { id: 'geopolitics', label: 'aiAgents.purposeGeopolitics' },
  { id: 'none', label: 'aiAgents.purposeNone' },
]

function resolveAiAgentsPurpose(purposeId, t) {
  if (!purposeId || purposeId === 'none') return ''
  const opt = AI_AGENTS_PURPOSE_OPTIONS.find((o) => o.id === purposeId)
  return opt ? t(opt.label) : ''
}

const AI_AGENTS_CATEGORY_OPTIONS = [
  { id: 'economics', label: 'aiAgents.categoryEconomics' },
  { id: 'finance', label: 'aiAgents.categoryFinance' },
]

const AI_AGENTS_REGION_OPTIONS = {
  economics: [
    { id: 'japan', label: 'aiAgents.regionJapan' },
    { id: 'us', label: 'aiAgents.regionUs' },
    { id: 'world', label: 'aiAgents.regionWorld' },
  ],
  finance: [
    { id: 'japan-stocks', label: 'aiAgents.regionJapanStocks' },
    { id: 'us-stocks', label: 'aiAgents.regionUsStocks' },
  ],
}

function findOptionLabel(options, id, t) {
  const opt = options.find((opt) => opt.id === id)
  return opt ? t(opt.label) : id
}

const AI_AGENTS_EMPTY_PROFILE = { level: '', role: '', purpose: '', categories: [], regions: {} }

// プロフィール設定を「選んで完了」形式にするための質問の並び。categoriesは複数選択可で、
// 選ばれたカテゴリーの数だけ(Economics/Financeそれぞれの)region質問を末尾に追加する。
// singleは1クリックで即次へ進み、multiは複数選んでから「次へ」で確定する。
function buildAiAgentsSteps(profile) {
  const steps = [
    {
      key: 'level',
      type: 'single',
      question: 'aiAgents.questionLevel',
      options: AI_AGENTS_LEVEL_OPTIONS,
      getValue: (p) => p.level,
      apply: (p, value) => ({ ...p, level: value }),
    },
    {
      key: 'role',
      type: 'single',
      question: 'aiAgents.questionRole',
      options: AI_AGENTS_ROLE_OPTIONS,
      getValue: (p) => p.role,
      apply: (p, value) => ({ ...p, role: value }),
    },
    {
      key: 'purpose',
      type: 'single',
      question: 'aiAgents.questionPurpose',
      options: AI_AGENTS_PURPOSE_OPTIONS,
      getValue: (p) => p.purpose,
      apply: (p, value) => ({ ...p, purpose: value }),
    },
    {
      key: 'categories',
      type: 'multi',
      question: 'aiAgents.questionCategories',
      options: AI_AGENTS_CATEGORY_OPTIONS,
      getValue: (p) => p.categories,
      apply: (p, values) => ({ ...p, categories: values }),
    },
  ]

  for (const cat of profile.categories) {
    steps.push({
      key: `region:${cat}`,
      type: 'single',
      question: cat === 'finance' ? 'aiAgents.questionRegionFinance' : 'aiAgents.questionRegionEconomics',
      options: AI_AGENTS_REGION_OPTIONS[cat] || [],
      getValue: (p) => p.regions[cat],
      apply: (p, value) => ({ ...p, regions: { ...p.regions, [cat]: value } }),
    })
  }

  return steps
}

function AiAgents({ onGenerated }) {
  const { lang, t } = useLanguage()
  const [profile, setProfile] = useState(AI_AGENTS_EMPTY_PROFILE)
  // 何問目まで回答済みか。stepsと同じ長さに達したらプロフィール設定完了(=チャット可能)。
  const [stepIndex, setStepIndex] = useState(0)
  // categories(複数選択)の質問だけ、確定前の途中選択を別に持つ。
  const [pendingCategories, setPendingCategories] = useState([])
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // プロフィール確定後の「毎朝9時にリマインドしますか?」の状態。
  // 'none'=未提示、'asked'=提示中(回答待ち)、'done'=回答済み。
  const [reminderStage, setReminderStage] = useState('none')
  const [reminderResult, setReminderResult] = useState(null) // null | 'enabled' | 'declined'
  const [reminderSaving, setReminderSaving] = useState(false)
  const [reminderError, setReminderError] = useState(null)
  const bottomRef = useRef(null)
  // 会話が続く限り同じ履歴項目を上書き更新するための、サーバー側の履歴ID
  const historyIdRef = useRef(null)
  // プロフィール確定直後の自動レポート生成を、1回だけ発火させるためのガード
  const autoSentRef = useRef(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const steps = buildAiAgentsSteps(profile)
  const canChat = stepIndex >= steps.length

  // プロフィールの選択が全て終わったら、ユーザーの操作を待たず自動でレポートを生成する。
  useEffect(() => {
    if (canChat && !autoSentRef.current) {
      autoSentRef.current = true
      sendMessage(t('aiAgents.defaultQuestion'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canChat])

  // 自動生成された最初のレポートが届いたら、毎朝9時のリマインドを提案する。
  useEffect(() => {
    if (reminderStage === 'none' && !loading && messages.length === 2 && messages[1]?.role === 'assistant' && !messages[1].error) {
      setReminderStage('asked')
    }
  }, [messages, loading, reminderStage])

  function handleAnswer(step, index, value) {
    setProfile((prev) => step.apply(prev, value))
    setStepIndex(index + 1)
  }

  function handleConfirmCategories(index) {
    if (pendingCategories.length === 0) return
    setProfile((prev) => ({ ...prev, categories: pendingCategories }))
    setStepIndex(index + 1)
  }

  function handleReset() {
    setProfile(AI_AGENTS_EMPTY_PROFILE)
    setStepIndex(0)
    setPendingCategories([])
    setMessages([])
    setError(null)
    historyIdRef.current = null
    autoSentRef.current = false
    setReminderStage('none')
    setReminderResult(null)
    setReminderError(null)
  }

  async function sendMessage(text) {
    const q = text.trim()
    if (!q || loading || !canChat) return

    const nextMessages = [...messages, { role: 'user', content: q }]
    setMessages(nextMessages)
    setInput('')
    setLoading(true)
    setError(null)

    try {
      const resp = await apiFetch('/ai-agents-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: profile.level,
          role: profile.role,
          purpose: resolveAiAgentsPurpose(profile.purpose, t),
          categories: profile.categories,
          regions: profile.regions,
          messages: nextMessages,
          history_id: historyIdRef.current,
          lang,
        }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      if (data.history_id) historyIdRef.current = data.history_id
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer }])
      onGenerated?.()
    } catch (err) {
      setError(String(err))
      setMessages((prev) => [...prev, { role: 'assistant', error: String(err) }])
    } finally {
      setLoading(false)
    }
  }

  function handleSend(e) {
    e.preventDefault()
    sendMessage(input)
  }

  async function handleReminderChoice(enable) {
    setReminderStage('done')
    if (!enable) {
      setReminderResult('declined')
      return
    }
    setReminderSaving(true)
    setReminderError(null)
    try {
      const resp = await apiFetch('/ai-agents-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          level: profile.level,
          role: profile.role,
          purpose: resolveAiAgentsPurpose(profile.purpose, t),
          categories: profile.categories,
          regions: profile.regions,
          lang,
        }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      setReminderResult('enabled')
    } catch (err) {
      setReminderError(String(err))
    } finally {
      setReminderSaving(false)
    }
  }

  // プロフィール設定中は、質問1問だけを画面いっぱいに表示する(一覧で並べない)。
  if (!canChat) {
    const step = steps[stepIndex]
    const selected = step.type === 'multi' ? pendingCategories : null

    return (
      <div className="ai-agents-fullscreen">
        <div className="ai-agents-fullscreen-progress">{t('aiAgents.progress', { current: stepIndex + 1, total: steps.length })}</div>
        <p className="ai-agents-fullscreen-question">{t(step.question)}</p>
        <div className="ai-agents-fullscreen-options">
          {step.options.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`length-option ${step.type === 'multi' ? (selected.includes(opt.id) ? 'chosen' : '') : ''}`}
              onClick={() => {
                if (step.type === 'multi') {
                  setPendingCategories((prev) =>
                    prev.includes(opt.id) ? prev.filter((id) => id !== opt.id) : [...prev, opt.id]
                  )
                } else {
                  handleAnswer(step, stepIndex, opt.id)
                }
              }}
            >
              {t(opt.label)}
            </button>
          ))}
        </div>
        {step.type === 'multi' && (
          <button
            type="button"
            className="send-button wizard-confirm"
            disabled={pendingCategories.length === 0}
            onClick={() => handleConfirmCategories(stepIndex)}
          >
            {t('aiAgents.next')}
          </button>
        )}
        {stepIndex > 0 && (
          <button type="button" className="course-picker-reset wizard-reset" onClick={handleReset}>
            {t('aiAgents.startOver')}
          </button>
        )}
      </div>
    )
  }

  const profileSummary = [
    findOptionLabel(AI_AGENTS_LEVEL_OPTIONS, profile.level, t),
    findOptionLabel(AI_AGENTS_ROLE_OPTIONS, profile.role, t),
    resolveAiAgentsPurpose(profile.purpose, t),
    profile.categories
      .map((cat) => `${findOptionLabel(AI_AGENTS_CATEGORY_OPTIONS, cat, t)}(${findOptionLabel(AI_AGENTS_REGION_OPTIONS[cat] || [], profile.regions[cat], t)})`)
      .join(' / '),
  ].filter(Boolean).join(' ・ ')

  return (
    <>
      <div className="course-picker">
        <span className="ai-agents-summary">{profileSummary}</span>
        <button type="button" className="course-picker-reset" onClick={handleReset}>
          {t('aiAgents.changeTarget')}
        </button>
      </div>

      <div className="thread">
        {messages.map((m, i) => (
          <div className={`message message-${m.role}`} key={i}>
            {m.role === 'user' ? (
              <>
                <div className="message-author">{t('common.you')}</div>
                <div className="message-body"><p>{m.content}</p></div>
              </>
            ) : (
              <>
                <div className="message-author">{t('common.assistant')}</div>
                <div className="message-body">
                  {m.error ? <div className="error">Error: {m.error}</div> : <MessageContent content={m.content} />}
                </div>
              </>
            )}
          </div>
        ))}

        {loading && (
          <div className="message message-assistant">
            <div className="message-author">{t('common.assistant')}</div>
            <div className="message-body"><span className="typing"><LoadingDots label={t('common.thinking')} /></span></div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {reminderStage === 'asked' && (
        <div className="length-question wizard-step wizard-reminder">
          <p>{t('aiAgents.reminderQuestion')}</p>
          <div className="length-options">
            <button type="button" className="length-option" disabled={reminderSaving} onClick={() => handleReminderChoice(true)}>
              {t('aiAgents.reminderYes')}
            </button>
            <button type="button" className="length-option" disabled={reminderSaving} onClick={() => handleReminderChoice(false)}>
              {t('aiAgents.reminderNo')}
            </button>
          </div>
        </div>
      )}
      {reminderResult === 'enabled' && (
        <div className="empty-state wizard-reminder">{t('aiAgents.reminderEnabled')}</div>
      )}
      {reminderError && <div className="error wizard-reminder">{t('common.error')}: {reminderError}</div>}

      <form className="composer" onSubmit={handleSend}>
        <textarea
          className="prompt-box"
          placeholder={canChat ? t('aiAgents.inputPlaceholderReady') : t('aiAgents.inputPlaceholderNotReady')}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={3}
          disabled={!canChat || loading}
        />
        <div className="composer-toolbar">
          <button type="submit" className="send-button" disabled={!canChat || loading || !input.trim()}>
            {loading ? t('common.sending') : t('common.send')}
          </button>
        </div>
        {error && <div className="error">{t('common.error')}: {error}</div>}
      </form>
    </>
  )
}

function formatMinutes(minutes, t) {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest > 0 ? t('common.hoursMinutes', { hours, minutes: rest }) : t('common.hoursOnly', { hours })
  }
  return t('common.minutesOnly', { minutes })
}

function formatDateTime(iso, lang) {
  if (!iso) return ''
  return new Date(iso).toLocaleString(localeFor(lang), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function TaskReminders({ onGenerated }) {
  const { lang, t } = useLanguage()
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
          lang,
        }),
      })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const created = await resp.json()
      setTasks((prev) => [...prev, created].sort((a, b) => a.remind_at.localeCompare(b.remind_at)))
      setDescription('')
      setDeadline('')
      onGenerated?.()
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
          placeholder={t('taskReminders.placeholder')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          disabled={loading}
        />
        <div className="task-form-row">
          <label className="task-deadline-label">
            {t('taskReminders.deadlineLabel')}
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              disabled={loading}
            />
          </label>
          <button type="submit" className="send-button" disabled={loading || !description.trim()}>
            {loading ? t('taskReminders.estimating') : t('taskReminders.submit')}
          </button>
        </div>
        {error && <div className="error">{t('common.error')}: {error}</div>}
      </form>

      <ul className="task-list">
        {listLoaded && tasks.length === 0 && (
          <div className="empty-state">{t('taskReminders.empty')}</div>
        )}
        {tasks.map((task) => (
          <li key={task.id} className={`task-item ${task.status === 'done' ? 'task-item-done' : ''}`}>
            <div className="task-item-main">
              <div className="task-item-description">{task.description}</div>
              <div className="task-item-meta">
                {t('taskReminders.durationEstimate', { duration: formatMinutes(task.estimated_minutes, t) })}
                {task.deadline && <>{t('taskReminders.deadlineLine', { date: formatDateTime(task.deadline, lang) })}</>}
                {' '}{t('taskReminders.remindLine', { date: formatDateTime(task.remind_at, lang) })}
              </div>
              {task.reasoning && <div className="task-item-reasoning">{task.reasoning}</div>}
            </div>
            <div className="task-item-actions">
              <button type="button" onClick={() => handleToggleStatus(task)}>
                {task.status === 'done' ? t('taskReminders.markPending') : t('taskReminders.markDone')}
              </button>
              <button type="button" className="task-item-delete" aria-label="🗑" onClick={() => handleDelete(task)}>
                <Trash2 aria-hidden="true" />
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

function TaskGenerator({ onGenerated }) {
  const { lang, t } = useLanguage()
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
        body: JSON.stringify({ description: text, kind, lang }),
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
      onGenerated?.()
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
          placeholder={t('taskGenerator.placeholder')}
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
            <option value="text">{t('taskGenerator.kindText')}</option>
            <option value="excel">{t('taskGenerator.kindExcel')}</option>
          </select>
          <button type="submit" className="send-button" disabled={loading || !description.trim()}>
            {loading ? t('taskGenerator.creating') : t('taskGenerator.submit')}
          </button>
        </div>
        {error && <div className="error">{t('common.error')}: {error}</div>}
      </form>

      <div className="task-generator-list">
        {items.length === 0 && (
          <div className="empty-state">{t('taskGenerator.empty')}</div>
        )}
        {items.map((item) => (
          <div className="task-generator-item" key={item.id}>
            <div className="task-generator-item-header">
              <span className="task-generator-item-desc">{item.description}</span>
              <span className="message-tag">{item.kind === 'excel' ? t('taskGenerator.tagExcel') : t('taskGenerator.tagText')}</span>
            </div>
            {item.kind === 'excel' ? (
              <button type="button" className="export-button" onClick={() => downloadTaskExcel(item)}>
                <FileSpreadsheet aria-hidden="true" /> {t('taskGenerator.downloadFile', { filename: item.filename })}
              </button>
            ) : (
              <>
                <div className="paper-body">
                  <PaperBodyContent content={item.content} />
                </div>
                <button type="button" className="export-button" onClick={() => downloadTaskText(item)}>
                  <Download aria-hidden="true" /> {t('taskGenerator.downloadMarkdown')}
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  )
}

function StudyNotes({ onGenerated }) {
  const { lang, t } = useLanguage()
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
      setError(t('studyNotes.missingInput'))
      return
    }

    setLoading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('text', text)
      formData.append('focus', focus)
      formData.append('lang', lang)
      if (file) formData.append('file', file)

      const resp = await apiFetch('/study-notes', { method: 'POST', body: formData })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()

      setItems((prev) => [
        { id: Date.now(), label: file ? file.name : text.slice(0, 40), content: data.content },
        ...prev,
      ])
      onGenerated?.()
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
          placeholder={t('studyNotes.textPlaceholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          disabled={loading}
        />
        <div className="task-form-row">
          <label className="study-notes-file-input">
            {t('studyNotes.attachFile')}
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
              ⊕ {file.name}
              <button
                type="button"
                className="chip-remove"
                aria-label={t('studyNotes.removeAttachmentAria', { name: file.name })}
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
            placeholder={t('studyNotes.focusPlaceholder')}
            disabled={loading}
          />
          <button type="submit" className="send-button" disabled={loading || (!text.trim() && !file)}>
            {loading ? t('studyNotes.analyzing') : t('studyNotes.submit')}
          </button>
        </div>
        {error && <div className="error">{t('common.error')}: {error}</div>}
      </form>

      <div className="task-generator-list">
        {items.length === 0 && (
          <div className="empty-state">
            {t('studyNotes.empty')}
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

// 左サイドバーのモード一覧・ヘッダー・コマンドパレットで共有する、5機能(学習アシスタント系)の静的な定義。
// tag/idは既存のchannel値・見出しと1対1(バックエンドの実際の機能に対応させてある)。
// short は i18n.jsx の modes.* キー(t()で解決する)。tag/idは既存のchannel値・見出しと
// 1対1で、コード的な識別子として言語を問わずそのまま表示する。
const MODE_DEFS = [
  {
    id: 'outline',
    tag: '# outline-generator',
    short: 'modes.outlineShort',
    key: '⌘1',
  },
  {
    id: 'logic-guide',
    tag: '# logic-guide',
    short: 'modes.logicGuideShort',
    key: '⌘2',
  },
  {
    id: 'task-generator',
    tag: '# task-generator',
    short: 'modes.taskGeneratorShort',
    key: '⌘3',
  },
  {
    id: 'tasks',
    tag: '# task-reminders',
    short: 'modes.taskRemindersShort',
    key: '⌘4',
  },
  {
    id: 'study-notes',
    tag: '# study-notes',
    short: 'modes.studyNotesShort',
    key: '⌘5',
  },
]

// 学習アシスタント系(MODE_DEFS)とは別枠で扱う、AIエージェント系機能の静的な定義。
// サイドバー・ホームでは独立したセクションとして表示するが、キーボードショートカット・
// コマンドパレット・アクティブタブ判定はALL_MODE_DEFSで両者をまとめて扱う。
const AI_AGENT_DEFS = [
  {
    id: 'ai-agents',
    tag: '# ai-agents',
    short: 'modes.aiAgentsShort',
    key: '⌘6',
  },
]

const ALL_MODE_DEFS = [...MODE_DEFS, ...AI_AGENT_DEFS]

function formatActivityMinutes(minutes, t) {
  if (minutes < 60) return t('common.minutesOnly', { minutes: Math.round(minutes) })
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  return mins > 0 ? t('common.hoursMinutes', { hours, minutes: mins }) : t('common.hoursOnly', { hours })
}

function formatActivityBucketLabel(bucket, granularity, lang, t) {
  if (granularity === 'year') {
    const [, month] = bucket.split('-')
    return t('common.monthLabel', { month: Number(month) })
  }
  const date = new Date(`${bucket}T00:00:00`)
  return date.toLocaleDateString(localeFor(lang), { month: 'numeric', day: 'numeric' })
}

const ACTIVITY_RANGE_OPTIONS = [
  { id: 'day', label: 'home.rangeDay' },
  { id: 'week', label: 'home.rangeWeek' },
  { id: 'year', label: 'home.rangeYear' },
]

// アプリを開いたときの「ホーム」画面。利用時間(日/週/年)のグラフと、
// 各モードへのクイックスタートを表示する(Claude CodeのNew session画面のような位置づけ)。
function Home({ onSelectChannel }) {
  const { lang, t } = useLanguage()
  const [granularity, setGranularity] = useState('day')
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiFetch(`/activity/summary?granularity=${granularity}`)
      .then((resp) => (resp.ok ? resp.json() : null))
      .then((data) => {
        if (!cancelled) setItems(data?.items || [])
      })
      .catch(() => {
        if (!cancelled) setItems([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [granularity])

  const maxMinutes = Math.max(1, ...items.map((it) => it.minutes))
  const totalMinutes = items.reduce((sum, it) => sum + it.minutes, 0)

  return (
    <div className="home">
      <div className="home-hero">
        <div className="home-hero-brand"><BrandLockup /></div>
        <p className="home-hero-sub">{t('home.greeting')}</p>
      </div>

      <section className="home-panel">
        <div className="home-panel-header">
          <div className="home-panel-heading">
            <h2>{t('home.usageTitle')}</h2>
            {!loading && totalMinutes > 0 && (
              <span className="home-panel-total">
                {formatActivityMinutes(totalMinutes, t)}
                <small>{t('home.usageTotal')}</small>
              </span>
            )}
          </div>
          <div className="home-range-toggle">
            {ACTIVITY_RANGE_OPTIONS.map((opt) => (
              <button
                type="button"
                key={opt.id}
                className={`home-range-btn ${granularity === opt.id ? 'active' : ''}`}
                onClick={() => setGranularity(opt.id)}
              >
                {t(opt.label)}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="empty-state">{t('home.loading')}</div>
        ) : totalMinutes === 0 ? (
          <div className="empty-state">{t('home.noUsageYet')}</div>
        ) : (
          <div className="home-chart" role="img" aria-label={t('home.chartAriaLabel')}>
            {items.map((it, i) => {
              const label = formatActivityBucketLabel(it.bucket, granularity, lang, t)
              const tooltip = `${label}: ${formatActivityMinutes(it.minutes, t)}`
              return (
                <div
                  className={`home-chart-col ${i === items.length - 1 ? 'current' : ''}`}
                  key={it.bucket}
                  aria-label={tooltip}
                >
                  <div className="home-chart-bar-track" data-tooltip={tooltip}>
                    <div
                      className={`home-chart-bar ${it.minutes <= 0 ? 'empty' : ''}`}
                      style={{ height: it.minutes <= 0 ? '2px' : `${Math.max(4, (it.minutes / maxMinutes) * 100)}%` }}
                    />
                  </div>
                  <span className="home-chart-label">{label}</span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="home-panel">
        <h2>{t('home.getStarted')}</h2>
        <div className="home-quickstart-grid">
          {MODE_DEFS.map((m) => (
            <button
              type="button"
              key={m.id}
              className="home-quickstart-card"
              onClick={() => onSelectChannel(m.id)}
            >
              <span className="home-quickstart-tag">{m.tag}</span>
              <span className="home-quickstart-desc">{t(m.short)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="home-panel">
        <h2>{t('home.aiAgentsSection')}</h2>
        <div className="home-quickstart-grid">
          {AI_AGENT_DEFS.map((m) => (
            <button
              type="button"
              key={m.id}
              className="home-quickstart-card"
              onClick={() => onSelectChannel(m.id)}
            >
              <span className="home-quickstart-tag">{m.tag}</span>
              <span className="home-quickstart-desc">{t(m.short)}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

async function downloadModeHistoryExcel(entryId, filename) {
  const resp = await apiFetch(`/mode-history/${entryId}/download`)
  if (!resp.ok) return
  const blob = await resp.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// outline以外のモード(logic-guide/task-generator/study-notes/tasks)で履歴項目を開いたときの
// 読み取り専用プレビュー。各モードは会話やアイテムをタブ内で再構築せず、生成当時の内容を
// そのまま表示するだけにして、実装をモード横断で単純に保っている。
function HistoryPreviewPanel({ record, onClose }) {
  const { lang, t } = useLanguage()
  const { mode, title, payload, created_at } = record
  return (
    <div className="history-preview-overlay" onClick={onClose}>
      <div className="history-preview-panel" onClick={(e) => e.stopPropagation()}>
        <div className="history-preview-header">
          <h3>{title}</h3>
          <button type="button" className="history-preview-close" aria-label={t('common.close')} onClick={onClose}><X aria-hidden="true" /></button>
        </div>
        <div className="history-preview-date">{new Date(created_at).toLocaleString(localeFor(lang))}</div>
        <div className="history-preview-body">
          {mode === 'logic-guide' && (
            <>
              <p className="history-preview-meta">
                {payload.university} ／ {payload.faculty}{payload.department && ` ／ ${payload.department}`}
              </p>
              <div className="thread">
                {(payload.messages || []).map((m, i) => (
                  <div className={`message message-${m.role}`} key={i}>
                    <div className="message-author">{m.role === 'user' ? 'You' : 'Assistant'}</div>
                    <div className="message-body">
                      {m.role === 'user' ? <p>{m.content}</p> : <MessageContent content={m.content} />}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {mode === 'task-generator' && (
            <>
              <p className="history-preview-meta">{payload.description}</p>
              {payload.kind === 'excel' ? (
                <button
                  type="button"
                  className="export-button"
                  onClick={() => downloadModeHistoryExcel(record.id, payload.filename)}
                >
                  <FileSpreadsheet aria-hidden="true" /> {t('taskGenerator.downloadFile', { filename: payload.filename })}
                </button>
              ) : (
                <div className="paper-body">
                  <PaperBodyContent content={payload.content} />
                </div>
              )}
            </>
          )}

          {mode === 'study-notes' && (
            <div className="paper-body">
              <PaperBodyContent content={payload.content} />
            </div>
          )}

          {mode === 'ai-agents' && (
            <>
              <p className="history-preview-meta">
                {findOptionLabel(AI_AGENTS_LEVEL_OPTIONS, payload.level, t)} ／
                {' '}{findOptionLabel(AI_AGENTS_ROLE_OPTIONS, payload.role, t)} ／
                {' '}{(payload.categories || []).map((cat) => (
                  `${findOptionLabel(AI_AGENTS_CATEGORY_OPTIONS, cat, t)}・${findOptionLabel(AI_AGENTS_REGION_OPTIONS[cat] || [], payload.regions?.[cat], t)}`
                )).join(' / ')}
              </p>
              <div className="thread">
                {(payload.messages || []).map((m, i) => (
                  <div className={`message message-${m.role}`} key={i}>
                    <div className="message-author">{m.role === 'user' ? 'You' : 'Assistant'}</div>
                    <div className="message-body">
                      {m.role === 'user' ? <p>{m.content}</p> : <MessageContent content={m.content} />}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {mode === 'tasks' && (
            <div className="task-item-main">
              <div className="task-item-description">{payload.description}</div>
              <div className="task-item-meta">
                {t('taskReminders.durationEstimate', { duration: formatMinutes(payload.estimated_minutes, t) })}
                {payload.deadline && <>{t('taskReminders.deadlineLine', { date: formatDateTime(payload.deadline, lang) })}</>}
                {' '}{t('taskReminders.remindLine', { date: formatDateTime(payload.remind_at, lang) })}
              </div>
              {payload.reasoning && <div className="task-item-reasoning">{payload.reasoning}</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

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

// 関連文献パネルの言語セレクタで選べる言語。'natural'は原文表示(翻訳なし)。
const LITERATURE_LANGUAGES = [
  { code: 'natural', label: 'Natural' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' },
]

// 右パネル: 現在のスレッドで最後に生成されたアウトラインの目次(ジャンプ付き)と、
// 全節の関連文献をまとめて選択・コピーできる。outlineモードでのみ表示する。
function OutlinePanel({ outline, idPrefix, onFlash }) {
  const [selected, setSelected] = useState({})
  const [style, setStyle] = useState('list')
  const [literatureLang, setLiteratureLang] = useState('natural')
  const [translationCache, setTranslationCache] = useState({})
  const [translating, setTranslating] = useState(false)
  const [translateError, setTranslateError] = useState(null)
  const [retryTick, setRetryTick] = useState(0)

  const sections = outline.sections || []
  const papers = []
  sections.forEach((section, si) => {
    ;(section.literature || []).forEach((paper, pi) => {
      papers.push({ key: `${si}-${pi}`, sectionLabel: `${si + 1}. ${section.heading}`, ...paper })
    })
  })
  const selectedCount = Object.values(selected).filter(Boolean).length
  const targets = selectedCount > 0 ? papers.filter((p) => selected[p.key]) : papers

  // 文献の組み合わせ+言語ごとにキャッシュする(同じ文献を再翻訳しない/別アウトラインの
  // 文献と取り違えないよう、キーにタイトルまで含める)。
  const papersSignature = papers.map((p) => `${p.key}:${p.title}`).join('|')
  const cacheKey = `${literatureLang}::${papersSignature}`

  useEffect(() => {
    if (literatureLang === 'natural' || papers.length === 0) return
    if (translationCache[cacheKey]) return

    let cancelled = false
    setTranslating(true)
    setTranslateError(null)
    ;(async () => {
      try {
        const resp = await apiFetch('/literature/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ titles: papers.map((p) => p.title), target_lang: literatureLang }),
        })
        if (!resp.ok) throw new Error(await readErrorMessage(resp))
        const data = await resp.json()
        if (cancelled) return
        const map = {}
        papers.forEach((p, i) => { map[p.key] = data.titles?.[i] ?? p.title })
        setTranslationCache((prev) => ({ ...prev, [cacheKey]: map }))
      } catch (err) {
        if (!cancelled) setTranslateError(String(err))
      } finally {
        if (!cancelled) setTranslating(false)
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, literatureLang, retryTick])

  function displayTitle(paper) {
    if (literatureLang === 'natural') return paper.title
    return translationCache[cacheKey]?.[paper.key] ?? paper.title
  }

  function toggleSelect(key) {
    setSelected((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function jumpTo(i) {
    document.getElementById(`${idPrefix}-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function copyBibliography() {
    const withTranslatedTitles = targets.map((p) => ({ ...p, title: displayTitle(p) }))
    const text = style === 'bibtex' ? formatBibtex(withTranslatedTitles) : formatCitationList(withTranslatedTitles)
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
        <div className="literature-lang-row" role="tablist" aria-label="関連文献の表示言語">
          {LITERATURE_LANGUAGES.map((l) => (
            <button
              type="button"
              key={l.code}
              role="tab"
              aria-selected={literatureLang === l.code}
              className={`literature-lang-pill ${literatureLang === l.code ? 'active' : ''}`}
              onClick={() => setLiteratureLang(l.code)}
            >
              {l.label}
            </button>
          ))}
        </div>
        {translating && <p className="literature-translate-status">翻訳中…</p>}
        {translateError && !translating && (
          <p className="literature-translate-status literature-translate-error">
            翻訳に失敗しました。原文を表示しています。({translateError})
            <button type="button" className="literature-translate-retry" onClick={() => setRetryTick((n) => n + 1)}>
              再試行
            </button>
          </p>
        )}
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
                  <span className="paper-card-title">{displayTitle(p)}</span>
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

function formatEventType(type, t) {
  const labelKeys = {
    login_success: 'security.eventLoginSuccess',
    login_failed: 'security.eventLoginFailed',
    login_locked: 'security.eventLoginLocked',
    mfa_enabled: 'security.eventMfaEnabled',
    mfa_disabled: 'security.eventMfaDisabled',
    mfa_failed: 'security.eventMfaFailed',
    mfa_confirm_failed: 'security.eventMfaConfirmFailed',
    mfa_disable_failed: 'security.eventMfaDisableFailed',
    logout_all: 'security.eventLogoutAll',
  }
  return labelKeys[type] ? t(labelKeys[type]) : type
}

function loginEventBadgeClass(type) {
  if (type === 'login_success' || type === 'mfa_enabled') return 'login-badge-success'
  if (type === 'login_locked' || type === 'login_failed' || type.endsWith('_failed')) return 'login-badge-danger'
  return 'login-badge-neutral'
}

function SecuritySettings({ onClose, onTokenRefresh }) {
  const { lang, t } = useLanguage()
  const [status, setStatus] = useState(null) // { enabled, pending }
  const [secret, setSecret] = useState(null)
  const [otpauthUrl, setOtpauthUrl] = useState(null)
  const [confirmCode, setConfirmCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [logoutAllLoading, setLogoutAllLoading] = useState(false)
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
      const data = await resp.json()
      // MFA有効化は既存セッションを全て失効させる仕様なので、このリクエスト自身の
      // セッションは新しいトークンに差し替えて継続させる(でないと直後の操作で
      // ログアウトさせられてしまう)。
      if (data.token) onTokenRefresh?.(data.token)
      setSecret(null)
      setOtpauthUrl(null)
      setConfirmCode('')
      setMessage(t('security.mfaEnabledMessage'))
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
      const data = await resp.json()
      if (data.token) onTokenRefresh?.(data.token)
      setDisableCode('')
      setMessage(t('security.mfaDisabledMessage'))
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function handleLogoutAll() {
    setError(null)
    setMessage(null)
    setLogoutAllLoading(true)
    try {
      const resp = await apiFetch('/auth/logout-all', { method: 'POST' })
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const data = await resp.json()
      if (data.token) onTokenRefresh?.(data.token)
      setMessage(t('security.logoutAllMessage'))
      await refresh()
    } catch (err) {
      setError(String(err))
    } finally {
      setLogoutAllLoading(false)
    }
  }

  return (
    <div className="security-panel">
      <div className="security-panel-header">
        <h3><ShieldCheck aria-hidden="true" /> {t('security.title')}</h3>
        <button type="button" className="security-panel-close" onClick={onClose} aria-label={t('security.close')}><X aria-hidden="true" /></button>
      </div>

      <section className="security-panel-section">
        <h4>{t('security.mfaTitle')}</h4>
        {status?.enabled && (
          <>
            <p className="security-panel-status security-panel-status-on">{t('security.mfaOn')}</p>
            <form className="code-auth-form" onSubmit={handleDisable}>
              <input
                type="text"
                required
                inputMode="numeric"
                placeholder={t('security.mfaDisablePlaceholder')}
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
              />
              <button type="submit" className="login-button" disabled={loading}>
                {loading ? t('common.loadingEllipsis') : t('security.mfaDisableSubmit')}
              </button>
            </form>
          </>
        )}

        {status && !status.enabled && !secret && (
          <>
            <p className="security-panel-status">
              {status.pending ? t('security.mfaPending') : t('security.mfaOff')}
            </p>
            <button type="button" className="upgrade-button" onClick={handleStartSetup} disabled={loading}>
              {loading ? t('security.mfaPreparing') : t('security.mfaSetupStart')}
            </button>
          </>
        )}

        {secret && (
          <div className="security-mfa-setup">
            <p>{t('security.mfaSetupInstructions')}</p>
            <code className="security-mfa-secret">{secret}</code>
            <p className="security-panel-hint">{t('security.otpauthUrlLabel', { url: otpauthUrl })}</p>
            <form className="code-auth-form" onSubmit={handleConfirm}>
              <input
                type="text"
                required
                inputMode="numeric"
                placeholder={t('security.mfaConfirmPlaceholder')}
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
              />
              <button type="submit" className="login-button" disabled={loading}>
                {loading ? t('common.checking') : t('security.mfaConfirmSubmit')}
              </button>
            </form>
          </div>
        )}

      </section>

      <section className="security-panel-section">
        <h4>{t('security.sessionsTitle')}</h4>
        <p className="security-panel-hint">
          {t('security.sessionsHint')}
        </p>
        <button
          type="button"
          className="upgrade-button"
          onClick={handleLogoutAll}
          disabled={logoutAllLoading}
        >
          {logoutAllLoading ? t('common.loadingEllipsis') : t('security.logoutAllSubmit')}
        </button>
      </section>

      {message && <p className="security-panel-status security-panel-status-on">{message}</p>}
      {error && <div className="error">{t('common.error')}: {error}</div>}

      <section className="security-panel-section">
        <h4>{t('security.eventsTitle')}</h4>
        {events.length === 0 ? (
          <p className="security-panel-hint">{t('security.noEvents')}</p>
        ) : (
          <ul className="security-event-list">
            {events.map((ev) => (
              <li key={ev.id}>
                <span className="security-event-type">{formatEventType(ev.event_type, t)}</span>
                <span className="security-event-date">
                  {new Date(ev.created_at).toLocaleString(localeFor(lang), {
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

function AdminStat({ label, value, sub }) {
  return (
    <div className="admin-stat section-card">
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
      {sub && <div className="admin-stat-sub">{sub}</div>}
    </div>
  )
}

const LOGIN_EVENT_TYPE_OPTIONS = [
  { value: '', label: 'security.filterAllTypes' },
  { value: 'login_success', label: 'security.eventLoginSuccess' },
  { value: 'login_failed', label: 'security.eventLoginFailed' },
  { value: 'login_locked', label: 'security.eventLoginLocked' },
  { value: 'mfa_failed', label: 'security.eventMfaFailed' },
  { value: 'mfa_enabled', label: 'security.eventMfaEnabled' },
  { value: 'mfa_disabled', label: 'security.eventMfaDisabled' },
  { value: 'logout_all', label: 'security.eventLogoutAll' },
]

const ADMIN_LOGIN_LOGS_PAGE_SIZE = 50

// 公開後はApple/Google/GitHub/メールコードの全ログイン方式でイベントが積み上がるため、
// 種別・ユーザーID/メールアドレスで絞り込みつつページングして見られるようにする。
function AdminLoginLogs() {
  const { lang, t } = useLanguage()
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [eventType, setEventType] = useState('')
  const [q, setQ] = useState('')
  const [qInput, setQInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(async (nextOffset, nextEventType, nextQ) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        limit: String(ADMIN_LOGIN_LOGS_PAGE_SIZE),
        offset: String(nextOffset),
      })
      if (nextEventType) params.set('event_type', nextEventType)
      if (nextQ) params.set('q', nextQ)
      const resp = await apiFetch(`/admin/logins?${params.toString()}`)
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      const result = await resp.json()
      setItems(result.items)
      setTotal(result.total)
      setOffset(nextOffset)
    } catch (e) {
      setError(e.message || t('admin.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load(0, eventType, q)
  }, [load, eventType, q])

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    setQ(qInput.trim())
  }

  const canPrev = offset > 0
  const canNext = offset + items.length < total

  return (
    <section className="section-card admin-login-logs">
      <div className="admin-login-logs-header">
        <h3>{t('admin.loginHistory')}</h3>
        <span className="admin-login-logs-total">{t('admin.countSuffix', { count: total.toLocaleString(localeFor(lang)) })}</span>
      </div>

      <div className="admin-login-logs-filters">
        <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
          {LOGIN_EVENT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{t(opt.label)}</option>
          ))}
        </select>
        <form onSubmit={handleSearchSubmit} className="admin-login-logs-search">
          <input
            type="text"
            placeholder={t('admin.searchPlaceholder')}
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
          />
          <button type="submit">{t('admin.search')}</button>
        </form>
      </div>

      {error && <div className="error admin-error">{error}</div>}

      <div className="admin-login-logs-table-wrap">
        <table className="admin-login-logs-table">
          <thead>
            <tr>
              <th>{t('admin.colDate')}</th>
              <th>{t('admin.colType')}</th>
              <th>{t('admin.colSubject')}</th>
              <th>{t('admin.colEmail')}</th>
              <th>{t('admin.colDetail')}</th>
              <th>{t('admin.colIp')}</th>
              <th>{t('admin.colUserAgent')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((ev) => (
              <tr key={ev.id}>
                <td className="admin-login-logs-date">
                  {new Date(ev.created_at).toLocaleString(localeFor(lang), {
                    year: 'numeric', month: 'numeric', day: 'numeric',
                    hour: '2-digit', minute: '2-digit', second: '2-digit',
                  })}
                </td>
                <td>
                  <span className={`login-badge ${loginEventBadgeClass(ev.event_type)}`}>
                    {formatEventType(ev.event_type, t)}
                  </span>
                </td>
                <td className="admin-login-logs-subject">{ev.subject}</td>
                <td className="admin-login-logs-email">
                  {ev.subject_email || (ev.subject && ev.subject.includes('@') ? ev.subject : '—')}
                </td>
                <td>{ev.detail || '—'}</td>
                <td>{ev.ip_address || '—'}</td>
                <td className="admin-login-logs-ua" title={ev.user_agent || ''}>{ev.user_agent || '—'}</td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="admin-login-logs-empty">{t('admin.noRecords')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="admin-login-logs-pager">
        <button type="button" disabled={!canPrev || loading} onClick={() => load(Math.max(0, offset - ADMIN_LOGIN_LOGS_PAGE_SIZE), eventType, q)}>
          {t('admin.prevPage')}
        </button>
        <span>{total === 0 ? t('admin.countSuffix', { count: 0 }) : t('admin.pageRange', { from: offset + 1, to: offset + items.length, total })}</span>
        <button type="button" disabled={!canNext || loading} onClick={() => load(offset + ADMIN_LOGIN_LOGS_PAGE_SIZE, eventType, q)}>
          {t('admin.nextPage')}
        </button>
      </div>
    </section>
  )
}

// 運営者向け管理ダッシュボード(/admin)。app.py側の/admin/overviewが
// ADMIN_EMAILS/ADMIN_USER_IDSに該当しないユーザーには403を返すので、
// その場合はここでエラーメッセージだけを表示する。
function AdminDashboard({ onLogout, onBack }) {
  const { lang, t } = useLanguage()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('overview')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await apiFetch('/admin/overview')
      if (resp.status === 403) {
        setError(t('admin.noPermission'))
        return
      }
      if (!resp.ok) throw new Error(await readErrorMessage(resp))
      setData(await resp.json())
    } catch (e) {
      setError(e.message || t('admin.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="app-root admin-root">
      <div className="topbar">
        <span className="topbar-brand">THYNORA</span>
        <span className="topbar-sep">/</span>
        <span className="topbar-title"># admin</span>
        <div className="topbar-spacer" />
        <button type="button" className="topbar-search" onClick={load} disabled={loading}>
          {t('admin.refresh')}
        </button>
        <button type="button" className="topbar-search" onClick={onBack}>
          {t('admin.backToApp')}
        </button>
        <button type="button" className="topbar-search" onClick={onLogout}>
          {t('admin.logout')}
        </button>
      </div>

      <div className="admin-tabs">
        <button
          type="button"
          className={tab === 'overview' ? 'active' : ''}
          onClick={() => setTab('overview')}
        >
          {t('admin.tabOverview')}
        </button>
        <button
          type="button"
          className={tab === 'logins' ? 'active' : ''}
          onClick={() => setTab('logins')}
        >
          {t('admin.tabLogins')}
        </button>
      </div>

      <div className="admin-body">
        {tab === 'overview' && (
          <>
            {loading && !data && <div className="app-loading">{t('admin.loading')}</div>}
            {error && <div className="error admin-error">{error}</div>}

            {data && (
              <>
                <div className="admin-grid">
                  <AdminStat
                    label={t('admin.totalUsers')}
                    value={data.users.total}
                    sub={t('admin.totalUsersSub', { d7: data.users.new_7d, d30: data.users.new_30d })}
                  />
                  <AdminStat
                    label={t('admin.activeUsers24h')}
                    value={data.users.active_24h}
                    sub={t('admin.activeUsers24hSub', { n: data.users.active_7d })}
                  />
                  <AdminStat
                    label={t('admin.payingUsers')}
                    value={data.plans.paying}
                    sub={t('admin.payingUsersSub', { pro: data.plans.pro, max: data.plans.max, free: data.plans.free })}
                  />
                  <AdminStat
                    label={t('admin.tokensThisPeriod')}
                    value={data.usage.tokens_used_this_period.toLocaleString(localeFor(lang))}
                    sub={t('admin.tokensThisPeriodSub')}
                  />
                  <AdminStat
                    label={t('admin.totalGenerations')}
                    value={data.generations.total}
                    sub={t('admin.totalGenerationsSub', { d7: data.generations.last_7d, d30: data.generations.last_30d })}
                  />
                </div>

                <section className="section-card admin-events">
                  <div className="admin-events-header">
                    <h3>{t('admin.recentSecurityEvents')}</h3>
                    <button type="button" className="admin-events-see-all" onClick={() => setTab('logins')}>
                      {t('admin.seeAll')}
                    </button>
                  </div>
                  {data.recent_security_events.length === 0 ? (
                    <p className="security-panel-hint">{t('admin.noRecords')}</p>
                  ) : (
                    <ul className="security-event-list">
                      {data.recent_security_events.map((ev, i) => (
                        <li key={i}>
                          <span className="security-event-type">{formatEventType(ev.event_type, t)}</span>
                          <span className="admin-event-subject">
                            {ev.subject}
                            {ev.subject_email && ev.subject_email !== ev.subject && ` (${ev.subject_email})`}
                          </span>
                          <span className="security-event-date">
                            {new Date(ev.created_at).toLocaleString(localeFor(lang), {
                              month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <p className="admin-generated-at">{t('admin.lastUpdated', { date: new Date(data.generated_at).toLocaleString(localeFor(lang)) })}</p>
              </>
            )}
          </>
        )}

        {tab === 'logins' && <AdminLoginLogs />}
      </div>
    </div>
  )
}

export default function App() {
  const { lang, t } = useLanguage()

  // どのチャンネル(機能)を表示するか。'home'=利用時間の確認とクイックスタート、
  // 'outline'=論文アウトライン生成、'logic-guide'=大学授業案内チャット、
  // 'tasks'=学習タスクの所要時間見積もり・リマインド、'task-generator'=課題の成果物(文章・Excel等)の生成、
  // 'study-notes'=レポート・資料から暗記すべき要点や流れを整理、
  // 'ai-agents'=知識レベル・立場に合わせた経済(Economics)・金融(Finance)の状況解説チャット。
  const [channel, setChannel] = useState('home')

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

  // /admin(管理ダッシュボード)への遷移をSPA内で扱うための現在パス。
  // フルページ遷移(location.href)にしないのは、開発時のVite devサーバーが
  // '/admin'自体へのプロキシを持たない(APIの'/admin/overview'だけを転送する)ため。
  const [pathname, setPathname] = useState(window.location.pathname)

  function navigate(path) {
    window.history.pushState({}, '', path)
    setPathname(path)
  }

  useEffect(() => {
    function handlePopState() {
      setPathname(window.location.pathname)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

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

  // GitHub/MicrosoftのOAuth認可コード(?code=...)がURLに付いていたら、トークンに交換する。
  // どちらも同じ?code=形式でリダイレクトしてくるため、認可リクエスト時に付けた
  // state(github/microsoft)で行き先のエンドポイントを判別する(state無し=旧来のGitHub扱い)。
  // MFAが有効なアカウントの場合はセッショントークンではなくmfa_tokenが返るので、
  // LoginScreenへ渡して認証アプリのコード入力画面を表示させる(画面遷移を伴う
  // リダイレクトフローのため、mfaTokenの状態はここ=親側で一時的に保持する)。
  const [pendingMfaToken, setPendingMfaToken] = useState(null)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')
    if (!code) return

    const state = params.get('state')
    const isMicrosoft = state === 'microsoft'
    const microsoftRedirectUri = import.meta.env.VITE_MICROSOFT_REDIRECT_URI || window.location.origin

    setAuthExchanging(true)
    fetch(`${API_ORIGIN}/auth/${isMicrosoft ? 'microsoft' : 'github'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isMicrosoft ? { code, redirect_uri: microsoftRedirectUri } : { code }),
    })
      .then(async (resp) => {
        if (resp.ok) {
          const data = await resp.json()
          if (data.mfa_required) {
            setPendingMfaToken(data.mfa_token)
          } else {
            setAuthToken(data.token)
          }
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

  // ホーム画面の利用時間グラフ向けに、タブが表示されている間だけ60秒おきに生存確認を送る。
  // Claude APIは呼ばないのでトークンやレート制限への影響はない。
  useEffect(() => {
    if (!authToken) return undefined

    function sendPing() {
      if (document.visibilityState === 'visible') {
        apiFetch('/activity/ping', { method: 'POST' }).catch(() => {})
      }
    }

    sendPing()
    const interval = setInterval(sendPing, 60000)
    document.addEventListener('visibilitychange', sendPing)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', sendPing)
    }
  }, [authToken])

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
      setSidebarError(`${t('errors.upgradeFailed')}: ${String(err)}`)
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
      setSidebarError(`${t('errors.managePlanFailed')}: ${String(err)}`)
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
    return window.confirm(t('confirm.discardComposer'))
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
          setSidebarError(`${t('errors.tabsLoadFailed')}: ${await readErrorMessage(resp)}`)
        }
      } catch (err) {
        // サーバーに接続できない場合は後段のフォールバックで単一タブとして動作する
        setSidebarError(`${t('errors.tabsLoadFailed')}: ${String(err)}`)
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
            setSidebarError(`${t('errors.tabsSaveFailed')}: ${await readErrorMessage(resp)}`)
          }
        })
        .catch((err) => {
          // 保存に失敗しても画面は止めない(次の変更時に再送される)が、原因は表示する
          setSidebarError(`${t('errors.tabsSaveFailed')}: ${String(err)}`)
        })
    })
  }, [sessions, sessionsLoaded])

  const [historyItems, setHistoryItems] = useState([])
  const [historyQuery, setHistoryQuery] = useState('')
  // ON にすると通常の履歴一覧の代わりにシークレット履歴だけを表示する(混在させない)。
  const [showSecretHistory, setShowSecretHistory] = useState(false)
  // outline以外のモードで履歴項目を開いたときの、読み取り専用プレビュー(HistoryPreviewPanel)の中身。
  const [historyPreview, setHistoryPreview] = useState(null)

  // outlineは専用の/historyエンドポイント(generationsテーブル)、それ以外の4モードは
  // 共通の/mode-history(history_entriesテーブル)を使う。どちらもitem.idを不透明な値として
  // 同じ形(id/title/created_at/is_private)で扱えるようにしてあるので、以降のUIは分岐不要。
  const historyBase = channel === 'outline' ? '/history' : '/mode-history'

  const fetchHistory = useCallback(async (query, scope, mode) => {
    try {
      const params = new URLSearchParams()
      if (query && query.trim()) params.set('q', query.trim())
      if (scope) params.set('scope', scope)
      if (mode !== 'outline') params.set('mode', mode)
      const base = mode === 'outline' ? '/history' : '/mode-history'
      const resp = await apiFetch(`${base}${params.toString() ? `?${params}` : ''}`)
      if (!resp.ok) {
        setSidebarError(`${t('errors.historyLoadFailed')}: ${await readErrorMessage(resp)}`)
        return
      }
      const data = await resp.json()
      setHistoryItems(data.items ?? [])
    } catch (err) {
      setSidebarError(`${t('errors.historyLoadFailed')}: ${String(err)}`)
    }
  }, [])

  const refreshHistory = useCallback(
    () => fetchHistory(historyQuery, showSecretHistory ? 'private' : undefined, channel),
    [fetchHistory, historyQuery, showSecretHistory, channel]
  )

  // タブ(モード)を切り替えたら、直前のモードでの検索語を引きずらず一覧を出し直す。
  useEffect(() => {
    setHistoryQuery('')
  }, [channel])

  useEffect(() => {
    if (!authToken || channel === 'home') return
    const handle = setTimeout(refreshHistory, historyQuery ? 300 : 0)
    return () => clearTimeout(handle)
  }, [authToken, historyQuery, showSecretHistory, refreshHistory, channel])

  async function handleDeleteHistoryItem(e, id) {
    e.stopPropagation()
    if (!window.confirm(t('confirm.deleteHistory'))) return
    try {
      const resp = await apiFetch(`${historyBase}/${id}`, { method: 'DELETE' })
      if (resp.ok) {
        refreshHistory()
      } else {
        setSidebarError(`${t('errors.historyDeleteFailed')}: ${await readErrorMessage(resp)}`)
      }
    } catch (err) {
      setSidebarError(`${t('errors.historyDeleteFailed')}: ${String(err)}`)
    }
  }

  async function handleTogglePrivacy(e, item) {
    e.stopPropagation()
    try {
      const resp = await apiFetch(`${historyBase}/${item.id}/private`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_private: !item.is_private }),
      })
      if (resp.ok) {
        refreshHistory()
      } else {
        setSidebarError(`${t('errors.privacyChangeFailed')}: ${await readErrorMessage(resp)}`)
      }
    } catch (err) {
      setSidebarError(`${t('errors.privacyChangeFailed')}: ${String(err)}`)
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
      setSidebarError(t('errors.newTabFailed'))
      return
    }
    savedSnapshots.current[created.id] = JSON.stringify({ title: created.title, messages: created.messages })
    setSessions((prev) => [...prev, created])
    setActiveId(created.id)
  }

  async function openHistoryItem(item) {
    // outline以外は会話・アイテムをタブに再構築せず、その場で読み取り専用プレビューを開くだけ
    if (channel !== 'outline') {
      try {
        const resp = await apiFetch(`/mode-history/${item.id}`)
        if (!resp.ok) {
          setSidebarError(`${t('errors.historyOpenFailed')}: ${await readErrorMessage(resp)}`)
          return
        }
        setHistoryPreview(await resp.json())
      } catch (err) {
        setSidebarError(`${t('errors.historyOpenFailed')}: ${String(err)}`)
      }
      return
    }

    if (!confirmDiscardComposerIfNeeded()) return
    try {
      const resp = await apiFetch(`/history/${item.id}`)
      if (!resp.ok) {
        setSidebarError(`${t('errors.historyOpenFailed')}: ${await readErrorMessage(resp)}`)
        return
      }
      const record = await resp.json()

      const created = await createSessionOnServer((record.title || NEW_TAB_TITLE).slice(0, 20))
      if (!created) {
        setSidebarError(t('errors.newTabFailed'))
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
      setSidebarError(`${t('errors.historyOpenFailed')}: ${String(err)}`)
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
    const items = [
      {
        kind: 'MODE',
        label: `# home  ${t('home.homeDesc')}`,
        hint: '',
        run: () => { selectChannel('home'); closePalette() },
      },
      ...ALL_MODE_DEFS.map((m) => ({
        kind: 'MODE',
        label: `${m.tag}  ${t(m.short)}`,
        hint: m.key,
        run: () => { selectChannel(m.id); closePalette() },
      })),
    ]
    if (channel === 'outline') {
      historyItems.slice(0, 8).forEach((h) => {
        items.push({ kind: t('sidebar.history'), label: h.title, hint: '', run: () => { openHistoryItem(h); closePalette() } })
      })
      items.push({ kind: 'CMD', label: t('palette.newThread'), hint: '⌘N', run: () => { closePalette(); addTab() } })
    }
    items.push({ kind: 'CMD', label: t('palette.logout'), hint: '', run: () => { closePalette(); handleLogout() } })
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

  // ⌘K パレット、⌘1-6 モード切り替え、⌘N 新規スレッド(outlineのみ)。依存配列を付けず
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
      } else if (meta && ['1', '2', '3', '4', '5', '6'].includes(e.key)) {
        e.preventDefault()
        const mode = ALL_MODE_DEFS[Number(e.key) - 1]
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

  const activeMode = ALL_MODE_DEFS.find((m) => m.id === channel) ?? ALL_MODE_DEFS[0]
  // outlineモードだけスレッド(セッション)を持つので、タイトルはそのタブ名を表示する。
  // それ以外のモードは単一のスレッドしかないので、モードのタグ名を代わりに出す。
  const topbarTitle =
    channel === 'home' ? '# home' : channel === 'outline' ? (activeSession?.title || NEW_TAB_TITLE) : activeMode.tag

  if (authExchanging) {
    return <div className="app-root app-loading">{t('common.signingIn')}</div>
  }

  if (!authToken) {
    return <LoginScreen onToken={setAuthToken} initialMfaToken={pendingMfaToken} />
  }

  if (pathname === '/admin') {
    return <AdminDashboard onLogout={handleLogout} onBack={() => navigate('/')} />
  }

  if (!sessionsLoaded || !activeSession) {
    return <div className="app-root app-loading">{t('home.loading')}</div>
  }

  return (
    <div className="app-root">
      <div className="topbar">
        <button
          type="button"
          className="sidebar-toggle"
          aria-label={t('topbar.menuLabel')}
          onClick={() => setSidebarOpen(true)}
        >
          <Menu aria-hidden="true" />
        </button>
        <span className="topbar-brand"><BrandLockup /></span>
        <span className="topbar-sep">/</span>
        <span className="topbar-title">{topbarTitle}</span>
        <div className="topbar-spacer" />
        <button type="button" className="topbar-search" onClick={openPalette}>
          {t('topbar.search')}<span className="topbar-kbd">⌘K</span>
        </button>
        {usage && (
          <span className="topbar-plan">{usage.plan === 'free' ? t('topbar.planFree') : usage.plan === 'pro' ? t('topbar.planPro') : t('topbar.planMax')}</span>
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
                  aria-label={t('topbar.closeTabAria', { title: s.title })}
                  onClick={(e) => { e.stopPropagation(); closeTab(s.id) }}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button type="button" className="tab-add" aria-label={t('topbar.newTabAria')} onClick={addTab}><Plus aria-hidden="true" /></button>
        </div>
      )}

      {sidebarError && (
        <div className="global-error">
          <span>{sidebarError}</span>
          <button
            type="button"
            className="global-error-dismiss"
            aria-label={t('topbar.closeError')}
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
            <BrandLockup className="sidebar-brand" />
            <button
              type="button"
              className="sidebar-close"
              aria-label={t('sidebar.closeMenu')}
              onClick={() => setSidebarOpen(false)}
            >
              ×
            </button>
          </div>
          <div className="mode-list">
            <button
              type="button"
              aria-label="# home"
              className={`mode-item ${channel === 'home' ? 'active' : ''}`}
              onClick={() => selectChannel('home')}
            >
              <span className="mode-item-bar" />
              <span className="mode-item-body">
                <span className="mode-item-tag"><House aria-hidden="true" /> {t('home.home')}</span>
                <span className="mode-item-short">{t('home.homeDesc')}</span>
              </span>
            </button>
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
                  <span className="mode-item-short">{t(m.short)}</span>
                </span>
                <span className="mode-item-key">{m.key}</span>
              </button>
            ))}
          </div>

          <div className="mode-section-label">{t('sidebar.aiAgentsSectionLabel')}</div>
          <div className="mode-list">
            {AI_AGENT_DEFS.map((m) => (
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
                  <span className="mode-item-short">{t(m.short)}</span>
                </span>
                <span className="mode-item-key">{m.key}</span>
              </button>
            ))}
          </div>

          {channel !== 'home' && (
          <div className="sidebar-history">
            <div className="sidebar-history-header">
              <div className="sidebar-history-title">
                {showSecretHistory ? t('sidebar.secretHistoryOf', { mode: activeMode.tag }) : t('sidebar.historyOf', { mode: activeMode.tag })}
              </div>
              <label className="secret-toggle" title={t('sidebar.secretToggleTitle')}>
                <input
                  type="checkbox"
                  checked={showSecretHistory}
                  onChange={(e) => setShowSecretHistory(e.target.checked)}
                />
                <LockKeyhole aria-hidden="true" />
              </label>
            </div>
            <input
              type="search"
              className="sidebar-history-search"
              placeholder={t('sidebar.searchHistory')}
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
            />
            {historyItems.length === 0 ? (
              <div className="sidebar-history-empty">
                {historyQuery.trim()
                  ? t('sidebar.noHistoryMatch')
                  : showSecretHistory
                  ? t('sidebar.noSecretHistory')
                  : t('sidebar.noHistory')}
              </div>
            ) : (
              <ul className="sidebar-history-list">
                {historyItems.map((item) => (
                  <li key={item.id}>
                    <button type="button" className="history-item-open" onClick={() => openHistoryItem(item)}>
                      <span className="history-item-title">{item.title}</span>
                      <span className="history-item-date">
                        {new Date(item.created_at).toLocaleString(localeFor(lang), {
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
                      title={item.is_private ? t('sidebar.makePublic') : t('sidebar.makePrivate')}
                      aria-label={item.is_private ? t('sidebar.makePublicAria', { title: item.title }) : t('sidebar.makePrivateAria', { title: item.title })}
                      onClick={(e) => handleTogglePrivacy(e, item)}
                    >
                      {item.is_private ? <LockKeyhole aria-hidden="true" /> : <LockKeyholeOpen aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      className="history-item-delete"
                      title={t('sidebar.deleteHistory')}
                      aria-label={t('sidebar.deleteItemAria', { title: item.title })}
                      onClick={(e) => handleDeleteHistoryItem(e, item.id)}
                    >
                      <Trash2 aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {channel === 'outline' && (
              <button type="button" className="sidebar-new-thread" aria-label={t('sidebar.newThread')} onClick={addTab}>
                <Plus aria-hidden="true" /> {t('sidebar.newThread')} <span className="topbar-kbd">⌘N</span>
              </button>
            )}
          </div>
          )}

          <div className="sidebar-settings">
            {usage && (
              <div className={`usage-indicator ${usage.tokens_used >= usage.tokens_quota ? 'usage-indicator-over' : ''}`}>
                <div className="usage-indicator-row">
                  <span>{t('sidebar.tokensThisMonth')}</span>
                  <span>{usage.tokens_used.toLocaleString(localeFor(lang))} / {usage.tokens_quota.toLocaleString(localeFor(lang))}</span>
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
                  {t('sidebar.upgradePro')}
                </button>
                <button
                  type="button"
                  className="upgrade-button"
                  disabled={billingLoading}
                  onClick={() => handleUpgrade('max')}
                >
                  {t('sidebar.upgradeMax')}
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
                  {t('sidebar.managePlan')}
                </button>
              )
            )}

            {usage?.is_admin && (
              <button
                type="button"
                className="security-settings-button"
                onClick={() => navigate('/admin')}
              >
                <LayoutDashboard aria-hidden="true" /> {t('sidebar.adminDashboard')}
              </button>
            )}
            <button type="button" className="security-settings-button" aria-label={`🔒 ${t('sidebar.securitySettings')}`} onClick={() => setShowSecurityPanel(true)}>
              <ShieldCheck aria-hidden="true" /> {t('sidebar.securitySettings')}
            </button>
            <button type="button" className="logout-button" onClick={handleLogout}>
              {t('sidebar.logout')}
            </button>
            <LanguageSwitcher className="sidebar-language-switcher" />
          </div>
        </aside>

        {showSecurityPanel && (
          <div className="security-panel-overlay" onClick={() => setShowSecurityPanel(false)}>
            <div onClick={(e) => e.stopPropagation()}>
              <SecuritySettings onClose={() => setShowSecurityPanel(false)} onTokenRefresh={setAuthToken} />
            </div>
          </div>
        )}

        <div className="main">
          {channel === 'home' ? (
            <Home onSelectChannel={selectChannel} />
          ) : channel === 'outline' ? (
            <>
              <header className="main-header">
                <h1># outline-generator</h1>
                <p>{t('modes.outlineShort')}</p>
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
                <p>{t('modes.logicGuideShort')}</p>
              </header>

              <CourseGuide onGenerated={refreshHistory} />
            </>
          ) : channel === 'tasks' ? (
            <>
              <header className="main-header">
                <h1># task-reminders</h1>
                <p>{t('modes.taskRemindersShort')}</p>
              </header>

              <TaskReminders onGenerated={refreshHistory} />
            </>
          ) : channel === 'task-generator' ? (
            <>
              <header className="main-header">
                <h1># task-generator</h1>
                <p>{t('modes.taskGeneratorShort')}</p>
              </header>

              <TaskGenerator onGenerated={refreshHistory} />
            </>
          ) : channel === 'study-notes' ? (
            <>
              <header className="main-header">
                <h1># study-notes</h1>
                <p>{t('modes.studyNotesShort')}</p>
              </header>

              <StudyNotes onGenerated={refreshHistory} />
            </>
          ) : (
            <>
              <header className="main-header">
                <h1># ai-agents</h1>
                <p>{t('modes.aiAgentsShort')}</p>
              </header>

              <AiAgents onGenerated={refreshHistory} />
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

      {historyPreview && (
        <HistoryPreviewPanel record={historyPreview} onClose={() => setHistoryPreview(null)} />
      )}

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
