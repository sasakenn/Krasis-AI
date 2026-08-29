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

function mockFetch({ history = { items: [] }, generateResponses = [] } = {}) {
  let call = 0
  global.fetch = vi.fn((url) => {
    if (typeof url === 'string' && url.startsWith('/history')) {
      return Promise.resolve(jsonResponse(history))
    }
    const response = generateResponses[call]
    call += 1
    return Promise.resolve(response)
  })
}

async function submitTopic(topic = '生成AIと教育') {
  const textarea = screen.getByPlaceholderText(/生成AIが学術論文の執筆プロセスに与える影響/)
  fireEvent.change(textarea, { target: { value: topic } })
  fireEvent.click(screen.getByRole('button', { name: /送信/ }))
}

beforeEach(() => {
  localStorage.clear()
  mockFetch()
})

describe('App', () => {
  it('shows the empty-state hint when there are no messages yet', () => {
    render(<App />)
    expect(screen.getByText(/テーマを入力し/)).toBeInTheDocument()
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
    mockFetch({ generateResponses: [{ ok: false, text: async () => 'boom' }] })

    render(<App />)
    await submitTopic()

    await waitFor(() => expect(screen.getAllByText(/Error/).length).toBeGreaterThan(0))
  })

  it('restores messages from localStorage on remount', async () => {
    mockFetch({ generateResponses: [jsonResponse(LENGTH_QUESTION_RESPONSE)] })

    const { unmount } = render(<App />)
    await submitTopic('生成AIと教育')
    await waitFor(() => expect(screen.getByText(LENGTH_QUESTION_RESPONSE.message)).toBeInTheDocument())
    unmount()

    render(<App />)
    expect(screen.getByText(LENGTH_QUESTION_RESPONSE.message)).toBeInTheDocument()
    expect(screen.getAllByText('生成AIと教育').length).toBeGreaterThan(0)
  })

  it('supports opening and closing tabs', () => {
    render(<App />)
    expect(screen.getAllByText('新規タブ')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: '＋' }))
    const tabs = screen.getAllByText('新規タブ')
    expect(tabs).toHaveLength(2)

    const secondTab = tabs[1].closest('.tab')
    fireEvent.click(within(secondTab).getByRole('button', { name: '×' }))
    expect(screen.getAllByText('新規タブ')).toHaveLength(1)
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
})
