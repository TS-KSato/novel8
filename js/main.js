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

  /* 街ビューの描画方式の解決:
     ① Three.js 3D（既定。WebGL初期化に成功した場合）
     ② CSSジオラマ（3D不可時の自動フォールバック）
     ③ 旧・横から見た夜景（window.LIZA_USE_DIORAMA = false）
     window.LIZA_USE_3D = false で3Dを無効化できる。 */
  const viewMode = () => {
    if (window.LIZA_USE_3D !== false && window.LizaTown3D && window.LizaTown3D.ready) return '3d';
    if (window.LIZA_USE_DIORAMA !== false && window.LizaTown) return 'diorama';
    return 'classic';
  };
  const glOn = () => viewMode() === '3d';
  const dioramaOn = () => viewMode() === 'diorama';
  const townData = () => ({
    stage: state.maxStage,
    lv: state.lv,
    residents: residents(),
    decor: state.decor,
  });

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

  /* ---------- 昼夜サイクル ----------
     朝→昼→夕→夜。1周は実時間で約4分（定数で調整可能）。 */
  const PHASES = [
    { id: 'morning', dur: 50 },
    { id: 'day',     dur: 70 },
    { id: 'dusk',    dur: 50 },
    { id: 'night',   dur: 70 },
  ];
  const CYCLE_LEN = PHASES.reduce((a, p) => a + p.dur, 0); // 240秒
  const NIGHT_START = 170; // 物語は夜から始まる

  function phaseAt(pos) {
    let t = ((pos % CYCLE_LEN) + CYCLE_LEN) % CYCLE_LEN;
    for (const p of PHASES) {
      if (t < p.dur) return p.id;
      t -= p.dur;
    }
    return 'night';
  }

  /* ---------- ねがいぼし ----------
     ときどき空に現れる小さな奇跡。タップでまとめて獲得。 */
  const WISH_MIN_WAIT = 45, WISH_MAX_WAIT = 90; // 出現間隔（秒）
  const WISH_LIFE = 6;                          // 出現している時間（秒）
  const WISH_HARVEST_SEC = 45;                  // 自動生産の何秒ぶんか

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
    '昔、ここには何もなかった。あったのは、小さなランタンがひとつだけ。',
    'これは、大切な友人が｛遺|のこ｝してくれた灯。『この灯を、いつか街いっぱいの光にしてね』',
    'レインたちは約束した。——君も、一緒に来てくれるか?',
  ];
  const FIRST_GOAL_TOAST = 'まずはランタンの灯に光を集めよう（街をタップ!）';

  /* ストーリーメッセージ（段階到達時・原文のまま、ふりがな付き） */
  const STORY = {
    2: 'レイン『……まずは雨風をしのげる場所からだ。少しずつでいい、確かめながら進めよう』',
    3: 'バルト『見ろよ、灯りが増えてきた。人が集まる所には商いが生まれる。ここからが本番だぜ』',
    4: 'アルノ『記録した数字は嘘をつきません。この街は、確かに育っています』',
    5: '夜の｛帳|とばり｝が下りる瞬間、｛街灯網|がいとうもう｝が波打つように一斉に灯った。かつてたった一つのランタンだった光が、いま、街全体を照らしている。爽やかな風が、街を吹き抜けていった。',
  };

  /* ---------- ものがたり図鑑 ----------
     条件をみたすと1ページずつ解放される読み物（各150字以内）。
     リーザの死の経緯・詳細、恋愛要素は書かない。 */
  const STORYBOOK = [
    {
      id: 'world', title: 'この世界',
      hint: '初めから読める',
      cond: () => true,
      text: 'この世界では、生まれ持った魔力の強さで人の偉さが決まるという。強い光の家に生まれた子は偉く、弱い光の子は下を向いて歩く。——でも、本当にそうだろうか?',
    },
    {
      id: 'rein', title: 'レイン',
      hint: 'ランタン工房がLv3になると…',
      cond: s => s.lv.lantern >= 3,
      text: '魔力が弱いと笑われた少年。けれど「よく見て、試して、記録する」ことだけは、誰にも負けなかった。みんなが無理だと言うことを、レインは何度でも確かめた。',
    },
    {
      id: 'baruto', title: 'バルト',
      hint: '市場がLv3になると…',
      cond: s => s.lv.market >= 3,
      text: '誰とでもすぐ友達になれる少年。物の値段と、人の気持ちのプロ。「いい商いはな、みんなが笑顔になるんだぜ」が口癖。',
    },
    {
      id: 'aruno', title: 'アルノ',
      hint: '学問所がLv3になると…',
      cond: s => s.lv.school >= 3,
      text: '数字と星を読む、物静かな少年。レインの「こうかもしれない」を、確かな数字で本物の魔法に変える、大切な相棒。',
    },
    {
      id: 'lanternlight', title: 'ランタンの灯',
      hint: '街が「開拓の集落」になると…',
      cond: s => s.maxStage >= 2,
      text: 'レインたちには、4人目の友達がいた。このランタンは、その子が何よりも大切にしていたもの。灯りを見つめると、なぜだかみんな、優しい気持ちになれた。',
    },
    {
      id: 'lizaname', title: 'リーザという名前',
      hint: '街が「灯りの街」になると…',
      cond: s => s.maxStage >= 3,
      text: '街の名前になった少女のこと。「理由も分からないまま困ってしまう人を、減らしたい」——それが彼女の夢だった。街は、その名前とともに育っていく。',
    },
    {
      id: 'clinicsecret', title: '救護院の秘密',
      hint: '救護院がLv5になると…',
      cond: s => s.lv.clinic >= 5,
      text: '｛救護院|きゅうごいん｝に来る人は、みんなどこか安心した顔になる。リーザの夢は、今もこの建物の中で生きている。だからここの灯は、少し優しい色をしている。',
    },
    {
      id: 'promise', title: '光の都の約束',
      hint: '街が「光の都リーザ」になると…',
      cond: s => s.maxStage >= 5,
      text: '小さな灯は、街いっぱいの光になった。約束は、果たされた。——それでも、街はこれからも育っていく。新しい朝も、新しい夜も、この街の光はもう消えない。',
    },
  ];

  /* ---------- 施設定義 ---------- */
  const FACILITIES = [
    {
      id: 'lantern', name: 'ランタン工房', char: 'rein',
      base: { maso: 15, shizai: 0 },
      desc: 'レインがランタンを灯す場所。光が自動で集まる',
      stat: lv => '現在 ✦+' + trim1(lv) + '/秒',
    },
    {
      id: 'market', name: '市場', char: 'baruto',
      base: { maso: 25, shizai: 0 },
      desc: 'バルトの元気な声が響く。木材が自動で集まる',
      stat: lv => '現在 ▤+' + trim1(lv * 0.5) + '/秒',
    },
    {
      id: 'school', name: '学問所', char: 'aruno',
      base: { maso: 70, shizai: 6 },
      desc: 'アルノが数字と星を調べる。タップで集まる光が増える',
      stat: lv => '現在 タップ✦+' + (1 + lv),
    },
    {
      id: 'clinic', name: '｛救護院|きゅうごいん｝', char: 'rein',
      base: { maso: 250, shizai: 30 },
      desc: 'リーザの願いを継いだ場所。街のみんなの仕事が捗る',
      stat: lv => '現在 自動生産 +' + lv * 10 + '%',
    },
    {
      id: 'lights', name: '｛街灯網|がいとうもう｝', char: 'baruto',
      base: { maso: 600, shizai: 80 },
      desc: '街の隅々まで灯りを届ける',
      stat: lv => '現在 輝き +' + lv * 5,
    },
  ];

  /* ---------- 仲間の声 ---------- */
  const VOICES = {
    rein: {
      name: 'レイン', cls: 'v-rein', emblem: '🕯',
      lines: [
        '……うん、いい感じだ',
        '確かめながら、進もう',
        '灯りがひとつ、増えたね',
        '静かな夜ほど、光はよく見える',
        'この調子で、いこう',
        '……あの約束に、少し近づいた',
      ],
    },
    baruto: {
      name: 'バルト', cls: 'v-baruto', emblem: '⚖',
      lines: [
        'よっしゃ、商売繁盛!',
        '人が集まりゃ街は育つぜ!',
        'いいねえ、賑やかになってきた!',
        '腹が減ったら市場に来な!',
        'でっかくいこうぜ!',
      ],
    },
    aruno: {
      name: 'アルノ', cls: 'v-aruno', emblem: '✒',
      lines: [
        '記録しておきます',
        '数字は嘘をつきません',
        '順調です。とても',
        '今夜は星の位置も良いようです',
        '計算どおり……いえ、それ以上です',
      ],
    },
  };
  const FIRST_BUILD_LINE = { char: 'rein', text: '……うん、いい感じだ。始まりの一歩だね' };
  const FIRST_RESIDENT_LINE = { char: 'baruto', text: 'お、初めての住人だ! 賑やかになるぜ!' };

  /* ---------- 住人の節目（職業＋一言） ---------- */
  const RESIDENT_MILESTONES = [
    { n: 5,    text: 'パン屋のハンナ『いい匂いで、みんなを呼び寄せるわ』' },
    { n: 10,   text: '花屋のミレイユ『窓辺に花があると、笑顔が増えるの』' },
    { n: 20,   text: '小人の大工 ドン『いい木だ。屋根は俺が直してやろう』' },
    { n: 50,   text: '漁師の少年テオ『川で大物が釣れたんだ!』' },
    { n: 100,  text: '糸紡ぎのリダ婆さん『温かい毛糸を編んであげようね』' },
    { n: 200,  text: '鍛冶屋のガロ『火花だって、街の灯の仲間さ』' },
    { n: 350,  text: '旅の楽士ピポ『この街の歌を作ったよ。聴きたい?』' },
    { n: 500,  text: '星読みのナジュ『星もこの街を見下ろして笑っている』' },
    { n: 750,  text: '葡萄園のフェルマ『実りの季節が楽しみだね』' },
    { n: 1000, text: '郵便屋のクルト『届けたい手紙が増えるのは、いい街の証だよ』' },
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
    cyclePos: NIGHT_START, // 昼夜サイクルの位相（秒）
    pages: [],         // 解放済みの図鑑ページid
    questActive: [],   // 受領中のおねがいid（最大2）
    questDone: [],     // 達成済みのおねがいid
    decor: [],         // 報酬で街に置かれた装飾id（永続）
    boost: null,       // 二択型の一時ブースト {kind, mult, until}
    questUnread: false,
    lastSaved: Date.now(),
  };

  /* 表示用のカウントアップ値（実値に向かって滑らかに増える） */
  const shown = { maso: 0, shizai: 0 };

  /* ---------- 派生値 ---------- */
  const autoBonus = () => 1 + state.lv.clinic * 0.1;
  const masoPerSec = () => state.lv.lantern * autoBonus() * questBoostMult('maso');
  const shizaiPerSec = () => state.lv.market * 0.5 * autoBonus() * questBoostMult('shizai');
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
          win.style.setProperty('--lit-delay', (rng() * 18).toFixed(1) + 's'); // 夕方に順に点灯
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
      win.style.setProperty('--lit-delay', (rng() * 14).toFixed(1) + 's');
      b.appendChild(win);
    }
  }

  function renderFacilities() {
    if (glOn()) {
      window.LizaTown3D.render(townData());
      return;
    }
    if (dioramaOn()) {
      window.LizaTown.render(townData());
      return;
    }
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
        w.style.setProperty('--lit-delay', (rng() * 12).toFixed(1) + 's');
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
    if (glOn()) {
      window.LizaTown3D.render(townData()); // 民家として反映される
      return;
    }
    if (dioramaOn()) {
      window.LizaTown.render(townData()); // 民家・灯の密度として反映される
      return;
    }
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
      p.style.setProperty('--lit-delay', (rng() * 18).toFixed(1) + 's');
      box.appendChild(p);
    }
  }

  /* 建設・そだてる時：対象の建物が光と共に出現/成長する */
  function animateFacility(id) {
    if (glOn()) {
      window.LizaTown3D.animateFacility(id);
      return;
    }
    if (dioramaOn()) {
      window.LizaTown.animateFacility(id);
      return;
    }
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
    cityEl.className = 'stage-' + stage + ' t-' + phaseAt(state.cyclePos) +
      (glOn() ? ' gl' : dioramaOn() ? ' diorama' : '') + (flashing ? ' flash' : '');

    if (glOn()) {
      // 3D描画：DOM側のレイヤーと空はすべて空にして、シーンに一括で描く
      for (const id of ['layer-far', 'layer-mid', 'layer-near', 'layer-fac',
        'resident-lights', 'ambient-lights', 'stars']) {
        $(id).textContent = '';
      }
      window.LizaTown3D.render(townData());
      $('stage-no').textContent = '段階 ' + stage;
      $('stage-name').textContent = STAGES[stage - 1].name;
      return;
    }

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

    if (dioramaOn()) {
      // ジオラマ描画：旧レイヤーは空にして、盤面に一括で描く
      for (const id of ['layer-far', 'layer-mid', 'layer-near', 'layer-fac',
        'resident-lights', 'ambient-lights']) {
        $(id).textContent = '';
      }
      window.LizaTown.render(townData());
      $('stage-no').textContent = '段階 ' + stage;
      $('stage-name').textContent = STAGES[stage - 1].name;
      return;
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
      l.style.setProperty('--lit-delay', (rng() * 10).toFixed(1) + 's');
      amb.appendChild(l);
    }
    for (let i = 0; i < cfg.sea; i++) {
      const p = document.createElement('span');
      p.className = 'sea-light';
      p.style.left = rng() * 100 + '%';
      p.style.bottom = (8 + rng() * 30) + '%';
      p.style.animationDuration = (3 + rng() * 4) + 's';
      p.style.animationDelay = (-rng() * 5) + 's';
      p.style.setProperty('--lit-delay', (rng() * 16).toFixed(1) + 's');
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
  const CHEERS = ['わあっ!', '明るい!', 'きれいだ!', 'やった!', 'すごい!'];
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
      infoToast('🏠 新しい住人が越してきた!');
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
    if (unlockedFlag) {
      body.appendChild(rubyText(STORY[stageNum]));
    } else {
      body.textContent = `？？？（段階${stageNum}に到達すると読める）`;
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
    openModal('街の記録', wrap, '物語を続ける');
  }

  function showRecordsModal() {
    const wrap = document.createElement('div');
    const replay = document.createElement('button');
    replay.type = 'button';
    replay.className = 'replay-btn';
    replay.textContent = '✦ 約束をもう一度見る';
    replay.addEventListener('click', () => {
      closeModal();
      startOpening();
    });
    wrap.appendChild(replay);

    // ① 街のあゆみ
    const h1 = document.createElement('div');
    h1.className = 'zukan-head';
    h1.textContent = '— 街のあゆみ —';
    wrap.appendChild(h1);
    for (let s = 2; s <= 5; s++) {
      wrap.appendChild(storyNode(s, state.unlocked.includes(s)));
    }

    // ② ものがたり（条件達成で1ページずつ解放）
    const h2 = document.createElement('div');
    h2.className = 'zukan-head';
    h2.textContent = '— ものがたり —';
    wrap.appendChild(h2);
    for (const page of STORYBOOK) {
      const unlockedPage = state.pages.includes(page.id);
      const card = document.createElement('div');
      card.className = 'page-card' + (unlockedPage ? '' : ' page-locked');
      const title = document.createElement('div');
      title.className = 'page-title';
      title.textContent = unlockedPage ? '📖 ' + page.title : '📖 ？？？';
      const body = document.createElement('div');
      body.className = 'page-text';
      if (unlockedPage) {
        body.appendChild(rubyText(page.text));
      } else {
        body.textContent = page.hint;
      }
      card.appendChild(title);
      card.appendChild(body);
      wrap.appendChild(card);
    }

    openModal('図鑑', wrap);
  }

  /* 図鑑ページの解放チェック（silent=trueはロード時の整合用） */
  function checkPages(silent) {
    let added = false;
    for (const page of STORYBOOK) {
      if (!state.pages.includes(page.id) && page.cond(state)) {
        state.pages.push(page.id);
        added = true;
      }
    }
    if (added && !silent) {
      infoToast('📖 図鑑に新しいページが増えた!');
    }
    return added;
  }

  function showSettingsModal() {
    const wrap = document.createElement('div');

    const info = document.createElement('div');
    info.className = 'settings-row';
    info.textContent =
      'ゲームはこの端末に自動で保存されます。最終保存：' + new Date(state.lastSaved).toLocaleString('ja-JP');
    wrap.appendChild(info);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'danger-btn';
    btn.textContent = 'セーブデータをリセット';
    btn.addEventListener('click', () => {
      if (confirm('セーブデータを削除して、最初からやり直します。\nこの操作は取り消せません。よろしいですか?')) {
        try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* 失敗しても続行 */ }
        resetting = true;
        location.reload();
      }
    });
    wrap.appendChild(btn);

    openModal('設定', wrap);
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
      r.cost.appendChild(document.createTextNode('必要：'));
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

      r.btn.textContent = lv === 0 ? '建てる' : '育てる';
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
    }
    // 仲間の一言（はじめての建設は、かならずレインが声をかける）
    if (wasFirstBuild) {
      speak(FIRST_BUILD_LINE.char, FIRST_BUILD_LINE.text);
    } else {
      speak(fac.char);
    }
    checkResidents();
    checkStage();
    checkPages(false); // 図鑑の新ページ解放チェック
    updateAll();
    save();
    // 建物が光と共に出現/成長する演出。
    // （住人処理などで盤面が再描画された後に付けないと消えてしまう）
    animateFacility(id);
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
     ねがいぼし（昼=光る蝶、夜=流れ星。タップでまとめて獲得）
     ============================================================ */

  let wishTimer = 0;

  function wishReward() {
    // その時点の自動生産45秒ぶん（序盤は固定15）
    return {
      maso: Math.max(15, Math.floor(masoPerSec() * WISH_HARVEST_SEC)),
      shizai: Math.floor(shizaiPerSec() * WISH_HARVEST_SEC),
    };
  }

  function scheduleWish() {
    clearTimeout(wishTimer);
    const wait = (WISH_MIN_WAIT + Math.random() * (WISH_MAX_WAIT - WISH_MIN_WAIT)) * 1000;
    wishTimer = setTimeout(spawnWish, wait);
  }

  /* 願い星キャッチの共通処理（獲得＋輝きの演出） */
  function grantWishAt(x, y) {
    const r = wishReward();
    state.maso += r.maso;
    state.shizai += r.shizai;
    const num = document.createElement('span');
    num.className = 'tap-num wish-num';
    num.textContent = '+' + fmt(r.maso) + ' ✦' + (r.shizai > 0 ? '  +' + fmt(r.shizai) + ' ▤' : '');
    num.style.left = x + 'px';
    num.style.top = y + 'px';
    tapLayer.appendChild(num);
    for (let i = 0; i < 5; i++) {
      const sp = document.createElement('span');
      sp.className = 'spark bright';
      sp.style.left = (x + (Math.random() * 36 - 18)) + 'px';
      sp.style.top = (y + (Math.random() * 16 - 8)) + 'px';
      sp.style.setProperty('--dx', (Math.random() * 64 - 32).toFixed(0) + 'px');
      tapLayer.appendChild(sp);
      setTimeout(() => sp.remove(), 1500);
    }
    setTimeout(() => num.remove(), 1100);
    updateAll();
    save();
  }

  function spawnWish() {
    // 開いている画面でだけ現れる（オープニング中・非表示タブは見送り）
    if (document.visibilityState === 'hidden' || !openingEl.hidden) {
      scheduleWish();
      return;
    }
    const phase = phaseAt(state.cyclePos);
    const isStar = phase === 'night' || phase === 'dusk';

    // 3Dビューでは星／蝶が3D空間内に現れる
    if (glOn()) {
      const ok = window.LizaTown3D.spawnWish(isStar ? 'star' : 'butterfly', () => {
        const p = window.LizaTown3D.lanternPoint() ||
          { x: cityEl.clientWidth / 2, y: cityEl.clientHeight / 2 };
        grantWishAt(p.x, p.y);
        scheduleWish();
      });
      if (ok) {
        window.LizaTown3D.onWishExpire = () => scheduleWish();
        return;
      }
    }

    const layer = $('wish-layer');
    layer.textContent = '';

    const w = document.createElement('button');
    w.type = 'button';
    w.className = 'wish ' + (isStar ? 'wish-star' : 'wish-butterfly');
    w.setAttribute('aria-label', '願い星');
    w.style.left = (10 + Math.random() * 72) + '%';
    w.style.top = (8 + Math.random() * 30) + '%';
    const core = document.createElement('span');
    core.className = 'wish-core';
    w.appendChild(core);

    let caught = false;
    w.addEventListener('pointerdown', e => {
      e.stopPropagation(); // 街タップと二重取りにしない
      if (caught) return;
      caught = true;
      const rect = cityEl.getBoundingClientRect();
      grantWishAt(e.clientX - rect.left, e.clientY - rect.top);
      w.remove();
      scheduleWish();
    });

    layer.appendChild(w);
    setTimeout(() => {
      if (!caught) {
        w.classList.add('gone');
        setTimeout(() => w.remove(), 600);
        scheduleWish();
      }
    }, WISH_LIFE * 1000);
  }

  /* ============================================================
     街のおねがい（依頼システム）
     納品型 / 達成型 / 二択型。報酬の装飾は3Dの街に置かれ永続する。
     ============================================================ */

  const QUEST_TEMPLATES = [
    // 納品型（5種）— 報酬に装飾が付き、街が実際に豊かになる
    { id: 'd_wood80', type: 'delivery', res: 'shizai', amount: 80,
      title: '木材を80届けてほしい', from: '小人の大工 ドン',
      note: '広場の花壇を作りたいんだ。',
      reward: { maso: 250, decor: 'flowerbed' }, minStage: 2 },
    { id: 'd_light300', type: 'delivery', res: 'maso', amount: 300,
      title: '光を300届けてほしい', from: 'パン屋のハンナ',
      note: '夜明け前の仕込みに、灯りが要るのよ。',
      reward: { shizai: 80, decor: 'bench' }, minStage: 2 },
    { id: 'd_wood200', type: 'delivery', res: 'shizai', amount: 200,
      title: '木材を200届けてほしい', from: '花屋のミレイユ',
      note: '祝祭の旗を立てましょう。',
      reward: { maso: 700, decor: 'flagpole' }, minStage: 3 },
    { id: 'd_light1200', type: 'delivery', res: 'maso', amount: 1200,
      title: '光を1200届けてほしい', from: '星読みのナジュ',
      note: '広場に小さな噴水を。水面に星が映るわ。',
      reward: { shizai: 300, decor: 'fountain' }, minStage: 3 },
    { id: 'd_wood500', type: 'delivery', res: 'shizai', amount: 500,
      title: '木材を500届けてほしい', from: '鍛冶屋のガロ',
      note: '「光の像」を鋳よう。この街の証だ。',
      reward: { maso: 2400, decor: 'statue' }, minStage: 4 },
    // 達成型（4種）
    { id: 'a_school5', type: 'achieve', title: '学問所をLv5にしてほしい',
      from: 'アルノ', speaker: 'aruno', note: '調べたいことが増えました。',
      cond: () => state.lv.school >= 5, reward: { maso: 600 }, minStage: 2 },
    { id: 'a_lantern8', type: 'achieve', title: 'ランタン工房をLv8にしてほしい',
      from: 'レイン', speaker: 'rein', note: '灯りはまだ足りない。',
      cond: () => state.lv.lantern >= 8, reward: { maso: 1500 }, minStage: 3 },
    { id: 'a_residents30', type: 'achieve', title: '住人を30人に増やしてほしい',
      from: 'バルト', speaker: 'baruto', note: '賑わいこそ街の力だぜ。',
      cond: () => residents() >= 30, reward: { shizai: 180 }, minStage: 2 },
    { id: 'a_clinic1', type: 'achieve', title: '救護院を建ててほしい',
      from: '糸紡ぎのリダ婆さん', note: '安心して暮らせる場所が要るんだよ。',
      cond: () => state.lv.clinic >= 1, reward: { maso: 500 }, minStage: 3 },
    // 二択型（2種）— どちらを選んでも正解だが、効果が異なる
    { id: 'c_festival', type: 'choice', title: '祭りの準備、どちらを手伝う?',
      from: 'バルト', note: '人手が足りないんだ。頼む!',
      options: [
        { key: 'market', label: '市場を手伝う', boost: { kind: 'shizai', mult: 1.25, min: 10 },
          line: 'よっしゃ、市場は任せた! 10分間、木材の集まりが+25%だ!' },
        { key: 'school', label: '学問所を手伝う', boost: { kind: 'maso', mult: 1.25, min: 10 },
          line: '助かります。10分間、光の集まりが+25%です。' },
      ], minStage: 2 },
    { id: 'c_visit', type: 'choice', title: '隣街の使者が来た。どこを案内する?',
      from: 'レイン', note: 'この街の良さを、どう伝えよう。',
      options: [
        { key: 'lantern', label: 'ランタン工房を案内', boost: { kind: 'maso', mult: 1.2, min: 10 },
          line: '使者は灯りに見とれていた。10分間、光の集まりが+20%。' },
        { key: 'clinic', label: '救護院を案内', boost: { kind: 'all', mult: 1.15, min: 10 },
          line: '使者は深くうなずいた。10分間、すべての生産が+15%。' },
      ], minStage: 3 },
  ];
  const QUEST_MAX_ACTIVE = 2;

  function questEligible() {
    return QUEST_TEMPLATES.filter(q =>
      state.maxStage >= q.minStage &&
      !state.questActive.includes(q.id) &&
      !state.questDone.includes(q.id));
  }

  function spawnQuest(forceId) {
    if (state.questActive.length >= QUEST_MAX_ACTIVE) return null;
    let tpl = null;
    if (forceId) {
      tpl = QUEST_TEMPLATES.find(q => q.id === forceId);
      if (!tpl || state.questActive.includes(tpl.id) || state.questDone.includes(tpl.id)) return null;
    } else {
      const pool = questEligible();
      if (pool.length === 0) return null;
      tpl = pool[Math.floor(Math.random() * pool.length)];
    }
    state.questActive.push(tpl.id);
    state.questUnread = true;
    infoToast('📋 街のおねがいが届いた!');
    updateQuestBadge();
    save();
    return tpl.id;
  }

  let questTimer = 0;
  function scheduleQuestCheck() {
    clearTimeout(questTimer);
    questTimer = setTimeout(() => {
      if (document.visibilityState !== 'hidden' && openingEl.hidden) spawnQuest();
      scheduleQuestCheck();
    }, 60000 + Math.random() * 40000);
  }

  function questBoostMult(kind) {
    const b = state.boost;
    if (!b || Date.now() > b.until) return 1;
    return (b.kind === kind || b.kind === 'all') ? b.mult : 1;
  }

  function questRewardText(reward) {
    const parts = [];
    if (reward.maso) parts.push('✦' + fmt(reward.maso));
    if (reward.shizai) parts.push('▤' + fmt(reward.shizai));
    if (reward.decor && window.LizaTownModel) {
      parts.push('装飾「' + window.LizaTownModel.DECOR_DEFS[reward.decor].name + '」');
    }
    return parts.join('・');
  }

  function completeQuest(tpl, extraLine) {
    state.questActive = state.questActive.filter(id => id !== tpl.id);
    state.questDone.push(tpl.id);
    if (tpl.reward) {
      if (tpl.reward.maso) state.maso += tpl.reward.maso;
      if (tpl.reward.shizai) state.shizai += tpl.reward.shizai;
      if (tpl.reward.decor && !state.decor.includes(tpl.reward.decor)) {
        state.decor.push(tpl.reward.decor);
        renderFacilities(); // 装飾が街に実際に置かれる
      }
    }
    infoToast('🎉 「' + tpl.from + '」のおねがいを達成! ' + (tpl.reward ? questRewardText(tpl.reward) : ''));
    if (tpl.speaker) setTimeout(() => speak(tpl.speaker, extraLine), 800);
    updateQuestBadge();
    updateAll();
    save();
  }

  /* 納品型: 資源を持っていれば届けられる */
  function claimDelivery(tplId) {
    const tpl = QUEST_TEMPLATES.find(q => q.id === tplId);
    if (!tpl || tpl.type !== 'delivery' || !state.questActive.includes(tplId)) return false;
    if (state[tpl.res] < tpl.amount) return false;
    state[tpl.res] -= tpl.amount;
    completeQuest(tpl);
    return true;
  }

  /* 達成型: 条件を満たしていれば報告できる */
  function claimAchieve(tplId) {
    const tpl = QUEST_TEMPLATES.find(q => q.id === tplId);
    if (!tpl || tpl.type !== 'achieve' || !state.questActive.includes(tplId)) return false;
    if (!tpl.cond()) return false;
    completeQuest(tpl);
    return true;
  }

  /* 二択型: どちらを選んでも正解。選んだ側に一時ブースト */
  function chooseQuest(tplId, optionKey) {
    const tpl = QUEST_TEMPLATES.find(q => q.id === tplId);
    if (!tpl || tpl.type !== 'choice' || !state.questActive.includes(tplId)) return false;
    const opt = tpl.options.find(o => o.key === optionKey);
    if (!opt) return false;
    state.boost = {
      kind: opt.boost.kind,
      mult: opt.boost.mult,
      until: Date.now() + opt.boost.min * 60 * 1000,
    };
    state.questActive = state.questActive.filter(id => id !== tplId);
    state.questDone.push(tplId);
    infoToast('✨ ' + opt.line);
    updateQuestBadge();
    updateAll();
    save();
    return true;
  }

  function updateQuestBadge() {
    const badge = $('quest-badge');
    const n = state.questActive.length;
    badge.textContent = String(n);
    badge.hidden = n === 0;
    $('quest-board-btn').classList.toggle('unread', !!state.questUnread && n > 0);
  }

  function showQuestModal() {
    state.questUnread = false;
    updateQuestBadge();
    const wrap = document.createElement('div');
    if (state.questActive.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'settings-row';
      empty.textContent = '今は新しいおねがいは届いていない。街が育てば、また誰かが頼ってくる。';
      wrap.appendChild(empty);
    }
    for (const id of state.questActive) {
      const tpl = QUEST_TEMPLATES.find(q => q.id === id);
      if (!tpl) continue;
      const card = document.createElement('div');
      card.className = 'quest-card';
      const head = document.createElement('div');
      head.className = 'quest-from';
      head.textContent = tpl.from;
      const title = document.createElement('div');
      title.className = 'quest-title';
      title.textContent = tpl.title;
      const note = document.createElement('div');
      note.className = 'quest-note';
      note.textContent = '「' + tpl.note + '」';
      card.appendChild(head);
      card.appendChild(title);
      card.appendChild(note);

      if (tpl.type === 'delivery') {
        const prog = document.createElement('div');
        prog.className = 'quest-prog';
        const cur = Math.floor(state[tpl.res]);
        prog.textContent = '所持: ' + (tpl.res === 'maso' ? '✦' : '▤') + fmt(cur) + ' ／ ' + tpl.amount;
        card.appendChild(prog);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quest-btn';
        btn.textContent = '届ける（報酬: ' + questRewardText(tpl.reward) + '）';
        btn.disabled = cur < tpl.amount;
        btn.addEventListener('click', () => { if (claimDelivery(tpl.id)) showQuestModal(); });
        card.appendChild(btn);
      } else if (tpl.type === 'achieve') {
        const done = tpl.cond();
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'quest-btn';
        btn.textContent = done
          ? '達成を報告する（報酬: ' + questRewardText(tpl.reward) + '）'
          : 'まだ達成していない（報酬: ' + questRewardText(tpl.reward) + '）';
        btn.disabled = !done;
        btn.addEventListener('click', () => { if (claimAchieve(tpl.id)) showQuestModal(); });
        card.appendChild(btn);
      } else if (tpl.type === 'choice') {
        for (const opt of tpl.options) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'quest-btn quest-choice';
          btn.textContent = opt.label;
          btn.addEventListener('click', () => { if (chooseQuest(tpl.id, opt.key)) closeModal(); });
          card.appendChild(btn);
        }
      }
      wrap.appendChild(card);
    }
    openModal('街のおねがい', wrap);
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
    // ジオラマでは「はじまりのランタン」から舞い上がる。夜は粒が華やぐ
    let sx = x, sy = y;
    if (glOn()) {
      const p = window.LizaTown3D.lanternPoint();
      if (p) { sx = p.x; sy = p.y; }
    } else if (dioramaOn()) {
      const p = window.LizaTown.lanternPoint();
      if (p) { sx = p.x; sy = p.y; }
    }
    const nightly = phaseAt(state.cyclePos) === 'night';
    if (tapLayer.querySelectorAll('.spark').length < 18) {
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const sp = document.createElement('span');
        sp.className = 'spark' + (nightly ? ' bright' : '');
        sp.style.left = (sx + (Math.random() * 30 - 15)) + 'px';
        sp.style.top = (sy + (Math.random() * 12 - 6)) + 'px';
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
        ? '光を集めよう（街をタップ!）'
        : 'ランタン工房を建てよう';
    }
    // 2種類以上たてられるときは、選択を奪わない問いかけにする
    let affordable = 0;
    for (const fac of FACILITIES) {
      const c = costOf(fac, state.lv[fac.id]);
      if (state.maso >= c.maso && state.shizai >= c.shizai) affordable++;
    }
    if (affordable >= 2) return '次はどれを育てる?';
    if (state.lv.market === 0) return '市場を建てよう';
    if (state.maxStage >= 2 && state.lv.school === 0) return '学問所を建てよう（木材が必要）';
    if (state.maxStage >= 3 && state.lv.clinic === 0) return '救護院を建てよう';
    if (state.maxStage >= 3 && state.lv.lights === 0) return '街灯網を整備しよう';
    if (state.maxStage < 5) {
      const next = STAGES[state.maxStage];
      const rest = Math.max(0, next.th - devPoints());
      return '輝き' + next.th + 'で『' + next.name + '』になる（あと' + rest + '）';
    }
    return '光の海を、さらに広げよう';
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
      ? '輝き ' + fmt(devPoints()) + '／' + next.th
      : '輝き ' + fmt(devPoints());
  }

  function updateAll() {
    easeShown();
    updateResources();
    updateFacilityList();
    updateGoal();
  }

  /* 昼夜サイクル：位相を進め、変わり目でクラスを切り替える
     （色の変化そのものはCSS transitionが約30秒かけて行う） */
  let appliedPhase = '';
  function updatePhase() {
    const p = phaseAt(state.cyclePos);
    if (p === appliedPhase) return;
    appliedPhase = p;
    for (const ph of PHASES) cityEl.classList.remove('t-' + ph.id);
    cityEl.classList.add('t-' + p);
  }

  let lastTick = Date.now();
  function tick() {
    const now = Date.now();
    let dt = (now - lastTick) / 1000;
    lastTick = now;
    if (dt <= 0) return;
    if (dt > 300) dt = 300; // バックグラウンド復帰時の暴走防止

    state.cyclePos = (state.cyclePos + dt) % CYCLE_LEN;
    updatePhase();
    if (glOn()) window.LizaTown3D.setCycle(state.cyclePos, CYCLE_LEN);
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
        cyclePos: state.cyclePos,
        pages: state.pages,
        questActive: state.questActive,
        questDone: state.questDone,
        decor: state.decor,
        boost: state.boost,
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
      // 昼夜サイクルは保存した位相の続きから流れる
      const pos = Number(d.cyclePos);
      state.cyclePos = Number.isFinite(pos)
        ? ((pos % CYCLE_LEN) + CYCLE_LEN) % CYCLE_LEN
        : NIGHT_START;
      const validIds = STORYBOOK.map(p => p.id);
      state.pages = Array.isArray(d.pages)
        ? d.pages.filter(id => validIds.includes(id))
        : [];
      const questIds = QUEST_TEMPLATES.map(q => q.id);
      state.questActive = Array.isArray(d.questActive)
        ? d.questActive.filter(id => questIds.includes(id)).slice(0, QUEST_MAX_ACTIVE)
        : [];
      state.questDone = Array.isArray(d.questDone)
        ? d.questDone.filter(id => questIds.includes(id))
        : [];
      state.decor = Array.isArray(d.decor) ? d.decor.filter(x => typeof x === 'string') : [];
      state.boost = (d.boost && Number(d.boost.until) > Date.now())
        ? { kind: String(d.boost.kind), mult: Number(d.boost.mult) || 1, until: Number(d.boost.until) }
        : null;
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

  /* 3Dビューでタップした施設のカードへスクロール＆ハイライト */
  function highlightFacilityCard(id) {
    const r = cardRefs[id];
    if (!r) return;
    const card = r.btn.closest('.card');
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('hl');
    void card.offsetWidth;
    card.classList.add('hl');
    setTimeout(() => card.classList.remove('hl'), 1600);
  }

  const hadSave = load();
  checkPages(true); // 条件を満たしているページは静かに解放（「この世界」含む）
  shown.maso = state.maso;
  shown.shizai = state.shizai;
  buildFacilityList();

  /* Three.js 街ビューの初期化（失敗時はCSSジオラマへ自動フォールバック） */
  if (window.LIZA_USE_3D !== false && window.LizaTown3D && window.LizaTownModel) {
    window.LizaTown3D.init(cityEl, { onFacilityTap: highlightFacilityCard });
  }

  renderCity();
  updatePhase();
  if (glOn()) window.LizaTown3D.setCycle(state.cyclePos, CYCLE_LEN);
  updateAll();
  updateQuestBadge();
  $('quest-board-btn').addEventListener('click', showQuestModal);
  scheduleWish();
  scheduleQuestCheck();
  if (state.maso > 0 || totalLv() > 0) {
    tapHint.classList.add('hidden');
  }
  if (!hadSave && !state.introSeen) {
    startOpening(); // オープニング「約束」（初回のみ）
  }

  // テスト用フック（ゲームプレイには影響しない）
  window.__lizaDev = {
    spawnWish, phaseAt, wishReward,
    spawnQuest, claimDelivery, claimAchieve, chooseQuest,
    questEligible, questBoostMult, QUEST_TEMPLATES, viewMode,
  };

  setInterval(tick, 100);
  setInterval(save, 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
    else lastTick = Date.now();
  });
  window.addEventListener('pagehide', save);
})();
