import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'

// アプリ全体(ログイン画面含む)で切り替え可能な3言語。
export const LANGUAGES = [
  { code: 'ja', label: '日本語' },
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
]
export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code)
export const DEFAULT_LANGUAGE = 'ja'

const LANG_STORAGE_KEY = 'thynora-lang'

// バックエンド(Claude API)に「この言語で回答して」と伝えるための表示名。
export const AI_LANGUAGE_NAMES = {
  ja: '日本語',
  en: 'English',
  ko: '한국어',
}

// toLocaleDateString/toLocaleString用のロケール。
const LOCALES = { ja: 'ja-JP', en: 'en-US', ko: 'ko-KR' }
export function localeFor(lang) {
  return LOCALES[lang] || LOCALES[DEFAULT_LANGUAGE]
}

function getInitialLanguage() {
  try {
    const stored = localStorage.getItem(LANG_STORAGE_KEY)
    if (stored && LANGUAGE_CODES.includes(stored)) return stored
  } catch {
    // localStorageが使えない環境(プライベートモード等)では既定言語にフォールバックする
  }
  return DEFAULT_LANGUAGE
}

// キーはドット区切りのパス(例: 'login.subtitle')。値に{name}のようなプレースホルダーを
// 含めておくと、t(key, {name: '...'})で埋め込める。
const translations = {
  common: {
    loadingEllipsis: { ja: '処理中…', en: 'Working…', ko: '처리 중…' },
    checking: { ja: '確認中…', en: 'Checking…', ko: '확인 중…' },
    back: { ja: '戻る', en: 'Back', ko: '뒤로' },
    error: { ja: 'エラー', en: 'Error', ko: '오류' },
    cancel: { ja: 'キャンセル', en: 'Cancel', ko: '취소' },
    save: { ja: '保存', en: 'Save', ko: '저장' },
    close: { ja: '閉じる', en: 'Close', ko: '닫기' },
    optional: { ja: '任意', en: 'optional', ko: '선택' },
    hoursMinutes: { ja: '{hours}時間{minutes}分', en: '{hours}h {minutes}m', ko: '{hours}시간 {minutes}분' },
    hoursOnly: { ja: '{hours}時間', en: '{hours}h', ko: '{hours}시간' },
    minutesOnly: { ja: '{minutes}分', en: '{minutes}m', ko: '{minutes}분' },
    monthLabel: { ja: '{month}月', en: 'Month {month}', ko: '{month}월' },
    signingIn: { ja: 'サインイン処理中…', en: 'Signing in…', ko: '로그인 처리 중…' },
    you: { ja: 'You', en: 'You', ko: 'You' },
    assistant: { ja: 'Assistant', en: 'Assistant', ko: 'Assistant' },
    thinking: { ja: '考え中', en: 'Thinking', ko: '생각 중' },
    sending: { ja: '送信中…', en: 'Sending…', ko: '전송 중…' },
    send: { ja: '送信 →', en: 'Send →', ko: '전송 →' },
  },

  login: {
    subtitle: { ja: '続けるにはログインしてください', en: 'Please sign in to continue', ko: '계속하려면 로그인하세요' },
    mfaSubtitle: {
      ja: '認証アプリに表示されている6桁のコードを入力してください',
      en: 'Enter the 6-digit code shown in your authenticator app',
      ko: '인증 앱에 표시된 6자리 코드를 입력하세요',
    },
    mfaPlaceholder: { ja: '6桁のコード', en: '6-digit code', ko: '6자리 코드' },
    mfaSubmit: { ja: 'コードを確認してログイン', en: 'Verify code & sign in', ko: '코드 확인 후 로그인' },
    googleSignIn: { ja: 'Googleでサインイン', en: 'Sign in with Google', ko: 'Google로 로그인' },
    githubSignIn: { ja: 'GitHubでサインイン', en: 'Sign in with GitHub', ko: 'GitHub로 로그인' },
    microsoftSignIn: { ja: 'Microsoftでサインイン', en: 'Sign in with Microsoft', ko: 'Microsoft로 로그인' },
    googleMissing: { ja: 'サーバーでGOOGLE_CLIENT_IDが未設定です', en: 'GOOGLE_CLIENT_ID is not configured on the server', ko: '서버에 GOOGLE_CLIENT_ID가 설정되어 있지 않습니다' },
    githubMissing: { ja: 'サーバーでGITHUB_CLIENT_IDが未設定です', en: 'GITHUB_CLIENT_ID is not configured on the server', ko: '서버에 GITHUB_CLIENT_ID가 설정되어 있지 않습니다' },
    microsoftMissing: { ja: 'サーバーでMICROSOFT_CLIENT_IDが未設定です', en: 'MICROSOFT_CLIENT_ID is not configured on the server', ko: '서버에 MICROSOFT_CLIENT_ID가 설정되어 있지 않습니다' },
    divider: { ja: 'または', en: 'or', ko: '또는' },
    tabSignup: { ja: '新規登録', en: 'Sign up', ko: '회원가입' },
    tabLogin: { ja: 'ログイン', en: 'Log in', ko: '로그인' },
    tabForgot: { ja: 'ログインコードを忘れた', en: 'Forgot login code', ko: '로그인 코드 분실' },
    emailPlaceholder: { ja: 'メールアドレス', en: 'Email address', ko: '이메일 주소' },
    codePlaceholder: { ja: '12桁のログインコード', en: '12-digit login code', ko: '12자리 로그인 코드' },
    signupSubmit: { ja: 'メールで登録してログインコードを発行', en: 'Sign up by email & get a login code', ko: '이메일로 가입하고 로그인 코드 발급받기' },
    loginSubmit: { ja: 'ログインコードでログイン', en: 'Log in with code', ko: '코드로 로그인' },
    reissueSubmit: { ja: 'ログインコードを再発行してメールで送る', en: 'Reissue login code by email', ko: '로그인 코드를 재발급하여 메일로 받기' },
    devLogin: { ja: '開発用ログイン', en: 'Dev login', ko: '개발용 로그인' },
    credit: { ja: 'Made by Krasis', en: 'Made by Krasis', ko: 'Made by Krasis' },
    languageLabel: { ja: '言語', en: 'Language', ko: '언어' },
  },

  home: {
    greeting: { ja: '今日は何をしますか?', en: 'What would you like to do today?', ko: '오늘은 무엇을 하시겠어요?' },
    usageTitle: { ja: '利用時間', en: 'Usage time', ko: '이용 시간' },
    usageTotal: { ja: '合計', en: 'total', ko: '합계' },
    rangeDay: { ja: '日', en: 'Day', ko: '일' },
    rangeWeek: { ja: '週', en: 'Week', ko: '주' },
    rangeYear: { ja: '年', en: 'Year', ko: '년' },
    loading: { ja: '読み込み中…', en: 'Loading…', ko: '불러오는 중…' },
    noUsageYet: { ja: 'まだ利用記録がありません。下から機能を使ってみましょう。', en: "No usage yet — try one of the features below.", ko: '아직 이용 기록이 없습니다. 아래에서 기능을 사용해 보세요.' },
    getStarted: { ja: 'はじめる', en: 'Get started', ko: '시작하기' },
    aiAgentsSection: { ja: 'AI Agents', en: 'AI Agents', ko: 'AI Agents' },
    home: { ja: 'home', en: 'home', ko: 'home' },
    homeDesc: { ja: '利用時間の確認とクイックスタート', en: 'Check usage time and quick-start a feature', ko: '이용 시간 확인 및 빠른 시작' },
    chartAriaLabel: { ja: '期間ごとの利用時間', en: 'Usage time by period', ko: '기간별 이용 시간' },
  },

  topbar: {
    menuLabel: { ja: 'メニューを開く', en: 'Open menu', ko: '메뉴 열기' },
    search: { ja: 'モード・履歴を検索', en: 'Search modes & history', ko: '모드·기록 검색' },
    planFree: { ja: 'FREE', en: 'FREE', ko: 'FREE' },
    planPro: { ja: 'PRO', en: 'PRO', ko: 'PRO' },
    planMax: { ja: 'MAX', en: 'MAX', ko: 'MAX' },
    closeError: { ja: 'エラーを閉じる', en: 'Dismiss error', ko: '오류 닫기' },
    newTabAria: { ja: '新しいタブを追加', en: 'Add a new tab', ko: '새 탭 추가' },
    closeTabAria: { ja: 'タブ「{title}」を閉じる', en: 'Close tab "{title}"', ko: '탭 "{title}" 닫기' },
  },

  sidebar: {
    closeMenu: { ja: 'メニューを閉じる', en: 'Close menu', ko: '메뉴 닫기' },
    history: { ja: '履歴', en: 'History', ko: '기록' },
    secretHistory: { ja: 'シークレット履歴', en: 'Private history', ko: '비공개 기록' },
    secretToggleTitle: { ja: 'シークレット履歴を表示', en: 'Show private history', ko: '비공개 기록 표시' },
    searchHistory: { ja: '履歴を検索', en: 'Search history', ko: '기록 검색' },
    noHistoryMatch: { ja: '該当する履歴がありません', en: 'No matching history', ko: '해당하는 기록이 없습니다' },
    noSecretHistory: { ja: 'シークレット履歴はまだありません', en: 'No private history yet', ko: '비공개 기록이 아직 없습니다' },
    noHistory: { ja: 'まだ生成履歴がありません', en: 'No history yet', ko: '아직 생성 기록이 없습니다' },
    newThread: { ja: '新規スレッド', en: 'New thread', ko: '새 스레드' },
    makePrivate: { ja: 'シークレットにする', en: 'Make private', ko: '비공개로 전환' },
    makePublic: { ja: '公開に戻す', en: 'Make public again', ko: '공개로 되돌리기' },
    deleteHistory: { ja: 'この履歴を削除', en: 'Delete this history item', ko: '이 기록 삭제' },
    tokensThisMonth: { ja: 'TOKENS · 今月', en: 'TOKENS · this month', ko: 'TOKENS · 이번 달' },
    upgradePro: { ja: 'Proにアップグレード', en: 'Upgrade to Pro', ko: 'Pro로 업그레이드' },
    upgradeMax: { ja: 'Maxにアップグレード', en: 'Upgrade to Max', ko: 'Max로 업그레이드' },
    managePlan: { ja: 'プランを管理', en: 'Manage plan', ko: '플랜 관리' },
    adminDashboard: { ja: '管理ダッシュボード', en: 'Admin dashboard', ko: '관리 대시보드' },
    securitySettings: { ja: 'セキュリティ設定', en: 'Security settings', ko: '보안 설정' },
    logout: { ja: 'ログアウト', en: 'Log out', ko: '로그아웃' },
    languageLabel: { ja: '言語', en: 'Language', ko: '언어' },
    historyOf: { ja: '履歴・{mode}', en: 'History · {mode}', ko: '기록 · {mode}' },
    secretHistoryOf: { ja: 'シークレット履歴・{mode}', en: 'Private history · {mode}', ko: '비공개 기록 · {mode}' },
    deleteItemAria: { ja: '{title}を削除', en: 'Delete {title}', ko: '{title} 삭제' },
    makePublicAria: { ja: '{title}を公開に戻す', en: 'Make {title} public again', ko: '{title}을(를) 다시 공개로 전환' },
    makePrivateAria: { ja: '{title}をシークレットにする', en: 'Make {title} private', ko: '{title}을(를) 비공개로 전환' },
    aiAgentsSectionLabel: { ja: 'AI Agents', en: 'AI Agents', ko: 'AI Agents' },
  },

  palette: {
    logout: { ja: 'ログアウト', en: 'Log out', ko: '로그아웃' },
    newThread: { ja: '新規スレッド', en: 'New thread', ko: '새 스레드' },
  },

  confirm: {
    discardComposer: {
      ja: '入力中のテーマや添付ファイル(未送信)は失われます。このまま続けますか？',
      en: 'The topic and attachments you started (not yet sent) will be lost. Continue anyway?',
      ko: '작성 중인 주제와 첨부파일(미전송)이 사라집니다. 계속하시겠습니까?',
    },
    deleteHistory: { ja: 'この履歴を削除しますか？', en: 'Delete this history item?', ko: '이 기록을 삭제하시겠습니까?' },
  },

  errors: {
    tabsLoadFailed: { ja: 'タブの読み込みに失敗しました', en: 'Failed to load tabs', ko: '탭을 불러오지 못했습니다' },
    tabsSaveFailed: { ja: 'タブの保存に失敗しました', en: 'Failed to save the tab', ko: '탭 저장에 실패했습니다' },
    historyLoadFailed: { ja: '履歴の取得に失敗しました', en: 'Failed to load history', ko: '기록을 불러오지 못했습니다' },
    historyOpenFailed: { ja: '履歴の読み込みに失敗しました', en: 'Failed to open history item', ko: '기록을 여는 데 실패했습니다' },
    historyDeleteFailed: { ja: '履歴の削除に失敗しました', en: 'Failed to delete history item', ko: '기록 삭제에 실패했습니다' },
    privacyChangeFailed: { ja: 'シークレット設定の変更に失敗しました', en: 'Failed to change the privacy setting', ko: '비공개 설정 변경에 실패했습니다' },
    newTabFailed: {
      ja: '新しいタブの作成に失敗しました。サーバーへの接続やAPIキーを確認してください。',
      en: 'Failed to create a new tab. Please check the server connection and API key.',
      ko: '새 탭 생성에 실패했습니다. 서버 연결과 API 키를 확인해 주세요.',
    },
    upgradeFailed: { ja: 'アップグレードに失敗しました', en: 'Failed to upgrade', ko: '업그레이드에 실패했습니다' },
    managePlanFailed: { ja: 'プラン管理画面を開けませんでした', en: 'Could not open the plan management page', ko: '플랜 관리 화면을 열 수 없었습니다' },
  },

  courseGuide: {
    otherUniversity: { ja: 'その他(入力する)', en: 'Other (type your own)', ko: '기타(직접 입력)' },
    selectUniversity: { ja: '大学を選択', en: 'Select a university', ko: '대학 선택' },
    universityPlaceholder: { ja: '大学名を入力', en: 'Enter university name', ko: '대학명 입력' },
    selectFaculty: { ja: '学部を選択', en: 'Select a faculty', ko: '학부 선택' },
    facultyPlaceholder: { ja: '学部名を入力', en: 'Enter faculty name', ko: '학부명 입력' },
    departmentPlaceholder: { ja: '学科・専攻(任意)', en: 'Department/major (optional)', ko: '학과·전공(선택)' },
    changeTarget: { ja: '↺ 対象を変更', en: '↺ Change selection', ko: '↺ 대상 변경' },
    emptyReady: { ja: '気になる授業について、下のボックスから質問してください。', en: 'Ask about any course you’re curious about using the box below.', ko: '궁금한 수업에 대해 아래 상자에서 질문해 보세요.' },
    emptyNotReady: { ja: '上で大学と学部を選択すると、質問できるようになります。', en: 'Select a university and faculty above to start asking questions.', ko: '위에서 대학과 학부를 선택하면 질문할 수 있습니다.' },
    inputPlaceholderReady: { ja: '例: 民法の授業は何を勉強しますか？', en: 'e.g. What do you study in Civil Law?', ko: '예: 민법 수업에서는 무엇을 배우나요?' },
    inputPlaceholderNotReady: { ja: '上で大学・学部を選択すると入力できます', en: 'Select a university & faculty above to type here', ko: '위에서 대학·학부를 선택하면 입력할 수 있습니다' },
  },

  outline: {
    promptRequired: { ja: 'プロンプトを入力してください', en: 'Please enter a prompt', ko: '프롬프트를 입력해 주세요' },
    empty: {
      ja: '下のボックスにテーマを入力し、必要なら参考資料やフォーマット指定ファイルを添付して送信してください。',
      en: 'Enter a topic in the box below and, if needed, attach reference materials or a format file, then send.',
      ko: '아래 상자에 주제를 입력하고, 필요하면 참고자료나 형식 지정 파일을 첨부하여 전송하세요.',
    },
    fieldTag: { ja: '分野: {field}', en: 'Field: {field}', ko: '분야: {field}' },
    attachToggle: { ja: '添付ファイル(参考資料・フォーマット指定)', en: 'Attachments (references & format spec)', ko: '첨부파일(참고자료·형식 지정)' },
    addReference: { ja: '参考資料を追加', en: 'Add reference material', ko: '참고자료 추가' },
    referenceHint: {
      ja: 'txt/md/pdf/docxは中身を読み込みます(複数可、それ以外はファイル名のみ)',
      en: 'txt/md/pdf/docx contents are read (multiple allowed; other types use filename only)',
      ko: 'txt/md/pdf/docx는 내용을 읽습니다(여러 개 가능, 그 외 형식은 파일명만 사용)',
    },
    addFormat: { ja: 'フォーマット指定ファイルを追加', en: 'Add a format spec file', ko: '형식 지정 파일 추가' },
    formatHint: {
      ja: '生成する論文の形式を指定するファイル(1件、txt/md/pdf/docx対応)',
      en: "A file specifying the output format (one file, txt/md/pdf/docx supported)",
      ko: '생성할 문서의 형식을 지정하는 파일(1개, txt/md/pdf/docx 지원)',
    },
    removeAttachmentAria: { ja: '{name}を添付から削除', en: 'Remove {name} from attachments', ko: '첨부에서 {name} 삭제' },
    chooseLengthHint: { ja: '上のメッセージで生成する分量を選んでください', en: 'Choose the target length in the message above', ko: '위 메시지에서 생성할 분량을 선택하세요' },
    topicPlaceholder: {
      ja: '例: 生成AIが学術論文の執筆プロセスに与える影響について調査計画を作りたい',
      en: 'e.g. I want a research plan on how generative AI affects the academic writing process',
      ko: '예: 생성형 AI가 학술 논문 작성 과정에 미치는 영향에 대한 조사 계획을 만들고 싶다',
    },
    fieldPlaceholder: { ja: '分野(例: 教育技術)', en: 'Field (e.g. education technology)', ko: '분야(예: 교육공학)' },
    savePrivate: { ja: 'シークレットとして保存', en: 'Save as private', ko: '비공개로 저장' },
  },

  taskGenerator: {
    downloadFile: { ja: '{filename} をダウンロード', en: 'Download {filename}', ko: '{filename} 다운로드' },
    placeholder: {
      ja: '例: 4月〜9月の売上集計表をExcelで作って / 江戸時代の身分制度についてレポートをまとめて',
      en: 'e.g. Make an Excel sales summary for April–September / Write a report on the Edo-era class system',
      ko: '예: 4월~9월 매출 집계표를 엑셀로 만들어줘 / 에도시대 신분제도에 대한 리포트를 정리해줘',
    },
    kindText: { ja: '文章の課題(レポート・回答など)', en: 'Text assignment (report, answer, etc.)', ko: '문서 과제(리포트·답안 등)' },
    kindExcel: { ja: 'Excelの課題(表計算)', en: 'Excel assignment (spreadsheet)', ko: '엑셀 과제(스프레드시트)' },
    creating: { ja: '作成中…', en: 'Creating…', ko: '작성 중…' },
    submit: { ja: 'AIに課題を完成させてもらう', en: 'Ask the AI to complete the assignment', ko: 'AI에게 과제 완성 요청하기' },
    empty: { ja: 'まだ生成した課題はありません。上のフォームから依頼してください。', en: 'No assignments generated yet — request one using the form above.', ko: '아직 생성된 과제가 없습니다. 위 양식에서 요청해 주세요.' },
    tagExcel: { ja: 'Excel', en: 'Excel', ko: 'Excel' },
    tagText: { ja: '文章', en: 'Text', ko: '문서' },
    downloadMarkdown: { ja: 'Markdownでダウンロード', en: 'Download as Markdown', ko: 'Markdown으로 다운로드' },
  },

  taskReminders: {
    placeholder: { ja: '例: 経済学のレポート(3000字)を書く', en: 'e.g. Write a 3,000-word economics report', ko: '예: 경제학 리포트(3000자) 작성하기' },
    deadlineLabel: { ja: '締切(任意)', en: 'Deadline (optional)', ko: '마감일(선택)' },
    estimating: { ja: '見積もり中…', en: 'Estimating…', ko: '추정 중…' },
    submit: { ja: 'AIに見積もってもらう', en: 'Ask the AI to estimate', ko: 'AI에게 추정 요청하기' },
    empty: { ja: 'まだタスクがありません。上のフォームから追加してください。', en: 'No tasks yet — add one using the form above.', ko: '아직 작업이 없습니다. 위 양식에서 추가해 주세요.' },
    durationEstimate: { ja: '所要時間の目安: 約{duration}', en: 'Estimated time: about {duration}', ko: '예상 소요 시간: 약 {duration}' },
    deadlineLine: { ja: ' ・ 締切: {date}', en: ' · Deadline: {date}', ko: ' · 마감: {date}' },
    remindLine: { ja: '・ リマインド予定: {date}', en: '· Reminder scheduled: {date}', ko: '· 알림 예정: {date}' },
    markPending: { ja: '未完了に戻す', en: 'Mark as not done', ko: '미완료로 되돌리기' },
    markDone: { ja: '完了にする', en: 'Mark as done', ko: '완료로 표시' },
    deleteAria: { ja: 'タスクを削除', en: 'Delete task', ko: '작업 삭제' },
  },

  admin: {
    loadFailed: { ja: '読み込みに失敗しました。', en: 'Failed to load.', ko: '불러오기에 실패했습니다.' },
    loginHistory: { ja: 'ログイン履歴', en: 'Login history', ko: '로그인 기록' },
    countSuffix: { ja: '{count}件', en: '{count}', ko: '{count}건' },
    searchPlaceholder: { ja: 'ユーザーID・メールアドレスで検索', en: 'Search by user ID or email', ko: '사용자 ID·이메일로 검색' },
    search: { ja: '検索', en: 'Search', ko: '검색' },
    colDate: { ja: '日時', en: 'Date/time', ko: '일시' },
    colType: { ja: '種別', en: 'Type', ko: '유형' },
    colSubject: { ja: '対象', en: 'Subject', ko: '대상' },
    colEmail: { ja: 'メールアドレス', en: 'Email', ko: '이메일' },
    colDetail: { ja: '詳細', en: 'Detail', ko: '상세' },
    colIp: { ja: 'IPアドレス', en: 'IP address', ko: 'IP 주소' },
    colUserAgent: { ja: 'User-Agent', en: 'User-Agent', ko: 'User-Agent' },
    noRecords: { ja: 'まだ記録がありません。', en: 'No records yet.', ko: '아직 기록이 없습니다.' },
    prevPage: { ja: '← 前へ', en: '← Previous', ko: '← 이전' },
    nextPage: { ja: '次へ →', en: 'Next →', ko: '다음 →' },
    pageRange: { ja: '{from}〜{to} / {total}件', en: '{from}-{to} of {total}', ko: '{from}~{to} / {total}건' },
    refresh: { ja: '更新', en: 'Refresh', ko: '새로고침' },
    backToApp: { ja: 'アプリに戻る', en: 'Back to app', ko: '앱으로 돌아가기' },
    logout: { ja: 'ログアウト', en: 'Log out', ko: '로그아웃' },
    tabOverview: { ja: '概要', en: 'Overview', ko: '개요' },
    tabLogins: { ja: 'ログイン履歴', en: 'Login history', ko: '로그인 기록' },
    noPermission: { ja: 'このアカウントには管理者権限がありません。', en: 'This account does not have admin privileges.', ko: '이 계정에는 관리자 권한이 없습니다.' },
    loading: { ja: '読み込み中…', en: 'Loading…', ko: '불러오는 중…' },
    totalUsers: { ja: '総ユーザー数', en: 'Total users', ko: '총 사용자 수' },
    totalUsersSub: { ja: '直近7日 +{d7}人 / 直近30日 +{d30}人', en: '+{d7} in last 7 days / +{d30} in last 30 days', ko: '최근 7일 +{d7}명 / 최근 30일 +{d30}명' },
    activeUsers24h: { ja: 'アクティブユーザー(24時間)', en: 'Active users (24h)', ko: '활성 사용자(24시간)' },
    activeUsers24hSub: { ja: '直近7日では{n}人', en: '{n} in the last 7 days', ko: '최근 7일간 {n}명' },
    payingUsers: { ja: '有料ユーザー', en: 'Paying users', ko: '유료 사용자' },
    payingUsersSub: { ja: 'Pro {pro}人 / Max {max}人 / Free {free}人', en: 'Pro {pro} / Max {max} / Free {free}', ko: 'Pro {pro}명 / Max {max}명 / Free {free}명' },
    tokensThisPeriod: { ja: '今期のトークン利用量(全ユーザー合計)', en: "This period's token usage (all users)", ko: '이번 기간 토큰 사용량(전체 사용자 합계)' },
    tokensThisPeriodSub: { ja: 'ユーザーごとに月初(UTC)でロールオーバー', en: 'Rolls over monthly (UTC) per user', ko: '사용자별로 매월 초(UTC)에 초기화' },
    totalGenerations: { ja: '生成件数(累計)', en: 'Total generations', ko: '누적 생성 건수' },
    totalGenerationsSub: { ja: '直近7日 {d7}件 / 直近30日 {d30}件', en: '{d7} in last 7 days / {d30} in last 30 days', ko: '최근 7일 {d7}건 / 최근 30일 {d30}건' },
    recentSecurityEvents: { ja: '直近のセキュリティイベント', en: 'Recent security events', ko: '최근 보안 이벤트' },
    seeAll: { ja: 'すべて見る →', en: 'See all →', ko: '전체 보기 →' },
    lastUpdated: { ja: '最終更新: {date}', en: 'Last updated: {date}', ko: '마지막 업데이트: {date}' },
    tabPrompts: { ja: 'プロンプト分析', en: 'Prompt analytics', ko: '프롬프트 분석' },
    promptsByFeature: { ja: '機能別の利用件数', en: 'Usage by feature', ko: '기능별 이용 건수' },
    promptsTopFields: { ja: 'よく使われる分野(論文アウトライン)', en: 'Common fields (paper outline)', ko: '자주 쓰는 분야(논문 개요)' },
    promptsTopKeywords: { ja: '頻出キーワード', en: 'Frequent keywords', ko: '빈출 키워드' },
    promptsList: { ja: 'プロンプト一覧', en: 'Prompt list', ko: '프롬프트 목록' },
    promptsFilterAllModes: { ja: 'すべての機能', en: 'All features', ko: '모든 기능' },
    promptsSearchPlaceholder: { ja: 'ユーザーID・メールアドレス・内容で検索', en: 'Search by user ID, email, or content', ko: '사용자 ID·이메일·내용으로 검색' },
    colFeature: { ja: '機能', en: 'Feature', ko: '기능' },
    colPrompt: { ja: 'プロンプト', en: 'Prompt', ko: '프롬프트' },
    viewDetail: { ja: '詳細を見る', en: 'View detail', ko: '상세 보기' },
    hideDetail: { ja: '閉じる', en: 'Close', ko: '닫기' },
    detailLoadFailed: { ja: '詳細の読み込みに失敗しました。', en: 'Failed to load detail.', ko: '상세 정보를 불러오지 못했습니다.' },
    modeOutline: { ja: '論文アウトライン', en: 'Paper outline', ko: '논문 개요' },
    modeLogicGuide: { ja: '授業案内チャット', en: 'Course guide chat', ko: '수업 안내 챗' },
    modeAiAgents: { ja: 'AIエージェント', en: 'AI agents', ko: 'AI 에이전트' },
    modeTaskGenerator: { ja: '課題成果物生成', en: 'Assignment generator', ko: '과제 결과물 생성' },
    modeStudyNotes: { ja: 'レポート要点整理', en: 'Study notes', ko: '리포트 요점 정리' },
    modeTasks: { ja: 'タスク見積もり', en: 'Task estimation', ko: '작업 시간 추정' },
  },

  security: {
    title: { ja: 'セキュリティ設定', en: 'Security settings', ko: '보안 설정' },
    close: { ja: '閉じる', en: 'Close', ko: '닫기' },
    mfaTitle: { ja: '多要素認証(認証アプリ)', en: 'Multi-factor authentication (authenticator app)', ko: '다단계 인증(인증 앱)' },
    mfaOn: { ja: '✓ 有効になっています', en: '✓ Enabled', ko: '✓ 활성화되어 있습니다' },
    mfaDisablePlaceholder: { ja: '無効にするには現在の6桁コード', en: 'Enter the current 6-digit code to disable', ko: '비활성화하려면 현재 6자리 코드' },
    mfaDisableSubmit: { ja: '多要素認証を無効にする', en: 'Disable multi-factor authentication', ko: '다단계 인증 비활성화' },
    mfaPending: { ja: '設定途中です。もう一度シークレットを発行してください。', en: 'Setup is incomplete. Please generate a new secret.', ko: '설정이 진행 중입니다. 시크릿을 다시 발급해 주세요.' },
    mfaOff: { ja: '現在、無効です。', en: 'Currently disabled.', ko: '현재 비활성화되어 있습니다.' },
    mfaPreparing: { ja: '準備中…', en: 'Preparing…', ko: '준비 중…' },
    mfaSetupStart: { ja: '多要素認証を設定する', en: 'Set up multi-factor authentication', ko: '다단계 인증 설정' },
    mfaSetupInstructions: { ja: '認証アプリ(Google Authenticator等)で以下のキーを手動追加してください。', en: 'Manually add the key below in an authenticator app (e.g. Google Authenticator).', ko: '인증 앱(Google Authenticator 등)에 아래 키를 수동으로 추가해 주세요.' },
    otpauthUrlLabel: { ja: 'otpauth URL: {url}', en: 'otpauth URL: {url}', ko: 'otpauth URL: {url}' },
    mfaConfirmPlaceholder: { ja: '表示された6桁のコード', en: 'The 6-digit code shown', ko: '표시된 6자리 코드' },
    mfaConfirmSubmit: { ja: 'コードを確認して有効化', en: 'Verify code and enable', ko: '코드 확인 후 활성화' },
    sessionsTitle: { ja: 'セッション管理', en: 'Session management', ko: '세션 관리' },
    sessionsHint: {
      ja: '他の端末やブラウザでログインしたままの、心当たりのないセッションがある場合に使います。この端末は新しいトークンに切り替わり、ログインしたままになります。',
      en: 'Use this if you have unrecognized sessions still logged in on other devices or browsers. This device switches to a new token and stays logged in.',
      ko: '다른 기기나 브라우저에 로그인된 기억나지 않는 세션이 있을 때 사용합니다. 이 기기는 새 토큰으로 전환되어 로그인 상태가 유지됩니다.',
    },
    logoutAllSubmit: { ja: 'この端末以外を全てログアウトする', en: 'Log out all other devices', ko: '이 기기를 제외한 모든 기기 로그아웃' },
    eventsTitle: { ja: '直近のログイン・セキュリティイベント', en: 'Recent login & security events', ko: '최근 로그인·보안 이벤트' },
    noEvents: { ja: 'まだ記録がありません。', en: 'No records yet.', ko: '아직 기록이 없습니다.' },
    mfaEnabledMessage: { ja: '多要素認証を有効にしました。他の端末は安全のため全てログアウトされました。', en: 'Multi-factor authentication enabled. All other devices have been logged out for safety.', ko: '다단계 인증을 활성화했습니다. 안전을 위해 다른 모든 기기에서 로그아웃되었습니다.' },
    mfaDisabledMessage: { ja: '多要素認証を無効にしました。他の端末は安全のため全てログアウトされました。', en: 'Multi-factor authentication disabled. All other devices have been logged out for safety.', ko: '다단계 인증을 비활성화했습니다. 안전을 위해 다른 모든 기기에서 로그아웃되었습니다.' },
    logoutAllMessage: { ja: 'この端末を除く、全てのログイン中の端末からログアウトしました。', en: 'Logged out of all other logged-in devices except this one.', ko: '이 기기를 제외한 로그인된 모든 기기에서 로그아웃했습니다.' },
    eventLoginSuccess: { ja: 'ログイン成功', en: 'Login succeeded', ko: '로그인 성공' },
    eventLoginFailed: { ja: 'ログイン失敗', en: 'Login failed', ko: '로그인 실패' },
    eventLoginLocked: { ja: 'アカウント一時ロック', en: 'Account temporarily locked', ko: '계정 일시 잠금' },
    eventMfaEnabled: { ja: '多要素認証を有効化', en: 'Enabled multi-factor authentication', ko: '다단계 인증 활성화' },
    eventMfaDisabled: { ja: '多要素認証を無効化', en: 'Disabled multi-factor authentication', ko: '다단계 인증 비활성화' },
    eventMfaFailed: { ja: '認証アプリのコード不一致', en: 'Authenticator app code mismatch', ko: '인증 앱 코드 불일치' },
    eventMfaConfirmFailed: { ja: '認証アプリの登録確認に失敗', en: 'Failed to confirm authenticator app registration', ko: '인증 앱 등록 확인 실패' },
    eventMfaDisableFailed: { ja: '無効化時のコード不一致', en: 'Code mismatch when disabling', ko: '비활성화 시 코드 불일치' },
    eventLogoutAll: { ja: '全端末からログアウト', en: 'Logged out of all devices', ko: '모든 기기에서 로그아웃' },
    filterAllTypes: { ja: 'すべての種別', en: 'All types', ko: '모든 유형' },
  },

  aiAgents: {
    levelBeginner: { ja: '初学者', en: 'Beginner', ko: '초급자' },
    levelIntermediate: { ja: '中級者', en: 'Intermediate', ko: '중급자' },
    levelAdvanced: { ja: '上級者', en: 'Advanced', ko: '고급자' },
    roleStudent: { ja: '学生', en: 'Student', ko: '학생' },
    roleEmployee: { ja: '会社員', en: 'Employee', ko: '회사원' },
    roleExecutive: { ja: '経営者', en: 'Executive', ko: '경영자' },
    roleFounder: { ja: '起業家', en: 'Founder', ko: '창업가' },
    roleInvestor: { ja: '投資家', en: 'Investor', ko: '투자자' },
    roleResearcher: { ja: '研究者', en: 'Researcher', ko: '연구자' },
    roleOther: { ja: 'その他', en: 'Other', ko: '기타' },
    purposeEconomicsStudy: { ja: '経済の勉強', en: 'Studying economics', ko: '경제 공부' },
    purposeDailyNews: { ja: '毎日のニュース把握', en: 'Keeping up with daily news', ko: '매일 뉴스 파악' },
    purposeStockInvesting: { ja: '株式投資', en: 'Stock investing', ko: '주식 투자' },
    purposeBusinessManagement: { ja: '起業・経営判断', en: 'Startup/business decisions', ko: '창업·경영 판단' },
    purposeMarketAnalysis: { ja: '金融市場の分析', en: 'Financial market analysis', ko: '금융시장 분석' },
    purposeGeopolitics: { ja: '世界情勢の把握', en: 'Following world affairs', ko: '세계 정세 파악' },
    purposeNone: { ja: '指定しない', en: 'Not specified', ko: '지정하지 않음' },
    categoryEconomics: { ja: 'Economics(経済)', en: 'Economics', ko: 'Economics(경제)' },
    categoryFinance: { ja: 'Finance(金融)', en: 'Finance', ko: 'Finance(금융)' },
    regionJapan: { ja: '日本', en: 'Japan', ko: '일본' },
    regionUs: { ja: 'アメリカ', en: 'United States', ko: '미국' },
    regionWorld: { ja: '世界', en: 'World', ko: '세계' },
    regionJapanStocks: { ja: '日本株', en: 'Japanese stocks', ko: '일본 주식' },
    regionUsStocks: { ja: '米国株', en: 'US stocks', ko: '미국 주식' },
    questionLevel: { ja: '経済・金融についての知識レベルを教えてください', en: 'What’s your knowledge level in economics & finance?', ko: '경제·금융에 대한 지식 수준을 알려주세요' },
    questionRole: { ja: 'あなたの立場・属性を教えてください', en: 'What’s your role or background?', ko: '당신의 입장·속성을 알려주세요' },
    questionPurpose: { ja: '主な利用目的を教えてください(任意)', en: 'What’s your main purpose for using this? (optional)', ko: '주요 이용 목적을 알려주세요(선택)' },
    questionCategories: { ja: 'Economics(経済)とFinance(金融)、どちらの状況を見ますか?(両方も選べます)', en: 'Which would you like to see — Economics, Finance, or both?', ko: 'Economics(경제)와 Finance(금융) 중 어느 쪽을 보시겠어요?(둘 다 선택 가능)' },
    questionRegionFinance: { ja: '見たい市場を選んでください(Finance)', en: 'Choose the market you want to follow (Finance)', ko: '보고 싶은 시장을 선택하세요(Finance)' },
    questionRegionEconomics: { ja: '見たい地域を選んでください(Economics)', en: 'Choose the region you want to follow (Economics)', ko: '보고 싶은 지역을 선택하세요(Economics)' },
    progress: { ja: '質問 {current} / {total}', en: 'Question {current} / {total}', ko: '질문 {current} / {total}' },
    next: { ja: '次へ →', en: 'Next →', ko: '다음 →' },
    startOver: { ja: '↺ 最初からやり直す', en: '↺ Start over', ko: '↺ 처음부터 다시' },
    changeTarget: { ja: '↺ 対象を変更', en: '↺ Change selection', ko: '↺ 대상 변경' },
    reminderQuestion: {
      ja: '毎朝9時にリマインドしますか?その時に、その日の最新ニュースをお届けします。',
      en: 'Would you like a reminder every morning at 9am? We’ll deliver that day’s latest news at that time.',
      ko: '매일 아침 9시에 알림을 받으시겠어요? 그때 그날의 최신 뉴스를 보내드립니다.',
    },
    reminderYes: { ja: 'はい、リマインドする', en: 'Yes, remind me', ko: '네, 알림 받을게요' },
    reminderNo: { ja: 'いいえ', en: 'No', ko: '아니요' },
    reminderEnabled: { ja: '毎朝9時に、その日の最新ニュースをメールでお届けします。', en: 'We’ll email you that day’s latest news every morning at 9am.', ko: '매일 아침 9시에 그날의 최신 뉴스를 이메일로 보내드립니다.' },
    defaultQuestion: { ja: '現在の状況を教えて', en: 'Tell me about the current situation', ko: '현재 상황을 알려줘' },
    inputPlaceholderReady: { ja: '例: 現在の状況を教えて', en: 'e.g. Tell me about the current situation', ko: '예: 현재 상황을 알려줘' },
    inputPlaceholderNotReady: { ja: '上の質問に答えると入力できます', en: 'Answer the question above to start typing', ko: '위 질문에 답하면 입력할 수 있습니다' },
  },

  studyNotes: {
    missingInput: {
      ja: 'レポート・資料のテキストを貼り付けるか、ファイルを添付してください',
      en: 'Please paste report/material text or attach a file',
      ko: '리포트·자료 텍스트를 붙여넣거나 파일을 첨부해 주세요',
    },
    textPlaceholder: { ja: 'レポート・資料の本文をここに貼り付け(またはファイルを添付)', en: 'Paste the report/material text here (or attach a file)', ko: '리포트·자료 본문을 여기에 붙여넣기(또는 파일 첨부)' },
    attachFile: { ja: '⊕ ファイルを添付', en: '⊕ Attach a file', ko: '⊕ 파일 첨부' },
    removeAttachmentAria: { ja: '{name}を添付から削除', en: 'Remove {name} from attachments', ko: '첨부에서 {name} 삭제' },
    focusPlaceholder: { ja: '重視したい観点(任意、例: 試験に出そうな数値や定義)', en: 'What to focus on (optional, e.g. numbers/definitions likely on the exam)', ko: '중점을 두고 싶은 관점(선택, 예: 시험에 나올 만한 수치나 정의)' },
    analyzing: { ja: '分析中…', en: 'Analyzing…', ko: '분석 중…' },
    submit: { ja: '要点を整理してもらう', en: 'Have the AI organize the key points', ko: '핵심 정리 요청하기' },
    empty: {
      ja: 'まだ整理した資料はありません。レポートの本文を貼り付けるかファイルを添付して送信してください。',
      en: 'No organized material yet — paste report text or attach a file and send.',
      ko: '아직 정리된 자료가 없습니다. 리포트 본문을 붙여넣거나 파일을 첨부하여 전송해 주세요.',
    },
  },

  modes: {
    outlineShort: { ja: 'テーマ・参考資料・フォーマット指定を送ると、調査アウトラインと関連文献を生成します', en: 'Send a topic, references and format, and get a research outline with related literature', ko: '주제·참고자료·형식을 보내면 연구 개요와 관련 문헌을 생성합니다' },
    logicGuideShort: { ja: '大学・学部・学科を選んで、気になる授業内容をAIに質問できます', en: 'Pick a university/faculty and ask the AI about course content', ko: '대학·학부·학과를 선택하고 궁금한 수업 내용을 AI에게 물어보세요' },
    taskGeneratorShort: { ja: '課題の内容を送ると、AIが文章やExcelの表など、実際に提出できる成果物を作成します', en: 'Send an assignment and the AI creates a submittable deliverable (text or Excel)', ko: '과제 내용을 보내면 AI가 문서나 엑셀 표 등 제출 가능한 결과물을 만들어 줍니다' },
    taskRemindersShort: { ja: 'タスク内容を送ると、AIが所要時間を見積もり、頃合いにメールでリマインドします', en: 'Send a task and the AI estimates the time needed and emails you a reminder', ko: '작업 내용을 보내면 AI가 소요 시간을 추정하고 적절한 때 이메일로 알려줍니다' },
    studyNotesShort: { ja: 'レポート・資料を貼り付けるか添付すると、暗記すべき要点と全体の流れを整理します', en: 'Paste or attach a report/material to get the key points and overall flow organized', ko: '리포트·자료를 붙여넣거나 첨부하면 외워야 할 핵심과 전체 흐름을 정리해 줍니다' },
    aiAgentsShort: { ja: 'あなたの知識レベル・立場に合わせて、経済(Economics)・金融(Finance)の状況をAIが解説します', en: 'The AI explains the state of Economics & Finance, tailored to your knowledge level and role', ko: '지식 수준과 입장에 맞춰 AI가 경제(Economics)·금융(Finance) 상황을 설명해 드립니다' },
  },
}

const LanguageContext = createContext({ lang: DEFAULT_LANGUAGE, setLang: () => {}, t: (key) => key })

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(getInitialLanguage)

  const setLang = useCallback((next) => {
    if (!LANGUAGE_CODES.includes(next)) return
    setLangState(next)
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next)
    } catch {
      // 保存に失敗しても、このセッション内の切り替え自体は継続させる
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const t = useCallback(
    (key, vars) => {
      const parts = key.split('.')
      let node = translations
      for (const part of parts) {
        node = node?.[part]
      }
      if (!node) return key
      let text = node[lang] || node[DEFAULT_LANGUAGE] || key
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          text = text.replaceAll(`{${k}}`, v)
        }
      }
      return text
    },
    [lang]
  )

  return <LanguageContext.Provider value={{ lang, setLang, t }}>{children}</LanguageContext.Provider>
}

export function useLanguage() {
  return useContext(LanguageContext)
}

// LanguageProviderの外(コンポーネントツリー外)からでも、直近の言語でAI呼び出し用の
// 表示名を引けるようにするヘルパー。localStorageを直接見るので再レンダリングには連動しない。
export function getStoredLanguage() {
  return getInitialLanguage()
}
