/*!
 * Krasis splash — ニューラルネットワーク投影の起動演出 (krasis.xyz の site/index.html から抽出)
 *
 * 使い方(どのアプリでも同じ):
 *   <link rel="stylesheet" href="krasis-splash.css">   ← CSPが厳しいアプリでは必須。それ以外は省略可(自動挿入)
 *   <script src="krasis-splash.js"></script>
 *   <script>KrasisSplash.play();</script>
 *
 * オプション(すべて省略可):
 *   KrasisSplash.play({
 *     title: 'KRASIS',            // 中央のロゴ文字
 *     tagline: 'THINK BEYOND.',   // その下の一行
 *     duration: 2.6,              // 秒。描画のタイミングはこの長さに合わせて伸縮する
 *     force: false,               // true なら prefers-reduced-motion でも再生する
 *     skippable: true,            // クリック/キー入力で飛ばせる
 *     showLog: true,              // 左下の "> load model graph" ログ
 *     onDone: () => {},           // 消え終わったときに呼ばれる
 *   });
 *   KrasisSplash.skip();          // 外から即座に終了させる
 *
 * ES Modules から使う場合は `import './krasis-splash.js'` のあと window.KrasisSplash を使う。
 */
(function (global) {
  'use strict';

  var GOLD = [230, 171, 132];
  var STYLE_ID = 'krasis-splash-style';
  var ROOT_ID = 'nn-splash';

  // krasis-splash.css と同じ内容。<link> で読み込み済みなら挿入しない(CSP対策)。
  var CSS = [
    ':root{--ks-void:#08090b;--ks-ink-2:#8f9296;--ks-gold:#e6ab84;--ks-font-mono:"IBM Plex Mono",ui-monospace,"SFMono-Regular",Menlo,monospace}',
    '#nn-splash{position:fixed;inset:0;z-index:2147483000;background:var(--ks-void);display:grid;place-items:center;transition:opacity .5s cubic-bezier(.4,0,.2,1),visibility .5s;cursor:pointer}',
    '#nn-splash.done{opacity:0;visibility:hidden;pointer-events:none}',
    '#nn-splash[hidden]{display:none!important}',
    '#nn-splash canvas{position:absolute;inset:0;width:100%;height:100%}',
    '.nn-logo{position:relative;isolation:isolate;text-align:center;pointer-events:none;padding:48px 72px}',
    '.nn-logo::before{content:"";position:absolute;inset:-20px;z-index:-1;background:radial-gradient(closest-side,rgba(8,9,11,.96) 55%,rgba(8,9,11,0));opacity:0;transition:opacity .6s}',
    '#nn-splash.logo .nn-logo::before{opacity:1}',
    '.nn-logo b{display:block;font:500 clamp(26px,5vw,44px)/1 var(--ks-font-mono);letter-spacing:.5em;margin-right:-.5em;color:#fff;text-shadow:0 0 24px rgba(230,171,132,.35);opacity:0;transition:opacity 1s cubic-bezier(.3,0,.2,1),letter-spacing 1s cubic-bezier(.3,0,.2,1),margin 1s cubic-bezier(.3,0,.2,1)}',
    '.nn-mk{width:34px;height:34px;color:#fff;display:block;margin:0 auto 18px;opacity:0;transition:opacity .8s}',
    '#nn-splash.logo .nn-mk{opacity:1}',
    '.nn-logo span{display:block;margin-top:1em;font:400 clamp(11px,1.3vw,13px)/1 var(--ks-font-mono);letter-spacing:.32em;color:var(--ks-gold);opacity:0;transition:opacity 1s .2s}',
    '#nn-splash.logo .nn-logo b{opacity:1;letter-spacing:.28em;margin-right:-.28em}',
    '#nn-splash.logo .nn-logo span{opacity:1}',
    '.nn-skip{position:absolute;right:20px;bottom:calc(18px + env(safe-area-inset-bottom,0px));font:400 11px/1 var(--ks-font-mono);color:var(--ks-ink-2);letter-spacing:.08em}',
    '.nn-log{position:absolute;left:20px;bottom:calc(18px + env(safe-area-inset-bottom,0px));font:400 11px/1.6 var(--ks-font-mono);color:var(--ks-ink-2);white-space:pre}'
  ].join('\n');

  // ニューロンのマーク(2入力→1出力)
  var MARK_SVG =
    '<svg class="nn-mk" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
    '<path d="M5 5.5 L18.5 12 M5 18.5 L18.5 12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="5" cy="5.5" r="2.4" stroke="currentColor" stroke-width="1.6"/>' +
    '<circle cx="5" cy="18.5" r="2.4" stroke="currentColor" stroke-width="1.6"/>' +
    '<circle cx="18.5" cy="12" r="3.3" fill="#e6ab84"/></svg>';

  function cssAlreadyLoaded() {
    if (document.getElementById(STYLE_ID)) return true;
    var probe = document.createElement('div');
    probe.className = 'nn-skip';
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.appendChild(probe);
    var loaded = getComputedStyle(probe).letterSpacing !== 'normal';
    probe.remove();
    return loaded;
  }

  function ensureStyle() {
    if (cssAlreadyLoaded()) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  function ensureRoot(opts) {
    var root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      root.setAttribute('aria-hidden', 'true');
      root.innerHTML =
        '<canvas></canvas>' +
        '<div class="nn-logo">' + MARK_SVG + '<b></b><span></span></div>' +
        '<div class="nn-log"></div>' +
        '<div class="nn-skip">click to skip</div>';
      document.body.appendChild(root);
    }
    root.querySelector('.nn-logo b').textContent = opts.title;
    root.querySelector('.nn-logo span').textContent = opts.tagline;
    root.querySelector('.nn-skip').hidden = !opts.skippable;
    root.querySelector('.nn-log').hidden = !opts.showLog;
    return root;
  }

  // ---- ネットワーク構造(層サイズと重み)を作る ----
  function buildNet(w, h, layers, pad) {
    var nodes = [], edges = [];
    var xs = layers.map(function (_, i) { return pad.l + (w - pad.l - pad.r) * i / (layers.length - 1); });
    layers.forEach(function (n, li) {
      var span = Math.min(h - pad.t - pad.b, n * 46);
      var top = (h - span) / 2;
      var col = [];
      for (var k = 0; k < n; k++) col.push({ x: xs[li], y: n === 1 ? h / 2 : top + span * k / (n - 1), l: li });
      nodes.push(col);
    });
    for (var li = 0; li < layers.length - 1; li++) {
      nodes[li].forEach(function (a) {
        nodes[li + 1].forEach(function (b) { edges.push({ a: a, b: b, l: a.l, w: Math.pow(Math.random(), 2.2) }); });
      });
    }
    return { nodes: nodes, edges: edges, xs: xs };
  }
  function pickPath(net) {
    return net.nodes.map(function (col) { return col[(Math.random() * col.length) | 0]; });
  }
  function sizeCanvas(c) {
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    var r = c.getBoundingClientRect();
    c.width = Math.max(1, r.width * dpr); c.height = Math.max(1, r.height * dpr);
    var ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: r.width, h: r.height };
  }
  function clamp(v) { return Math.max(0, Math.min(1, v)); }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  function drawPulse(ctx, path, p, alpha) {
    // pathに沿って進む光。白→金のグラデーションの尾を引く
    p = clamp(p);
    var segs = path.length - 1, pos = p * segs;
    var i = Math.min(segs - 1, Math.floor(pos)), f = pos - i;
    var a = path[i], b = path[i + 1];
    var x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
    var t0 = Math.max(0, f - 0.22);
    var tx = a.x + (b.x - a.x) * t0, ty = a.y + (b.y - a.y) * t0;
    var g = ctx.createLinearGradient(tx, ty, x, y);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, 'rgba(255,255,255,' + (0.8 * alpha) + ')');
    g.addColorStop(1, 'rgba(' + GOLD + ',' + alpha + ')');
    ctx.strokeStyle = g; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke();
    ctx.fillStyle = 'rgba(' + GOLD + ',' + alpha + ')';
    ctx.shadowColor = 'rgba(' + GOLD + ',.8)'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  var current = null; // 再生中の演出(skip用)

  function play(options) {
    var opts = Object.assign({
      title: 'KRASIS', tagline: 'THINK BEYOND.', duration: 2.6,
      force: false, skippable: true, showLog: true, onDone: null
    }, options || {});

    // <head> の中で呼ばれた場合は、body ができてから再生する
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', function () { play(options); }, { once: true });
      return;
    }
    if (current) current.end(true);
    var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce && !opts.force) { if (opts.onDone) opts.onDone(); return; }

    ensureStyle();
    var splash = ensureRoot(opts);
    var logEl = splash.querySelector('.nn-log');
    splash.hidden = false;
    splash.classList.remove('done', 'logo');
    logEl.textContent = '';

    // 元の演出は2.6秒基準。duration に合わせて時間軸を伸縮する。
    var S = opts.duration / 2.6;
    var finished = false, timer = null;

    function end(immediate) {
      if (finished) return; finished = true;
      clearTimeout(timer);
      splash.removeEventListener('click', onSkip);
      global.removeEventListener('keydown', onSkip);
      splash.classList.add('done');
      current = null;
      var done = function () { splash.hidden = true; if (opts.onDone) opts.onDone(); };
      if (immediate) done(); else setTimeout(done, 600);
    }
    function onSkip() { end(false); }

    var size = sizeCanvas(splash.querySelector('canvas'));
    var ctx = size.ctx, w = size.w, h = size.h;
    var small = w < 640;
    var layers = small ? [4, 7, 7, 6, 3] : [6, 10, 10, 8, 4];
    var labels = ['input \u00b7 embed', 'attention', 'hidden', 'hidden', 'output'];
    var net = buildNet(w, h, layers, { l: w * (small ? 0.1 : 0.14), r: w * (small ? 0.1 : 0.14), t: h * 0.2, b: h * 0.24 });
    var pulses = Array.from({ length: small ? 10 : 18 }, function (_, i) {
      return { path: pickPath(net), d: 0.9 + i * 0.05 + Math.random() * 0.15 };
    });
    var logLines = ['> load model graph', '> layers: ' + layers.join('-'), '> forward pass', '> ready'];
    var T0 = performance.now();

    function frame(now) {
      if (finished) return;
      var t = (now - T0) / 1000 / S; // 2.6秒基準の時間
      ctx.clearRect(0, 0, w, h);
      var fade = 1 - clamp((t - 2.0) / 0.5);
      // edges
      net.edges.forEach(function (e) {
        var k = ease(clamp((t - 0.35 - e.l * 0.16) / 0.45));
        if (k <= 0) return;
        var x = e.a.x + (e.b.x - e.a.x) * k, y = e.a.y + (e.b.y - e.a.y) * k;
        ctx.strokeStyle = 'rgba(255,255,255,' + ((0.04 + e.w * 0.22) * fade) + ')';
        ctx.lineWidth = 0.6 + e.w * 0.6;
        ctx.beginPath(); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(x, y); ctx.stroke();
      });
      // nodes + labels
      net.nodes.forEach(function (col, li) {
        var k = ease(clamp((t - li * 0.12) / 0.35));
        if (k <= 0) return;
        col.forEach(function (n) {
          ctx.fillStyle = 'rgba(8,9,11,1)';
          ctx.beginPath(); ctx.arc(n.x, n.y, 4.2 * k, 0, Math.PI * 2); ctx.fill();
          ctx.strokeStyle = 'rgba(237,235,230,' + (0.85 * k * fade) + ')'; ctx.lineWidth = 1.1;
          ctx.stroke();
        });
        var last = col[col.length - 1];
        ctx.fillStyle = 'rgba(143,146,150,' + (k * fade) + ')';
        ctx.font = '400 10.5px "IBM Plex Mono", ui-monospace, monospace';
        ctx.textAlign = 'center';
        if (!small || li % 2 === 0) ctx.fillText(labels[li], last.x, last.y + 26);
        ctx.fillText('[' + col.length + ']', col[0].x, col[0].y - 16);
      });
      // pulses
      pulses.forEach(function (p) {
        var k = (t - p.d) / 0.75;
        if (k > 0 && k < 1) drawPulse(ctx, p.path, ease(k), fade);
      });
      // 出力層の点灯
      if (t > 1.6) {
        var g = clamp((t - 1.6) / 0.3) * fade;
        net.nodes[net.nodes.length - 1].forEach(function (n) {
          ctx.fillStyle = 'rgba(' + GOLD + ',' + g + ')';
          ctx.beginPath(); ctx.arc(n.x, n.y, 3, 0, Math.PI * 2); ctx.fill();
        });
      }
      logEl.textContent = logLines.slice(0, Math.min(logLines.length, 1 + Math.floor(t / 0.5))).join('\n');
      if (t > 1.45) splash.classList.add('logo');
      if (t >= 2.6) { end(false); return; }
      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
    if (opts.skippable) {
      splash.addEventListener('click', onSkip);
      global.addEventListener('keydown', onSkip, { once: true });
    }
    timer = setTimeout(onSkip, (opts.duration + 1.4) * 1000); // 念のための保険
    current = { end: end };
  }

  function skip() { if (current) current.end(false); }

  global.KrasisSplash = { play: play, skip: skip, version: '1.0.0' };
})(typeof window !== 'undefined' ? window : this);
