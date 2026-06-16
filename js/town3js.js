/* ============================================================
   灯火の街リーザ — Three.js 街ビュー（レンダラー層）
   ローポリ・ミニチュアジオラマ。「手のひらに乗る模型の街」。

   - モデル（何を建てるか）は town-model.js が生成し、ここでは描くだけ
   - ジオメトリはすべてコード生成。外部モデル・テクスチャ・画像なし
   - WebGL非対応／初期化失敗時は ready=false のままにして、
     main.js が CSSジオラマ（town3d.js）へ自動フォールバックする

   カメラ: OrthographicCamera（平行投影）による安定したアイソメ風俯瞰。
   影: 太陽角度を30秒ごとに離散更新（2秒で補間）し、毎フレームの
       連続回転による影のチラつきを根絶。frustumは盤面にタイトに合わせ、
       細いパーツは影を落とさない。夜は太陽影を無効化（月影なし）。
   ============================================================ */
(() => {
  'use strict';

  /* ---------- 調整用定数 ---------- */

  /* カメラ（アイソメ風・平行投影）
     俯瞰35度: 台座の側面が見え、建物の正面壁が主役になる構図 */
  const CAM = {
    elevDeg: 35,      // 俯瞰角
    azimDeg: 45,      // 方位角（盤面の角が手前に来るダイヤモンド配置）
    dist: 28,         // カメラ距離（平行投影では構図に影響しない）
    margin: 0.03,     // 端に意図的に残す最小マージン（3%）
    townFrac: 0.66,   // 街エリアが縦に占める割合（残りは周囲の地形で埋める）
    vBias: 0.18,      // 街を画面のやや上へ寄せる量（フレーム高さ比）
    // 最悪構成（段階5・全Lv最大・民家上限・全装飾）の「中身」を内包するAABB。
    // 実測: 建物/民家/装飾の外縁は |x|,|z| ≦ 5.84、最高点 y=4.36。
    // 街はこの範囲を必ず画面内に収め（見切れ禁止）、外側を地形で覆う。
    fitMin: { x: -5.85, y: -0.95, z: -5.85 },
    fitMax: { x:  5.85, y:  4.5,  z:  5.85 },
    viewHeight: 13.6, // フィット計算不可時のフォールバック
  };

  /* 影（チラつき対策の核心） */
  const SHADOW = {
    stepSec: 30,   // 太陽角度はゲーム内30秒ごとに更新（連続回転させない）
    blendSec: 2,   // 更新時は2秒かけて滑らかに補間
    mapSize: 1024,
    frustum: 8.0,  // 盤面12×12にタイトに合わせる
    bias: -0.0004,
    normalBias: 0.03,
  };

  /* 露出: 1.18ではACESのハイライト圧縮で昼の屋根色が白っぽく
     脱色されていた。1.0に戻し「はっきりした色のまま柔らかい」へ */
  const EXPOSURE = 1.0;

  /* レイン（街に常駐する3Dキャラ。すべて調整しやすい定数に） */
  const CHAR = {
    url: 'assets/models/rein.glb',
    x: -1.9, z: -2.0,    // ランタン工房(-1.9,-3.2)の手前
    y: 0.1,              // 足の接地高さ（建物基部と同じ）
    yawDeg: 135,         // 正面をカメラ（+x+z 方向）へ向ける
    scale: 0.62,         // 民家(高さ0.55〜0.75)と並ぶ人の大きさ
    texSize: 1024,       // 2048→1024へ縮小
    armDeg: 80,          // 上腕を下げる角度（検証値）
    elbowDeg: 14,        // 前腕の前曲げ（検証値）
    breathAmp: 0.012,    // 待機の上下動（呼吸）
  };

  /* 地形（画面いっぱいに広がる大地。台座は撤廃）。
     カメラの「右/奥」方向に沿った大きな板で画面を覆い、奥端を地平線にする。 */
  const TERRAIN = {
    width: 96,        // 画面横を覆う幅（カメラ右方向、±48）
    front: 50,        // カメラ手前への広がり（画面外へフレームアウト）
    horizon: 14,      // 奥（地平線）までの距離。ここで地面が切れ、上は空（約17%）になる
    seed: 20240607,   // 自然配置の固定シード（再描画・セーブ復元で同一）
    ringMin: 8.5,     // 自然要素を撒くドーナツ内径（街を避ける）
    ringMax: 22,      // 〃 外径（視界内を埋める）
    trees: 26, hills: 15, water: 2,
  };

  const T = {
    ready: false,
    CAM, SHADOW, EXPOSURE, CHAR, TERRAIN,
    init, render, setCycle, animateFacility, lanternPoint, spawnWish,
    quantizeSunPos, // テスト用：影の角度更新の離散化ロジック
    fitFrustum,     // テスト用：最悪構成を内包するフレーミング計算
    loadCharacter,  // テスト用：失敗時に安全にfalseを返すこと
    charBounce,
  };
  window.LizaTown3D = T;

  let renderer, scene, camera, sun, hemi, lanternLight;
  let host, canvas;
  let townGroup = null;
  let cyclePos = 170, cycleLen = 240;
  let windows = [];
  let flags = [];
  let smokes = [];
  let facGroups = {};
  let bounces = [];
  let wish = null;
  let lanternHeadMesh = null;
  let onFacilityTapCb = null;
  let charRoot = null;       // レイン本体（読み込めた場合のみ）
  let charBounceT0 = 0;      // ジャンプ反応の開始時刻
  let lastCharTap = 0;       // タップ反応のレート制限

  /* 共有ジオメトリ */
  let GEO = null;
  function geos() {
    if (GEO) return GEO;
    GEO = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
      cone: new THREE.ConeGeometry(0.5, 1, 10),
      pyramid: new THREE.ConeGeometry(0.72, 1, 4),
      sphere: new THREE.SphereGeometry(0.5, 10, 8),
      plane: new THREE.PlaneGeometry(1, 1),
      disc: new THREE.CylinderGeometry(0.5, 0.5, 0.08, 24),
    };
    return GEO;
  }

  const matCache = {};
  function matOf(color) {
    if (!matCache[color]) {
      matCache[color] = new THREE.MeshLambertMaterial({ color });
    }
    return matCache[color];
  }

  function init(hostEl, opts) {
    host = hostEl;
    onFacilityTapCb = opts && opts.onFacilityTap;
    try {
      if (typeof THREE === 'undefined') return false;
      const probe = document.createElement('canvas');
      if (!(probe.getContext('webgl') || probe.getContext('experimental-webgl'))) return false;

      renderer = new THREE.WebGLRenderer({
        antialias: (window.devicePixelRatio || 1) < 2,
        powerPreference: 'low-power',
        alpha: true, // 背景は透過し、CSSの空グラデーション+雲+星を生かす
      });
      renderer.setClearColor(0x000000, 0);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = EXPOSURE;

      canvas = renderer.domElement;
      canvas.id = 'gl-canvas';
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.zIndex = '2'; // CSSの空（tints/clouds/stars）より手前
      host.insertBefore(canvas, host.firstChild);

      scene = new THREE.Scene(); // 背景は透過（空はCSSが描く）
      scene.fog = new THREE.Fog(0xcfe0f4, 34, 70); // ごく薄い距離霞のみ

      /* アイソメ風の平行投影カメラ */
      camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 80);
      placeCamera();

      /* 半球光を主光源に（空=薄青白、地=暖ベージュ） */
      hemi = new THREE.HemisphereLight(0xf2f7fc, 0xe6d6b8, 1.0);
      scene.add(hemi);

      /* 太陽は補助+影用。角度は離散更新 */
      sun = new THREE.DirectionalLight(0xfff2dd, 0.55);
      sun.castShadow = true;
      sun.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
      sun.shadow.camera.left = -SHADOW.frustum;
      sun.shadow.camera.right = SHADOW.frustum;
      sun.shadow.camera.top = SHADOW.frustum;
      sun.shadow.camera.bottom = -SHADOW.frustum;
      sun.shadow.camera.near = 1;
      sun.shadow.camera.far = 50;
      sun.shadow.bias = SHADOW.bias;
      sun.shadow.normalBias = SHADOW.normalBias;
      scene.add(sun);
      scene.add(sun.target);

      lanternLight = new THREE.PointLight(0xffc173, 1.0, 9, 2);
      lanternLight.position.set(0, 1.6, 0);
      scene.add(lanternLight);

      resize();
      window.addEventListener('resize', resize);
      host.addEventListener('pointerdown', onPointerDown, true);

      T.ready = true;
      loadCharacter(); // レイン（任意・失敗しても街は完全に正常）
      animate();
      return true;
    } catch (e) {
      T.ready = false;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      return false;
    }
  }

  /* カメラの右/上ベクトル（純粋計算・THREE非依存でテスト可能） */
  function camBasis() {
    const e = CAM.elevDeg * Math.PI / 180, a = CAM.azimDeg * Math.PI / 180;
    const dir = [-Math.cos(e) * Math.sin(a), -Math.sin(e), -Math.cos(e) * Math.cos(a)]; // 原点へ向く
    const cross = (u, v) => [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    const norm = v => { const m = Math.hypot(v[0], v[1], v[2]); return [v[0]/m, v[1]/m, v[2]/m]; };
    const right = norm(cross(dir, [0, 1, 0]));
    const up = norm(cross(right, dir));
    return { right, up };
  }

  /* 最悪構成AABBの8隅をビュー空間へ射影し、指定アスペクトで全隅が収まる
     最小フレーム（viewHeight）と中心(cx,cy)を返す。段階5最大を基準にすれば
     段階1〜4は必ず内包される（盤面±6は不変、建物高さは段階5が最大）。 */
  function fitFrustum(aspect) {
    const { right, up } = camBasis();
    const dot = (p, b) => p[0]*b[0] + p[1]*b[1] + p[2]*b[2];
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [CAM.fitMin.x, CAM.fitMax.x])
      for (const y of [CAM.fitMin.y, CAM.fitMax.y])
        for (const z of [CAM.fitMin.z, CAM.fitMax.z]) {
          const vx = dot([x, y, z], right), vy = dot([x, y, z], up);
          if (vx < minX) minX = vx; if (vx > maxX) maxX = vx;
          if (vy < minY) minY = vy; if (vy > maxY) maxY = vy;
        }
    const cx = (minX + maxX) / 2, cy0 = (minY + maxY) / 2;
    const halfW = (maxX - minX) / 2 * (1 + CAM.margin);
    const halfH = (maxY - minY) / 2 * (1 + CAM.margin);
    let H = Math.max(halfH, halfW / aspect); // 街がぴったり収まる最小フレーム
    H = H / CAM.townFrac;                     // 周囲に地形を見せるためズームアウト
    const cy = cy0 - CAM.vBias * H;           // 注視点を下げ、街を画面のやや上へ
    return { viewHeight: 2 * H, cx, cy, right, up };
  }

  const camTarget = { x: 0, y: 0.8, z: 0 }; // THREE非依存（モジュール評価時に落ちない）

  function placeCamera() {
    const elev = CAM.elevDeg * Math.PI / 180;
    const azim = CAM.azimDeg * Math.PI / 180;
    const r = CAM.dist;
    camera.position.set(
      camTarget.x + Math.cos(elev) * Math.sin(azim) * r,
      camTarget.y + Math.sin(elev) * r,
      camTarget.z + Math.cos(elev) * Math.cos(azim) * r);
    camera.lookAt(camTarget.x, camTarget.y, camTarget.z);
  }

  function resize() {
    if (!renderer || !host) return;
    const w = host.clientWidth || 390;
    const h = host.clientHeight || 300;
    renderer.setSize(w, h);
    const aspect = w / h;
    const fit = fitFrustum(aspect);
    // ビュー中心(cx,cy)を画面中心へ合わせる注視点（向きは不変＝右/上ベクトルも不変）
    camTarget.x = fit.cx * fit.right[0] + fit.cy * fit.up[0];
    camTarget.y = fit.cx * fit.right[1] + fit.cy * fit.up[1];
    camTarget.z = fit.cx * fit.right[2] + fit.cy * fit.up[2];
    const halfH = fit.viewHeight / 2;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
    placeCamera();
    camera.updateProjectionMatrix();
  }

  /* ---------- モデル → メッシュ ---------- */

  function partMesh(p) {
    const g = geos();
    let mesh;
    const needsOwnMat = p.emissive !== undefined;
    const mat = needsOwnMat
      ? new THREE.MeshLambertMaterial({ color: p.color, emissive: p.emissive, emissiveIntensity: 0 })
      : matOf(p.color);

    switch (p.kind) {
      case 'box':
        mesh = new THREE.Mesh(g.box, mat);
        mesh.scale.set(p.w, p.h, p.d);
        break;
      case 'pyramid':
        mesh = new THREE.Mesh(g.pyramid, mat);
        mesh.scale.set(p.r, p.h, p.r);
        mesh.rotation.y = Math.PI / 4;
        break;
      case 'cylinder':
        mesh = new THREE.Mesh(g.cyl, mat);
        mesh.scale.set(p.r * 2, p.h, p.r * 2);
        break;
      case 'cone':
        mesh = new THREE.Mesh(g.cone, mat);
        mesh.scale.set(p.r * 2, p.h, p.r * 2);
        break;
      case 'sphere':
        mesh = new THREE.Mesh(g.sphere, mat);
        mesh.scale.setScalar(p.r * 2);
        break;
      case 'plane': {
        const m2 = new THREE.MeshLambertMaterial({ color: p.color, side: THREE.DoubleSide });
        mesh = new THREE.Mesh(g.plane, m2);
        mesh.scale.set(p.w, p.h, 1);
        break;
      }
      default:
        return null;
    }
    mesh.position.set(p.x, p.y, p.z);
    // 細い・小さいパーツは影を落とさない（低解像度影でのチラつき対策）
    mesh.castShadow = !p.noShadow && p.kind !== 'plane';
    mesh.receiveShadow = false;

    if (p.win) windows.push({ mat: mesh.material, delay: p.delay || 0, always: !!p.always });
    if (p.anim === 'flag') flags.push({ mesh, seed: Math.random() * 10 });
    if (p.anim === 'smoke-src') addSmoke(p);
    return mesh;
  }

  function addSmoke(p) {
    for (let i = 0; i < 3; i++) {
      const sm = new THREE.Sprite(new THREE.SpriteMaterial({
        color: 0xeeeae2, transparent: true, opacity: 0.45,
      }));
      sm.scale.setScalar(0.22);
      smokes.push({ sprite: sm, seed: i * 2.1 + Math.random(), baseX: p.x, baseY: p.y + 0.35, baseZ: p.z });
    }
  }

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 画面いっぱいの大地（カメラの右/奥方向に沿った大きな板）。
     奥端 = gBack*horizon が地平線になり、その上は空（透過→CSS）。 */
  function buildGround(P) {
    const e = CAM.elevDeg * Math.PI / 180, a = CAM.azimDeg * Math.PI / 180;
    const dir = new THREE.Vector3(-Math.cos(e)*Math.sin(a), -Math.sin(e), -Math.cos(e)*Math.cos(a)).normalize();
    const gRight = new THREE.Vector3(-dir.z, 0, dir.x).normalize();  // 画面右（水平）
    const gBack = new THREE.Vector3(dir.x, 0, dir.z).normalize();    // 画面奥＝カメラから遠ざかる側（地平線）
    const zAxis = new THREE.Vector3().crossVectors(gRight, new THREE.Vector3(0, 1, 0)); // 右手系の第3軸(=-gBack)
    const depth = TERRAIN.front + TERRAIN.horizon;
    const ground = new THREE.Mesh(geos().box, matOf(P.grass));
    ground.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(gRight, new THREE.Vector3(0, 1, 0), zAxis));
    ground.scale.set(TERRAIN.width, 0.1, depth);
    ground.position.copy(gBack.clone().multiplyScalar((TERRAIN.horizon - TERRAIN.front) / 2));
    ground.position.y = -0.05; // 上面を y=0 に
    ground.receiveShadow = true;
    ground.castShadow = false;
    return { ground, gRight, gBack };
  }

  /* 街の外側を自然で埋める（木立・低い丘・水辺）。固定シードで決定的。
     地平線より奥には置かない。 */
  function addNature(group, gBack, P) {
    const rng = mulberry32(TERRAIN.seed);
    const limit = TERRAIN.horizon - 1.5;
    const backCoord = (x, z) => x * gBack.x + z * gBack.z;
    for (let i = 0; i < TERRAIN.trees; i++) {
      const ang = rng() * Math.PI * 2, rad = TERRAIN.ringMin + rng() * (TERRAIN.ringMax - TERRAIN.ringMin);
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (backCoord(x, z) > limit) continue;
      const g = new THREE.Group();
      const th = 0.5 + rng() * 0.5;
      const trunk = new THREE.Mesh(geos().cyl, matOf(P.trunk));
      trunk.scale.set(0.12, th, 0.12); trunk.position.y = th / 2; trunk.castShadow = false;
      const lr = 0.5 + rng() * 0.4;
      const leaf = new THREE.Mesh(geos().sphere, matOf(rng() < 0.5 ? P.leaf : P.leafDark));
      leaf.scale.set(lr * 2, lr * 2.2, lr * 2); leaf.position.y = th + lr * 0.8; leaf.castShadow = false;
      g.add(trunk); g.add(leaf);
      g.position.set(x, 0, z); g.scale.setScalar(0.8 + rng() * 0.7);
      group.add(g);
    }
    for (let i = 0; i < TERRAIN.hills; i++) {
      const ang = rng() * Math.PI * 2, rad = TERRAIN.ringMin + 2 + rng() * (TERRAIN.ringMax - TERRAIN.ringMin);
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (backCoord(x, z) > limit) continue;
      const hill = new THREE.Mesh(geos().sphere, matOf(i % 2 ? P.grass : P.grassDark));
      const r = 1.2 + rng() * 2.2;
      hill.scale.set(r * 2, 0.4 + rng() * 0.5, r * 2);
      hill.position.set(x, 0.02, z); hill.receiveShadow = true; hill.castShadow = false;
      group.add(hill);
    }
    for (let i = 0; i < TERRAIN.water; i++) {
      const ang = (i ? 2.3 : 0.7) + rng() * 0.5, rad = 12 + rng() * 9;
      const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
      if (backCoord(x, z) > limit) continue;
      const water = new THREE.Mesh(geos().disc, new THREE.MeshLambertMaterial({
        color: P.water, emissive: 0x2a4a66, emissiveIntensity: 0.2,
      }));
      const r = 2 + rng() * 2;
      water.scale.set(r * 2, 1, r * 1.4); water.position.set(x, 0.04, z); water.castShadow = false;
      group.add(water);
    }
  }

  function render(data) {
    if (!T.ready || !window.LizaTownModel) return;
    const model = window.LizaTownModel.buildTownModel(data);
    const P = window.LizaTownModel.PALETTE;

    if (townGroup) scene.remove(townGroup);
    windows = []; flags = []; smokes = []; facGroups = {};
    townGroup = new THREE.Group();

    const S = model.board.size;

    /* 画面いっぱいに広がる大地（台座は撤廃）。カメラの右/奥方向に沿った
       大きな板で画面を覆い、手前・左右は画面外へ逃がし、奥端を地平線にする。 */
    const gb = buildGround(P);
    townGroup.add(gb.ground);

    /* 街の外側を自然（木立・低い丘・水辺）で画面端まで埋める（固定シード） */
    addNature(townGroup, gb.gBack, P);

    /* 街エリアの土の区画・草の丘（中心の彩り。配置は街エリア内に限定） */
    const rngP = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(model.stage * 99 + 7);
    for (let i = 0; i < model.mounds; i++) {
      const isDirt = i % 3 === 2;
      const mound = new THREE.Mesh(geos().sphere,
        matOf(isDirt ? P.dirt : (i % 2 === 0 ? P.grassLight : P.grassDark)));
      const pr = 0.9 + rngP() * 1.2;
      mound.scale.set(pr * 2, isDirt ? 0.12 : 0.28, pr * 2);
      mound.position.set((rngP() - 0.5) * (S - 3), 0.02, (rngP() - 0.5) * (S - 3));
      mound.receiveShadow = true;
      mound.castShadow = false;
      townGroup.add(mound);
    }

    /* 道＝一段明るいクリーム石畳 + 茶の縁石（アクセント） */
    for (const r of model.roads) {
      const road = new THREE.Mesh(geos().box, matOf(P.road));
      road.scale.set(r.w, 0.06, r.l);
      road.position.set(r.x, 0.09, r.z);
      road.receiveShadow = true;
      road.castShadow = false;
      townGroup.add(road);
      // 縁石（道の両側に細い茶のライン）
      for (const side of [-1, 1]) {
        const curb = new THREE.Mesh(geos().box, matOf(P.roadEdge));
        if (r.dir === 'ns') {
          curb.scale.set(0.12, 0.1, r.l);
          curb.position.set(r.x + side * (r.w / 2 + 0.06), 0.1, r.z);
        } else {
          curb.scale.set(r.w, 0.1, 0.12);
          curb.position.set(r.x, 0.1, r.z + side * (r.l / 2 + 0.06));
        }
        curb.castShadow = false;
        curb.receiveShadow = true;
        townGroup.add(curb);
      }
    }
    const plaza = new THREE.Mesh(geos().disc, matOf(P.plaza));
    plaza.scale.set(model.plaza.r * 2, 1, model.plaza.r * 2);
    plaza.position.y = 0.08;
    plaza.receiveShadow = true;
    plaza.castShadow = false;
    townGroup.add(plaza);

    if (model.canal) {
      const canal = new THREE.Mesh(geos().box, new THREE.MeshLambertMaterial({
        color: P.water, emissive: 0x3a6a8a, emissiveIntensity: 0.25,
      }));
      canal.scale.set(S, 0.05, 0.55);
      canal.position.set(0, 0.1, 2.75);
      canal.castShadow = false;
      townGroup.add(canal);
    }

    /* 木（幹+葉のローポリツリー） */
    for (const t of model.trees) {
      const grp = buildParts(t.parts);
      grp.position.set(t.x, 0.1, t.z);
      townGroup.add(grp);
    }

    /* 段階4+の花壇 */
    for (let i = 0; i < model.flowerbeds; i++) {
      const fb = buildParts(window.LizaTownModel.decorParts('flowerbed'));
      fb.position.set(i % 2 === 0 ? -2.4 : 2.4, 0.1, i < 2 ? -1.3 : 1.3);
      townGroup.add(fb);
    }

    /* はじまりのランタン（広場の中心・常時灯る） */
    const lant = new THREE.Group();
    const pole = new THREE.Mesh(geos().cyl, matOf(P.woodDark));
    pole.scale.set(0.12, 1.5, 0.12);
    pole.position.y = 0.75;
    pole.castShadow = true;
    lant.add(pole);
    const headMat = new THREE.MeshLambertMaterial({
      color: P.glassWarm, emissive: P.lanternGlow, emissiveIntensity: 1,
    });
    lanternHeadMesh = new THREE.Mesh(geos().sphere, headMat);
    lanternHeadMesh.scale.setScalar(0.34);
    lanternHeadMesh.position.y = 1.62;
    lanternHeadMesh.castShadow = false;
    lant.add(lanternHeadMesh);
    windows.push({ mat: headMat, delay: 0, always: true });
    lant.position.y = 0.1;
    townGroup.add(lant);

    /* 施設 */
    for (const b of model.buildings) {
      const grp = buildParts(b.parts);
      grp.position.set(b.x, 0.1, b.z);
      grp.userData.facId = b.id;
      grp.traverse(o => { o.userData.facId = b.id; });
      facGroups[b.id] = grp;
      townGroup.add(grp);
    }

    /* 街灯（細いポールは影を落とさない） */
    for (const l of model.lamps) {
      const grp = new THREE.Group();
      const p = new THREE.Mesh(geos().cyl, matOf(P.woodDark));
      p.scale.set(0.07, 1.1, 0.07);
      p.position.y = 0.55;
      p.castShadow = false;
      grp.add(p);
      const gm = new THREE.MeshLambertMaterial({
        color: P.glassWarm, emissive: P.windowLit, emissiveIntensity: 0,
      });
      const gl = new THREE.Mesh(geos().sphere, gm);
      gl.scale.setScalar(0.2);
      gl.position.y = 1.15;
      gl.castShadow = false;
      grp.add(gl);
      windows.push({ mat: gm, delay: l.delay, always: false });
      grp.position.set(l.x, 0.1, l.z);
      grp.userData.facId = 'lights';
      grp.traverse(o => { o.userData.facId = 'lights'; });
      townGroup.add(grp);
    }

    /* 民家 */
    for (const h of model.homes) {
      const grp = buildParts(h.parts);
      grp.position.set(h.x, 0.1, h.z);
      grp.rotation.y = (h.rotY % (Math.PI / 2)) - Math.PI / 4;
      townGroup.add(grp);
    }

    /* 依頼報酬の装飾 */
    for (const d of model.decorations) {
      const grp = buildParts(d.parts);
      grp.position.set(d.x, 0.1, d.z);
      townGroup.add(grp);
    }

    for (const s of smokes) townGroup.add(s.sprite);
    scene.add(townGroup);
  }

  function buildParts(parts) {
    const grp = new THREE.Group();
    for (const p of parts) {
      const m = partMesh(p);
      if (m) grp.add(m);
    }
    return grp;
  }

  /* ---------- 昼夜サイクル ----------
     色・強さは毎フレーム連続補間（チラつかない）。
     影を作る太陽の「角度」だけは30秒ごとの離散更新+2秒補間。 */

  function setCycle(pos, len) {
    cyclePos = pos;
    if (len) cycleLen = len;
  }

  /* パステル調の昼夜キーフレーム（空・太陽・半球光） */
  /* 「常時、色がきれい」を最優先（リアルな色温度より優先）。
     昼の合計光量がLambertの飽和域(>1.3)に入ると色が白飛びして
     彩度が抜けるため、昼の強度は hemi+sun ≒ 1.25 以下に抑える */
  const KEYS = [
    // t(秒), 霞色, 太陽色, 太陽強さ, 仰角(deg), 半球光(空/地/強さ)
    { t: 0,   sky: 0xdfe9f6, sunC: 0xffe6c2, sunI: 0.42, elev: 22, hemiS: 0xf0f5fb, hemiG: 0xe8d8ba, hemiI: 0.85 },
    { t: 85,  sky: 0xd5e7f8, sunC: 0xfff4e2, sunI: 0.45, elev: 60, hemiS: 0xf6fafd, hemiG: 0xecdcc0, hemiI: 0.88 },
    { t: 145, sky: 0xf6cfa6, sunC: 0xffb878, sunI: 0.45, elev: 16, hemiS: 0xf8dcb8, hemiG: 0xe2c49e, hemiI: 0.82 },
    { t: 205, sky: 0x4a5a94, sunC: 0xb4c4ee, sunI: 0.24, elev: 45, hemiS: 0x8290c4, hemiG: 0x5e5468, hemiI: 0.7 },
    { t: 240, sky: 0xdfe9f6, sunC: 0xffe6c2, sunI: 0.42, elev: 22, hemiS: 0xf0f5fb, hemiG: 0xe8d8ba, hemiI: 0.85 },
  ];
  T.KEYS = KEYS;

  let cA = null, cB = null;
  function lerpColor(a, b, f) {
    if (!cA) { cA = new THREE.Color(); cB = new THREE.Color(); }
    return cA.setHex(a).lerp(cB.setHex(b), f);
  }

  function keyLerp(pos) {
    let a = KEYS[0], b = KEYS[1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (pos >= KEYS[i].t && pos <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const f = (pos - a.t) / Math.max(1, b.t - a.t);
    return { a, b, f };
  }

  /* 窓明かり: 夜=1 / 昼=0。夕暮れは窓ごとの delay で一つずつ点く */
  function litFactor(pos, delay) {
    if (pos >= 170 || pos < 0) return 1;
    if (pos < 50) {
      const pr = pos / 50;
      return pr > delay ? Math.max(0, 1 - (pr - delay) * 6) : 1;
    }
    if (pos < 120) return 0;
    const pr = (pos - 120) / 50;
    return pr > delay ? Math.min(1, (pr - delay) * 6) : 0;
  }

  /* ---- 太陽角度の離散化（影のチラつき対策・テスト対象） ---- */
  function quantizeSunPos(pos) {
    return Math.floor(pos / SHADOW.stepSec) * SHADOW.stepSec;
  }

  function sunAngleAt(qpos) {
    const norm = ((qpos % 240) + 240) % 240;
    const k = keyLerp(norm);
    const elev = (k.a.elev + (k.b.elev - k.a.elev) * k.f) * Math.PI / 180;
    const azim = (norm / 240) * Math.PI * 2 - Math.PI * 0.25;
    return { elev, azim };
  }

  let shadowQ = -1;
  let angleFrom = null, angleTo = null, blendStart = 0;

  function updateSunAngle(pos, nowMs) {
    const q = quantizeSunPos(pos);
    if (q !== shadowQ) {
      angleFrom = angleTo || sunAngleAt(q);
      angleTo = sunAngleAt(q + SHADOW.stepSec / 2); // 区間の中央角で固定
      shadowQ = q;
      blendStart = nowMs;
    }
    let f = Math.min(1, (nowMs - blendStart) / (SHADOW.blendSec * 1000));
    f = f * f * (3 - 2 * f); // smoothstep
    const elev = angleFrom.elev + (angleTo.elev - angleFrom.elev) * f;
    let dAzim = angleTo.azim - angleFrom.azim;
    if (Math.abs(dAzim) > Math.PI) dAzim -= Math.sign(dAzim) * Math.PI * 2; // 最短経路
    const azim = angleFrom.azim + dAzim * f;
    sun.position.set(Math.cos(azim) * 18, Math.max(2, Math.sin(elev) * 18 + 3), Math.sin(azim) * 18);

    // 夜は太陽影を切る（月影は作らない）。切替は離散更新時のみ起きる
    const night = pos >= 170;
    if (sun.castShadow === night) sun.castShadow = !night;
  }

  function applyCycle(nowMs) {
    const pos = (cyclePos / cycleLen) * 240;
    const k = keyLerp(pos);

    scene.fog.color.copy(lerpColor(k.a.sky, k.b.sky, k.f));
    sun.color.copy(lerpColor(k.a.sunC, k.b.sunC, k.f));
    sun.intensity = k.a.sunI + (k.b.sunI - k.a.sunI) * k.f;
    hemi.color.copy(lerpColor(k.a.hemiS, k.b.hemiS, k.f));
    hemi.groundColor.copy(lerpColor(k.a.hemiG, k.b.hemiG, k.f));
    hemi.intensity = k.a.hemiI + (k.b.hemiI - k.a.hemiI) * k.f;

    updateSunAngle(pos, nowMs);

    const night = litFactor(pos, 0);
    lanternLight.intensity = 0.35 + night * 0.95;

    for (const w of windows) {
      w.mat.emissiveIntensity = w.always ? 1 : litFactor(pos, w.delay);
    }
  }

  /* ---------- 願い星（3D空間に出現） ---------- */
  function spawnWish(kind, onCatch) {
    if (!T.ready) return false;
    removeWish();
    const grp = new THREE.Group();
    if (kind === 'star') {
      const star = new THREE.Mesh(geos().sphere, new THREE.MeshBasicMaterial({ color: 0xfff2cc }));
      star.scale.setScalar(0.3);
      grp.add(star);
      const tail = new THREE.Mesh(geos().box, new THREE.MeshBasicMaterial({
        color: 0xffe2a0, transparent: true, opacity: 0.5,
      }));
      tail.scale.set(1.6, 0.06, 0.06);
      tail.position.x = 0.9;
      grp.add(tail);
      // 寄せたフレーム内（上空 y<=4.5）に収め、流れ星として斜めに流れる
      grp.position.set(1 + Math.random() * 3, 3.2 + Math.random() * 0.9, -3.5 + Math.random() * 3);
    } else {
      for (const sx of [-1, 1]) {
        const wing = new THREE.Mesh(geos().plane, new THREE.MeshBasicMaterial({
          color: 0xfff2cc, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
        }));
        wing.scale.set(0.34, 0.42, 1);
        wing.position.x = sx * 0.18;
        wing.userData.wing = sx;
        grp.add(wing);
      }
      grp.position.set(-3 + Math.random() * 6, 2.6 + Math.random() * 1.2, -2 + Math.random() * 3);
    }
    grp.userData.isWish = true;
    grp.traverse(o => { o.userData.isWish = true; });
    scene.add(grp);
    wish = { group: grp, kind, onCatch, expireAt: Date.now() + 6000, t0: Date.now() };
    return true;
  }

  function removeWish() {
    if (wish) { scene.remove(wish.group); wish = null; }
  }

  /* ---------- タップ（願い星キャッチ・施設→カード連携） ---------- */
  let raycaster = null, pointer = null;

  function onPointerDown(e) {
    if (!T.ready || !canvas) return;
    if (!raycaster) { raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2(); }
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera); // Orthographicにも対応

    if (wish) {
      const hits = raycaster.intersectObject(wish.group, true);
      if (hits.length > 0) {
        const cb = wish.onCatch;
        removeWish();
        e.stopPropagation();
        if (cb) cb();
        return;
      }
    }
    if (townGroup && onFacilityTapCb) {
      const hits = raycaster.intersectObject(townGroup, true);
      for (const h of hits) {
        if (h.object.userData.facId) {
          onFacilityTapCb(h.object.userData.facId);
          break;
        }
      }
    }
    // レインをタップ（付近）したら軽くジャンプ（連打はレート制限）
    if (charRoot) {
      const now = Date.now();
      if (now - lastCharTap > 600 && raycaster.intersectObject(charRoot, true).length > 0) {
        lastCharTap = now;
        charBounce();
      }
    }
  }

  /* ============================================================
     レイン（街に常駐する3Dキャラ）
     ・読み込み／WebGL失敗時は何もせず、街は完全に正常表示される
     ・マテリアルは街と同じ MeshLambertMaterial（同じ光だけで陰影を簡素化）
       にし、写実的なテカリ・陰影を抑えて街と馴染ませる
     ・昼夜サイクルの光（hemi/sun）に応じて色が街と一緒に変化する
     ============================================================ */
  function loadCharacter() {
    try {
      if (typeof THREE === 'undefined' || !T.ready) return false;
      if (typeof THREE.GLTFLoader !== 'function') return false; // ローダー未読込なら街のみ
      const loader = new THREE.GLTFLoader();
      loader.load(CHAR.url, onCharLoaded, undefined, () => {
        /* 読み込み失敗：街はそのまま正常。キャラだけ出ない */
      });
      return true;
    } catch (e) {
      return false; // 何があっても街の描画は止めない
    }
  }

  /* テクスチャを texSize 四方へ縮小（2048→1024） */
  function downscaleTexture(tex, size) {
    try {
      if (!tex || !tex.image) return tex;
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d').drawImage(tex.image, 0, 0, size, size);
      const nt = new THREE.CanvasTexture(c);
      nt.flipY = tex.flipY;
      nt.encoding = THREE.sRGBEncoding;
      nt.wrapS = tex.wrapS; nt.wrapT = tex.wrapT;
      return nt;
    } catch (e) { return tex; }
  }

  /* ボーンのワールド向き fromDir を toDir へ向ける（親回転を打ち消して適用）。
     表示回転・左右の鏡像配置に依存しない堅牢な方式（test-glbで検証済み）。 */
  function alignWorld(bone, fromDir, toDir) {
    const pq = new THREE.Quaternion();
    if (bone.parent) bone.parent.getWorldQuaternion(pq);
    const q = new THREE.Quaternion().setFromUnitVectors(
      fromDir.clone().normalize(), toDir.clone().normalize());
    bone.quaternion.premultiply(pq).premultiply(q).premultiply(pq.clone().invert());
  }

  function poseCharArms(root) {
    scene.updateMatrixWorld(true);
    const find = sfx => {
      let r = null;
      root.traverse(o => { if ((o.name || '').toLowerCase().endsWith(sfx)) r = o; });
      return r;
    };
    const wp = o => o.getWorldPosition(new THREE.Vector3());
    for (const s of ['left', 'right']) {
      const sh = find(s + 'shoulder'), arm = find(s + 'arm'),
        fore = find(s + 'forearm'), hand = find(s + 'hand');
      if (!sh || !arm || !hand) continue;
      const armDir = wp(hand).sub(wp(sh));
      const horiz = new THREE.Vector3(armDir.x, 0, armDir.z).normalize();
      // 上腕：真下＋わずかに外（残し角 ≒ 90−armDeg）
      const out = Math.cos(THREE.MathUtils.degToRad(CHAR.armDeg)) /
                  Math.max(0.0001, Math.sin(THREE.MathUtils.degToRad(CHAR.armDeg)));
      const target = horiz.clone().multiplyScalar(out).add(new THREE.Vector3(0, -1, 0));
      alignWorld(arm, armDir, target);
      scene.updateMatrixWorld(true);
      if (fore) {
        const faDir = wp(hand).sub(wp(fore));
        const bent = faDir.clone().applyAxisAngle(horiz, THREE.MathUtils.degToRad(CHAR.elbowDeg));
        alignWorld(fore, faDir, bent);
        scene.updateMatrixWorld(true);
      }
    }
  }

  function onCharLoaded(gltf) {
    try {
      const root = gltf.scene;
      root.scale.setScalar(CHAR.scale);
      root.position.set(CHAR.x, CHAR.y, CHAR.z);
      root.rotation.y = THREE.MathUtils.degToRad(CHAR.yawDeg);

      // マテリアルを街と同じ簡略ライティング（Lambert）へ。テカリ・写実陰影を排し、
      // baseColorの色味だけ残す。テクスチャは1024へ縮小。
      root.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = false;     // 接地影は別途ブロブで落とす
        o.receiveShadow = false;
        const src = o.material;
        const map = src && src.map ? downscaleTexture(src.map, CHAR.texSize) : null;
        const lm = new THREE.MeshLambertMaterial({
          map,
          color: map ? 0xffffff : 0xdcc6a8,
          skinning: !!o.isSkinnedMesh, // r128はskinnedに skinning フラグが必要
        });
        o.material = lm;
      });

      poseCharArms(root); // 左右対称の腕下げ（検証値）

      // 街の建物と同質の接地影（楕円ブロブを1つ、足元へ）
      const shadow = new THREE.Mesh(geos().disc, new THREE.MeshBasicMaterial({
        color: 0x2a2018, transparent: true, opacity: 0.22, depthWrite: false,
      }));
      shadow.scale.set(0.85, 0.4, 0.7);
      shadow.position.set(CHAR.x, 0.12, CHAR.z);
      shadow.renderOrder = -1;
      scene.add(shadow);
      root.userData.shadow = shadow;

      scene.add(root);
      charRoot = root;
    } catch (e) {
      // 失敗してもキャラを出さないだけ。街は正常のまま
      charRoot = null;
    }
  }

  function charBounce() {
    if (charRoot) charBounceT0 = Date.now();
  }

  /* ---------- 演出 ---------- */
  function animateFacility(id) {
    const grp = facGroups[id];
    if (grp) bounces.push({ group: grp, t0: Date.now() });
    if (id === 'lights') {
      bounces.push({ group: townGroup, t0: Date.now(), soft: true });
    }
    if (id === 'lantern') charBounce(); // 工房を育てるとレインが小さくジャンプ
  }

  function lanternPoint() {
    if (!T.ready || !lanternHeadMesh || !canvas) return null;
    const v = new THREE.Vector3();
    lanternHeadMesh.getWorldPosition(v);
    v.project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height };
  }

  /* ---------- ループ ---------- */
  function animate() {
    requestAnimationFrame(animate);
    const now = Date.now();
    const t = now / 1000;

    applyCycle(now);

    for (const f of flags) {
      f.mesh.rotation.y = Math.sin(t * 4 + f.seed) * 0.3;
      f.mesh.scale.y = 1 + Math.sin(t * 7 + f.seed) * 0.06;
    }
    for (const s of smokes) {
      const ph = ((t * 0.35 + s.seed) % 1.6) / 1.6;
      s.sprite.position.set(
        s.baseX + Math.sin(ph * 6 + s.seed) * 0.12,
        s.baseY + ph * 1.1,
        s.baseZ);
      s.sprite.material.opacity = 0.4 * (1 - ph);
      s.sprite.scale.setScalar(0.16 + ph * 0.3);
    }
    // レイン：呼吸程度のゆっくりした上下動 ＋ 反応のジャンプ
    if (charRoot) {
      let y = CHAR.y + Math.sin(t * 1.5) * CHAR.breathAmp;
      const bp = (now - charBounceT0) / 520;
      if (bp >= 0 && bp < 1) y += Math.sin(bp * Math.PI) * 0.14;
      charRoot.position.y = y;
    }
    for (let i = bounces.length - 1; i >= 0; i--) {
      const b = bounces[i];
      const p = (now - b.t0) / 600;
      if (p >= 1) {
        b.group.scale.setScalar(1);
        bounces.splice(i, 1);
        continue;
      }
      const s = b.soft
        ? 1 + Math.sin(p * Math.PI) * 0.03
        : 0.7 + 0.3 * (1 - Math.pow(1 - p, 3)) + Math.sin(p * Math.PI) * 0.12;
      b.group.scale.setScalar(s);
    }
    if (wish) {
      if (now > wish.expireAt) {
        removeWish();
        if (T.onWishExpire) T.onWishExpire();
      } else if (wish.kind === 'star') {
        wish.group.position.x -= 0.012;
        wish.group.position.y -= 0.006;
      } else {
        wish.group.position.y += Math.sin(t * 2.4) * 0.008;
        wish.group.children.forEach(w => {
          if (w.userData.wing) w.rotation.y = w.userData.wing * (0.5 + Math.sin(t * 14) * 0.5);
        });
      }
    }

    renderer.render(scene, camera);
  }
})();
