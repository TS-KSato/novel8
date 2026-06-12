/* ============================================================
   灯火の街リーザ — 街の3Dモデル定義（ロジック層）
   WebGLに依存しない純粋なデータ生成。state から決定的に
   「何を・どこに・どんな部品で建てるか」を組み立てる。
   レンダラー（town3js.js）はこのモデルを描くだけ。
   jsdom でそのままテストできる。
   ============================================================ */
(() => {
  'use strict';

  /* 施設Lv → 見た目の成長段階（4段階） */
  const tierOf = lv => (lv >= 10 ? 4 : lv >= 6 ? 3 : lv >= 3 ? 2 : 1);

  const HOME_MAX = 14;

  /* ボードはワールド座標 -6〜+6 の正方形の島 */
  const BOARD = 12;

  /* 区画（広場(0,0)中心、+x=東、+z=南） */
  const PLOTS = {
    lantern: { x: 0,    z: -3.4 }, // 北
    market:  { x: 3.6,  z: 0.2 },  // 東の道沿い
    school:  { x: -3.6, z: -1.2 }, // 西の丘側
    clinic:  { x: 0,    z: 3.6 },  // 南
  };

  const LAMP_POS = [
    [-0.9, -2.2], [0.9, 1.8], [-2.2, 0.85], [2.2, -0.85], [-0.9, -4.4],
    [0.9, 4.2], [-4.2, 0.85], [4.4, -0.85], [-0.9, 2.9], [0.9, -3.3],
    [-3.1, -0.85], [3.1, 0.85],
  ];

  const HOME_ZONES = [
    [-5.2, -1.6, -5.2, -1.8], [1.6, 5.2, -5.2, -1.8],
    [-5.2, -1.6, 1.6, 5.0], [1.8, 5.2, 1.6, 5.0],
  ];

  /* 依頼の報酬で街に置かれる装飾（5種） */
  const DECOR_DEFS = {
    flowerbed: { name: '花壇',       pos: [-1.9, 2.0] },
    bench:     { name: 'ベンチ',     pos: [1.7, -1.6] },
    flagpole:  { name: '祝祭の旗',   pos: [1.9, 2.2] },
    fountain:  { name: '小さな噴水', pos: [-1.8, -2.0] },
    statue:    { name: '光の像',     pos: [0, 1.6] },
  };

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- 建物のパーツ構成 ----------
     各パーツ: { kind, w,h,d / r, x,y,z, color, emissive?, win?, anim? }
     kind: box | pyramid | cylinder | cone | sphere | plane
     y はパーツ中心の高さ（地面=0）。win:true は窓（夜に灯る）。 */

  function facilityParts(id, lv, rng) {
    const tier = tierOf(lv);
    const parts = [];
    const add = p => parts.push(p);
    const winN = Math.min(2 + Math.floor(lv / 2), 6);

    if (id === 'lantern') {
      const h = 1.0 + tier * 0.22;
      add({ kind: 'box', w: 1.5, h, d: 1.3, x: 0, y: h / 2, z: 0, color: 0xc9a87c }); // 壁
      add({ kind: 'pyramid', r: 1.25, h: 0.75, x: 0, y: h + 0.37, z: 0, color: 0xd07838 }); // 屋根
      add({ kind: 'box', w: 0.3, h: 0.5, d: 0.06, x: 0, y: 0.25, z: 0.66, color: 0x5c4030 }); // 扉
      add({ kind: 'cylinder', r: 0.12, h: 0.55, x: 0.45, y: h + 0.55, z: -0.3, color: 0x6e5a45, anim: 'smoke-src' }); // 煙突
      add({ kind: 'sphere', r: 0.09, x: 0.38, y: 0.62, z: 0.68, color: 0xffd98e, emissive: 0xffb24d, win: true, always: true }); // 吊りランタン
      if (tier >= 2) add({ kind: 'box', w: 0.42, h: 0.3, d: 0.05, x: -0.55, y: 0.75, z: 0.68, color: 0xefe2c4 }); // 看板
      if (tier >= 3) add({ kind: 'box', w: 1.5, h: 0.5, d: 1.3, x: 0, y: h + 0.95, z: 0, color: 0xd4b388 }); // 増築
      if (tier >= 4) add({ kind: 'sphere', r: 0.12, x: 0, y: h + 1.5, z: 0, color: 0xffe9b0, emissive: 0xffcf6a, win: true, always: true }); // 大灯
    }

    if (id === 'market') {
      const h = 0.8 + tier * 0.18;
      add({ kind: 'box', w: 1.7, h, d: 1.2, x: 0, y: h / 2, z: 0, color: 0xd8b88a });
      add({ kind: 'pyramid', r: 1.3, h: 0.6, x: 0, y: h + 0.3, z: 0, color: 0x8a6a40 });
      add({ kind: 'box', w: 1.8, h: 0.08, d: 0.7, x: 0, y: h * 0.82, z: 0.85, color: 0xd05848, anim: 'awning' }); // 日よけ
      add({ kind: 'box', w: 0.34, h: 0.34, d: 0.34, x: 1.2, y: 0.17, z: 0.6, color: 0xa07c4e });  // 木箱
      add({ kind: 'box', w: 0.28, h: 0.28, d: 0.28, x: 1.45, y: 0.14, z: 0.25, color: 0x8a6a40 }); // 木箱2
      if (tier >= 2) add({ kind: 'box', w: 0.42, h: 0.3, d: 0.05, x: -0.7, y: 0.8, z: 0.62, color: 0xefe2c4 });
      if (tier >= 3) add({ kind: 'box', w: 1.2, h: 0.06, d: 0.8, x: -1.5, y: 0.62, z: 0.4, color: 0xf4ead2, anim: 'awning' }); // 屋台が増える
      if (tier >= 4) add({ kind: 'plane', w: 0.5, h: 0.32, x: 0, y: h + 1.0, z: 0, color: 0xffbe62, anim: 'flag' });
    }

    if (id === 'school') {
      const h = 1.1 + tier * 0.25;
      add({ kind: 'box', w: 1.4, h, d: 1.4, x: 0, y: h / 2, z: 0, color: 0xaab4c8 });
      add({ kind: 'pyramid', r: 1.15, h: 0.6, x: 0, y: h + 0.3, z: 0, color: 0x4a5a8c });
      add({ kind: 'cylinder', r: 0.32, h: h + 0.9, x: -0.85, y: (h + 0.9) / 2, z: -0.5, color: 0x99a4ba }); // 塔
      add({ kind: 'cone', r: 0.42, h: 0.6, x: -0.85, y: h + 1.2, z: -0.5, color: 0x3a4774 });               // 塔のとんがり
      add({ kind: 'sphere', r: 0.1, x: -0.85, y: h + 1.62, z: -0.5, color: 0xffe9b0, emissive: 0xcfe2ff, win: true }); // 星の印
      add({ kind: 'box', w: 0.3, h: 0.46, d: 0.06, x: 0.2, y: 0.23, z: 0.72, color: 0x4a3c30 });
      if (tier >= 3) add({ kind: 'box', w: 1.4, h: 0.5, d: 1.4, x: 0, y: h + 0.85, z: 0, color: 0xbcc6d8 });
      if (tier >= 4) add({ kind: 'plane', w: 0.5, h: 0.32, x: -0.85, y: h + 1.9, z: -0.5, color: 0x6aa8ff, anim: 'flag' });
    }

    if (id === 'clinic') {
      const h = 0.9 + tier * 0.2;
      add({ kind: 'box', w: 1.6, h, d: 1.3, x: 0, y: h / 2, z: 0, color: 0xf0e6d2 });
      add({ kind: 'pyramid', r: 1.3, h: 0.65, x: 0, y: h + 0.32, z: 0, color: 0x5e8c5a });
      add({ kind: 'box', w: 0.32, h: 0.5, d: 0.06, x: 0, y: 0.25, z: 0.68, color: 0x6e5a45 });
      add({ kind: 'sphere', r: 0.13, x: 0, y: h + 0.85, z: 0, color: 0x9ed89a, emissive: 0x9ef0b4, win: true }); // 葉の印
      add({ kind: 'box', w: 0.5, h: 0.06, d: 0.5, x: 1.1, y: 0.03, z: 0.5, color: 0x7a9a50 }); // 薬草の苗床
      if (tier >= 2) add({ kind: 'box', w: 0.42, h: 0.3, d: 0.05, x: -0.6, y: 0.75, z: 0.68, color: 0xefe2c4 });
      if (tier >= 3) add({ kind: 'box', w: 1.0, h: 0.45, d: 1.0, x: 0, y: h + 0.85, z: 0, color: 0xf6ecd8 });
      if (tier >= 4) add({ kind: 'sphere', r: 0.1, x: 0.6, y: h + 0.7, z: 0.4, color: 0xd4ffe0, emissive: 0xb4ffd0, win: true });
    }

    // 窓（正面に並べる）
    for (let i = 0; i < winN; i++) {
      const fx = -0.45 + (i % 3) * 0.45;
      const fy = 0.55 + Math.floor(i / 3) * 0.4;
      parts.push({
        kind: 'box', w: 0.16, h: 0.2, d: 0.05,
        x: fx, y: fy, z: (id === 'school' ? 0.73 : 0.67),
        color: 0x6a5a48, emissive: 0xffc873, win: true,
        delay: rng(),
      });
    }
    return { tier, parts };
  }

  function homeParts(i, rng) {
    const z = HOME_ZONES[i % HOME_ZONES.length];
    const x = z[0] + rng() * (z[1] - z[0]);
    const zz = z[2] + rng() * (z[3] - z[2]);
    const roofColors = [0xb06a48, 0x9a7440, 0x74904e, 0x8a6488];
    const h = 0.55 + rng() * 0.2;
    return {
      x, z: zz, rotY: rng() * Math.PI * 2,
      parts: [
        { kind: 'box', w: 0.8, h, d: 0.7, x: 0, y: h / 2, z: 0, color: 0xcdb088 },
        { kind: 'pyramid', r: 0.65, h: 0.4, x: 0, y: h + 0.2, z: 0, color: roofColors[Math.floor(rng() * roofColors.length)] },
        { kind: 'box', w: 0.18, h: 0.3, d: 0.04, x: -0.15, y: 0.15, z: 0.36, color: 0x5c4030 },
        { kind: 'box', w: 0.13, h: 0.15, d: 0.04, x: 0.2, y: 0.38, z: 0.36, color: 0x6a5a48, emissive: 0xffc873, win: true, delay: rng() },
        { kind: 'cylinder', r: 0.05, h: 0.25, x: 0.25, y: h + 0.3, z: -0.15, color: 0x6e5a45 },
      ],
    };
  }

  function decorParts(decorId) {
    switch (decorId) {
      case 'flowerbed': return [
        { kind: 'box', w: 0.9, h: 0.12, d: 0.5, x: 0, y: 0.06, z: 0, color: 0x5e7c42 },
        { kind: 'sphere', r: 0.07, x: -0.25, y: 0.18, z: 0, color: 0xe08aa0 },
        { kind: 'sphere', r: 0.07, x: 0, y: 0.18, z: 0.08, color: 0xe8c060 },
        { kind: 'sphere', r: 0.07, x: 0.25, y: 0.18, z: -0.05, color: 0xb88ad8 },
      ];
      case 'bench': return [
        { kind: 'box', w: 0.7, h: 0.06, d: 0.25, x: 0, y: 0.22, z: 0, color: 0xa07c4e },
        { kind: 'box', w: 0.7, h: 0.2, d: 0.05, x: 0, y: 0.38, z: -0.1, color: 0xa07c4e },
        { kind: 'box', w: 0.06, h: 0.22, d: 0.2, x: -0.28, y: 0.11, z: 0, color: 0x6e5a45 },
        { kind: 'box', w: 0.06, h: 0.22, d: 0.2, x: 0.28, y: 0.11, z: 0, color: 0x6e5a45 },
      ];
      case 'flagpole': return [
        { kind: 'cylinder', r: 0.04, h: 1.5, x: 0, y: 0.75, z: 0, color: 0x6e5a45 },
        { kind: 'plane', w: 0.55, h: 0.35, x: 0.3, y: 1.3, z: 0, color: 0xf0962e, anim: 'flag' },
      ];
      case 'fountain': return [
        { kind: 'cylinder', r: 0.5, h: 0.18, x: 0, y: 0.09, z: 0, color: 0x9a948a },
        { kind: 'cylinder', r: 0.38, h: 0.1, x: 0, y: 0.2, z: 0, color: 0x6aaad2 },
        { kind: 'cylinder', r: 0.08, h: 0.45, x: 0, y: 0.4, z: 0, color: 0x9a948a },
        { kind: 'sphere', r: 0.1, x: 0, y: 0.66, z: 0, color: 0xbfe2f4, emissive: 0x9ed4f0, win: true },
      ];
      case 'statue': return [
        { kind: 'box', w: 0.5, h: 0.2, d: 0.5, x: 0, y: 0.1, z: 0, color: 0x9a948a },
        { kind: 'cylinder', r: 0.07, h: 0.7, x: 0, y: 0.55, z: 0, color: 0xb0aa9e },
        { kind: 'sphere', r: 0.14, x: 0, y: 1.0, z: 0, color: 0xffe9b0, emissive: 0xffcf6a, win: true, always: true },
      ];
      default: return [];
    }
  }

  /* ---------- 街全体のモデル ---------- */
  function buildTownModel(data) {
    const rng = mulberry32(data.stage * 7777 + 13);
    const model = {
      stage: data.stage,
      board: { size: BOARD, thickness: 0.9 },
      buildings: [],
      homes: [],
      lamps: [],
      decorations: [],
      plaza: { r: 1.5 },
      roads: [
        { x: 0, z: 0, w: 1.1, l: BOARD, dir: 'ns' },
        { x: 0, z: 0, w: BOARD, l: 1.1, dir: 'ew' },
      ],
      canal: data.stage >= 5,
      flowerbeds: data.stage >= 4 ? 4 : 0,
      bushes: data.stage <= 2 ? 6 : 3,
    };

    for (const id of ['lantern', 'market', 'school', 'clinic']) {
      if (data.lv[id] > 0) {
        const f = facilityParts(id, data.lv[id], rng);
        model.buildings.push({ id, tier: f.tier, x: PLOTS[id].x, z: PLOTS[id].z, parts: f.parts });
      }
    }

    const lampN = data.lv.lights > 0 ? Math.min(2 + data.lv.lights * 2, LAMP_POS.length) : 0;
    for (let i = 0; i < lampN; i++) {
      model.lamps.push({ x: LAMP_POS[i][0], z: LAMP_POS[i][1], delay: rng() });
    }

    const homeN = Math.min(Math.floor(data.residents / 4), HOME_MAX);
    for (let i = 0; i < homeN; i++) model.homes.push(homeParts(i, rng));

    for (const d of (data.decor || [])) {
      if (DECOR_DEFS[d]) {
        model.decorations.push({ id: d, x: DECOR_DEFS[d].pos[0], z: DECOR_DEFS[d].pos[1], parts: decorParts(d) });
      }
    }
    return model;
  }

  window.LizaTownModel = {
    buildTownModel, tierOf, facilityParts, homeParts, decorParts,
    DECOR_DEFS, PLOTS, HOME_MAX,
  };
})();
