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

function mockFetch({ history = { items: [] }, generateResponses = [], sessions = [] } = {}) {
  let call = 0
  let historyItems = history.items.slice()
  const sessionsBackend = createFakeSessionsBackend(sessions)

  global.fetch = vi.fn((url, options = {}) => {
    if (typeof url === 'string' && url.startsWith('/history')) {
      const method = options.method || 'GET'
      const deleteMatch = url.match(/^\/history\/(\d+)$/)

      if (deleteMatch && method === 'DELETE') {
        const id = Number(deleteMatch[1])
        historyItems = historyItems.filter((item) => item.id !== id)
        return Promise.resolve(jsonResponse({ status: 'deleted' }))
      }
      if (url.startsWith('/history?')) {
        const q = decodeURIComponent(url.split('q=')[1] || '')
        const filtered = historyItems.filter((item) => item.title.includes(q) || item.topic.includes(q))
        return Promise.resolve(jsonResponse({ items: filtered }))
      }
      return Promise.resolve(jsonResponse({ items: historyItems }))
    }

    if (typeof url === 'string' && url.startsWith('/sessions')) {
      const result = sessionsBackend.handle(url, options)
      if (result) return result
    }

    const response = generateResponses[call]
    call += 1
    return Promise.resolve(response)
  })

  return { sessionsBackend }
}

async function submitTopic(topic = '生成AIと教育') {
  const textarea = await screen.findByPlaceholderText(/生成AIが学術論文の執筆プロセスに与える影響/)
  fireEvent.change(textarea, { target: { value: topic } })
  fireEvent.click(screen.getByRole('button', { name: /送信/ }))
}

beforeEach(() => {
  localStorage.clear()
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

  it('supports opening and closing tabs', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getAllByText('新規タブ')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: '新しいタブを追加' }))
    await waitFor(() => expect(screen.getAllByText('新規タブ')).toHaveLength(2))

    const tabs = screen.getAllByText('新規タブ')
    const secondTab = tabs[1].closest('.tab')
    fireEvent.click(within(secondTab).getByRole('button', { name: 'タブ「新規タブ」を閉じる' }))
    await waitFor(() => expect(screen.getAllByText('新規タブ')).toHaveLength(1))
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

  it('sends the saved API key as an X-API-Key header once entered', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText(/テーマを入力し/)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/APIキー/), { target: { value: 'my-secret-key' } })

    await submitTopic()

    await waitFor(() => {
      const generateCall = global.fetch.mock.calls.find(([url]) => url === '/generate')
      expect(generateCall).toBeTruthy()
      expect(generateCall[1].headers['X-API-Key']).toBe('my-secret-key')
    })
    expect(localStorage.getItem('paper-assistant-api-key')).toBe('my-secret-key')
  })

  it('does not send an X-API-Key header when no key is set', async () => {
    render(<App />)
    await submitTopic()

    await waitFor(() => {
      const generateCall = global.fetch.mock.calls.find(([url]) => url === '/generate')
      expect(generateCall).toBeTruthy()
      expect(generateCall[1].headers?.['X-API-Key']).toBeUndefined()
    })
  })

  it('shows a dismissible error banner when sessions fail to load', async () => {
    global.fetch = vi.fn((url, options = {}) => {
      const method = options.method || 'GET'
      if (url === '/sessions') {
        // GETもPOST(フォールバックのタブ作成)も同じ理由で失敗するケースを想定
        return Promise.resolve(jsonErrorResponse(401, 'invalid or missing API key'))
      }
      if (typeof url === 'string' && url.startsWith('/history')) {
        return Promise.resolve(jsonResponse({ items: [] }))
      }
      return Promise.resolve(jsonResponse({}))
    })

    render(<App />)

    await waitFor(() => expect(screen.getByText(/タブの読み込みに失敗しました/)).toBeInTheDocument())
    expect(screen.getByText(/invalid or missing API key/)).toBeInTheDocument()

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

  it('asks for confirmation before switching tabs with unsaved composer input', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getAllByText('新規タブ')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: '新しいタブを追加' }))
    await waitFor(() => expect(screen.getAllByText('新規タブ')).toHaveLength(2))

    const textarea = await screen.findByPlaceholderText(/生成AIが学術論文の執筆プロセスに与える影響/)
    fireEvent.change(textarea, { target: { value: '未送信の下書き' } })

    const firstTabEl = screen.getAllByText('新規タブ')[0].closest('.tab')
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    fireEvent.click(firstTabEl)
    expect(confirmSpy).toHaveBeenCalled()
    expect(textarea).toHaveValue('未送信の下書き') // キャンセルしたのでタブは切り替わらない

    confirmSpy.mockReturnValue(true)
    fireEvent.click(firstTabEl)
    await waitFor(() => expect(screen.queryByDisplayValue('未送信の下書き')).not.toBeInTheDocument())

    confirmSpy.mockRestore()
  })
})
