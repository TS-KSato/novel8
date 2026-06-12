/* ============================================================
   灯火の街リーザ — ジオラマ街ビュー（擬似俯瞰ミニチュアマップ）
   CSSのみで描く。外部ライブラリ・画像は使わない。

   構造:
   - #diorama > #town-board … perspective + rotateX で奥に傾けた盤面
   - 盤面の上に .standee（逆回転で立ち上がる「紙の立て看板」式の
     ミニチュア建物）を置く。中央は広場と「はじまりのランタン」
   - すべて state（施設Lv・住人数・段階）から決定的に描くため、
     セーブ復元でも同じ街並みになる

   main.js 側の切替フラグ（window.LIZA_USE_DIORAMA = false）で
   旧・横スクロール夜景描画に戻せる。
   ============================================================ */
(() => {
  'use strict';

  /* 施設Lv → 見た目の成長段階（4段階） */
  const tierOf = lv => (lv >= 10 ? 4 : lv >= 6 ? 3 : lv >= 3 ? 2 : 1);

  const HOME_MAX = 14;        // 民家の最大表示数（超過は灯の密度で表現）
  const EXTRA_GLOW_MAX = 18;  // 密度表現の追加光点の上限

  /* 区画（盤面座標 %）: 広場(50,52)を中心に十字の道 */
  const PLOTS = {
    lantern: { x: 50, y: 22 }, // 広場の北
    market:  { x: 79, y: 52 }, // 東の道沿い
    school:  { x: 20, y: 40 }, // 西の丘側
    clinic:  { x: 50, y: 84 }, // 南
  };

  /* 街灯ポールの位置（道に沿って） */
  const LAMP_POS = [
    [45, 36], [55, 66], [34, 47], [66, 58], [45, 12],
    [55, 88], [16, 47], [84, 58], [28, 58], [72, 47], [45, 70], [55, 28],
  ];

  /* 民家ゾーン（道・広場・施設区画を避けた四隅） x1,x2,y1,y2 */
  const HOME_ZONES = [
    [8, 36, 8, 34], [63, 91, 10, 36], [8, 36, 64, 88], [63, 91, 66, 88],
  ];

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function div(cls, parent) {
    const d = document.createElement('div');
    d.className = cls;
    if (parent) parent.appendChild(d);
    return d;
  }

  /* 立て看板式スタンディ（盤面に立つ要素の共通土台） */
  function standee(cls, x, y, parent) {
    const s = div('standee ' + cls, parent);
    s.style.left = x + '%';
    s.style.top = y + '%';
    s.style.zIndex = String(100 + Math.round(y * 5)); // 手前ほど上に描く
    return s;
  }

  /* 窓明かり（夕方に --lit-delay の時間差で一つずつ点く） */
  function townWin(parent, leftPct, bottomPx, rng, cls) {
    const w = document.createElement('span');
    w.className = 't-win' + (cls ? ' ' + cls : '');
    w.style.left = leftPct + '%';
    w.style.bottom = bottomPx + 'px';
    w.style.animationDuration = (1.8 + rng() * 2.4) + 's';
    w.style.animationDelay = (-rng() * 3) + 's';
    w.style.setProperty('--lit-delay', (rng() * 16).toFixed(1) + 's');
    parent.appendChild(w);
    return w;
  }

  /* 施設の建物（屋根色・窓・看板など3つ以上の識別要素を持つ） */
  function buildFacility(id, lv, rng) {
    const tier = tierOf(lv);
    const p = PLOTS[id];
    const s = standee('t-fac fac-' + id + ' tier-' + tier, p.x, p.y);
    s.dataset.fac = id;
    s.dataset.tier = String(tier);

    const b = div('b', s);
    div('b-side', b);
    const front = div('b-front', b);
    div('b-door', front);
    div('b-roof', b);

    // 窓（Lvとともに増える。位置は決定的）
    const winN = Math.min(2 + Math.floor(lv / 2), 6);
    for (let i = 0; i < winN; i++) {
      townWin(front, 16 + (i % 3) * 26, 7 + Math.floor(i / 3) * 14, rng);
    }

    if (tier >= 2) div('b-sign', b);              // 看板
    if (tier >= 3) { div('b-floor2', b); div('b-flag', b); } // 2階+旗
    if (tier >= 4) div('b-deco', b);              // 特別装飾（光る縁どり）

    // 施設ごとの固有パーツ
    if (id === 'lantern') { div('b-chimney', b); div('b-hang', b); }
    if (id === 'market')  { div('b-awning', b); div('b-crate', b); }
    if (id === 'school')  { div('b-towercap', b); div('b-starmark', b); }
    if (id === 'clinic')  { div('b-leaf', b); div('b-aura', b); }
    return s;
  }

  /* 汎用の小さな民家 */
  const HOME_ROOFS = ['roof-a', 'roof-b', 'roof-c', 'roof-d'];
  function buildHome(i, rng) {
    const z = HOME_ZONES[i % HOME_ZONES.length];
    const x = z[0] + rng() * (z[1] - z[0]);
    const y = z[2] + rng() * (z[3] - z[2]);
    const s = standee('t-home', x, y);
    const b = div('hb', s);
    div('hb-side', b);
    const front = div('hb-front', b);
    div('hb-door', front);
    div('hb-roof ' + HOME_ROOFS[Math.floor(rng() * HOME_ROOFS.length)], b);
    townWin(front, 58, 4, rng);
    return s;
  }

  /* 街灯ポール */
  function buildLamp(x, y, rng) {
    const s = standee('t-lamp', x, y);
    s.dataset.fac = 'lights'; // そだてた時に光る演出の対象
    div('lamp-pole', s);
    const g = document.createElement('span');
    g.className = 'lamp-glow t-win';
    g.style.animationDuration = (2 + rng() * 2) + 's';
    g.style.setProperty('--lit-delay', (rng() * 10).toFixed(1) + 's');
    s.appendChild(g);
    return s;
  }

  /* はじまりのランタン（広場の中心・常時灯る象徴） */
  function buildLantern() {
    const s = standee('t-lantern', 50, 52);
    s.id = 'town-lantern';
    div('lantern-base', s);
    div('lantern-pole', s);
    const head = div('lantern-head always-lit', s);
    head.id = 'town-lantern-head';
    return s;
  }

  function render(data) {
    const host = document.getElementById('diorama');
    if (!host) return;
    host.textContent = '';

    const stage = data.stage;
    const rng = mulberry32(stage * 7777 + 13);

    const board = div('g-stage-' + stage, host);
    board.id = 'town-board';

    /* 道と広場（段階で 土 → 石畳 → 敷石 に変わる） */
    div('road road-ns', board);
    div('road road-ew', board);
    div('plaza', board);

    /* 段階ごとの地面の飾り */
    if (stage <= 2) {
      for (let i = 0; i < 6; i++) {
        const bush = div('deco-bush', board);
        bush.style.left = (6 + rng() * 88) + '%';
        bush.style.top = (6 + rng() * 88) + '%';
      }
    }
    if (stage >= 4) {
      for (let i = 0; i < 4; i++) {
        const fb = div('deco-flowerbed', board);
        fb.style.left = (30 + (i % 2) * 34) + '%';
        fb.style.top = (38 + Math.floor(i / 2) * 24) + '%';
      }
    }
    if (stage >= 5) {
      div('deco-canal', board);   // 水路
      for (let i = 0; i < 6; i++) {
        const fl = div('deco-flowers', board);
        fl.style.left = (10 + rng() * 80) + '%';
        fl.style.top = (10 + rng() * 80) + '%';
      }
    }

    /* はじまりのランタン */
    board.appendChild(buildLantern());

    /* 施設（建てたものだけが盤面に現れ、Lvで成長する） */
    for (const id of ['lantern', 'market', 'school', 'clinic']) {
      if (data.lv[id] > 0) board.appendChild(buildFacility(id, data.lv[id], rng));
    }

    /* 街灯網：道に沿ってポールが増える */
    const lampN = data.lv.lights > 0
      ? Math.min(2 + data.lv.lights * 2, LAMP_POS.length)
      : 0;
    for (let i = 0; i < lampN; i++) {
      board.appendChild(buildLamp(LAMP_POS[i][0], LAMP_POS[i][1], rng));
    }

    /* 民家：住人が増えると空き区画に増えていく（上限あり） */
    const homeN = Math.min(Math.floor(data.residents / 4), HOME_MAX);
    for (let i = 0; i < homeN; i++) board.appendChild(buildHome(i, rng));

    /* 上限を超えた住人は、地面の小さな灯の密度で表現する */
    const overflow = Math.max(0, data.residents - HOME_MAX * 4);
    const glowN = Math.min(Math.floor(overflow / 4), EXTRA_GLOW_MAX);
    for (let i = 0; i < glowN; i++) {
      const g = document.createElement('span');
      g.className = 't-win ground-glow';
      g.style.left = (6 + rng() * 88) + '%';
      g.style.top = (6 + rng() * 88) + '%';
      g.style.setProperty('--lit-delay', (rng() * 16).toFixed(1) + 's');
      board.appendChild(g);
    }
  }

  /* 建設・そだてる時：該当区画が光って成長する */
  function animateFacility(id) {
    document.querySelectorAll('#diorama [data-fac="' + id + '"]').forEach(el => {
      el.classList.add('grow');
      el.addEventListener('animationend', () => el.classList.remove('grow'), { once: true });
    });
  }

  /* タップの光の粒の出どころ＝はじまりのランタン */
  function lanternPoint() {
    const head = document.getElementById('town-lantern-head');
    const city = document.getElementById('city-view');
    if (!head || !city) return null;
    const hr = head.getBoundingClientRect();
    const cr = city.getBoundingClientRect();
    if (hr.width === 0 && hr.height === 0) return null; // 環境によって計測不可
    return {
      x: hr.left + hr.width / 2 - cr.left,
      y: hr.top + hr.height / 2 - cr.top,
    };
  }

  window.LizaTown = { render, animateFacility, lanternPoint, tierOf, HOME_MAX };
})();
