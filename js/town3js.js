/* ============================================================
   灯火の街リーザ — Three.js 街ビュー（レンダラー層）
   ローポリ・ミニチュアジオラマ。「手のひらに乗る模型の街」。

   - モデル（何を建てるか）は town-model.js が生成し、ここでは描くだけ
   - ジオメトリはすべてコード生成。外部モデル・テクスチャ・画像なし
   - WebGL非対応／初期化失敗時は ready=false のままにして、
     main.js が CSSジオラマ（town3d.js）へ自動フォールバックする
   - 性能: pixelRatio上限1.5 / 影は512px1枚 / 共有ジオメトリ・
     共有マテリアルでドローコールを抑制 / transformのみのアニメ
   ============================================================ */
(() => {
  'use strict';

  const T = {
    ready: false,
    init, render, setCycle, animateFacility, lanternPoint, spawnWish,
  };
  window.LizaTown3D = T;

  let renderer, scene, camera, sun, hemi, lanternLight;
  let host, canvas;
  let townGroup = null;
  let cyclePos = 170, cycleLen = 240;
  let windows = [];   // { mat, delay, always }
  let flags = [];     // { mesh, seed }
  let smokes = [];    // { sprite, seed, baseX, baseY, baseZ }
  let facGroups = {}; // facId -> group
  let bounces = [];   // { group, t0 }
  let wish = null;    // { group, kind, onCatch, expireAt }
  let lanternHeadMesh = null;
  let onFacilityTapCb = null;
  let raf = 0;

  /* 共有ジオメトリ（unitサイズをscaleして使い回す） */
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
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.outputEncoding = THREE.sRGBEncoding;

      canvas = renderer.domElement;
      canvas.id = 'gl-canvas';
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      host.insertBefore(canvas, host.firstChild);

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a2450);
      scene.fog = new THREE.Fog(0x1a2450, 22, 40);

      /* 約40度見下ろしの固定俯瞰。下半分のUIを妨げない構図 */
      camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60);
      camera.position.set(0, 13.2, 12.4);
      camera.lookAt(0, -0.4, 0);

      hemi = new THREE.HemisphereLight(0xbecbe8, 0x6e5a45, 0.85);
      scene.add(hemi);

      sun = new THREE.DirectionalLight(0xfff4e0, 0.9);
      sun.castShadow = true;
      sun.shadow.mapSize.set(512, 512);
      sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
      sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
      sun.shadow.camera.far = 50;
      scene.add(sun);

      /* はじまりのランタンの光（夜の存在感） */
      lanternLight = new THREE.PointLight(0xffb24d, 1.0, 9, 2);
      lanternLight.position.set(0, 1.6, 0);
      scene.add(lanternLight);

      resize();
      window.addEventListener('resize', resize);
      host.addEventListener('pointerdown', onPointerDown, true); // captureで願い星を先取り

      T.ready = true;
      animate();
      return true;
    } catch (e) {
      T.ready = false;
      if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
      return false;
    }
  }

  function resize() {
    if (!renderer || !host) return;
    const w = host.clientWidth || 390;
    const h = host.clientHeight || 300;
    renderer.setSize(w, h);
    camera.aspect = w / h;
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
    mesh.castShadow = p.kind !== 'plane';
    mesh.receiveShadow = false;

    if (p.win) windows.push({ mat: mesh.material, delay: p.delay || 0, always: !!p.always });
    if (p.anim === 'flag') flags.push({ mesh, seed: Math.random() * 10 });
    if (p.anim === 'smoke-src') addSmoke(p);
    return mesh;
  }

  function addSmoke(p) {
    for (let i = 0; i < 3; i++) {
      const sm = new THREE.Sprite(new THREE.SpriteMaterial({
        color: 0xd8d4cc, transparent: true, opacity: 0.45,
      }));
      sm.scale.setScalar(0.22);
      smokes.push({ sprite: sm, seed: i * 2.1 + Math.random(), baseX: p.x, baseY: p.y + 0.35, baseZ: p.z });
    }
  }

  function groundColor(stage) {
    return [0, 0x8a7a55, 0x86805a, 0x8d8572, 0x948c78, 0x9a9280][stage] || 0x8a7a55;
  }

  function render(data) {
    if (!T.ready || !window.LizaTownModel) return;
    const model = window.LizaTownModel.buildTownModel(data);

    if (townGroup) scene.remove(townGroup);
    windows = []; flags = []; smokes = []; facGroups = {};
    townGroup = new THREE.Group();

    /* 島型ボード（台座の厚みでジオラマ感） */
    const S = model.board.size;
    const base = new THREE.Mesh(geos().box, matOf(0x6e5a45));
    base.scale.set(S, model.board.thickness, S);
    base.position.y = -model.board.thickness / 2;
    base.receiveShadow = true;
    townGroup.add(base);

    const top = new THREE.Mesh(geos().box, matOf(groundColor(model.stage)));
    top.scale.set(S, 0.1, S);
    top.position.y = 0.0;
    top.receiveShadow = true;
    townGroup.add(top);

    /* 草地のパッチ */
    const rngP = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(model.stage * 99 + 7);
    for (let i = 0; i < model.bushes + 4; i++) {
      const patch = new THREE.Mesh(geos().disc, matOf(0x6f8a4a));
      const pr = 0.6 + rngP() * 0.9;
      patch.scale.set(pr * 2, 0.6, pr * 2);
      patch.position.set((rngP() - 0.5) * (S - 2.5), 0.04, (rngP() - 0.5) * (S - 2.5));
      patch.receiveShadow = true;
      townGroup.add(patch);
    }

    /* 道と広場（段階で石畳に） */
    const roadColor = model.stage >= 5 ? 0x7d766a : model.stage >= 3 ? 0x756d62 : 0x7a6a50;
    for (const r of model.roads) {
      const road = new THREE.Mesh(geos().box, matOf(roadColor));
      road.scale.set(r.w, 0.06, r.l);
      road.position.set(r.x, 0.09, r.z);
      road.receiveShadow = true;
      townGroup.add(road);
    }
    const plaza = new THREE.Mesh(geos().disc, matOf(model.stage >= 3 ? 0x8d857a : 0x84745a));
    plaza.scale.set(model.plaza.r * 2, 1, model.plaza.r * 2);
    plaza.position.y = 0.08;
    plaza.receiveShadow = true;
    townGroup.add(plaza);

    if (model.canal) {
      const canal = new THREE.Mesh(geos().box, new THREE.MeshLambertMaterial({
        color: 0x5e9ec8, emissive: 0x2a4a66, emissiveIntensity: 0.4,
      }));
      canal.scale.set(S, 0.05, 0.55);
      canal.position.set(0, 0.1, 2.75);
      townGroup.add(canal);
    }

    /* 茂み */
    for (let i = 0; i < model.bushes; i++) {
      const b = new THREE.Mesh(geos().sphere, matOf(0x5c7a3c));
      b.scale.set(0.5, 0.32, 0.5);
      b.position.set((rngP() - 0.5) * (S - 3), 0.16, (rngP() - 0.5) * (S - 3));
      b.castShadow = true;
      townGroup.add(b);
    }

    /* 段階4+の花壇 */
    for (let i = 0; i < model.flowerbeds; i++) {
      const fb = buildParts(window.LizaTownModel.decorParts('flowerbed'));
      fb.position.set(i % 2 === 0 ? -2.4 : 2.4, 0.1, i < 2 ? -1.3 : 1.3);
      townGroup.add(fb);
    }

    /* はじまりのランタン（広場の中心・常時灯る） */
    const lant = new THREE.Group();
    const pole = new THREE.Mesh(geos().cyl, matOf(0x4a4038));
    pole.scale.set(0.12, 1.5, 0.12);
    pole.position.y = 0.75;
    pole.castShadow = true;
    lant.add(pole);
    const headMat = new THREE.MeshLambertMaterial({
      color: 0xffe9b0, emissive: 0xffb24d, emissiveIntensity: 1,
    });
    lanternHeadMesh = new THREE.Mesh(geos().sphere, headMat);
    lanternHeadMesh.scale.setScalar(0.34);
    lanternHeadMesh.position.y = 1.62;
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

    /* 街灯 */
    for (const l of model.lamps) {
      const grp = new THREE.Group();
      const p = new THREE.Mesh(geos().cyl, matOf(0x4e4238));
      p.scale.set(0.07, 1.1, 0.07);
      p.position.y = 0.55;
      p.castShadow = true;
      grp.add(p);
      const gm = new THREE.MeshLambertMaterial({
        color: 0xffe2a0, emissive: 0xffc873, emissiveIntensity: 0,
      });
      const gl = new THREE.Mesh(geos().sphere, gm);
      gl.scale.setScalar(0.2);
      gl.position.y = 1.15;
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
      grp.rotation.y = (h.rotY % (Math.PI / 2)) - Math.PI / 4; // 道に程よく沿う
      townGroup.add(grp);
    }

    /* 依頼報酬の装飾（街が豊かになっていく） */
    for (const d of model.decorations) {
      const grp = buildParts(d.parts);
      grp.position.set(d.x, 0.1, d.z);
      townGroup.add(grp);
    }

    /* 煙スプライトをシーンに */
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
     朝50/昼70/夕50/夜70（秒）の連続値から光と空を補間する */
  function setCycle(pos, len) {
    cyclePos = pos;
    if (len) cycleLen = len;
  }

  const KEYS = [
    // t(秒), 空, 太陽色, 太陽強さ, 仰角(deg), 半球光(空/地), 霧
    { t: 0,   sky: 0x8fa3cf, sunC: 0xffd9a8, sunI: 0.62, elev: 14, hemiS: 0xb8c4e2, hemiG: 0x7a6450, hemiI: 0.8 },
    { t: 85,  sky: 0x9cc4ec, sunC: 0xfff4e0, sunI: 1.0,  elev: 62, hemiS: 0xcfe2f4, hemiG: 0x8a7a5c, hemiI: 1.0 },
    { t: 145, sky: 0xd28a5e, sunC: 0xff9858, sunI: 0.6,  elev: 10, hemiS: 0xd2a080, hemiG: 0x6e5a45, hemiI: 0.75 },
    { t: 205, sky: 0x141d40, sunC: 0x8aa4d8, sunI: 0.3,  elev: 42, hemiS: 0x3a4470, hemiG: 0x2c2620, hemiI: 0.5 },
    { t: 240, sky: 0x8fa3cf, sunC: 0xffd9a8, sunI: 0.62, elev: 14, hemiS: 0xb8c4e2, hemiG: 0x7a6450, hemiI: 0.8 },
  ];

  let cA = null, cB = null; // THREE未読込環境でも落ちないよう遅延生成
  function lerpColor(a, b, f) {
    if (!cA) { cA = new THREE.Color(); cB = new THREE.Color(); }
    return cA.setHex(a).lerp(cB.setHex(b), f);
  }

  /* 窓明かり: 夜=1 / 昼=0。夕暮れは窓ごとの delay で一つずつ点く */
  function litFactor(pos, delay) {
    if (pos >= 170 || pos < 0) return 1;                       // 夜
    if (pos < 50) {                                            // 朝: 順に消える
      const pr = pos / 50;
      return pr > delay ? Math.max(0, 1 - (pr - delay) * 6) : 1;
    }
    if (pos < 120) return 0;                                   // 昼
    const pr = (pos - 120) / 50;                               // 夕: 順に点く
    return pr > delay ? Math.min(1, (pr - delay) * 6) : 0;
  }

  function applyCycle() {
    const pos = (cyclePos / cycleLen) * 240;
    let a = KEYS[0], b = KEYS[1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (pos >= KEYS[i].t && pos <= KEYS[i + 1].t) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const f = (pos - a.t) / Math.max(1, b.t - a.t);

    scene.background.copy(lerpColor(a.sky, b.sky, f));
    scene.fog.color.copy(scene.background);
    sun.color.copy(lerpColor(a.sunC, b.sunC, f));
    sun.intensity = a.sunI + (b.sunI - a.sunI) * f;
    hemi.color.copy(lerpColor(a.hemiS, b.hemiS, f));
    hemi.groundColor.copy(lerpColor(a.hemiG, b.hemiG, f));
    hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * f;

    const elev = (a.elev + (b.elev - a.elev) * f) * Math.PI / 180;
    const azim = (pos / 240) * Math.PI * 2 - Math.PI * 0.25;
    sun.position.set(Math.cos(azim) * 16, Math.sin(elev) * 16 + 4, Math.sin(azim) * 16);

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
  let raycaster = null, pointer = null; // THREE未読込環境でも落ちないよう遅延生成

  function onPointerDown(e) {
    if (!T.ready || !canvas) return;
    if (!raycaster) { raycaster = new THREE.Raycaster(); pointer = new THREE.Vector2(); }
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    if (wish) {
      const hits = raycaster.intersectObject(wish.group, true);
      if (hits.length > 0) {
        const cb = wish.onCatch;
        removeWish();
        e.stopPropagation(); // 街タップと二重取りにしない
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
      // 街灯はグループ管理外なので全体を軽く明滅
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
    raf = requestAnimationFrame(animate);
    const t = Date.now() / 1000;

    applyCycle();

    // カメラのごく軽い揺れ（ミニチュアを覗き込む感じ）
    camera.position.x = Math.sin(t * 0.12) * 0.35;
    camera.lookAt(0, -0.4, 0);

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
      const p = (Date.now() - b.t0) / 600;
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
      const age = (Date.now() - wish.t0) / 1000;
      if (Date.now() > wish.expireAt) {
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
