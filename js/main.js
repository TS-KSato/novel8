/* ============================================================
   灯火の街リーザ — ゲームロジック
   素のJavaScriptのみ。外部ライブラリ・外部通信なし。
   ============================================================ */
(() => {
  'use strict';

  const SAVE_KEY = 'toukaLizaSave_v1';
  const COST_RATE = 1.6;

  /* ---------- 発展段階 ---------- */
  const STAGES = [
    { th: 0,  name: '泥のアジト' },
    { th: 5,  name: '開拓の集落' },
    { th: 14, name: '灯りの街' },
    { th: 30, name: '交易都市' },
    { th: 55, name: '光の都リーザ' },
  ];

  /* ストーリーメッセージ（段階到達時・原文のまま） */
  const STORY = {
    2: 'レイン『……まずは雨風をしのげる場所からだ。少しずつでいい、確かめながら進めよう』',
    3: 'バルト『見ろよ、灯りが増えてきた。人が集まる所には商いが生まれる。ここからが本番だぜ』',
    4: 'アルノ『記録した数字は嘘をつきません。この街は、確かに育っています』',
    5: '夜の帳が下りる瞬間、街灯網が波打つように一斉に灯った。かつてたった一つのランタンだった光が、いま、街全体を照らしている。爽やかな風が、街を吹き抜けていった。',
  };

  /* ---------- 施設定義 ---------- */
  const FACILITIES = [
    {
      id: 'lantern', name: 'ランタン工房', char: 'レイン',
      base: { maso: 15, shizai: 0 },
      effect: lv => `魔素の自動生産 +1/秒×Lv（現在 +${trim1(lv)}/秒）`,
    },
    {
      id: 'market', name: '市場', char: 'バルト',
      base: { maso: 40, shizai: 0 },
      effect: lv => `資材の自動生産 +1/2秒×Lv（現在 +${trim1(lv * 0.5)}/秒）`,
    },
    {
      id: 'school', name: '学問所', char: 'アルノ',
      base: { maso: 100, shizai: 10 },
      effect: lv => `タップ獲得量 +1×Lv（現在 タップ+${1 + lv}）`,
    },
    {
      id: 'clinic', name: '救護院', char: 'リーザの遺志',
      base: { maso: 250, shizai: 30 },
      effect: lv => `全自動生産 +10%×Lv（現在 +${lv * 10}%）`,
    },
    {
      id: 'lights', name: '街灯網', char: 'ユリウス',
      base: { maso: 600, shizai: 80 },
      effect: lv => `発展度 +5×Lv・街の光が増える（現在 +${lv * 5}）`,
    },
  ];

  /* ---------- 状態 ---------- */
  const state = {
    maso: 0,
    shizai: 0,
    lv: { lantern: 0, market: 0, school: 0, clinic: 0, lights: 0 },
    unlocked: [],   // 解放済みストーリー段階（2〜5）
    maxStage: 1,    // 到達済みの最高段階
    lastSaved: Date.now(),
  };

  /* ---------- 派生値 ---------- */
  const autoBonus = () => 1 + state.lv.clinic * 0.1;
  const masoPerSec = () => state.lv.lantern * autoBonus();
  const shizaiPerSec = () => state.lv.market * 0.5 * autoBonus();
  const tapGain = () => 1 + state.lv.school;
  const devPoints = () =>
    state.lv.lantern + state.lv.market + state.lv.school +
    state.lv.clinic + state.lv.lights * 5;

  function stageFor(dev) {
    let s = 1;
    for (let i = 0; i < STAGES.length; i++) {
      if (dev >= STAGES[i].th) s = i + 1;
    }
    return s;
  }

  function costOf(fac, lv) {
    return {
      maso: Math.ceil(fac.base.maso * Math.pow(COST_RATE, lv)),
      shizai: fac.base.shizai > 0
        ? Math.ceil(fac.base.shizai * Math.pow(COST_RATE, lv))
        : 0,
    };
  }

  /* ---------- 数値表示（日本語略記） ---------- */
  function fmt(n) {
    n = Math.floor(n);
    const units = [[1e12, '兆'], [1e8, '億'], [1e4, '万']];
    for (const [v, u] of units) {
      if (n >= v) {
        const x = n / v;
        return (x >= 100 ? Math.floor(x) : Math.floor(x * 10) / 10) + u;
      }
    }
    return String(n);
  }
  function trim1(n) {
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  }

  /* ---------- DOM参照 ---------- */
  const $ = id => document.getElementById(id);
  const cityEl = $('city-view');
  const tapLayer = $('tap-layer');
  const waveEl = $('wave');
  const tapHint = $('tap-hint');
  const listEl = $('facility-list');
  const overlay = $('modal-overlay');
  const modalTitle = $('modal-title');
  const modalBody = $('modal-body');

  /* ============================================================
     街ビュー描画（CSSのみ・段階ごとに自動生成）
     ============================================================ */

  // 乱数（シード固定で段階ごとに同じ街並みを再現する）
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CITY_CFG = {
    1: { far: 0,  mid: 0, near: 1,  hMax: 16, winRatio: 0,    lanterns: 1,  stars: 7,  sea: 0 },
    2: { far: 0,  mid: 2, near: 3,  hMax: 20, winRatio: 0.25, lanterns: 4,  stars: 16, sea: 0 },
    3: { far: 7,  mid: 5, near: 4,  hMax: 34, winRatio: 0.45, lanterns: 5,  stars: 26, sea: 0 },
    4: { far: 10, mid: 7, near: 6,  hMax: 48, winRatio: 0.65, lanterns: 8,  stars: 38, sea: 10 },
    5: { far: 13, mid: 9, near: 7,  hMax: 58, winRatio: 0.95, lanterns: 12, stars: 64, sea: 34 },
  };
  const SHAPES = ['shape-hut', 'shape-tower', 'shape-step', 'shape-flat', 'shape-dome'];

  function makeBuilding(layerEl, x, w, h, shape, winRatio, rng) {
    const b = document.createElement('div');
    b.className = 'bld ' + shape;
    b.style.left = x + '%';
    b.style.width = w + '%';
    b.style.height = h + '%';
    // 窓明かり
    if (winRatio > 0 && h >= 12) {
      const cols = Math.max(1, Math.round(w / 4));
      const rows = Math.max(1, Math.round(h / 11));
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (rng() > winRatio) continue;
          const win = document.createElement('span');
          win.className = 'win';
          win.style.left = (12 + (c * 76) / Math.max(1, cols - 1 || 1) + rng() * 6) + '%';
          win.style.top = (30 + (r * 58) / Math.max(1, rows - 1 || 1) + rng() * 6) + '%';
          win.style.animationDuration = (1.8 + rng() * 2.4) + 's';
          win.style.animationDelay = (-rng() * 3) + 's';
          b.appendChild(win);
        }
      }
    }
    layerEl.appendChild(b);
  }

  function fillLayer(layerEl, count, rng, stage, layerKind) {
    layerEl.textContent = '';
    if (count <= 0) return;
    const cfg = CITY_CFG[stage];
    const scale = layerKind === 'far' ? 0.75 : layerKind === 'mid' ? 0.9 : 1;
    for (let i = 0; i < count; i++) {
      const w = 7 + rng() * 9;
      const x = count === 1
        ? 38 + rng() * 14
        : (i / count) * 100 - 4 + rng() * (90 / count);
      let h = (cfg.hMax * (0.45 + rng() * 0.55)) * scale;
      let shape;
      if (stage <= 2) {
        shape = 'shape-hut';
        h = Math.min(h, 22);
      } else {
        shape = SHAPES[Math.floor(rng() * SHAPES.length)];
      }
      // 近景の窓は明るく・遠景は控えめに
      const ratio = layerKind === 'far' ? cfg.winRatio * 0.5 : cfg.winRatio;
      makeBuilding(layerEl, x, w, h, shape, ratio, rng);
    }
  }

  function renderCity() {
    const stage = state.maxStage;
    const cfg = CITY_CFG[stage];
    const rng = mulberry32(stage * 1000 + 7);

    // 段階アップ演出（flash）の途中で呼ばれてもアニメーションを切らない
    const flashing = cityEl.classList.contains('flash');
    cityEl.className = 'stage-' + stage + (flashing ? ' flash' : '');

    // 星空
    const stars = $('stars');
    stars.textContent = '';
    for (let i = 0; i < cfg.stars; i++) {
      const s = document.createElement('span');
      s.className = 'star';
      s.style.left = rng() * 100 + '%';
      s.style.top = rng() * 52 + '%';
      const size = rng() < 0.25 ? 2 : 1;
      s.style.width = s.style.height = size + 'px';
      s.style.animationDuration = (2.5 + rng() * 4) + 's';
      s.style.animationDelay = (-rng() * 5) + 's';
      stars.appendChild(s);
    }

    // 建物レイヤー
    fillLayer($('layer-far'), cfg.far, rng, stage, 'far');
    fillLayer($('layer-mid'), cfg.mid, rng, stage, 'mid');
    fillLayer($('layer-near'), cfg.near, rng, stage, 'near');

    // ランタン・街灯・光の海
    const amb = $('ambient-lights');
    amb.textContent = '';
    const lanternCount = cfg.lanterns + Math.min(state.lv.lights * 2, 16);
    for (let i = 0; i < lanternCount; i++) {
      const l = document.createElement('span');
      l.className = 'lantern';
      l.style.left = (4 + rng() * 92) + '%';
      l.style.bottom = (4 + rng() * 9) + '%';
      l.style.animationDuration = (1.8 + rng() * 1.6) + 's';
      l.style.animationDelay = (-rng() * 2.5) + 's';
      amb.appendChild(l);
    }
    for (let i = 0; i < cfg.sea; i++) {
      const p = document.createElement('span');
      p.className = 'sea-light';
      p.style.left = rng() * 100 + '%';
      p.style.bottom = (8 + rng() * 30) + '%';
      p.style.animationDuration = (3 + rng() * 4) + 's';
      p.style.animationDelay = (-rng() * 5) + 's';
      amb.appendChild(p);
    }

    $('stage-no').textContent = '段階 ' + stage;
    $('stage-name').textContent = STAGES[stage - 1].name;
  }

  /* 段階アップ演出：光の波 */
  function playWave() {
    waveEl.classList.remove('play');
    cityEl.classList.remove('flash');
    void waveEl.offsetWidth; // アニメーション再生のためのリフロー
    waveEl.classList.add('play');
    cityEl.classList.add('flash');
    setTimeout(() => {
      waveEl.classList.remove('play');
      cityEl.classList.remove('flash');
    }, 1800);
  }

  /* ============================================================
     モーダル
     ============================================================ */

  let onModalClose = null;

  function openModal(title, bodyNode, closeLabel) {
    modalTitle.textContent = title;
    modalBody.textContent = '';
    modalBody.appendChild(bodyNode);
    $('modal-close').textContent = closeLabel || '閉じる';
    overlay.hidden = false;
  }

  function closeModal() {
    overlay.hidden = true;
    modalBody.textContent = '';
    if (onModalClose) { const f = onModalClose; onModalClose = null; f(); }
    setTab('city');
  }

  function storyNode(stageNum, unlockedFlag) {
    const div = document.createElement('div');
    div.className = 'story-text' + (unlockedFlag ? '' : ' story-locked');
    const head = document.createElement('div');
    head.className = 'story-stage';
    head.textContent = `発展段階${stageNum}「${STAGES[stageNum - 1].name}」`;
    const body = document.createElement('div');
    body.textContent = unlockedFlag
      ? STORY[stageNum]
      : `？？？（発展段階${stageNum}に到達すると解放されます）`;
    div.appendChild(head);
    div.appendChild(body);
    return div;
  }

  function showStoryModal(stageNum) {
    openModal('街の記録', storyNode(stageNum, true), '物語を続ける');
  }

  function showRecordsModal() {
    const wrap = document.createElement('div');
    for (let s = 2; s <= 5; s++) {
      wrap.appendChild(storyNode(s, state.unlocked.includes(s)));
    }
    openModal('記録 — 街のあゆみ', wrap);
  }

  function showSettingsModal() {
    const wrap = document.createElement('div');

    const info = document.createElement('div');
    info.className = 'settings-row';
    info.textContent =
      'セーブはこの端末のブラウザ（localStorage）に5秒ごと＋操作時に自動保存されます。' +
      '最終保存：' + new Date(state.lastSaved).toLocaleString('ja-JP');
    wrap.appendChild(info);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'danger-btn';
    btn.textContent = 'セーブデータをリセット';
    btn.addEventListener('click', () => {
      if (confirm('セーブデータを削除して、最初からやり直します。\nこの操作は取り消せません。よろしいですか？')) {
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 失敗しても続行 */ }
        resetting = true;
        location.reload();
      }
    });
    wrap.appendChild(btn);

    openModal('設定', wrap);
  }

  /* ============================================================
     施設カード
     ============================================================ */

  const cardRefs = {};

  function buildFacilityList() {
    listEl.textContent = '';
    for (const fac of FACILITIES) {
      const li = document.createElement('li');
      li.className = 'card';

      const info = document.createElement('div');
      info.className = 'card-info';

      const head = document.createElement('div');
      head.className = 'card-head';
      const name = document.createElement('span');
      name.className = 'card-name';
      name.textContent = fac.name;
      const char = document.createElement('span');
      char.className = 'card-char';
      char.textContent = '担当：' + fac.char;
      const lv = document.createElement('span');
      lv.className = 'card-lv';
      head.appendChild(name);
      head.appendChild(char);
      head.appendChild(lv);

      const effect = document.createElement('div');
      effect.className = 'card-effect';
      const cost = document.createElement('div');
      cost.className = 'card-cost';

      info.appendChild(head);
      info.appendChild(effect);
      info.appendChild(cost);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'buy-btn';
      btn.addEventListener('click', () => buy(fac.id));

      li.appendChild(info);
      li.appendChild(btn);
      listEl.appendChild(li);

      cardRefs[fac.id] = { lv, effect, cost, btn };
    }
  }

  function updateFacilityList() {
    for (const fac of FACILITIES) {
      const r = cardRefs[fac.id];
      const lv = state.lv[fac.id];
      const c = costOf(fac, lv);
      const okMaso = state.maso >= c.maso;
      const okShizai = state.shizai >= c.shizai;

      r.lv.textContent = 'Lv.' + lv;
      r.effect.textContent = fac.effect(lv);

      r.cost.textContent = '';
      const label = document.createTextNode('必要：');
      r.cost.appendChild(label);
      const m = document.createElement('span');
      m.className = okMaso ? 'ok' : 'ng';
      m.textContent = '魔素 ' + fmt(c.maso);
      r.cost.appendChild(m);
      if (c.shizai > 0) {
        r.cost.appendChild(document.createTextNode('・'));
        const z = document.createElement('span');
        z.className = okShizai ? 'ok' : 'ng';
        z.textContent = '資材 ' + fmt(c.shizai);
        r.cost.appendChild(z);
      }

      r.btn.textContent = lv === 0 ? '建設' : '強化';
      r.btn.disabled = !(okMaso && okShizai);
    }
  }

  function buy(id) {
    const fac = FACILITIES.find(f => f.id === id);
    const c = costOf(fac, state.lv[id]);
    if (state.maso < c.maso || state.shizai < c.shizai) return;
    state.maso -= c.maso;
    state.shizai -= c.shizai;
    state.lv[id]++;
    tapHint.classList.add('hidden');
    if (id === 'lights') renderCity(); // 街灯網は光の本数に即反映
    checkStage();
    updateAll();
    save();
  }

  /* ============================================================
     発展段階チェック
     ============================================================ */

  function checkStage() {
    const s = stageFor(devPoints());
    if (s <= state.maxStage) return;
    for (let n = state.maxStage + 1; n <= s; n++) {
      if (STORY[n] && !state.unlocked.includes(n)) state.unlocked.push(n);
    }
    state.maxStage = s;
    playWave();
    setTimeout(renderCity, 650);          // 光の波の中で街並みが切り替わる
    setTimeout(() => showStoryModal(s), 1000);
    save();
  }

  /* ============================================================
     タップ
     ============================================================ */

  cityEl.addEventListener('pointerdown', e => {
    const g = tapGain();
    state.maso += g;

    const rect = cityEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const glow = document.createElement('span');
    glow.className = 'tap-glow';
    glow.style.left = x + 'px';
    glow.style.top = y + 'px';
    tapLayer.appendChild(glow);

    const num = document.createElement('span');
    num.className = 'tap-num';
    num.textContent = '+' + fmt(g);
    num.style.left = x + 'px';
    num.style.top = y + 'px';
    tapLayer.appendChild(num);

    setTimeout(() => { glow.remove(); num.remove(); }, 850);
    if (tapLayer.childElementCount > 40) tapLayer.firstElementChild.remove();

    updateAll();
  });

  /* ============================================================
     表示更新・メインループ
     ============================================================ */

  function updateResources() {
    $('res-maso').textContent = fmt(state.maso);
    $('res-shizai').textContent = fmt(state.shizai);
    $('rate-maso').textContent = '+' + trim1(masoPerSec()) + '/秒';
    $('rate-shizai').textContent = '+' + trim1(shizaiPerSec()) + '/秒';
    $('res-dev').textContent = fmt(devPoints());
    $('res-stage').textContent = STAGES[state.maxStage - 1].name;
  }

  function updateAll() {
    updateResources();
    updateFacilityList();
  }

  let lastTick = Date.now();
  function tick() {
    const now = Date.now();
    let dt = (now - lastTick) / 1000;
    lastTick = now;
    if (dt <= 0) return;
    if (dt > 300) dt = 300; // バックグラウンド復帰時の暴走防止

    state.maso += masoPerSec() * dt;
    state.shizai += shizaiPerSec() * dt;
    updateAll();
  }

  /* ============================================================
     セーブ／ロード
     ============================================================ */

  let resetting = false;

  function save() {
    if (resetting) return;
    state.lastSaved = Date.now();
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        v: 1,
        maso: state.maso,
        shizai: state.shizai,
        lv: state.lv,
        unlocked: state.unlocked,
        maxStage: state.maxStage,
        lastSaved: state.lastSaved,
      }));
    } catch (e) { /* プライベートモード等で保存できない場合は無視 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || d.v !== 1) return;
      state.maso = Number(d.maso) || 0;
      state.shizai = Number(d.shizai) || 0;
      for (const k of Object.keys(state.lv)) {
        state.lv[k] = Math.max(0, Math.floor(Number(d.lv && d.lv[k]) || 0));
      }
      state.unlocked = Array.isArray(d.unlocked)
        ? d.unlocked.filter(n => n >= 2 && n <= 5)
        : [];
      state.maxStage = Math.min(5, Math.max(1, Math.floor(Number(d.maxStage) || 1)));
      state.lastSaved = Number(d.lastSaved) || Date.now();
      // 整合性：保存時より発展度が高ければ静かに段階を合わせる
      const s = stageFor(devPoints());
      if (s > state.maxStage) {
        for (let n = state.maxStage + 1; n <= s; n++) {
          if (STORY[n] && !state.unlocked.includes(n)) state.unlocked.push(n);
        }
        state.maxStage = s;
      }
    } catch (e) { /* 壊れたデータは無視して新規開始 */ }
  }

  /* ============================================================
     フッターメニュー
     ============================================================ */

  function setTab(tab) {
    document.querySelectorAll('#footer-menu .tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
  }

  document.querySelectorAll('#footer-menu .tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      setTab(tab);
      if (tab === 'city') {
        $('facility-area').scrollTo({ top: 0, behavior: 'smooth' });
      } else if (tab === 'facility') {
        $('facility-area').scrollTo({ top: 0, behavior: 'smooth' });
      } else if (tab === 'records') {
        showRecordsModal();
      } else if (tab === 'settings') {
        showSettingsModal();
      }
    });
  });

  $('modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });

  /* ============================================================
     起動
     ============================================================ */

  load();
  buildFacilityList();
  renderCity();
  updateAll();
  if (Object.values(state.lv).some(v => v > 0)) tapHint.classList.add('hidden');

  setInterval(tick, 100);
  setInterval(save, 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
    else lastTick = Date.now();
  });
  window.addEventListener('pagehide', save);
})();
