// iOSアプリ(Capacitor)内のサブスク購入。アプリストアの規約上、iOSアプリ内では
// Stripeの決済ページへ誘導せず、Appleのアプリ内課金(RevenueCat経由)で購入させる。
// WebViewにはCapacitorのネイティブブリッジが注入されるため、プラグイン(Purchases)は
// window.Capacitor.Plugins から使う(Web版・デスクトップ版では常に無効)。

const IOS_API_KEY = import.meta.env.VITE_REVENUECAT_IOS_API_KEY

export const SUBSCRIPTIONS_URL = 'https://apps.apple.com/account/subscriptions'

// アプリ内課金の商品IDに対応するプラン。App Store Connectの商品ID(サーバーの
// REVENUECAT_PRODUCT_PLANSと同じ対応)と、RevenueCatのOfferingのパッケージ種別で引く。
const PLAN_PACKAGE_IDENTIFIERS = { pro: '$rc_pro', max: '$rc_max' }

function getCapacitor() {
  return typeof window === 'undefined' ? undefined : window.Capacitor
}

// iOS/Androidのネイティブアプリ(Capacitor)内かどうか
export function isNativeApp() {
  try {
    return Boolean(getCapacitor()?.isNativePlatform?.())
  } catch {
    return false
  }
}

export function isIosNativeApp() {
  const cap = getCapacitor()
  try {
    return Boolean(cap?.isNativePlatform?.() && cap.getPlatform?.() === 'ios')
  } catch {
    return false
  }
}

// iOSアプリ内でアプリ内課金が使える状態(公開SDKキーが設定済み)か
export function isIapAvailable() {
  return isIosNativeApp() && Boolean(IOS_API_KEY) && Boolean(getCapacitor()?.Plugins?.Purchases)
}

let configuredFor = null

async function ensureConfigured(userId) {
  const Purchases = getCapacitor().Plugins.Purchases
  if (configuredFor === null) {
    await Purchases.configure({ apiKey: IOS_API_KEY, appUserID: userId })
  } else if (configuredFor !== userId) {
    await Purchases.logIn({ appUserID: userId })
  }
  configuredFor = userId
  return Purchases
}

// planの購入を開始する。成功するとApple→RevenueCat→サーバーのWebhookでプランが更新される。
// ユーザーがキャンセルした場合はfalseを返す。
export async function purchasePlan(plan, userId) {
  const Purchases = await ensureConfigured(userId)
  const { current } = await Purchases.getOfferings()
  const identifier = PLAN_PACKAGE_IDENTIFIERS[plan]
  const aPackage = current?.availablePackages?.find((p) => p.identifier === identifier)
  if (!aPackage) throw new Error(`purchase package not found: ${plan}`)
  try {
    await Purchases.purchasePackage({ aPackage })
    return true
  } catch (err) {
    if (err?.userCancelled) return false
    throw err
  }
}

// 購入済みの契約を復元する(機種変更・再インストール後。アプリストアの審査で必須)。
export async function restorePurchases(userId) {
  const Purchases = await ensureConfigured(userId)
  await Purchases.restorePurchases()
}
