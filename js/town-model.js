/* ============================================================
   灯火の街リーザ — 街の3Dモデル定義（ロジック層）
   WebGLに依存しない純粋なデータ生成。state から決定的に
   「何を・どこに・どんな部品で建てるか」を組み立てる。
   レンダラー（town3js.js）はこのモデルを描くだけ。
   jsdom でそのままテストできる。
   ============================================================ */
(() => {
  'use strict';

  /* ---------- カラーパレット（パステル調・全色をここで一元管理） ----------
     「かわいいミニチュア模型」: 明るく、やわらかく、濁らない。 */
  const PALETTE = {
    // 地面（段階1も「寂しい灰色」ではなく「育つ前の素朴な土と草」）
    ground1: 0xc4ad82, // 明るい土
    ground2: 0xc8b288,
    ground3: 0xcdbb96, // 石畳が混ざる
    ground4: 0xd2c2a0,
    ground5: 0xd8caaa, // 美しい敷石
    grass: 0xa9cb7e,   // 明るい草色
    grassDark: 0x93b96b,
    road: 0xdacfb4,    // 薄いベージュの石畳
    roadEarly: 0xc9b690,
    plaza: 0xd9cdae,
    baseSide: 0xa98a64, // ジオラマ台座の側面

    // 壁
    wallCream: 0xf6efdd,
    wallWhite: 0xfaf6ec,
    wallSand: 0xeee2c6,
    wallBlue: 0xdde6f0,

    // 屋根（サンゴ・セージ・ラベンダー・マスタード等の彩度を抑えた群）
    roofCoral: 0xe89580,
    roofTerracotta: 0xdb9a6a,
    roofSage: 0x9dbb8b,
    roofLavender: 0xb3a6d0,
    roofMustard: 0xddb766,

    // 木・小物
    wood: 0xb08a5e,
    woodDark: 0x8a6a48,
    door: 0x96704e,
    stone: 0xcfc6b0,
    crate: 0xc09a68,

    // 灯り・自然
    windowLit: 0xffd98e,
    lanternGlow: 0xffc173,
    glassWarm: 0xffe9b0,
    leaf: 0x8fc274,
    leafDark: 0x7bb061,
    trunk: 0x9a7450,
    water: 0x9fd0ea,
    flowerPink: 0xf0a8b8,
    flowerYellow: 0xf2d488,
    flowerPurple: 0xc7a8e0,
    starlight: 0xfff0c4,
    coolWin: 0xdce8ff,
    softWin: 0xddf5e4,
  };

  /* 施設Lv → 見た目の成長段階（4段階） */
  const tierOf = lv => (lv >= 10 ? 4 : lv >= 6 ? 3 : lv >= 3 ? 2 : 1);

  const HOME_MAX = 14;
  const TREE_MAX = 12;
  const BOARD = 12;

  /* 区画（広場(0,0)中心、+x=東、+z=南） */
  const PLOTS = {
    lantern: { x: 0,    z: -3.4 },
    market:  { x: 3.6,  z: 0.2 },
    school:  { x: -3.6, z: -1.2 },
    clinic:  { x: 0,    z: 3.6 },
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
     各パーツ: { kind, w,h,d / r, x,y,z, color, emissive?, win?, anim?, noShadow? }
     noShadow: 細い・小さいパーツは影を落とさない（影のチラつき対策） */

  function facilityParts(id, lv, rng) {
    const P = PALETTE;
    const tier = tierOf(lv);
    const parts = [];
    const add = p => parts.push(p);
    const winN = Math.min(2 + Math.floor(lv / 2), 6);

    if (id === 'lantern') {
      const h = 1.0 + tier * 0.22;
      add({ kind: 'box', w: 1.5, h, d: 1.3, x: 0, y: h / 2, z: 0, color: P.wallCream });
      add({ kind: 'pyramid', r: 1.25, h: 0.75, x: 0, y: h + 0.37, z: 0, color: P.roofTerracotta });
      add({ kind: 'box', w: 0.3, h: 0.5, d: 0.06, x: 0, y: 0.25, z: 0.66, color: P.door, noShadow: true });
      add({ kind: 'cylinder', r: 0.12, h: 0.55, x: 0.45, y: h + 0.55, z: -0.3, color: P.woodDark, anim: 'smoke-src', noShadow: true });
      add({ kind: 'sphere', r: 0.09, x: 0.38, y: 0.62, z: 0.68, color: P.glassWarm, emissive: P.lanternGlow, win: true, always: true, noShadow: true });
      if (tier >= 2) add({ kind: 'box', w: 0.42, h: 0.3, d: 0.05, x: -0.55, y: 0.75, z: 0.68, color: P.wallSand, noShadow: true });
      if (tier >= 3) add({ kind: 'box', w: 1.5, h: 0.5, d: 1.3, x: 0, y: h + 0.95, z: 0, color: P.wallSand });
      if (tier >= 4) add({ kind: 'sphere', r: 0.12, x: 0, y: h + 1.5, z: 0, color: P.glassWarm, emissive: P.lanternGlow, win: true, always: true, noShadow: true });
    }

    if (id === 'market') {
      const h = 0.8 + tier * 0.18;
      add({ kind: 'box', w: 1.7, h, d: 1.2, x: 0, y: h / 2, z: 0, color: P.wallSand });
      add({ kind: 'pyramid', r: 1.3, h: 0.6, x: 0, y: h + 0.3, z: 0, color: P.roofMustard });
      add({ kind: 'box', w: 1.8, h: 0.08, d: 0.7, x: 0, y: h * 0.82, z: 0.85, color: P.roofCoral, anim: 'awning', noShadow: true });
      add({ kind: 'box', w: 0.34, h: 0.34, d: 0.34, x: 1.2, y: 0.17, z: 0.6, color: P.crate });
      add({ kind: 'box', w: 0.28, h: 0.28, d: 0.28, x: 1.45, y: 0.14, z: 0.25, color: P.wood, noShadow: true });
      if (tier >= 2) add({ kind: 'box', w: 0.42, h: 0.3, d: 0.05, x: -0.7, y: 0.8, z: 0.62, color: P.wallCream, noShadow: true });
      if (tier >= 3) add({ kind: 'box', w: 1.2, h: 0.06, d: 0.8, x: -1.5, y: 0.62, z: 0.4, color: P.wallCream, anim: 'awning', noShadow: true });
      if (tier >= 4) add({ kind: 'plane', w: 0.5, h: 0.32, x: 0, y: h + 1.0, z: 0, color: P.roofCoral, anim: 'flag', noShadow: true });
    }

    if (id === 'school') {
      const h = 1.1 + tier * 0.25;
      add({ kind: 'box', w: 1.4, h, d: 1.4, x: 0, y: h / 2, z: 0, color: P.wallBlue });
      add({ kind: 'pyramid', r: 1.15, h: 0.6, x: 0, y: h + 0.3, z: 0, color: P.roofLavender });
      add({ kind: 'cylinder', r: 0.32, h: h + 0.9, x: -0.85, y: (h + 0.9) / 2, z: -0.5, color: P.wallWhite });
      add({ kind: 'cone', r: 0.42, h: 0.6, x: -0.85, y: h + 1.2, z: -0.5, color: P.roofLavender });
      add({ kind: 'sphere', r: 0.1, x: -0.85, y: h + 1.62, z: -0.5, color: P.starlight, emissive: P.coolWin, win: true, noShadow: true });
      add({ kind: 'box', w: 0.3, h: 0.46, d: 0.06, x: 0.2, y: 0.23, z: 0.72, color: P.door, noShadow: true });
      if (tier >= 3) add({ kind: 'box', w: 1.4, h: 0.5, d: 1.4, x: 0, y: h + 0.85, z: 0, color: P.wallWhite });
      if (tier >= 4) add({ kind: 'plane', w: 0.5, h: 0.32, x: -0.85, y: h + 1.9, z: -0.5, color: P.roofLavender, anim: 'flag', noShadow: true });
    }

    if (id === 'clinic') {
      const h = 0.9 + tier * 0.2;
      add({ kind: 'box', w: 1.6, h, d: 1.3, x: 0, y: h / 2, z: 0, color: P.wallWhite });
      add({ kind: 'pyramid', r: 1.3, h: 0.65, x: 0, y: h + 0.32, z: 0, color: P.roofSage });
      add({ kind: 'box', w: 0.32, h: 0.5, d: 0.06, x: 0, y: 0.25, z: 0.68, color: P.door, noShadow: true });
      add({ kind: 'sphere', r: 0.13, x: 0, y: h + 0.85, z: 0, color: P.softWin, emissive: P.softWin, win: true, noShadow: true });
      add({ kind: 'box', w: 0.5, h: 0.06, d: 0.5, x: 1.1, y: 0.03, z: 0.5, color: P.grass, noShadow: true });
      if (tier >= 2) add({ kind: 'box', w: 0.42, h: 0.3, d: 0.05, x: -0.6, y: 0.75, z: 0.68, color: P.wallSand, noShadow: true });
      if (tier >= 3) add({ kind: 'box', w: 1.0, h: 0.45, d: 1.0, x: 0, y: h + 0.85, z: 0, color: P.wallCream });
      if (tier >= 4) add({ kind: 'sphere', r: 0.1, x: 0.6, y: h + 0.7, z: 0.4, color: P.softWin, emissive: P.softWin, win: true, noShadow: true });
    }

    // 窓（正面に並べる。小さいので影は落とさない）
    for (let i = 0; i < winN; i++) {
      const fx = -0.45 + (i % 3) * 0.45;
      const fy = 0.55 + Math.floor(i / 3) * 0.4;
      parts.push({
        kind: 'box', w: 0.16, h: 0.2, d: 0.05,
        x: fx, y: fy, z: (id === 'school' ? 0.73 : 0.67),
        color: PALETTE.woodDark, emissive: PALETTE.windowLit, win: true,
        delay: rng(), noShadow: true,
      });
    }
    return { tier, parts };
  }

  const HOME_ROOF_COLORS = [
    PALETTE.roofCoral, PALETTE.roofSage, PALETTE.roofLavender, PALETTE.roofMustard,
  ];

  function homeParts(i, rng) {
    const P = PALETTE;
    const z = HOME_ZONES[i % HOME_ZONES.length];
    const x = z[0] + rng() * (z[1] - z[0]);
    const zz = z[2] + rng() * (z[3] - z[2]);
    const h = 0.55 + rng() * 0.2;
    const walls = [P.wallCream, P.wallWhite, P.wallSand];
    return {
      x, z: zz, rotY: rng() * Math.PI * 2,
      parts: [
        { kind: 'box', w: 0.8, h, d: 0.7, x: 0, y: h / 2, z: 0, color: walls[Math.floor(rng() * walls.length)] },
        { kind: 'pyramid', r: 0.65, h: 0.4, x: 0, y: h + 0.2, z: 0, color: HOME_ROOF_COLORS[Math.floor(rng() * HOME_ROOF_COLORS.length)] },
        { kind: 'box', w: 0.18, h: 0.3, d: 0.04, x: -0.15, y: 0.15, z: 0.36, color: P.door, noShadow: true },
        { kind: 'box', w: 0.13, h: 0.15, d: 0.04, x: 0.2, y: 0.38, z: 0.36, color: P.woodDark, emissive: P.windowLit, win: true, delay: rng(), noShadow: true },
        { kind: 'cylinder', r: 0.05, h: 0.25, x: 0.25, y: h + 0.3, z: -0.15, color: P.woodDark, noShadow: true },
      ],
    };
  }

  /* 簡易ローポリツリー（幹+葉2〜3パーツ） */
  function treeParts(rng) {
    const P = PALETTE;
    const th = 0.35 + rng() * 0.2;        // 幹の高さ
    const leaf = 0.34 + rng() * 0.16;     // 葉の大きさ
    const parts = [
      { kind: 'cylinder', r: 0.07, h: th, x: 0, y: th / 2, z: 0, color: P.trunk, noShadow: true },
      { kind: 'sphere', r: leaf, x: 0, y: th + leaf * 0.7, z: 0, color: P.leaf },
      { kind: 'sphere', r: leaf * 0.72, x: leaf * 0.5, y: th + leaf * 0.4, z: leaf * 0.25, color: P.leafDark },
    ];
    if (rng() < 0.5) {
      parts.push({ kind: 'sphere', r: leaf * 0.6, x: -leaf * 0.45, y: th + leaf * 0.5, z: -leaf * 0.2, color: P.leaf });
    }
    return parts;
  }

  /* 道・広場・施設区画を避けた木の配置 */
  function treeSpot(rng) {
    for (let tries = 0; tries < 20; tries++) {
      const x = -5 + rng() * 10;
      const z = -5 + rng() * 10;
      if (Math.abs(x) < 1.1 || Math.abs(z) < 1.1) continue;          // 道
      if (x * x + z * z < 5.5) continue;                              // 広場まわり
      let nearPlot = false;
      for (const k of Object.keys(PLOTS)) {
        const p = PLOTS[k];
        if ((x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) < 2.6) { nearPlot = true; break; }
      }
      if (nearPlot) continue;
      return { x, z };
    }
    return null;
  }

  function decorParts(decorId) {
    const P = PALETTE;
    switch (decorId) {
      case 'flowerbed': return [
        { kind: 'box', w: 0.9, h: 0.12, d: 0.5, x: 0, y: 0.06, z: 0, color: P.grassDark },
        { kind: 'sphere', r: 0.07, x: -0.25, y: 0.18, z: 0, color: P.flowerPink, noShadow: true },
        { kind: 'sphere', r: 0.07, x: 0, y: 0.18, z: 0.08, color: P.flowerYellow, noShadow: true },
        { kind: 'sphere', r: 0.07, x: 0.25, y: 0.18, z: -0.05, color: P.flowerPurple, noShadow: true },
      ];
      case 'bench': return [
        { kind: 'box', w: 0.7, h: 0.06, d: 0.25, x: 0, y: 0.22, z: 0, color: P.wood },
        { kind: 'box', w: 0.7, h: 0.2, d: 0.05, x: 0, y: 0.38, z: -0.1, color: P.wood, noShadow: true },
        { kind: 'box', w: 0.06, h: 0.22, d: 0.2, x: -0.28, y: 0.11, z: 0, color: P.woodDark, noShadow: true },
        { kind: 'box', w: 0.06, h: 0.22, d: 0.2, x: 0.28, y: 0.11, z: 0, color: P.woodDark, noShadow: true },
      ];
      case 'flagpole': return [
        { kind: 'cylinder', r: 0.04, h: 1.5, x: 0, y: 0.75, z: 0, color: P.woodDark, noShadow: true },
        { kind: 'plane', w: 0.55, h: 0.35, x: 0.3, y: 1.3, z: 0, color: P.roofCoral, anim: 'flag', noShadow: true },
      ];
      case 'fountain': return [
        { kind: 'cylinder', r: 0.5, h: 0.18, x: 0, y: 0.09, z: 0, color: P.stone },
        { kind: 'cylinder', r: 0.38, h: 0.1, x: 0, y: 0.2, z: 0, color: P.water, noShadow: true },
        { kind: 'cylinder', r: 0.08, h: 0.45, x: 0, y: 0.4, z: 0, color: P.stone, noShadow: true },
        { kind: 'sphere', r: 0.1, x: 0, y: 0.66, z: 0, color: P.water, emissive: P.water, win: true, noShadow: true },
      ];
      case 'statue': return [
        { kind: 'box', w: 0.5, h: 0.2, d: 0.5, x: 0, y: 0.1, z: 0, color: P.stone },
        { kind: 'cylinder', r: 0.07, h: 0.7, x: 0, y: 0.55, z: 0, color: P.stone, noShadow: true },
        { kind: 'sphere', r: 0.14, x: 0, y: 1.0, z: 0, color: P.glassWarm, emissive: P.lanternGlow, win: true, always: true, noShadow: true },
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
      trees: [],
      decorations: [],
      plaza: { r: 1.5 },
      roads: [
        { x: 0, z: 0, w: 1.1, l: BOARD, dir: 'ns' },
        { x: 0, z: 0, w: BOARD, l: 1.1, dir: 'ew' },
      ],
      canal: data.stage >= 5,
      flowerbeds: data.stage >= 4 ? 4 : 0,
      mounds: 5, // 低い丘状の緑地
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

    /* 木：段階とともに少し増える（性能のため最大12本） */
    const treeN = Math.min(3 + data.stage * 2, TREE_MAX);
    for (let i = 0; i < treeN; i++) {
      const spot = treeSpot(rng);
      if (spot) model.trees.push({ x: spot.x, z: spot.z, parts: treeParts(rng) });
    }

    for (const d of (data.decor || [])) {
      if (DECOR_DEFS[d]) {
        model.decorations.push({ id: d, x: DECOR_DEFS[d].pos[0], z: DECOR_DEFS[d].pos[1], parts: decorParts(d) });
      }
    }
    return model;
  }

  window.LizaTownModel = {
    buildTownModel, tierOf, facilityParts, homeParts, decorParts, treeParts,
    DECOR_DEFS, PLOTS, HOME_MAX, TREE_MAX, PALETTE,
  };
})();
