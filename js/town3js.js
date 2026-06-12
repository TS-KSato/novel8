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
    viewHeight: 13.6, // 縦に収めるワールド単位（ズーム。小さいほど寄る）
    dist: 28,         // カメラ距離（平行投影では構図に影響しない）
    lookAtY: 0.8,
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

  /* 露出（パステル調の明るさ） */
  const EXPOSURE = 1.18;

  const T = {
    ready: false,
    CAM, SHADOW,
    init, render, setCycle, animateFacility, lanternPoint, spawnWish,
    quantizeSunPos, // テスト用：影の角度更新の離散化ロジック
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
      animate();
      return true;
    } catch (e) {
      T.ready = false;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      return false;
    }
  }

  function placeCamera() {
    const elev = CAM.elevDeg * Math.PI / 180;
    const azim = CAM.azimDeg * Math.PI / 180;
    const r = CAM.dist;
    camera.position.set(
      Math.cos(elev) * Math.sin(azim) * r,
      Math.sin(elev) * r,
      Math.cos(elev) * Math.cos(azim) * r);
    camera.lookAt(0, CAM.lookAtY, 0);
  }

  function resize() {
    if (!renderer || !host) return;
    const w = host.clientWidth || 390;
    const h = host.clientHeight || 300;
    renderer.setSize(w, h);
    const aspect = w / h;
    const halfH = CAM.viewHeight / 2;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.left = -halfH * aspect;
    camera.right = halfH * aspect;
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

  function render(data) {
    if (!T.ready || !window.LizaTownModel) return;
    const model = window.LizaTownModel.buildTownModel(data);
    const P = window.LizaTownModel.PALETTE;

    if (townGroup) scene.remove(townGroup);
    windows = []; flags = []; smokes = []; facGroups = {};
    townGroup = new THREE.Group();

    /* 島型ボード（台座の厚みでジオラマ感） */
    const S = model.board.size;
    const base = new THREE.Mesh(geos().box, matOf(P.baseSide));
    base.scale.set(S, model.board.thickness, S);
    base.position.y = -model.board.thickness / 2;
    base.receiveShadow = true;
    townGroup.add(base);

    /* 地面ベース＝しっかりした明るい草色（画面の50-60%を占める基調色） */
    const top = new THREE.Mesh(geos().box, matOf(P.grass));
    top.scale.set(S, 0.1, S);
    top.position.y = 0.0;
    top.receiveShadow = true;
    townGroup.add(top);

    /* 土の区画（クリームベージュ）と草の丘で地面に構造を与える */
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
     朝・夕も地面の緑が灰色に濁らないよう、半球光は白寄り・高めの明度を保つ */
  const KEYS = [
    // t(秒), 霞色, 太陽色, 太陽強さ, 仰角(deg), 半球光(空/地/強さ)
    { t: 0,   sky: 0xdfe9f6, sunC: 0xffe6c2, sunI: 0.48, elev: 22, hemiS: 0xf0f5fb, hemiG: 0xe8d8ba, hemiI: 0.98 },
    { t: 85,  sky: 0xd5e7f8, sunC: 0xfff4e2, sunI: 0.6,  elev: 60, hemiS: 0xf6fafd, hemiG: 0xecdcc0, hemiI: 1.1 },
    { t: 145, sky: 0xf6cfa6, sunC: 0xffb878, sunI: 0.5,  elev: 16, hemiS: 0xf8dcb8, hemiG: 0xe2c49e, hemiI: 0.95 },
    { t: 205, sky: 0x4a5a94, sunC: 0xb4c4ee, sunI: 0.24, elev: 45, hemiS: 0x8290c4, hemiG: 0x5e5468, hemiI: 0.7 },
    { t: 240, sky: 0xdfe9f6, sunC: 0xffe6c2, sunI: 0.48, elev: 22, hemiS: 0xf0f5fb, hemiG: 0xe8d8ba, hemiI: 0.98 },
  ];

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
      grp.position.set(2 + Math.random() * 3, 6.5 + Math.random() * 1.5, -4 + Math.random() * 3);
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
      grp.position.set(-3 + Math.random() * 6, 3.4 + Math.random() * 1.4, -2 + Math.random() * 3);
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
  }

  /* ---------- 演出 ---------- */
  function animateFacility(id) {
    const grp = facGroups[id];
    if (grp) bounces.push({ group: grp, t0: Date.now() });
    if (id === 'lights') {
      bounces.push({ group: townGroup, t0: Date.now(), soft: true });
    }
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
