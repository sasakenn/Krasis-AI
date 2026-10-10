// デスクトップ版(Windows/Mac)の起動画面。main.cjs が、本体ウィンドウの読み込み中に
// この画面を別ウィンドウで出す。本体の読み込みが終わると main.cjs が window.thynoraReady() を
// 呼ぶので、それを待ってから演出を閉じ、タイトルを 'done' にして main.cjs に知らせる。
(function () {
  var markReady;
  var ready = new Promise(function (resolve) { markReady = resolve; });
  window.thynoraReady = function () { markReady(); };

  if (!window.KrasisSplash) { document.title = 'done'; return; }
  window.KrasisSplash.play({
    title: 'THYNORA',
    tagline: 'THINK BEYOND.',
    force: true,        // デスクトップの起動画面は常に出す(本体ウィンドウを隠している間の表示なので)
    skippable: false,
    until: ready,
    maxWait: 20000,     // 回線が遅くても、20秒たったら本体に切り替える
    onDone: function () { document.title = 'done'; },
  });
})();
