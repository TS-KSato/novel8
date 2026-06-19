/* ============================================================
   灯火の街リーザ（仮）— カードパズル 問1の縦スライス
   悩み → 手札からカードを選ぶ → 「これで解く」 → 判定 →
   解決後テキスト → 信頼ゲージ反映。
   保存は localStorage（接頭辞 lisa_cards:）のみ。
   ============================================================ */
(function () {
  'use strict';

  const { CARDS, PUZZLE_1 } = window.LisaCards;
  const TRUST_KEY = 'lisa_cards:trust';
  const puzzle = PUZZLE_1;

  const $ = id => document.getElementById(id);

  /* ---------- 状態 ---------- */
  let selected = new Set();     // 選択中カードidの集合
  let locked = false;           // 判定中（結果表示中）は操作不可

  function loadTrust() {
    const v = parseInt(localStorage.getItem(TRUST_KEY), 10);
    return Number.isFinite(v) ? v : 0;
  }
  function saveTrust(v) {
    try { localStorage.setItem(TRUST_KEY, String(v)); } catch (e) { /* 保存不可でも続行 */ }
  }
  let trust = loadTrust();

  /* ---------- 判定（集合一致） ---------- */
  function sameSet(arr, other) {
    if (arr.length !== other.length) return false;
    const s = new Set(other);
    return arr.every(x => s.has(x));
  }
  function judge(ids) {
    if (sameSet(ids, puzzle.answer)) return { ok: true, text: puzzle.success };
    for (const f of puzzle.fails) {
      if (sameSet(ids, f.set)) return { ok: false, text: f.text };
    }
    return { ok: false, text: puzzle.failDefault };
  }
  // テスト/確認用に公開（ゲーム挙動には影響しない）
  window.LisaGame = { judge, sameSet, TRUST_KEY, getTrust: () => trust };

  /* ---------- 描画 ---------- */
  function renderStatic() {
    $('face').style.backgroundImage = "url('assets/portraits/rein_face.png')";
    $('problem-text').textContent = puzzle.problem;

    const hand = $('hand');
    hand.textContent = '';
    for (const id of puzzle.hand) {
      const c = CARDS[id];
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'card';
      btn.dataset.id = id;
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML =
        '<span class="card-check" aria-hidden="true">✓</span>' +
        '<span class="card-icon" aria-hidden="true">' + c.icon + '</span>' +
        '<span class="card-label">' + c.label + '</span>';
      btn.addEventListener('click', () => toggle(id));
      li.appendChild(btn);
      hand.appendChild(li);
    }
    updateTrust();
    updateSelection();
  }

  function toggle(id) {
    if (locked) return;
    if (selected.has(id)) selected.delete(id); else selected.add(id);
    updateSelection();
  }

  function updateSelection() {
    // カードの選択状態
    for (const btn of document.querySelectorAll('.card')) {
      const on = selected.has(btn.dataset.id);
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    // レシピ（選択中）チップ：タップで外せる
    const chips = $('recipe-chips');
    chips.textContent = '';
    const order = puzzle.hand.filter(id => selected.has(id)); // 手札順で安定表示
    $('recipe-hint').style.display = order.length ? 'none' : '';
    for (const id of order) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.innerHTML = CARDS[id].icon + ' ' + CARDS[id].label +
        '<span class="chip-x" aria-hidden="true">×</span>';
      chip.setAttribute('aria-label', CARDS[id].label + ' を外す');
      chip.addEventListener('click', () => toggle(id));
      chips.appendChild(chip);
    }
    // ボタンの活性
    const any = selected.size > 0;
    $('btn-clear').disabled = !any || locked;
    $('btn-solve').disabled = !any || locked;
  }

  function updateTrust() {
    $('trust-val').textContent = String(trust);
    const pips = $('trust-pips');
    pips.textContent = '';
    const n = Math.max(0, Math.min(5, trust));
    for (let i = 0; i < 5; i++) {
      const p = document.createElement('span');
      p.className = 'pip' + (i < n ? ' lit' : '');
      pips.appendChild(p);
    }
    $('trust').classList.toggle('low', trust <= 0);
  }

  /* ---------- 解く ---------- */
  function solve() {
    if (locked || selected.size === 0) return;
    locked = true;
    updateSelection();
    const res = judge(puzzle.hand.filter(id => selected.has(id)));
    trust += res.ok ? 1 : -1;
    saveTrust(trust);
    updateTrust(); // ヘッダの信頼ゲージを即時反映
    showResult(res);
  }

  function showResult(res) {
    const gameover = trust < 0;
    $('result-card').className = res.ok ? 'ok' : (gameover ? 'over' : 'ng');
    $('result-mark').textContent = res.ok ? '◎' : (gameover ? '…' : '×');
    $('result-title').textContent = res.ok ? '解決した' : (gameover ? '信頼が尽きた' : 'うまくいかない');
    $('result-text').textContent = res.text;
    $('result-trust').textContent =
      (res.ok ? '信頼 +1' : '信頼 −1') + '　（信頼 ' + trust + '）' +
      (gameover ? '\nレインは、人々の信頼を失ってしまった。' : '');

    const next = $('result-next');
    if (gameover) next.textContent = '最初からやり直す';
    else if (res.ok) next.textContent = 'もう一度挑戦する';
    else next.textContent = 'もう一度考える';

    next.onclick = () => {
      $('result').hidden = true;
      if (gameover) { trust = 0; saveTrust(trust); }
      selected = new Set();
      locked = false;
      updateTrust();
      updateSelection();
    };
    $('result').hidden = false;
  }

  /* ---------- 起動 ---------- */
  $('btn-clear').addEventListener('click', () => {
    if (locked) return;
    selected = new Set();
    updateSelection();
  });
  $('btn-solve').addEventListener('click', solve);
  // オーバーレイ背景タップでは閉じない（誤操作防止：結果は必ずボタンで進める）

  renderStatic();
})();
