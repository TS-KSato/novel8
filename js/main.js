/* ============================================================
   灯火の街リーザ — ゲームロジック
   素のJavaScriptのみ。外部ライブラリ・外部通信なし。

   体験の核：
   「ちいさな灯をまもる約束が、いつのまにか、
     たくさんの人の笑顔になっていた」
   ============================================================ */
(() => {
  'use strict';

  const SAVE_KEY = 'toukaLizaSave_v1';
  const COST_RATE = 1.6;

  /* ---------- ふりがな（ルビ）ヘルパー ----------
     「｛漢字|よみ｝」記法を <ruby> 要素にして返す。
     rt要素を除いたテキストは原文と完全に一致する。 */
  function rubyText(str) {
    const frag = document.createDocumentFragment();
    const re = /｛([^|｝]+)\|([^｝]+)｝/g;
    let last = 0, m;
    while ((m = re.exec(str))) {
      if (m.index > last) frag.appendChild(document.createTextNode(str.slice(last, m.index)));
      const r = document.createElement('ruby');
      r.appendChild(document.createTextNode(m[1]));
      const rt = document.createElement('rt');
      rt.textContent = m[2];
      r.appendChild(rt);
      frag.appendChild(r);
      last = re.lastIndex;
    }
    if (last < str.length) frag.appendChild(document.createTextNode(str.slice(last)));
    return frag;
  }
  const rubyInto = (el, str) => { el.textContent = ''; el.appendChild(rubyText(str)); };

  /* ---------- 発展段階 ---------- */
  const STAGES = [
    { th: 0,  name: '泥のアジト' },
    { th: 5,  name: '開拓の集落' },
    { th: 14, name: '灯りの街' },
    { th: 30, name: '交易都市' },
    { th: 55, name: '光の都リーザ' },
  ];

  /* オープニング「約束」（タップで進む4枚） */
  const OPENING_LINES = [
    'むかし、ここには なにもなかった。あったのは、ちいさなランタン ひとつだけ。',
    'これは、たいせつな友だちが のこしてくれた灯。『この灯を、いつか 街いっぱいの光にしてね』',
    'レインたちは ｛約束|やくそく｝した。きみも、いっしょに 来てくれる?',
  ];
  const FIRST_GOAL_TOAST = 'まずは ランタンの灯に ひかりを集めよう（街をタップ!）';

  /* ストーリーメッセージ（段階到達時・原文のまま、ふりがな付き） */
  const STORY = {
    2: 'レイン『……まずは｛雨風|あめかぜ｝をしのげる｛場所|ばしょ｝からだ。｛少|すこ｝しずつでいい、｛確|たし｝かめながら｛進|すす｝めよう』',
    3: 'バルト『｛見|み｝ろよ、｛灯|あか｝りが｛増|ふ｝えてきた。｛人|ひと｝が｛集|あつ｝まる｛所|ところ｝には｛商|あきな｝いが｛生|う｝まれる。ここからが｛本番|ほんばん｝だぜ』',
    4: 'アルノ『｛記録|きろく｝した｛数字|すうじ｝は｛嘘|うそ｝をつきません。この｛街|まち｝は、｛確|たし｝かに｛育|そだ｝っています』',
    5: '｛夜|よる｝の｛帳|とばり｝が｛下|お｝りる｛瞬間|しゅんかん｝、｛街灯網|がいとうもう｝が｛波打|なみう｝つように｛一斉|いっせい｝に｛灯|とも｝った。かつてたった｛一|ひと｝つのランタンだった｛光|ひかり｝が、いま、｛街全体|まちぜんたい｝を｛照|て｝らしている。｛爽|さわ｝やかな｛風|かぜ｝が、｛街|まち｝を｛吹|ふ｝き｛抜|ぬ｝けていった。',
  };

  /* ---------- 施設定義 ---------- */
  const FACILITIES = [
    {
      id: 'lantern', name: 'ランタン｛工房|こうぼう｝', char: 'rein',
      base: { maso: 15, shizai: 0 },
      desc: 'レインが ランタンを ともす場所。ひかりが じどうで集まる',
      stat: lv => 'いま ✦+' + trim1(lv) + '/秒',
    },
    {
      id: 'market', name: '｛市場|いちば｝', char: 'baruto',
      base: { maso: 40, shizai: 0 },
      desc: 'バルトの 元気な声が ひびく。もくざいが じどうで集まる',
      stat: lv => 'いま ▤+' + trim1(lv * 0.5) + '/秒',
    },
    {
      id: 'school', name: '｛学問所|がくもんじょ｝', char: 'aruno',
      base: { maso: 100, shizai: 10 },
      desc: 'アルノが 数字と 星をしらべる。タップで集まる ひかりが ふえる',
      stat: lv => 'いま タップ✦+' + (1 + lv),
    },
    {
      id: 'clinic', name: '｛救護院|きゅうごいん｝', char: 'rein',
      base: { maso: 250, shizai: 30 },
      desc: 'リーザの ねがいを ついだ場所。みんなの 仕事が はかどる',
      stat: lv => 'いま じどうで集まる量 +' + lv * 10 + '%',
    },
    {
      id: 'lights', name: '｛街灯網|がいとうもう｝', char: 'baruto',
      base: { maso: 600, shizai: 80 },
      desc: '街のすみずみまで あかりを とどける',
      stat: lv => 'いま かがやき +' + lv * 5,
    },
  ];

  /* ---------- 仲間の声 ---------- */
  const VOICES = {
    rein: {
      name: 'レイン', cls: 'v-rein', emblem: '🕯',
      lines: [
        '……うん、いい｛感|かん｝じだ',
        '｛確|たし｝かめながら、｛進|すす｝もう',
        '｛灯|あか｝りがひとつ、ふえたね',
        '｛静|しず｝かな｛夜|よる｝ほど、｛光|ひかり｝はよく｛見|み｝える',
        'この｛調子|ちょうし｝で、いこう',
        '……あの｛約束|やくそく｝に、｛少|すこ｝し｛近|ちか｝づいた',
      ],
    },
    baruto: {
      name: 'バルト', cls: 'v-baruto', emblem: '⚖',
      lines: [
        'よっしゃ、｛商売|しょうばい｝はんじょう!',
        '｛人|ひと｝が｛集|あつ｝まりゃ｛街|まち｝は｛育|そだ｝つぜ!',
        'いいねえ、にぎやかになってきた!',
        '｛腹|はら｝がへったら｛市場|いちば｝に｛来|き｝な!',
        'でっかくいこうぜ!',
      ],
    },
    aruno: {
      name: 'アルノ', cls: 'v-aruno', emblem: '✒',
      lines: [
        '｛記録|きろく｝しておきます',
        '｛数字|すうじ｝は うそをつきません',
        '｛順調|じゅんちょう｝です。とても',
        '｛星|ほし｝の｛位置|いち｝も、｛今夜|こんや｝はいいようです',
        '｛計算|けいさん｝どおり……いえ、それ｛以上|いじょう｝です',
      ],
    },
  };
  const FIRST_BUILD_LINE = { char: 'rein', text: '……うん、いい｛感|かん｝じだ。はじまりの｛一歩|いっぽ｝だね' };
  const FIRST_RESIDENT_LINE = { char: 'baruto', text: 'お、はじめての｛住人|じゅうにん｝だ! にぎやかになるぜ!' };

  /* ---------- 住人の節目（職業＋一言） ---------- */
  const RESIDENT_MILESTONES = [
    { n: 5,    text: 'パンやの ハンナ『いいにおいで みんなを よびよせるわ』' },
    { n: 10,   text: 'はなやの ミレイユ『まどべに 花があると 笑顔が ふえるの』' },
    { n: 20,   text: 'こびとの大工 ドン『いい木だ。おれが 屋根を なおしてやろう』' },
    { n: 50,   text: 'りょうしの少年 テオ『川で 大きいのが つれたんだ!』' },
    { n: 100,  text: '糸つむぎの リダばあちゃん『あたたかい 毛糸を あんであげようね』' },
    { n: 200,  text: 'かじやの ガロ『火花だって 街の灯の なかまさ』' },
    { n: 350,  text: '旅の楽士 ピポ『この街の歌を つくったよ。ききたい?』' },
    { n: 500,  text: '星よみの ナジュ『星も この街を 見おろして わらってる』' },
    { n: 750,  text: 'ぶどう園の フェルマ『みのりの きせつが たのしみだね』' },
    { n: 1000, text: 'ゆうびんやの クルト『とどけたい 手紙が ふえるのは いい街の しるしさ』' },
  ];

  /* ---------- 状態 ---------- */
  const state = {
    maso: 0,
    shizai: 0,
    lv: { lantern: 0, market: 0, school: 0, clinic: 0, lights: 0 },
    unlocked: [],      // 解放済みストーリー段階（2〜5）
    maxStage: 1,       // 到達済みの最高段階
    introSeen: false,  // オープニング「約束」を見たか
    lastResidents: 0,  // 住人トースト用の前回値
    lastSaved: Date.now(),
  };

  /* 表示用のカウントアップ値（実値に向かって滑らかに増える） */
  const shown = { maso: 0, shizai: 0 };

  /* ---------- 派生値 ---------- */
  const autoBonus = () => 1 + state.lv.clinic * 0.1;
  const masoPerSec = () => state.lv.lantern * autoBonus();
  const shizaiPerSec = () => state.lv.market * 0.5 * autoBonus();
  const tapGain = () => 1 + state.lv.school;
  const totalLv = () =>
    state.lv.lantern + state.lv.market + state.lv.school + state.lv.clinic + state.lv.lights;
  const residents = () => totalLv() * 2; // 施設の合計Lv×2人
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
  const toastArea = $('toast-area');
  const openingEl = $('opening');

  /* ============================================================
     街ビュー描画（CSSのみ・段階ごとに自動生成）
     ============================================================ */

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const CITY_CFG = {
    1: { far: 0,  mid: 0, near: 1,  hMax: 16, winRatio: 0,    lanterns: 1,  stars: 10, sea: 0 },
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
    if (stage === 1 && layerKind === 'near') {
      // 段階1は固定配置の小屋一つ。背景から識別できる大きさで描く
      makeBuilding(layerEl, 38, 24, 21, 'shape-hut', 0, rng);
      return;
    }
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
      const ratio = layerKind === 'far' ? cfg.winRatio * 0.5 : cfg.winRatio;
      makeBuilding(layerEl, x, w, h, shape, ratio, rng);
    }
  }

  /* ------------------------------------------------------------
     施設シルエット：プレイヤーが建てたものが街の絵として残る。
     state.lv から決定的に描くため、セーブ復元でも同じ街並みになる。
     ------------------------------------------------------------ */

  function facWindows(b, lv, cap, cls, rng) {
    const n = Math.min(lv, cap);
    for (let i = 0; i < n; i++) {
      const win = document.createElement('span');
      win.className = 'win' + (cls ? ' ' + cls : '');
      win.style.left = (14 + (i % 3) * 26 + rng() * 8) + '%';
      win.style.top = (22 + Math.floor(i / 3) * 22 + rng() * 6) + '%';
      win.style.animationDuration = (1.8 + rng() * 2.4) + 's';
      win.style.animationDelay = (-rng() * 3) + 's';
      b.appendChild(win);
    }
  }

  function renderFacilities() {
    const layer = $('layer-fac');
    layer.textContent = '';
    const rng = mulberry32(424242);
    const lv = state.lv;

    const fac = (id, shape, left, width, height) => {
      const b = document.createElement('div');
      b.className = 'bld ' + shape;
      b.dataset.fac = id;
      b.style.left = left + '%';
      b.style.width = width + '%';
      b.style.height = height + '%';
      layer.appendChild(b);
      return b;
    };

    // ランタン工房：小屋の隣。Lvに応じて灯る窓が増え、背も少し伸びる
    if (lv.lantern > 0) {
      const b = fac('lantern', 'shape-step', 64, 14, 13 + Math.min(lv.lantern, 12));
      facWindows(b, lv.lantern, 9, '', rng);
    }

    // 市場：屋台が増え、にぎわいの暖色グローが強まる
    if (lv.market > 0) {
      const stalls = 1 + Math.min(Math.floor((lv.market - 1) / 2), 4);
      const glow = document.createElement('div');
      glow.className = 'stall-glow';
      glow.dataset.fac = 'market';
      glow.style.left = '3%';
      glow.style.width = (stalls * 7 + 5) + '%';
      glow.style.height = '17%';
      glow.style.bottom = '8%';
      glow.style.opacity = Math.min(0.45 + lv.market * 0.05, 1);
      layer.appendChild(glow);
      for (let i = 0; i < stalls; i++) {
        const s = document.createElement('div');
        s.className = 'stall';
        s.dataset.fac = 'market';
        s.style.left = (5 + i * 7) + '%';
        s.style.width = '5.5%';
        s.style.height = (7 + Math.min(lv.market, 8) * 0.5) + '%';
        s.style.bottom = '8%';
        const w = document.createElement('span');
        w.className = 'win';
        w.style.left = '38%';
        w.style.top = '34%';
        w.style.animationDuration = (1.4 + rng() * 1.2) + 's';
        w.style.animationDelay = (-rng() * 2) + 's';
        s.appendChild(w);
        layer.appendChild(s);
      }
    }

    // 学問所：塔。窓に知的な青白い灯
    if (lv.school > 0) {
      const b = fac('school', 'shape-tower', 80, 11, 16 + Math.min(lv.school, 12) * 1.4);
      facWindows(b, lv.school, 8, 'win-cool', rng);
    }

    // 救護院：柔らかい白〜緑がかった優しい灯
    if (lv.clinic > 0) {
      const b = fac('clinic', 'shape-dome', 29, 13, 11 + Math.min(lv.clinic, 8));
      facWindows(b, lv.clinic, 6, 'win-soft', rng);
      const aura = document.createElement('div');
      aura.className = 'clinic-aura';
      aura.dataset.fac = 'clinic';
      aura.style.left = '26%';
      aura.style.width = '19%';
      aura.style.height = (16 + Math.min(lv.clinic, 8) * 1.5) + '%';
      aura.style.bottom = '8%';
      layer.appendChild(aura);
    }
    // 街灯網：renderCity のランタン光点の増加で表現する
  }

  /* 住人の灯：人が増える＝窓明かりが増える、を絵で一致させる */
  function renderResidentLights() {
    const box = $('resident-lights');
    box.textContent = '';
    const n = Math.min(Math.floor(residents() / 2), 60);
    const rng = mulberry32(state.maxStage * 100 + 9);
    for (let i = 0; i < n; i++) {
      const p = document.createElement('span');
      p.className = 'res-light';
      p.style.left = (3 + rng() * 94) + '%';
      p.style.bottom = (9 + rng() * 26) + '%';
      p.style.animationDuration = (2.2 + rng() * 3) + 's';
      p.style.animationDelay = (-rng() * 4) + 's';
      box.appendChild(p);
    }
  }

  /* 建設・そだてる時：対象の建物が光と共に出現/成長する */
  function animateFacility(id) {
    document.querySelectorAll('#layer-fac [data-fac="' + id + '"]').forEach(el => {
      el.classList.add('grow');
      el.addEventListener('animationend', () => el.classList.remove('grow'), { once: true });
    });
  }

  function renderCity() {
    const stage = state.maxStage;
    const cfg = CITY_CFG[stage];
    const rng = mulberry32(stage * 1000 + 7);

    // 段階アップ演出（flash）の途中で呼ばれてもアニメーションを切らない
    const flashing = cityEl.classList.contains('flash');
    cityEl.className = 'stage-' + stage + (flashing ? ' flash' : '');

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

    fillLayer($('layer-far'), cfg.far, rng, stage, 'far');
    fillLayer($('layer-mid'), cfg.mid, rng, stage, 'mid');
    fillLayer($('layer-near'), cfg.near, rng, stage, 'near');

    const amb = $('ambient-lights');
    amb.textContent = '';
    const lanternCount = cfg.lanterns + Math.min(state.lv.lights * 2, 16);
    for (let i = 0; i < lanternCount; i++) {
      const l = document.createElement('span');
      l.className = 'lantern';
      if (stage === 1 && i === 0) {
        // たった一つの灯は小屋の戸口に寄り添わせ、画面の主役にする
        l.classList.add('hero');
        l.style.left = '63%';
        l.style.bottom = '9%';
      } else {
        l.style.left = (4 + rng() * 92) + '%';
        l.style.bottom = (4 + rng() * 9) + '%';
      }
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

    renderFacilities();
    renderResidentLights();

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

  /* 祝祭演出：おめでとう!＋光の粒＋住人たちの歓声 */
  const CHEERS = ['わあっ!', 'あかるい!', 'きれい!', 'やったあ!', 'すごい!'];
  function playCelebration() {
    const cel = $('celebration');
    cel.textContent = '';
    cel.hidden = false;
    const title = document.createElement('div');
    title.id = 'cel-title';
    title.textContent = 'おめでとう!';
    cel.appendChild(title);
    for (let i = 0; i < 16; i++) {
      const sp = document.createElement('span');
      sp.className = 'cel-spark';
      sp.style.left = (5 + Math.random() * 90) + '%';
      sp.style.bottom = (Math.random() * 30) + '%';
      sp.style.animationDelay = (Math.random() * 0.5) + 's';
      sp.style.animationDuration = (0.9 + Math.random() * 0.7) + 's';
      cel.appendChild(sp);
    }
    for (let i = 0; i < 6; i++) {
      const c = document.createElement('span');
      c.className = 'cheer';
      c.textContent = CHEERS[i % CHEERS.length];
      c.style.left = (8 + Math.random() * 76) + '%';
      c.style.top = (28 + Math.random() * 45) + '%';
      c.style.animationDelay = (Math.random() * 0.6) + 's';
      cel.appendChild(c);
    }
    setTimeout(() => { cel.hidden = true; cel.textContent = ''; }, 1700);
  }

  /* ============================================================
     トースト（仲間の声・住人のお知らせ）
     ============================================================ */

  function showToast(node, cls) {
    const t = document.createElement('div');
    t.className = 'toast' + (cls ? ' ' + cls : '');
    t.appendChild(node);
    toastArea.appendChild(t);
    while (toastArea.children.length > 2) toastArea.firstChild.remove();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      t.classList.add('out');
      setTimeout(() => t.remove(), 350);
    };
    t.addEventListener('pointerdown', close);
    setTimeout(close, 3000);
    return t;
  }

  /* 仲間の一言（吹き出し。顔は描かず、キャラ色と紋章で表現） */
  function speak(charId, line) {
    const v = VOICES[charId];
    if (!v) return;
    const wrap = document.createDocumentFragment();
    const em = document.createElement('span');
    em.className = 'emblem';
    em.textContent = v.emblem;
    const body = document.createElement('span');
    body.className = 'voice-body';
    const name = document.createElement('span');
    name.className = 'voice-name';
    name.textContent = v.name;
    const text = document.createElement('span');
    text.appendChild(rubyText(line || v.lines[Math.floor(Math.random() * v.lines.length)]));
    body.appendChild(name);
    body.appendChild(text);
    wrap.appendChild(em);
    wrap.appendChild(body);
    showToast(wrap, 'voice ' + v.cls);
  }

  function infoToast(text) {
    const span = document.createElement('span');
    span.appendChild(rubyText(text));
    showToast(span, 'info');
  }

  /* ============================================================
     住人システム
     ============================================================ */

  function checkResidents() {
    const now = residents();
    const prev = state.lastResidents;
    if (now <= prev) return;
    const ms = RESIDENT_MILESTONES.find(m => prev < m.n && now >= m.n);
    if (ms) {
      infoToast('🏠 ' + ms.text);
    } else {
      infoToast('🏠 あたらしい住人が 越してきた!');
    }
    if (prev === 0) {
      setTimeout(() => speak(FIRST_RESIDENT_LINE.char, FIRST_RESIDENT_LINE.text), 600);
    }
    state.lastResidents = now;
    renderResidentLights();
  }

  /* ============================================================
     モーダル
     ============================================================ */

  let onModalClose = null;

  function openModal(title, bodyNode, closeLabel) {
    if (!bodyNode) return; // 中身のない（空の）モーダルは絶対に出さない
    modalTitle.textContent = title;
    modalBody.textContent = '';
    modalBody.appendChild(bodyNode);
    $('modal-close').textContent = closeLabel || 'とじる';
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
    if (unlockedFlag) {
      body.appendChild(rubyText(STORY[stageNum]));
    } else {
      body.textContent = `？？？（段階${stageNum}に なると よめるよ）`;
    }
    div.appendChild(head);
    div.appendChild(body);
    return div;
  }

  function showStoryModal(stageNum) {
    if (!STORY[stageNum]) return; // ストーリーが無い段階ではモーダルを出さない
    const wrap = document.createElement('div');
    wrap.appendChild(storyNode(stageNum, true));
    const you = document.createElement('div');
    you.className = 'story-you';
    you.textContent = 'あなたたちの街は『' + STAGES[stageNum - 1].name + '』になった。';
    wrap.appendChild(you);
    openModal('街のきろく', wrap, '物語をつづける');
  }

  function showRecordsModal() {
    const wrap = document.createElement('div');
    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'replay-btn';
    replay.textContent = '✦ やくそくを もういちど見る';
    replay.addEventListener('click', () => {
      closeModal();
      startOpening();
    });
    wrap.appendChild(replay);
    for (let s = 2; s <= 5; s++) {
      wrap.appendChild(storyNode(s, state.unlocked.includes(s)));
    }
    openModal('きろく — 街のあゆみ', wrap);
  }

  function showSettingsModal() {
    const wrap = document.createElement('div');

    const info = document.createElement('div');
    info.className = 'settings-row';
    info.textContent =
      'ゲームは この端末（たんまつ）に じどうで ほぞんされます。' +
      'さいごの ほぞん：' + new Date(state.lastSaved).toLocaleString('ja-JP');
    wrap.appendChild(info);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'danger-btn';
    btn.textContent = 'セーブデータを リセット';
    btn.addEventListener('click', () => {
      if (confirm('セーブデータを けして、さいしょから やりなおします。\nもとに もどせません。いいですか?')) {
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 失敗しても続行 */ }
        resetting = true;
        location.reload();
      }
    });
    wrap.appendChild(btn);

    openModal('せってい', wrap);
  }

  /* ============================================================
     オープニング「約束」
     ============================================================ */

  let opScene = 0;

  function showScene(n) {
    opScene = n;
    openingEl.className = 'scene-' + n;
    const text = $('op-text');
    const startBtn = $('op-start');
    const hint = $('op-next-hint');
    if (n <= 3) {
      rubyInto(text, OPENING_LINES[n - 1]);
      text.hidden = false;
      hint.hidden = false;
      startBtn.hidden = true;
    } else {
      text.hidden = true;
      hint.hidden = true;
      startBtn.hidden = false;
    }
  }

  function startOpening() {
    openingEl.classList.remove('depart');
    openingEl.hidden = false;
    showScene(1);
  }

  function finishOpening(withFlash) {
    if (!state.introSeen) {
      state.introSeen = true;
      save();
      // 約束のあと、最初の目標をやさしく示す
      setTimeout(() => infoToast(FIRST_GOAL_TOAST), withFlash ? 1100 : 400);
    }
    if (withFlash) {
      openingEl.classList.add('depart'); // 画面が暖かく明転する
      setTimeout(() => { openingEl.hidden = true; openingEl.classList.remove('depart'); }, 950);
    } else {
      openingEl.hidden = true;
    }
  }

  openingEl.addEventListener('pointerdown', e => {
    if (e.target.closest('#op-skip') || e.target.closest('#op-start')) return;
    if (opScene >= 1 && opScene < 4) showScene(opScene + 1);
  });
  $('op-skip').addEventListener('click', () => finishOpening(false));
  $('op-start').addEventListener('click', () => finishOpening(true));

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
      name.appendChild(rubyText(fac.name));
      const char = document.createElement('span');
      char.className = 'card-char chip-' + fac.char;
      char.textContent = VOICES[fac.char] ? VOICES[fac.char].name : '';
      if (fac.id === 'clinic') char.textContent = 'リーザのねがい';
      if (fac.id === 'lights') char.textContent = 'ユリウス';
      const lv = document.createElement('span');
      lv.className = 'card-lv';
      head.appendChild(name);
      head.appendChild(char);
      head.appendChild(lv);

      const desc = document.createElement('div');
      desc.className = 'card-effect';
      desc.appendChild(rubyText(fac.desc));

      const stat = document.createElement('div');
      stat.className = 'card-stat';
      const cost = document.createElement('div');
      cost.className = 'card-cost';

      info.appendChild(head);
      info.appendChild(desc);
      info.appendChild(stat);
      info.appendChild(cost);

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'buy-btn';
      btn.addEventListener('click', () => buy(fac.id));

      li.appendChild(info);
      li.appendChild(btn);
      listEl.appendChild(li);

      cardRefs[fac.id] = { lv, stat, cost, btn };
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
      r.stat.textContent = fac.stat(lv);

      r.cost.textContent = '';
      r.cost.appendChild(document.createTextNode('ひつよう：'));
      const m = document.createElement('span');
      m.className = okMaso ? 'ok' : 'ng';
      m.textContent = '✦' + fmt(c.maso);
      r.cost.appendChild(m);
      if (c.shizai > 0) {
        r.cost.appendChild(document.createTextNode('・'));
        const z = document.createElement('span');
        z.className = okShizai ? 'ok' : 'ng';
        z.textContent = '▤' + fmt(c.shizai);
        r.cost.appendChild(z);
      }

      r.btn.textContent = lv === 0 ? 'たてる' : 'そだてる';
      const afford = okMaso && okShizai;
      // たてられるようになった瞬間、ボタンをわずかに明滅させて気づかせる
      if (afford && r.wasAfford === false) {
        r.btn.classList.add('ping');
        clearTimeout(r.pingTimer);
        r.pingTimer = setTimeout(() => r.btn.classList.remove('ping'), 1900);
      }
      r.wasAfford = afford;
      r.btn.disabled = !afford;
    }
  }

  function buy(id) {
    const fac = FACILITIES.find(f => f.id === id);
    const c = costOf(fac, state.lv[id]);
    if (state.maso < c.maso || state.shizai < c.shizai) return;
    const wasFirstBuild = totalLv() === 0;
    state.maso -= c.maso;
    state.shizai -= c.shizai;
    state.lv[id]++;
    tapHint.classList.add('hidden');
    if (id === 'lights') {
      renderCity(); // 街灯網は光の本数に即反映
    } else {
      renderFacilities();
      animateFacility(id); // 建物が光と共に出現/成長する
    }
    // 仲間の一言（はじめての建設は、かならずレインが声をかける）
    if (wasFirstBuild) {
      speak(FIRST_BUILD_LINE.char, FIRST_BUILD_LINE.text);
    } else {
      speak(fac.char);
    }
    checkResidents();
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
    setTimeout(playCelebration, 250);      // おめでとう!の祝祭
    setTimeout(renderCity, 650);           // 光の波の中で街並みが切り替わる
    setTimeout(() => showStoryModal(s), 2000);
    onModalClose = () => {
      // 物語のあと、仲間がひとこと添える
      const chars = ['rein', 'baruto', 'aruno'];
      speak(chars[s % chars.length]);
    };
    save();
  }

  /* ============================================================
     タップ
     ============================================================ */

  let pulseTimer = 0;

  cityEl.addEventListener('pointerdown', e => {
    const g = tapGain();
    state.maso += g;
    tapHint.classList.add('hidden'); // 一度でも獲得したら誘導をフェードアウト

    // 街の灯が一瞬強く脈動する
    cityEl.classList.add('lantern-pulse');
    clearTimeout(pulseTimer);
    pulseTimer = setTimeout(() => cityEl.classList.remove('lantern-pulse'), 170);

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

    // 小さな光の粒が1〜3個ふわっと舞い上がる（同時表示数を制限）
    if (tapLayer.querySelectorAll('.spark').length < 18) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const sp = document.createElement('span');
        sp.className = 'spark';
        sp.style.left = (x + (Math.random() * 30 - 15)) + 'px';
        sp.style.top = (y + (Math.random() * 12 - 6)) + 'px';
        sp.style.setProperty('--dx', (Math.random() * 56 - 28).toFixed(0) + 'px');
        sp.style.animationDuration = (0.8 + Math.random() * 0.6) + 's';
        tapLayer.appendChild(sp);
        setTimeout(() => sp.remove(), 1500);
      }
    }

    setTimeout(() => { glow.remove(); num.remove(); }, 850);
    if (tapLayer.childElementCount > 40) tapLayer.firstElementChild.remove();

    updateAll();
  });

  /* ============================================================
     表示更新・メインループ
     ============================================================ */

  /* 表示値を実値に向かってカウントアップさせる（消費時は即時反映） */
  function easeShown() {
    for (const k of ['maso', 'shizai']) {
      const real = state[k];
      if (real < shown[k]) { shown[k] = real; continue; }
      const diff = real - shown[k];
      shown[k] = diff < 1 ? real : shown[k] + diff * 0.25;
    }
  }

  /* 次の目標を現在の状況から自動判定する */
  function currentGoal() {
    if (state.lv.lantern === 0) {
      return state.maso < 15
        ? 'ひかりを 集めよう（街をタップ!）'
        : 'ランタン工房を たてよう';
    }
    if (state.lv.market === 0) return '市場を たてよう';
    if (state.maxStage >= 2 && state.lv.school === 0) return '学問所を たてよう（もくざいが いる）';
    if (state.maxStage >= 3 && state.lv.clinic === 0) return '救護院を たてよう';
    if (state.maxStage >= 3 && state.lv.lights === 0) return '街灯網を つくろう';
    if (state.maxStage < 5) {
      const next = STAGES[state.maxStage];
      const rest = Math.max(0, next.th - devPoints());
      return 'かがやき' + next.th + 'で 『' + next.name + '』になる（あと' + rest + '）';
    }
    return 'ひかりの海を、もっと ひろげよう';
  }

  let lastGoal = '';
  function updateGoal() {
    const g = currentGoal();
    if (g === lastGoal) return;
    lastGoal = g;
    $('goal-text').textContent = g;
    const chip = $('goal-chip');
    chip.classList.remove('changed');
    void chip.offsetWidth;
    chip.classList.add('changed');
  }

  function updateResources() {
    $('res-maso').textContent = fmt(shown.maso);
    $('res-shizai').textContent = fmt(shown.shizai);
    $('rate-maso').textContent = '+' + trim1(masoPerSec()) + '/秒';
    $('rate-shizai').textContent = '+' + trim1(shizaiPerSec()) + '/秒';
    $('res-people').textContent = fmt(residents());
    const next = state.maxStage < 5 ? STAGES[state.maxStage] : null;
    $('stage-glow').textContent = next
      ? 'かがやき ' + fmt(devPoints()) + '／' + next.th
      : 'かがやき ' + fmt(devPoints());
  }

  function updateAll() {
    easeShown();
    updateResources();
    updateFacilityList();
    updateGoal();
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
        introSeen: state.introSeen,
        lastResidents: state.lastResidents,
        lastSaved: state.lastSaved,
      }));
    } catch (e) { /* プライベートモード等で保存できない場合は無視 */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || d.v !== 1) return false;
      state.maso = Number(d.maso) || 0;
      state.shizai = Number(d.shizai) || 0;
      for (const k of Object.keys(state.lv)) {
        state.lv[k] = Math.max(0, Math.floor(Number(d.lv && d.lv[k]) || 0));
      }
      state.unlocked = Array.isArray(d.unlocked)
        ? d.unlocked.filter(n => n >= 2 && n <= 5)
        : [];
      state.maxStage = Math.min(5, Math.max(1, Math.floor(Number(d.maxStage) || 1)));
      state.introSeen = d.introSeen !== false; // 既存セーブはオープニングを再表示しない
      state.lastSaved = Number(d.lastSaved) || Date.now();
      // 整合性：保存時より発展度が高ければ静かに段階を合わせる
      const s = stageFor(devPoints());
      if (s > state.maxStage) {
        for (let n = state.maxStage + 1; n <= s; n++) {
          if (STORY[n] && !state.unlocked.includes(n)) state.unlocked.push(n);
        }
        state.maxStage = s;
      }
      // 住人は再訪時にトーストの嵐にならないよう現在値に合わせる
      state.lastResidents = residents();
      return true;
    } catch (e) { /* 壊れたデータは無視して新規開始 */ }
    return false;
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
      if (tab === 'city' || tab === 'facility') {
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

  const hadSave = load();
  shown.maso = state.maso;
  shown.shizai = state.shizai;
  buildFacilityList();
  renderCity();
  updateAll();
  if (state.maso > 0 || totalLv() > 0) {
    tapHint.classList.add('hidden');
  }
  if (!hadSave && !state.introSeen) {
    startOpening(); // オープニング「約束」（初回のみ）
  }

  setInterval(tick, 100);
  setInterval(save, 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
    else lastTick = Date.now();
  });
  window.addEventListener('pagehide', save);
})();
