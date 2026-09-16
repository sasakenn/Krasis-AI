import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.jsx'

const LENGTH_QUESTION_RESPONSE = {
  type: 'length_question',
  message: '生成する分量の目安を選んでください。',
  options: [
    { key: '1-100', label: '1〜100文字' },
    { key: '101-1000', label: '101〜1000文字' },
  ],
}

const OUTLINE_RESPONSE = {
  type: 'outline',
  id: 1,
  title: 'テスト計画',
  research_question: '中心の問い',
  sections: [
    {
      heading: '背景',
      purpose: '背景を整理する',
      search_query: 'background research',
      literature: [],
    },
  ],
}

function jsonResponse(body) {
  return { ok: true, text: async () => JSON.stringify(body), json: async () => body }
}

function jsonErrorResponse(status, detail) {
  return { ok: false, status, text: async () => JSON.stringify({ detail }) }
}

// /sessions への GET/POST/PUT/DELETE をインメモリで模倣する簡易フェイクバックエンド。
function createFakeSessionsBackend(initialSessions = []) {
  let nextId = initialSessions.reduce((max, s) => Math.max(max, s.id), 0) + 1
  const store = new Map(initialSessions.map((s) => [s.id, { ...s }]))

  return {
    store,
    handle(url, options = {}) {
      const method = options.method || 'GET'

      if (url === '/sessions' && method === 'GET') {
        return Promise.resolve(jsonResponse({ items: Array.from(store.values()) }))
      }
      if (url === '/sessions' && method === 'POST') {
        const body = JSON.parse(options.body)
        const session = { id: nextId++, title: body.title, messages: [] }
        store.set(session.id, session)
        return Promise.resolve(jsonResponse(session))
      }

      const match = url.match(/^\/sessions\/(\d+)$/)
      if (match && method === 'PUT') {
        const id = Number(match[1])
        const body = JSON.parse(options.body)
        store.set(id, { id, title: body.title, messages: body.messages })
        return Promise.resolve(jsonResponse({ status: 'ok' }))
      }
      if (match && method === 'DELETE') {
        store.delete(Number(match[1]))
        return Promise.resolve(jsonResponse({ status: 'deleted' }))
      }

      return null
    },
  }
}

const DEFAULT_USAGE = {
  user_id: 'test-user',
  plan: 'free',
  tokens_used: 100,
  tokens_quota: 20000,
  period_start: '2026-01-01T00:00:00+00:00',
}

// /tasks への GET/POST/PUT/DELETE をインメモリで模倣する簡易フェイクバックエンド。
function createFakeTasksBackend(initialTasks = []) {
  let nextId = initialTasks.reduce((max, t) => Math.max(max, t.id), 0) + 1
  const store = new Map(initialTasks.map((t) => [t.id, { ...t }]))

  return {
    store,
    handle(url, options = {}) {
      const method = options.method || 'GET'

      if (url === '/tasks' && method === 'GET') {
        return Promise.resolve(jsonResponse({ items: Array.from(store.values()) }))
      }
      if (url === '/tasks' && method === 'POST') {
        const body = JSON.parse(options.body)
        const now = new Date()
        const estimatedMinutes = 45
        const remindAt = new Date(now.getTime() + estimatedMinutes * 60000).toISOString()
        const task = {
          id: nextId++,
          description: body.description,
          deadline: body.deadline || null,
          estimated_minutes: estimatedMinutes,
          remind_at: remindAt,
          reasoning: 'テスト用の固定見積もりです。',
          status: 'pending',
          reminded_at: null,
          created_at: now.toISOString(),
        }
        store.set(task.id, task)
        return Promise.resolve(jsonResponse(task))
      }

      const statusMatch = url.match(/^\/tasks\/(\d+)\/status$/)
      if (statusMatch && method === 'PUT') {
        const id = Number(statusMatch[1])
        const body = JSON.parse(options.body)
        const task = store.get(id)
        if (task) task.status = body.status
        return Promise.resolve(jsonResponse({ status: 'ok' }))
      }

      const deleteMatch = url.match(/^\/tasks\/(\d+)$/)
      if (deleteMatch && method === 'DELETE') {
        store.delete(Number(deleteMatch[1]))
        return Promise.resolve(jsonResponse({ status: 'deleted' }))
      }

      return null
    },
  }
}

const MFA_TEST_CODE = '123456'

function mockFetch({
  history = { items: [] },
  generateResponses = [],
  sessions = [],
  tasks = [],
  usage = DEFAULT_USAGE,
  mfaRequiredOnLogin = false,
  mfaInitialState = { enabled: false, pending: false },
  securityEvents = [],
} = {}) {
  let call = 0
  let historyItems = history.items.map((item) => ({ is_private: false, ...item }))
  const sessionsBackend = createFakeSessionsBackend(sessions)
  const tasksBackend = createFakeTasksBackend(tasks)
  const mfaState = { ...mfaInitialState }

  global.fetch = vi.fn((url, options = {}) => {
    const method = options.method || 'GET'

    if (url === '/me') {
      return Promise.resolve(jsonResponse(usage))
    }

    if (url === '/auth/dev' && method === 'POST') {
      return Promise.resolve(jsonResponse({ token: 'dev-token' }))
    }

    if (url === '/auth/code/signup' && method === 'POST') {
      return Promise.resolve(jsonResponse({ token: 'code-signup-token' }))
    }

    if (url === '/auth/code/login' && method === 'POST') {
      if (mfaRequiredOnLogin) {
        return Promise.resolve(jsonResponse({ mfa_required: true, mfa_token: 'pretend-mfa-token' }))
      }
      return Promise.resolve(jsonResponse({ token: 'code-login-token' }))
    }

    if (url === '/auth/mfa/verify' && method === 'POST') {
      const body = JSON.parse(options.body)
      if (body.mfa_token === 'pretend-mfa-token' && body.code === MFA_TEST_CODE) {
        return Promise.resolve(jsonResponse({ token: 'mfa-verified-token' }))
      }
      return Promise.resolve(jsonErrorResponse(401, '認証アプリのコードが正しくありません'))
    }

    if (url === '/auth/mfa/status' && method === 'GET') {
      return Promise.resolve(jsonResponse({ ...mfaState }))
    }

    if (url === '/auth/mfa/setup' && method === 'POST') {
      mfaState.pending = true
      return Promise.resolve(
        jsonResponse({ secret: 'ABCDEFGHIJKLMNOP', otpauth_url: 'otpauth://totp/Paper%20Assistant' })
      )
    }

    if (url === '/auth/mfa/confirm' && method === 'POST') {
      const body = JSON.parse(options.body)
      if (body.code !== MFA_TEST_CODE) {
        return Promise.resolve(jsonErrorResponse(400, '認証アプリのコードが正しくありません'))
      }
      mfaState.enabled = true
      mfaState.pending = false
      return Promise.resolve(jsonResponse({ enabled: true }))
    }

    if (url === '/auth/mfa/disable' && method === 'POST') {
      const body = JSON.parse(options.body)
      if (body.code !== MFA_TEST_CODE) {
        return Promise.resolve(jsonErrorResponse(401, '認証アプリのコードが正しくありません'))
      }
      mfaState.enabled = false
      mfaState.pending = false
      return Promise.resolve(jsonResponse({ enabled: false }))
    }

    if (url === '/auth/security-events' && method === 'GET') {
      return Promise.resolve(jsonResponse({ items: securityEvents }))
    }

    if (url === '/auth/code/reissue' && method === 'POST') {
      return Promise.resolve(
        jsonResponse({ message: 'このメールアドレスが登録されていれば、新しいコードを送信しました。' })
      )
    }

    if (url === '/billing/checkout' && method === 'POST') {
      return Promise.resolve(jsonResponse({ checkout_url: 'https://checkout.stripe.com/fake' }))
    }

    if (url === '/billing/portal' && method === 'POST') {
      return Promise.resolve(jsonResponse({ portal_url: 'https://billing.stripe.com/fake' }))
    }

    if (typeof url === 'string' && url.startsWith('/history')) {
      const deleteMatch = url.match(/^\/history\/(\d+)$/)
      const privacyMatch = url.match(/^\/history\/(\d+)\/private$/)

      if (privacyMatch && method === 'PUT') {
        const id = Number(privacyMatch[1])
        const body = JSON.parse(options.body)
        const item = historyItems.find((h) => h.id === id)
        if (item) item.is_private = body.is_private
        return Promise.resolve(jsonResponse({ status: 'ok' }))
      }
      if (deleteMatch && method === 'DELETE') {
        const id = Number(deleteMatch[1])
        historyItems = historyItems.filter((item) => item.id !== id)
        return Promise.resolve(jsonResponse({ status: 'deleted' }))
      }
      if (url.includes('?')) {
        const params = new URL(url, 'http://localhost').searchParams
        const q = params.get('q') || ''
        const wantsPrivate = params.get('scope') === 'private'
        const filtered = historyItems.filter(
          (item) =>
            Boolean(item.is_private) === wantsPrivate && (!q || item.title.includes(q) || item.topic.includes(q))
        )
        return Promise.resolve(jsonResponse({ items: filtered }))
      }
      return Promise.resolve(jsonResponse({ items: historyItems.filter((item) => !item.is_private) }))
    }

    if (typeof url === 'string' && url.startsWith('/sessions')) {
      const result = sessionsBackend.handle(url, options)
      if (result) return result
    }

    if (typeof url === 'string' && url.startsWith('/tasks')) {
      const result = tasksBackend.handle(url, options)
      if (result) return result
    }

    const response = generateResponses[call]
    call += 1
    return Promise.resolve(response)
  })

  return { sessionsBackend, tasksBackend }
}

async function submitTopic(topic = '生成AIと教育') {
  const textarea = await screen.findByPlaceholderText(/生成AIが学術論文の執筆プロセスに与える影響/)
  fireEvent.change(textarea, { target: { value: topic } })
  fireEvent.click(screen.getByRole('button', { name: /送信/ }))
}

beforeEach(() => {
  localStorage.clear()
  // 大半のテストはログイン済み状態のアプリ本体を検証したいので、あらかじめトークンを
  // 入れておく(未ログイン時の挙動を見るテストは個別にトークンを消してから使う)。
  localStorage.setItem('paper-assistant-token', 'test-token')
  mockFetch()
})

describe('App', () => {
  it('shows the empty-state hint when there are no messages yet', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText(/テーマを入力し/)).toBeInTheDocument())
  })

  it('asks for a target length after the first submit, then generates an outline once chosen', async () => {
    mockFetch({ generateResponses: [jsonResponse(LENGTH_QUESTION_RESPONSE), jsonResponse(OUTLINE_RESPONSE)] })

    render(<App />)
    await submitTopic()

    await waitFor(() => expect(screen.getByText(LENGTH_QUESTION_RESPONSE.message)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '1〜100文字' }))

    await waitFor(() => expect(screen.getByText('テスト計画')).toBeInTheDocument())
    expect(screen.getByText('中心の問い')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Markdownでダウンロード/ })).toBeInTheDocument()
  })

  it('shows an error message when the request fails', async () => {
    mockFetch({ generateResponses: [{ ok: false, status: 500, text: async () => 'boom' }] })

    render(<App />)
    await submitTopic()

    await waitFor(() => expect(screen.getAllByText(/Error/).length).toBeGreaterThan(0))
    expect(screen.getAllByText(/boom/).length).toBeGreaterThan(0)
  })

  it('shows the parsed detail message when the backend returns a JSON error body', async () => {
    mockFetch({
      generateResponses: [
        { ok: false, status: 400, text: async () => JSON.stringify({ detail: 'topic is required' }) },
      ],
    })

    render(<App />)
    await submitTopic()

    await waitFor(() => expect(screen.getAllByText(/topic is required/).length).toBeGreaterThan(0))
  })

  it('restores messages from the server on remount', async () => {
    mockFetch({ generateResponses: [jsonResponse(LENGTH_QUESTION_RESPONSE)] })

    const { unmount } = render(<App />)
    await submitTopic('生成AIと教育')
    await waitFor(() => expect(screen.getByText(LENGTH_QUESTION_RESPONSE.message)).toBeInTheDocument())
    unmount()

    render(<App />)
    await waitFor(() => expect(screen.getByText(LENGTH_QUESTION_RESPONSE.message)).toBeInTheDocument())
    expect(screen.getAllByText('生成AIと教育').length).toBeGreaterThan(0)
  })

  it('starts a fresh thread in a new tab, keeping the previous one reachable', async () => {
    mockFetch({ generateResponses: [jsonResponse(LENGTH_QUESTION_RESPONSE)] })
    render(<App />)
    await submitTopic('生成AIと教育')
    await waitFor(() => expect(screen.getByText(LENGTH_QUESTION_RESPONSE.message)).toBeInTheDocument())
    expect(screen.getAllByText('生成AIと教育').length).toBeGreaterThan(0)

    // 未送信の下書き(分量待ちの一時状態)が残っているので、新規スレッドの作成は確認を挟む
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '新規スレッド' }))

    // 新しいタブがアクティブになり、そのスレッドの中身(長さの質問)は消える
    await waitFor(() => expect(screen.queryByText(LENGTH_QUESTION_RESPONSE.message)).not.toBeInTheDocument())
    expect(screen.getByText(/下のボックスにテーマを入力し/)).toBeInTheDocument()
    // 前のタブ自体はタブバーに残り、タブ名としてテーマがまだ1箇所だけ表示される
    expect(screen.getAllByText('生成AIと教育')).toHaveLength(1)
    confirmSpy.mockRestore()
  })

  it('lists server-side history and opens an item in a new tab', async () => {
    mockFetch({
      history: {
        items: [{ id: 7, created_at: '2026-08-30T01:00:00Z', topic: '過去のテーマ', field: '一般', title: '過去の計画' }],
      },
    })

    render(<App />)
    await waitFor(() => expect(screen.getByText('過去の計画')).toBeInTheDocument())

    global.fetch.mockImplementationOnce((url) => {
      expect(url).toBe('/history/7')
      return Promise.resolve(
        jsonResponse({
          id: 7,
          topic: '過去のテーマ',
          field: '一般',
          title: '過去の計画',
          outline: OUTLINE_RESPONSE,
        })
      )
    })

    fireEvent.click(screen.getByText('過去の計画'))

    await waitFor(() => expect(screen.getAllByText('テスト計画').length).toBeGreaterThan(0))
    expect(screen.getAllByText('過去の計画').length).toBeGreaterThan(0) // タブタイトルとしても表示される
  })

  it('searches history items by query', async () => {
    mockFetch({
      history: {
        items: [
          { id: 1, created_at: '2026-08-30T01:00:00Z', topic: '生成AIと教育', field: '一般', title: '生成AI計画' },
          { id: 2, created_at: '2026-08-29T01:00:00Z', topic: '量子コンピュータ', field: '一般', title: '量子計画' },
        ],
      },
    })

    render(<App />)
    await waitFor(() => expect(screen.getByText('生成AI計画')).toBeInTheDocument())
    expect(screen.getByText('量子計画')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('履歴を検索'), { target: { value: '量子' } })

    await waitFor(() => expect(screen.queryByText('生成AI計画')).not.toBeInTheDocument())
    expect(screen.getByText('量子計画')).toBeInTheDocument()
  })

  it('deletes a history item after confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockFetch({
      history: {
        items: [{ id: 7, created_at: '2026-08-30T01:00:00Z', topic: '過去のテーマ', field: '一般', title: '過去の計画' }],
      },
    })

    render(<App />)
    await waitFor(() => expect(screen.getByText('過去の計画')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('この履歴を削除'))

    await waitFor(() => expect(screen.queryByText('過去の計画')).not.toBeInTheDocument())
    confirmSpy.mockRestore()
  })

  it('keeps a history item when the deletion confirmation is cancelled', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    mockFetch({
      history: {
        items: [{ id: 7, created_at: '2026-08-30T01:00:00Z', topic: '過去のテーマ', field: '一般', title: '過去の計画' }],
      },
    })

    render(<App />)
    await waitFor(() => expect(screen.getByText('過去の計画')).toBeInTheDocument())

    fireEvent.click(screen.getByTitle('この履歴を削除'))

    await waitFor(() => expect(screen.getByText('過去の計画')).toBeInTheDocument())
    confirmSpy.mockRestore()
  })

  it('sends the stored session token as a Bearer header', async () => {
    mockFetch({ generateResponses: [jsonResponse(LENGTH_QUESTION_RESPONSE)] })
    render(<App />)
    await submitTopic()

    await waitFor(() => {
      const generateCall = global.fetch.mock.calls.find(([url]) => url === '/generate')
      expect(generateCall).toBeTruthy()
      expect(generateCall[1].headers.Authorization).toBe('Bearer test-token')
    })
  })

  it('sends the private flag from the composer checkbox', async () => {
    mockFetch({ generateResponses: [jsonResponse(LENGTH_QUESTION_RESPONSE)] })
    render(<App />)

    const textarea = await screen.findByPlaceholderText(/生成AIが学術論文の執筆プロセスに与える影響/)
    fireEvent.change(textarea, { target: { value: 'シークレットテーマ' } })
    fireEvent.click(screen.getByLabelText(/シークレットとして保存/))
    fireEvent.click(screen.getByRole('button', { name: /送信/ }))

    await waitFor(() => {
      const generateCall = global.fetch.mock.calls.find(([url]) => url === '/generate')
      expect(generateCall).toBeTruthy()
      expect(generateCall[1].body.get('private')).toBe('true')
    })
  })

  it('shows the usage indicator fetched from /me', async () => {
    mockFetch({ usage: { ...DEFAULT_USAGE, plan: 'pro', tokens_used: 1234, tokens_quota: 200000 } })
    render(<App />)

    await waitFor(() => expect(screen.getByText('PRO')).toBeInTheDocument())
    expect(screen.getByText('1,234 / 200,000')).toBeInTheDocument()
  })

  it('shows upgrade buttons on the free plan and starts a Stripe checkout', async () => {
    mockFetch({ usage: { ...DEFAULT_USAGE, plan: 'free' } })
    render(<App />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Proにアップグレード' })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Maxにアップグレード' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'プランを管理' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Proにアップグレード' }))

    await waitFor(() => {
      const checkoutCall = global.fetch.mock.calls.find(([url]) => url === '/billing/checkout')
      expect(checkoutCall).toBeTruthy()
      expect(JSON.parse(checkoutCall[1].body)).toEqual({ plan: 'pro' })
    })
  })

  it('shows a manage-billing button on a paid plan and opens the Stripe portal', async () => {
    mockFetch({ usage: { ...DEFAULT_USAGE, plan: 'pro' } })
    render(<App />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'プランを管理' })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Proにアップグレード' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'プランを管理' }))

    await waitFor(() => {
      const portalCall = global.fetch.mock.calls.find(([url]) => url === '/billing/portal')
      expect(portalCall).toBeTruthy()
    })
  })

  it('logs out and returns to the login screen', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText(/テーマを入力し/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'ログアウト' }))

    await waitFor(() => expect(screen.getByText('続けるにはログインしてください')).toBeInTheDocument())
    expect(localStorage.getItem('paper-assistant-token')).toBeNull()
  })

  it('returns to the login screen when a request comes back 401 (expired token)', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText(/テーマを入力し/)).toBeInTheDocument())

    global.fetch = vi.fn(() => Promise.resolve(jsonErrorResponse(401, 'token expired')))
    fireEvent.click(screen.getByRole('button', { name: '新規スレッド' }))

    await waitFor(() => expect(screen.getByText('続けるにはログインしてください')).toBeInTheDocument())
    expect(localStorage.getItem('paper-assistant-token')).toBeNull()
  })

  it('toggles an individual history item between public and secret', async () => {
    mockFetch({
      history: {
        items: [
          { id: 5, created_at: '2026-08-30T01:00:00Z', topic: 'トグル対象', field: '一般', title: 'トグル計画' },
        ],
      },
    })

    render(<App />)
    await waitFor(() => expect(screen.getByText('トグル計画')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'トグル計画をシークレットにする' }))

    await waitFor(() => expect(screen.queryByText('トグル計画')).not.toBeInTheDocument())
  })

  it('shows the secret history list only when the toggle is on', async () => {
    mockFetch({
      history: {
        items: [
          { id: 1, created_at: '2026-08-30T01:00:00Z', topic: '公開テーマ', field: '一般', title: '公開計画' },
          {
            id: 2,
            created_at: '2026-08-30T01:00:00Z',
            topic: '秘密テーマ',
            field: '一般',
            title: '秘密計画',
            is_private: true,
          },
        ],
      },
    })

    const { container } = render(<App />)
    await waitFor(() => expect(screen.getByText('公開計画')).toBeInTheDocument())
    expect(screen.queryByText('秘密計画')).not.toBeInTheDocument()

    fireEvent.click(container.querySelector('.secret-toggle input'))

    await waitFor(() => expect(screen.getByText('秘密計画')).toBeInTheDocument())
    expect(screen.queryByText('公開計画')).not.toBeInTheDocument()
  })

  it('shows a dismissible error banner when sessions fail to load', async () => {
    // 401は「未認証」として専用のログイン画面への復帰処理に一本化されているので、
    // ここでは(ログインは有効なままの)サーバーエラーでバナー表示を確認する。
    global.fetch = vi.fn((url) => {
      if (url === '/me') return Promise.resolve(jsonResponse(DEFAULT_USAGE))
      if (url === '/sessions') {
        // GETもPOST(フォールバックのタブ作成)も同じ理由で失敗するケースを想定
        return Promise.resolve(jsonErrorResponse(500, 'internal server error'))
      }
      if (typeof url === 'string' && url.startsWith('/history')) {
        return Promise.resolve(jsonResponse({ items: [] }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    render(<App />)

    await waitFor(() => expect(screen.getByText(/タブの読み込みに失敗しました/)).toBeInTheDocument())
    expect(screen.getByText(/internal server error/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'エラーを閉じる' }))
    expect(screen.queryByText(/タブの読み込みに失敗しました/)).not.toBeInTheDocument()
  })

  it('shows an error banner when deleting a history item fails', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    mockFetch({
      history: {
        items: [{ id: 7, created_at: '2026-08-30T01:00:00Z', topic: '過去のテーマ', field: '一般', title: '過去の計画' }],
      },
    })

    render(<App />)
    await waitFor(() => expect(screen.getByText('過去の計画')).toBeInTheDocument())

    global.fetch.mockImplementationOnce((url, options) => {
      expect(url).toBe('/history/7')
      expect(options.method).toBe('DELETE')
      return Promise.resolve(jsonErrorResponse(500, 'internal error'))
    })

    fireEvent.click(screen.getByTitle('この履歴を削除'))

    await waitFor(() => expect(screen.getByText(/履歴の削除に失敗しました/)).toBeInTheDocument())
    expect(screen.getByText(/internal error/)).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('asks for confirmation before starting a new thread with unsaved composer input', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getAllByText('新規タブ').length).toBeGreaterThan(0))

    const textarea = await screen.findByPlaceholderText(/生成AIが学術論文の執筆プロセスに与える影響/)
    fireEvent.change(textarea, { target: { value: '未送信の下書き' } })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    fireEvent.click(screen.getByRole('button', { name: '新規スレッド' }))
    expect(confirmSpy).toHaveBeenCalled()
    expect(textarea).toHaveValue('未送信の下書き') // キャンセルしたのでスレッドは変わらない

    confirmSpy.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: '新規スレッド' }))
    await waitFor(() => expect(screen.queryByDisplayValue('未送信の下書き')).not.toBeInTheDocument())

    confirmSpy.mockRestore()
  })
})

describe('LoginScreen', () => {
  beforeEach(() => {
    localStorage.removeItem('paper-assistant-token')
  })

  it('shows the login screen when there is no stored token', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('続けるにはログインしてください')).toBeInTheDocument())
  })

  it('logs in via the dev login button and shows the app', async () => {
    render(<App />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /開発用ログイン/ })).toBeInTheDocument()
    )

    fireEvent.click(screen.getByRole('button', { name: /開発用ログイン/ }))

    await waitFor(() => expect(screen.getByText(/テーマを入力し/)).toBeInTheDocument())
    expect(localStorage.getItem('paper-assistant-token')).toBe('dev-token')
  })

  it('disables provider buttons when their client id is not configured', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('続けるにはログインしてください')).toBeInTheDocument())

    expect(screen.getByRole('button', { name: /Appleでサインイン/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /GitHubでサインイン/ })).toBeDisabled()
  })

  it('signs up with email and logs in immediately without showing any code', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByPlaceholderText('メールアドレス')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('メールアドレス'), {
      target: { value: 'new-user@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'メールで登録してログインコードを発行' }))

    await waitFor(() => expect(screen.getByText(/テーマを入力し/)).toBeInTheDocument())
    expect(localStorage.getItem('paper-assistant-token')).toBe('code-signup-token')
  })

  it('logs in with an existing email and code', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    fireEvent.change(screen.getByPlaceholderText('メールアドレス'), {
      target: { value: 'existing-user@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('12桁のログインコード'), {
      target: { value: 'abc123def456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログインコードでログイン' }))

    await waitFor(() => expect(screen.getByText(/テーマを入力し/)).toBeInTheDocument())
    expect(localStorage.getItem('paper-assistant-token')).toBe('code-login-token')
  })

  it('requests a code reissue and shows the confirmation message', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'ログインコードを忘れた' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'ログインコードを忘れた' }))

    fireEvent.change(screen.getByPlaceholderText('メールアドレス'), {
      target: { value: 'forgot-code@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログインコードを再発行してメールで送る' }))

    await waitFor(() =>
      expect(screen.getByText(/このメールアドレスが登録されていれば/)).toBeInTheDocument()
    )
  })
})

describe('TaskReminders', () => {
  async function openTaskChannel() {
    render(<App />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '# task-reminders' })).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: '# task-reminders' }))
    await waitFor(() => expect(screen.getByText('まだタスクがありません。上のフォームから追加してください。')).toBeInTheDocument())
  }

  it('creates a task and shows the estimated time returned by the server', async () => {
    await openTaskChannel()

    fireEvent.change(screen.getByPlaceholderText(/経済学のレポート/), {
      target: { value: '統計学のレポートを書く' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AIに見積もってもらう' }))

    await waitFor(() => expect(screen.getByText('統計学のレポートを書く')).toBeInTheDocument())
    expect(screen.getByText(/所要時間の目安: 約45分/)).toBeInTheDocument()
    expect(screen.getByText('テスト用の固定見積もりです。')).toBeInTheDocument()
  })

  it('toggles a task to done and back to pending', async () => {
    await openTaskChannel()

    fireEvent.change(screen.getByPlaceholderText(/経済学のレポート/), {
      target: { value: '完了させるタスク' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AIに見積もってもらう' }))
    await waitFor(() => expect(screen.getByText('完了させるタスク')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '完了にする' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '未完了に戻す' })).toBeInTheDocument())

    const taskItem = screen.getByText('完了させるタスク').closest('li')
    expect(taskItem).toHaveClass('task-item-done')
  })

  it('deletes a task from the list', async () => {
    await openTaskChannel()

    fireEvent.change(screen.getByPlaceholderText(/経済学のレポート/), {
      target: { value: '削除するタスク' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'AIに見積もってもらう' }))
    await waitFor(() => expect(screen.getByText('削除するタスク')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: '🗑' }))
    await waitFor(() => expect(screen.queryByText('削除するタスク')).not.toBeInTheDocument())
  })

  it('loads existing tasks from the server on open', async () => {
    mockFetch({
      tasks: [
        {
          id: 99,
          description: '既存のタスク',
          deadline: null,
          estimated_minutes: 30,
          remind_at: new Date(Date.now() + 30 * 60000).toISOString(),
          reasoning: '',
          status: 'pending',
          reminded_at: null,
          created_at: new Date().toISOString(),
        },
      ],
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '# task-reminders' }))
    await waitFor(() => expect(screen.getByText('既存のタスク')).toBeInTheDocument())
  })
})

describe('MFA login flow', () => {
  beforeEach(() => {
    localStorage.removeItem('paper-assistant-token')
  })

  it('asks for an authenticator code when the account has MFA enabled, then logs in', async () => {
    mockFetch({ mfaRequiredOnLogin: true })
    render(<App />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'ログイン' })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }))

    fireEvent.change(screen.getByPlaceholderText('メールアドレス'), {
      target: { value: 'mfa-user@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('12桁のログインコード'), {
      target: { value: 'abc123def456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログインコードでログイン' }))

    await waitFor(() =>
      expect(screen.getByText('認証アプリに表示されている6桁のコードを入力してください')).toBeInTheDocument()
    )
    expect(localStorage.getItem('paper-assistant-token')).toBeNull()

    fireEvent.change(screen.getByPlaceholderText('6桁のコード'), { target: { value: MFA_TEST_CODE } })
    fireEvent.click(screen.getByRole('button', { name: 'コードを確認してログイン' }))

    await waitFor(() => expect(screen.getByText(/テーマを入力し/)).toBeInTheDocument())
    expect(localStorage.getItem('paper-assistant-token')).toBe('mfa-verified-token')
  })

  it('shows an error and lets the user retry on a wrong authenticator code', async () => {
    mockFetch({ mfaRequiredOnLogin: true })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'ログイン' }))
    fireEvent.change(screen.getByPlaceholderText('メールアドレス'), {
      target: { value: 'mfa-user@example.com' },
    })
    fireEvent.change(screen.getByPlaceholderText('12桁のログインコード'), {
      target: { value: 'abc123def456' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'ログインコードでログイン' }))
    await screen.findByPlaceholderText('6桁のコード')

    fireEvent.change(screen.getByPlaceholderText('6桁のコード'), { target: { value: '000000' } })
    fireEvent.click(screen.getByRole('button', { name: 'コードを確認してログイン' }))

    await waitFor(() => expect(screen.getByText(/認証アプリのコードが正しくありません/)).toBeInTheDocument())
    expect(localStorage.getItem('paper-assistant-token')).toBeNull()
  })
})

describe('SecuritySettings', () => {
  async function openSecurityPanel() {
    render(<App />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '🔒 セキュリティ設定' })).toBeInTheDocument()
    )
    fireEvent.click(screen.getByRole('button', { name: '🔒 セキュリティ設定' }))
    await waitFor(() => expect(screen.getByText('多要素認証(認証アプリ)')).toBeInTheDocument())
  }

  it('sets up and enables MFA with the confirmation code', async () => {
    mockFetch()
    await openSecurityPanel()

    await waitFor(() => expect(screen.getByText('現在、無効です。')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '多要素認証を設定する' }))

    await waitFor(() => expect(screen.getByText('ABCDEFGHIJKLMNOP')).toBeInTheDocument())

    fireEvent.change(screen.getByPlaceholderText('表示された6桁のコード'), {
      target: { value: MFA_TEST_CODE },
    })
    fireEvent.click(screen.getByRole('button', { name: 'コードを確認して有効化' }))

    await waitFor(() => expect(screen.getByText('多要素認証を有効にしました。')).toBeInTheDocument())
    expect(screen.getByText('✓ 有効になっています')).toBeInTheDocument()
  })

  it('disables MFA when already enabled, given the correct code', async () => {
    mockFetch({ mfaInitialState: { enabled: true, pending: false } })
    await openSecurityPanel()

    await waitFor(() => expect(screen.getByText('✓ 有効になっています')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText('無効にするには現在の6桁コード'), {
      target: { value: MFA_TEST_CODE },
    })
    fireEvent.click(screen.getByRole('button', { name: '多要素認証を無効にする' }))

    await waitFor(() => expect(screen.getByText('多要素認証を無効にしました。')).toBeInTheDocument())
    expect(screen.getByText('現在、無効です。')).toBeInTheDocument()
  })

  it('shows recent security events', async () => {
    mockFetch({
      securityEvents: [
        { id: 1, created_at: new Date().toISOString(), event_type: 'login_failed', detail: '' },
      ],
    })
    await openSecurityPanel()

    await waitFor(() => expect(screen.getByText('ログイン失敗')).toBeInTheDocument())
  })
})
