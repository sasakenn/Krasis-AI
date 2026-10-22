// iOSアプリ内の「Appleでサインイン」。ネイティブのSign in with Appleでidentity tokenを取得し、
// サーバーの /auth/apple で検証してもらう。トークンのaudはアプリのBundle IDになるため、
// サーバーのAPPLE_CLIENT_IDにBundle ID(com.thynora.app)を含めておくこと。
// Web版・デスクトップ版・Androidでは使わない(プラグインはiOSアプリにだけ入っている)。
import { isIosNativeApp } from './iap'

const APP_BUNDLE_ID = 'com.thynora.app'

function getPlugin() {
  return typeof window === 'undefined' ? undefined : window.Capacitor?.Plugins?.SignInWithApple
}

export function isAppleSignInAvailable() {
  return isIosNativeApp() && Boolean(getPlugin())
}

// identity tokenを返す。ユーザーがキャンセルした場合はnull。
export async function requestAppleIdentityToken() {
  try {
    const result = await getPlugin().authorize({
      clientId: APP_BUNDLE_ID,
      redirectURI: window.location.origin,
      scopes: 'email name',
    })
    return result?.response?.identityToken || null
  } catch (err) {
    // 1001 = ユーザーがシートを閉じた(ASAuthorizationError.canceled)
    if (String(err?.code) === '1001' || /cancel/i.test(String(err?.message))) return null
    throw err
  }
}
