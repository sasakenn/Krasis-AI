// 起動演出(krasis-splash.js のニューラルネットワーク投影)を再生し、
// (a)演出が一通り終わること と (b)アプリが実際にroot配下へ描画完了したこと
// の両方を待ってから消す。こうしないと、読み込みが遅い回線・端末では演出のほうが
// 先に終わってしまい、本体はまだ真っ白(スタイル未適用)のまま、というバグ
// ("起動演出の後に白塗りになる")が起きる。maxWaitは、万一アプリの起動に失敗した
// 場合でも演出が消えないまま残り続けないための安全装置。
//
// index.htmlのインラインscriptだったが、CSPのscript-srcが'self'と明示オリジンのみを
// 許可し'unsafe-inline'を含まないため実行されず、起動演出が永久に残り続けるバグの原因に
// なっていた。'self'から読み込める外部ファイルに切り出すことで、CSPを緩めずに解決する。
//
// type="module"のスクリプト(main.jsx)はdocument parse後まで実行が
// 遅延されるので、このスクリプトを先に置いておけばMutationObserverの
// 登録がroot描画より必ず先に間に合う。
(function () {
  var splash = document.getElementById('nn-splash');
  var root = document.getElementById('root');
  if (!splash || !root) return;

  // 部品が読み込めなかった場合は、HTMLに置いた黒い枠が残り続けないよう即座に閉じる
  if (!window.KrasisSplash) {
    splash.hidden = true;
    return;
  }

  var rootReady = new Promise(function (resolve) {
    if (root.childElementCount > 0) { resolve(); return; }
    var observer = new MutationObserver(function () {
      if (root.childElementCount > 0) {
        observer.disconnect();
        resolve();
      }
    });
    observer.observe(root, { childList: true });
  });

  window.KrasisSplash.play({
    title: 'THYNORA',
    tagline: 'THINK BEYOND.',
    until: rootReady,
    maxWait: 6000,
  });
})();
