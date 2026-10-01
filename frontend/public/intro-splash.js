// 起動演出を「固定1.75秒で消す」のではなく、(a)最低表示時間 と
// (b)アプリが実際にroot配下へ描画完了したこと の両方を待って消す。
// こうしないと、読み込みが遅い回線・端末では演出のほうが先に終わってしまい、
// 本体はまだ真っ白(スタイル未適用)のまま、というバグ("起動演出の後に
// 白塗りになる")が起きる。MAX_MSは、万一アプリの起動に失敗した場合でも
// 演出が消えないまま残り続けないための安全装置。
//
// index.htmlのインラインscriptだったが、CSPのscript-srcが'self'と明示オリジンのみを
// 許可し'unsafe-inline'を含まないため実行されず、起動演出が永久に残り続けるバグの原因に
// なっていた。'self'から読み込める外部ファイルに切り出すことで、CSPを緩めずに解決する。
//
// type="module"のスクリプト(main.jsx)はdocument parse後まで実行が
// 遅延されるので、このスクリプトを先に置いておけばMutationObserverの
// 登録がroot描画より必ず先に間に合う。
(function () {
  var splash = document.getElementById('intro-splash');
  var root = document.getElementById('root');
  if (!splash || !root) return;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MIN_MS = reduceMotion ? 150 : 1750;
  var MAX_MS = 6000;
  var minTimeElapsed = false;
  var appReady = false;
  var hidden = false;

  function hide() {
    if (hidden) return;
    hidden = true;
    splash.classList.add('intro-splash-hidden');
  }

  function tryHide() {
    if (minTimeElapsed && appReady) hide();
  }

  setTimeout(function () { minTimeElapsed = true; tryHide(); }, MIN_MS);
  setTimeout(hide, MAX_MS);

  var observer = new MutationObserver(function () {
    if (root.childElementCount > 0) {
      appReady = true;
      observer.disconnect();
      tryHide();
    }
  });
  observer.observe(root, { childList: true });
})();
