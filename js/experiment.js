/* ============================================================
   灯火の街リーザ（仮）— 問1 実験スライス（独立ページ）
   カードを「試す」と、その結果が実験ビューで物理現象として起きる。
   判定して正解を教えるのではなく、結果を見せて気づかせる。
   Three.js は vendor/ の r128(UMD)のみ。ビルド不要・直開きで動く。
   v2 本体（index.html / main.js / data.js / style.css）とは無関係。
   ============================================================ */
(function () {
  'use strict';

  if (!window.THREE) { console.error('THREE が読み込めていません'); return; }
  const T = window.THREE;
  const $ = id => document.getElementById(id);

  /* ---------- カード（このページ専用に自己完結） ---------- */
  const CARDS = {
    fire:  { label: '火', icon: '🔥' },
    water: { label: '水', icon: '💧' },
    pot:   { label: '鍋', icon: '🍲' },
    cloth: { label: '布', icon: '🧵' },
  };
  const HAND = ['fire', 'water', 'pot', 'cloth'];

  function sameSet(a, b) {
    if (a.length !== b.length) return false;
    const s = new Set(b);
    return a.every(x => s.has(x));
  }
  // 選んだ集合 → どの現象が起きるか
  function outcome(ids) {
    if (sameSet(ids, ['pot', 'water', 'fire'])) return 'boil';
    if (sameSet(ids, ['fire', 'water']))        return 'evaporate';
    if (sameSet(ids, ['cloth', 'water']))       return 'filter';
    return 'nothing';
  }

  /* ============================================================
     Three.js セットアップ（正面・記号的なオルソ表示）
     ============================================================ */
  const view = $('exp-view');
  const canvas = $('exp-canvas');
  const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new T.Scene();
  const HX = 5;                                  // 世界の横半幅（固定）
  const camera = new T.OrthographicCamera(-HX, HX, HX, -HX, -100, 100);
  camera.position.z = 10;

  const stage = new T.Group();                   // 現象ごとに作り直す入れ物
  scene.add(stage);

  const clock = new T.Clock();
  let tickers = [];                              // 毎フレーム呼ぶ更新関数
  let phenoStart = 0;                            // 現象開始時刻
  let lineTimer = null;

  function resize() {
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const HY = HX * (h / w);
    camera.left = -HX; camera.right = HX;
    camera.top = HY; camera.bottom = -HY;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();
    const t = clock.elapsedTime - phenoStart;
    for (const fn of tickers) fn(t, dt);
    renderer.render(scene, camera);
  }

  /* ---------- 形づくりヘルパ ---------- */
  // 角丸長方形シェイプ。y0 を 0 にすれば「下端基準」で上に伸ばせる。
  function rr(w, h, r, bottomAnchored) {
    const s = new T.Shape();
    const x = -w / 2;
    const y = bottomAnchored ? 0 : -h / 2;
    r = Math.min(r, w / 2, h / 2);
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);          s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);      s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);          s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);              s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function shapeMesh(shape, color, opacity) {
    const m = new T.Mesh(
      new T.ShapeGeometry(shape),
      new T.MeshBasicMaterial({ color, transparent: true, opacity: opacity == null ? 1 : opacity })
    );
    return m;
  }
  function rrMesh(w, h, r, color, opacity, bottomAnchored) {
    return shapeMesh(rr(w, h, r, bottomAnchored), color, opacity);
  }
  function circle(radius, color, opacity) {
    return new T.Mesh(
      new T.CircleGeometry(radius, 18),
      new T.MeshBasicMaterial({ color, transparent: true, opacity: opacity == null ? 1 : opacity })
    );
  }
  function add(mesh, x, y, z) {
    mesh.position.set(x || 0, y || 0, z || 0);
    stage.add(mesh);
    return mesh;
  }

  // 炎（外オレンジ＋内黄）。flames を userData に入れ、ticker で揺らす。
  function flameShape() {
    const s = new T.Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(0.55, 0.35, 0.45, 1.25, 0, 1.9);
    s.bezierCurveTo(-0.45, 1.25, -0.55, 0.35, 0, 0);
    return s;
  }
  function makeFire(x, y, scale) {
    const g = new T.Group();
    g.position.set(x, y, 0);
    g.scale.setScalar(scale || 1);
    const glow = circle(1.5, 0xff7a1a, 0.16); glow.position.y = 0.7; g.add(glow);
    const outer = shapeMesh(flameShape(), 0xff7a1a, 0.95);
    const midL = shapeMesh(flameShape(), 0xff9a2a, 0.95); midL.position.set(-0.5, 0.05, 0.01); midL.scale.set(0.6, 0.8, 1);
    const midR = shapeMesh(flameShape(), 0xff9a2a, 0.95); midR.position.set(0.5, 0.05, 0.01); midR.scale.set(0.6, 0.8, 1);
    const inner = shapeMesh(flameShape(), 0xffd24a, 1); inner.position.set(0, 0.12, 0.02); inner.scale.set(0.55, 0.7, 1);
    g.add(outer, midL, midR, inner);
    g.userData.parts = [
      { m: outer, base: 1.0,  spd: 9,  ph: 0.0, amp: 0.16 },
      { m: midL,  base: 0.8,  spd: 13, ph: 1.7, amp: 0.22 },
      { m: midR,  base: 0.8,  spd: 12, ph: 3.1, amp: 0.22 },
      { m: inner, base: 0.7,  spd: 15, ph: 0.6, amp: 0.18 },
      { m: glow,  base: 1.0,  spd: 7,  ph: 2.2, amp: 0.12, isGlow: true },
    ];
    return g;
  }
  function flickerFire(g, t) {
    for (const p of g.userData.parts) {
      const w = Math.sin(t * p.spd + p.ph) + 0.4 * Math.sin(t * p.spd * 1.7 + p.ph * 2);
      const sy = p.base * (1 + p.amp * w);
      if (p.isGlow) {
        p.m.material.opacity = 0.16 + 0.07 * (w * 0.5 + 0.5);
        p.m.scale.setScalar(1 + 0.08 * w);
      } else {
        p.m.scale.y = sy;
      }
    }
  }

  /* ---------- 後始末 ---------- */
  function disposeDeep(obj) {
    obj.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
  function clearStage() {
    while (stage.children.length) {
      const c = stage.children[0];
      stage.remove(c);
      disposeDeep(c);
    }
    tickers = [];
    if (lineTimer) { clearTimeout(lineTimer); lineTimer = null; }
  }

  /* ============================================================
     現象 4 種
     ============================================================ */

  // 共通：湯気の粒
  function makeSteam(count) {
    const arr = [];
    for (let i = 0; i < count; i++) {
      const c = circle(0.16 + Math.random() * 0.12, 0xffffff, 0);
      c.userData = {
        x0: (Math.random() - 0.5) * 2.0,
        spd: 0.9 + Math.random() * 0.7,
        ph: Math.random() * 10,
        sway: 0.25 + Math.random() * 0.3,
        life: Math.random(),
        rise: 3.2 + Math.random() * 0.8,
      };
      stage.add(c);
      arr.push(c);
    }
    return arr;
  }

  function boil() {
    const fire = makeFire(0, -3.05, 1.05); stage.add(fire);

    const potColor = 0x564f6b, potEdge = 0x6f6790;
    const bottom = rrMesh(3.6, 0.55, 0.22, potColor); add(bottom, 0, -2.55, 0.0);
    const left  = rrMesh(0.42, 3.0, 0.18, potColor);  add(left,  -1.62, -1.05, 0.0);
    const right = rrMesh(0.42, 3.0, 0.18, potColor);  add(right,  1.62, -1.05, 0.0);
    // 縁のハイライト
    const rimL = rrMesh(0.5, 0.22, 0.1, potEdge); add(rimL, -1.62, 0.42, 0.02);
    const rimR = rrMesh(0.5, 0.22, 0.1, potEdge); add(rimR,  1.62, 0.42, 0.02);

    // 水（下端基準で張られていく）
    const waterBottom = -2.25, waterH = 1.95;
    const water = rrMesh(2.8, waterH, 0.25, 0x3aa0e0, 0.9, true);
    add(water, 0, waterBottom, -0.01);
    water.scale.y = 0.0;
    // 水面ハイライト
    const surface = rrMesh(2.8, 0.16, 0.08, 0x8fd2f2, 0.9); add(surface, 0, waterBottom + waterH, 0.0);
    surface.visible = false;

    // 泡（水中で上昇）
    const bubbles = [];
    for (let i = 0; i < 7; i++) {
      const b = circle(0.1 + Math.random() * 0.08, 0xcdeaff, 0.0);
      b.userData = { x: (Math.random() - 0.5) * 2.2, ph: Math.random() * 6, spd: 0.8 + Math.random() * 0.8 };
      add(b, b.userData.x, waterBottom, 0.0);
      bubbles.push(b);
    }
    const steam = makeSteam(10);

    // 成功のかすかな手応え（淡い緑のリングが一度ふわっと広がる）
    const ring = new T.Mesh(new T.RingGeometry(0.6, 0.78, 32),
      new T.MeshBasicMaterial({ color: 0x7fd49a, transparent: true, opacity: 0 }));
    add(ring, 0, -0.3, 0.03);

    tickers.push((t) => {
      flickerFire(fire, t);
      // 0〜0.7s で水が張られる
      const fill = Math.min(1, t / 0.7);
      water.scale.y = fill;
      const surfY = waterBottom + waterH * fill;
      surface.position.y = surfY + 0.02 * Math.sin(t * 8);
      surface.visible = fill > 0.15;

      const boiling = t > 1.0;          // 沸き始め
      // 泡
      for (const b of bubbles) {
        if (!boiling) { b.material.opacity = 0; continue; }
        const u = ((t * b.userData.spd + b.userData.ph) % 1);
        b.position.y = waterBottom + 0.2 + u * (waterH * fill - 0.5);
        b.position.x = b.userData.x + 0.08 * Math.sin(t * 6 + b.userData.ph);
        b.material.opacity = 0.7 * Math.sin(Math.PI * u);
      }
      // 水面のゆらぎ
      if (boiling) surface.scale.x = 1 + 0.03 * Math.sin(t * 10);
      // 湯気
      for (const c of steam) {
        const d = c.userData;
        if (!boiling) { c.material.opacity = 0; continue; }
        let u = ((t * d.spd + d.ph) % 1);
        const y = surfY + 0.1 + u * d.rise;
        c.position.set(d.x0 + Math.sin(t * d.sway + d.ph) * 0.5, y, 0.0);
        c.material.opacity = 0.5 * Math.sin(Math.PI * u);
        c.scale.setScalar(0.7 + u * 0.8);
      }
      // 手応えリング（1.5〜2.6s に一度）
      if (t > 1.5 && t < 2.6) {
        const u = (t - 1.5) / 1.1;
        ring.scale.setScalar(1 + u * 3.2);
        ring.material.opacity = 0.5 * (1 - u);
      } else { ring.material.opacity = 0; }
    });

    scheduleLine(1.9, 'レイン',
      '煮沸消毒だ。この世界じゃ"菌"の存在が知られてないからな',
      '火を通せば、水の中の見えない病の元が死ぬ');
  }

  // 2) 火+水（鍋なし）：水が直接火にさらされ、ジュッと蒸発して消える。
  function evaporate() {
    const fire = makeFire(0, -3.0, 1.15); stage.add(fire);

    // 器のない水のかたまり（火の上に裸で乗っている）
    const drop = rrMesh(1.7, 1.25, 0.55, 0x3aa0e0, 0.92);
    add(drop, 0, -1.35, 0.0);
    const hi = circle(0.22, 0x9fdcff, 0.8); add(hi, -0.35, -1.05, 0.01);

    // 蒸発の湯気バースト
    const burst = [];
    for (let i = 0; i < 14; i++) {
      const c = circle(0.14 + Math.random() * 0.14, 0xffffff, 0);
      c.userData = { x: (Math.random() - 0.5) * 1.6, spd: 1.6 + Math.random() * 1.4, ph: Math.random(), sway: Math.random() * 2 };
      add(c, 0, -1.2, 0.0);
      burst.push(c);
    }

    const T0 = 0.5;      // 少し温まってから
    const T1 = 1.25;     // ここまでで消える
    tickers.push((t) => {
      flickerFire(fire, t);
      if (t < T0) { return; }
      const u = Math.min(1, (t - T0) / (T1 - T0));     // 0→1 で縮んで消える
      drop.scale.set(1 - u, Math.max(0.001, 1 - u * 1.05), 1);
      drop.position.y = -1.35 + u * 0.35;              // わずかに浮いて消える
      drop.material.opacity = 0.92 * (1 - u);
      hi.material.opacity = 0.8 * (1 - u);
      // ジュッと立ち上る湯気（縮みに合わせて噴き上げる）
      for (const c of burst) {
        const d = c.userData;
        const uu = Math.min(1, Math.max(0, (t - T0) / (T1 - T0 + 0.5) * (0.6 + d.ph)));
        c.position.set(d.x + Math.sin(t * d.sway + d.ph * 6) * 0.4, -1.2 + uu * d.spd * 2.4, 0);
        c.material.opacity = (u > 0.02 ? 0.6 : 0) * Math.sin(Math.PI * Math.min(1, uu));
        c.scale.setScalar(0.6 + uu * 1.2);
      }
    });

    scheduleLine(1.35, 'レイン', '器がなきゃ、煮える前に消えちまう', null);
  }

  // 3) 布+水（濾す）：濁った水が布を通り澄む。だが見えない何かは残る（濁り≠病）。
  function filter() {
    const clothY = 0.2;

    // 上：濁った水（茶色）
    const murk = rrMesh(3.0, 1.35, 0.3, 0x7a5a36, 0.95);
    add(murk, 0, 2.1, 0.0);
    // 濁りの粒（茶の中の濃い点。布で「取れる」見える汚れ）
    const grit = [];
    for (let i = 0; i < 6; i++) {
      const g = circle(0.09 + Math.random() * 0.05, 0x4a371f, 0.9);
      g.userData = { x: (Math.random() - 0.5) * 2.4, y: 2.1 + (Math.random() - 0.5) * 1.0, ph: Math.random() * 6 };
      add(g, g.userData.x, g.userData.y, 0.01);
      grit.push(g);
    }

    // 布（薄いベージュのシート。少したわむ）
    const cloth = rrMesh(4.4, 0.34, 0.16, 0xd8c9a8, 1); add(cloth, 0, clothY, 0.01);
    const weave = rrMesh(4.0, 0.06, 0.03, 0xb9a888, 0.8); add(weave, 0, clothY, 0.02);

    // 下：澄んだ水が溜まっていく（下端基準）
    const clearBottom = -3.2, clearH = 2.6;
    const clear = rrMesh(3.0, clearH, 0.28, 0x3aa0e0, 0.9, true);
    add(clear, 0, clearBottom, -0.01);
    clear.scale.y = 0;

    // 落ちる水の筋
    const stream = rrMesh(0.3, 1.0, 0.15, 0x6fc0ec, 0.85); add(stream, 0, clothY - 0.6, 0.0);
    stream.visible = false;

    // 澄んだ水の中に「残る見えない何か」（微細な暗点）
    const remain = [];
    for (let i = 0; i < 5; i++) {
      const d = circle(0.07, 0x26303a, 0);
      d.userData = { x: (Math.random() - 0.5) * 2.2, y0: clearBottom + 0.5 + Math.random() * 1.4, ph: Math.random() * 6 };
      add(d, d.userData.x, d.userData.y0, 0.02);
      remain.push(d);
    }

    tickers.push((t) => {
      // 0.2〜1.4s：濁り水が布へ降りて減る／下に澄んだ水が溜まる
      const u = Math.min(1, Math.max(0, (t - 0.2) / 1.2));
      murk.scale.y = 1 - u;
      murk.position.y = 2.1 + (1 - (1 - u)) * 0.0 - u * 0.2; // ほぼその場で薄く
      murk.material.opacity = 0.95;
      stream.visible = u > 0.05 && u < 0.98;
      stream.scale.y = 0.8 + 0.4 * Math.sin(t * 14);
      clear.scale.y = u;
      // 濁りの粒は布の手前で「取れて」消える（見える汚れは落ちる）
      for (const g of grit) {
        const gy = g.userData.y - u * (g.userData.y - (clothY + 0.35));
        g.position.y = gy + 0.04 * Math.sin(t * 3 + g.userData.ph);
        g.material.opacity = 0.9 * (1 - u);
      }
      // 1.2s 以降：残る暗点がふっと見えてくる（澄んでも残る対比）
      const rv = Math.min(1, Math.max(0, (t - 1.3) / 0.7));
      for (const d of remain) {
        d.position.y = d.userData.y0 + 0.08 * Math.sin(t * 1.6 + d.userData.ph);
        d.position.x = d.userData.x + 0.05 * Math.cos(t * 1.2 + d.userData.ph);
        d.material.opacity = 0.85 * rv;
      }
    });

    scheduleLine(1.95, 'レイン', '澄んでも、それとこれは別物だ', null);
  }

  // 4) その他：手応えのない結果。
  function nothing(ids) {
    // 選んだカードを灰色のタイルとして置く——が、何も起きない。
    const list = HAND.filter(id => ids.indexOf(id) >= 0);
    const n = Math.max(1, list.length);
    const tiles = [];
    list.forEach((id, i) => {
      const tile = rrMesh(1.3, 1.3, 0.28, 0x413b54, 0.9);
      const x = (i - (n - 1) / 2) * 1.6;
      add(tile, x, 0.4, 0.0);
      tile.userData = { x, ph: i * 0.7 };
      tiles.push(tile);
    });
    if (list.length === 0) {
      const q = rrMesh(0.4, 0.4, 0.2, 0x413b54, 0.8); add(q, 0, 0.4, 0); tiles.push(q);
    }
    tickers.push((t) => {
      for (const tile of tiles) {
        tile.position.y = 0.4 + 0.07 * Math.sin(t * 1.6 + (tile.userData ? tile.userData.ph : 0));
      }
    });
    scheduleLine(0.7, 'レイン', '……それじゃ、何も変わらないな', null);
  }

  /* ============================================================
     現象の起動・台詞
     ============================================================ */
  function runPhenomenon(kind, ids) {
    clearStage();
    phenoStart = clock.elapsedTime;
    hideLine();
    if (kind === 'boil') boil();
    else if (kind === 'evaporate') evaporate();
    else if (kind === 'filter') filter();
    else nothing(ids);
  }

  function scheduleLine(delay, who, text, sub) {
    if (lineTimer) clearTimeout(lineTimer);
    lineTimer = setTimeout(() => showLine(who, text, sub), delay * 1000);
  }
  function showLine(who, text, sub) {
    $('exp-line-who').textContent = who;
    $('exp-line-text').textContent = '「' + text + '」';
    const subEl = $('exp-line-sub');
    if (sub) { subEl.textContent = '——' + sub; subEl.hidden = false; }
    else { subEl.textContent = ''; subEl.hidden = true; }
    $('exp-line').hidden = false;
  }
  function hideLine() {
    $('exp-line').hidden = true;
    $('exp-line-sub').hidden = true;
  }

  /* ============================================================
     手札 UI
     ============================================================ */
  const selected = new Set();
  let triedOnce = false;

  function buildHand() {
    const hand = $('exp-hand');
    hand.textContent = '';
    for (const id of HAND) {
      const c = CARDS[id];
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'exp-card';
      btn.dataset.id = id;
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML =
        '<span class="exp-card-check" aria-hidden="true">✓</span>' +
        '<span class="exp-card-icon" aria-hidden="true">' + c.icon + '</span>' +
        '<span class="exp-card-label">' + c.label + '</span>';
      btn.addEventListener('click', () => toggle(id));
      li.appendChild(btn);
      hand.appendChild(li);
    }
  }

  function toggle(id) {
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    refresh();
  }

  function refresh() {
    for (const btn of document.querySelectorAll('.exp-card')) {
      const on = selected.has(btn.dataset.id);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const any = selected.size > 0;
    $('exp-try').disabled = !any;
    $('exp-reset').disabled = !any && !triedOnce;
  }

  function doTry() {
    if (selected.size === 0) return;
    const ids = HAND.filter(id => selected.has(id));
    triedOnce = true;
    $('exp-view-hint').classList.add('gone');
    runPhenomenon(outcome(ids), ids);
    refresh();
  }

  function doReset() {
    selected.clear();
    triedOnce = false;
    clearStage();
    hideLine();
    $('exp-view-hint').classList.remove('gone');
    refresh();
  }

  /* ---------- 起動 ---------- */
  buildHand();
  $('exp-try').addEventListener('click', doTry);
  $('exp-reset').addEventListener('click', doReset);
  refresh();
  resize();
  animate();

  // 確認用フック（挙動には影響しない）
  window.LisaExperiment = { outcome, sameSet };
})();
