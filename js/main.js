/* ============================================================
   灯火の街リーザ（仮）— カードパズル v2
   悩み（観察メモ常時表示） → 手札からカードを選ぶ／仲間に相談（浅・深）／
   相談を断る → 「これで解く」 → 判定 → 解決後テキスト → 信頼ゲージ反映。
   信頼の増減は DELTA に一元化。ヒントと撤退は「消費後も信頼0以上」のときだけ可。
   保存は localStorage（接頭辞 lisa_cards:）のみ。
   ============================================================ */
(function () {
  'use strict';

  const { CARDS, PUZZLES } = window.LisaCards;
  const LAST = PUZZLES.length - 1;

  const TRUST_KEY = 'lisa_cards:trust';
  const PROGRESS_KEY = 'lisa_cards:progress';
  const STATUS_KEY = 'lisa_cards:status';

  // 信頼の増減（暫定。調整はここ一箇所で）
  const DELTA = {
    success: +2,
    fail: -2,
    hintShallow: -1,
    hintDeep: -2,
    decline: -1,
  };

  const $ = id => document.getElementById(id);

  /* ---------- 状態 ---------- */
  let selected = new Set();     // 選択中カードidの集合
  let locked = false;           // 判定中（結果表示中）は操作不可
  let hintStage = 0;            // 0:未相談 / 1:浅まで / 2:深まで

  function loadInt(key, def) {
    const v = parseInt(localStorage.getItem(key), 10);
    return Number.isFinite(v) ? v : def;
  }
  function saveInt(key, v) {
    try { localStorage.setItem(key, String(v)); } catch (e) { /* 保存不可でも続行 */ }
  }
  function loadStatus() {
    try {
      const a = JSON.parse(localStorage.getItem(STATUS_KEY));
      if (Array.isArray(a) && a.length === PUZZLES.length) return a;
    } catch (e) { /* 壊れていたら初期化 */ }
    return PUZZLES.map(() => 'open');
  }
  function saveStatus() {
    try { localStorage.setItem(STATUS_KEY, JSON.stringify(status)); } catch (e) { /* 続行 */ }
  }

  let trust = loadInt(TRUST_KEY, 0);
  let idx = Math.max(0, Math.min(LAST, loadInt(PROGRESS_KEY, 0)));
  let status = loadStatus();    // 各問: 'open' | 'solved' | 'declined'
  let puzzle = PUZZLES[idx];

  // 信頼を変えて即時反映（保存・ゲージ・ボタン活性まで）
  function changeTrust(d) {
    trust += d;
    saveInt(TRUST_KEY, trust);
    updateTrust();
    updateAssist();
  }

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
  window.LisaGame = {
    judge, sameSet, DELTA,
    getTrust: () => trust,
    getIndex: () => idx,
    getStatus: () => status.slice(),
    getHintStage: () => hintStage,
  };

  /* ---------- 描画 ---------- */
  function renderFace() {
    $('face').style.backgroundImage = "url('assets/portraits/rein_face.png')";
  }

  // 現在の問題（puzzle）を画面に展開し、選択・相談状態をリセットする
  function loadPuzzle() {
    selected = new Set();
    locked = false;
    hintStage = 0;

    $('problem-tag').textContent = '悩み ' + (idx + 1) + ' / ' + PUZZLES.length;
    $('problem-text').textContent = puzzle.problem;
    $('observe-text').textContent = puzzle.observe || '';

    const lead = $('lead');
    if (puzzle.lead) { lead.textContent = puzzle.lead; lead.hidden = false; }
    else { lead.textContent = ''; lead.hidden = true; }

    $('hints').textContent = '';

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
    updateAssist();
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

  // 相談・撤退ボタンのラベルと活性、足りないときの注意書き
  function updateAssist() {
    const hintBtn = $('btn-hint');
    const declineBtn = $('btn-decline');
    const note = $('assist-note');

    // 次に出すヒントの段（浅→深）。深まで出していたら打ち止め
    const nextCost = hintStage === 0 ? -DELTA.hintShallow
                   : hintStage === 1 ? -DELTA.hintDeep
                   : null;
    if (hintStage >= 2) {
      hintBtn.textContent = 'これ以上の相談はない';
      hintBtn.disabled = true;
    } else {
      hintBtn.textContent = hintStage === 0
        ? '仲間に相談する（信頼−' + (-DELTA.hintShallow) + '）'
        : 'もっと深く相談（信頼−' + (-DELTA.hintDeep) + '）';
      // 消費後も信頼が0以上に保てるときだけ可
      hintBtn.disabled = locked || trust + DELTA[hintStage === 0 ? 'hintShallow' : 'hintDeep'] < 0;
    }

    declineBtn.textContent = '相談を断る（信頼−' + (-DELTA.decline) + '）';
    declineBtn.disabled = locked || trust + DELTA.decline < 0;

    // 信頼不足で押せないものがあれば一言出す
    const shortHint = hintStage < 2 && nextCost !== null && trust < nextCost;
    const shortDecline = trust < -DELTA.decline;
    if (!locked && (shortHint || shortDecline)) {
      note.textContent = '信頼が足りない——いまは、自分で解くしかない';
      note.hidden = false;
    } else {
      note.hidden = true;
    }
  }

  /* ---------- 相談（ヒント） ---------- */
  function consult() {
    if (locked || hintStage >= 2) return;
    const stage = hintStage === 0 ? 'shallow' : 'deep';
    const cost = stage === 'shallow' ? DELTA.hintShallow : DELTA.hintDeep;
    if (trust + cost < 0) return; // ゲート：消費後も0以上
    const h = puzzle.hints[stage];

    const box = document.createElement('div');
    box.className = 'hint' + (stage === 'deep' ? ' deep' : '');
    const who = document.createElement('span');
    who.className = 'hint-who';
    who.textContent = h.who;
    const txt = document.createElement('span');
    txt.textContent = '「' + h.text + '」';
    box.appendChild(who);
    box.appendChild(txt);
    $('hints').appendChild(box);

    hintStage += 1;
    changeTrust(cost);   // 内部で updateAssist まで呼ぶ
  }

  /* ---------- 相談を断る（撤退） ---------- */
  function decline() {
    if (locked || trust + DELTA.decline < 0) return;
    locked = true;
    updateSelection();
    updateAssist();
    changeTrust(DELTA.decline);
    status[idx] = 'declined';
    saveStatus();
    showResult('decline', { text: 'この悩みは、いったん預かることにした。今のレインには、まだ早い' });
  }

  /* ---------- 解く ---------- */
  function solve() {
    if (locked || selected.size === 0) return;
    locked = true;
    updateSelection();
    updateAssist();
    const res = judge(puzzle.hand.filter(id => selected.has(id)));
    if (res.ok) {
      changeTrust(DELTA.success);
      status[idx] = 'solved';
      saveStatus();
      showResult('success', res);
    } else {
      changeTrust(DELTA.fail);
      showResult(trust < 0 ? 'gameover' : 'fail', res);
    }
  }

  /* ---------- 結果オーバーレイ ---------- */
  function showResult(kind, res) {
    const cls = (kind === 'success') ? 'ok'
              : (kind === 'gameover') ? 'over'
              : (kind === 'fail') ? 'ng'
              : '';   // decline は中立
    $('result-card').className = cls;
    $('result-mark').textContent =
      kind === 'success' ? '◎' :
      kind === 'gameover' ? '…' :
      kind === 'fail' ? '×' : '→';
    $('result-title').textContent =
      kind === 'success' ? '解決した' :
      kind === 'gameover' ? '信頼が尽きた' :
      kind === 'fail' ? 'うまくいかない' : '先送りにした';
    $('result-text').textContent = res.text;

    const deltaLabel =
      kind === 'success' ? '信頼 +' + DELTA.success :
      kind === 'gameover' ? '信頼 ' + DELTA.fail :
      kind === 'fail' ? '信頼 ' + DELTA.fail :
      '信頼 ' + DELTA.decline;
    $('result-trust').textContent =
      deltaLabel + '　（信頼 ' + trust + '）' +
      (kind === 'gameover' ? '\nレインは、人々の信頼を失ってしまった。' : '');

    const next = $('result-next');
    next.textContent =
      kind === 'gameover' ? 'この問題からやり直す' :
      kind === 'fail' ? 'もう一度考える' : '次へ';

    next.onclick = () => {
      $('result').hidden = true;
      if (kind === 'success' || kind === 'decline') {
        advance();
      } else if (kind === 'gameover') {
        // 今いる問題の頭から再開。信頼0に戻す。解いた問題はそのまま。
        trust = 0; saveInt(TRUST_KEY, trust);
        loadPuzzle();
      } else { // fail：同じ問題に再挑戦（相談・信頼はそのまま）
        selected = new Set();
        locked = false;
        updateTrust();
        updateSelection();
        updateAssist();
      }
    };
    $('result').hidden = false;
  }

  // 次の問題へ。全問が解決/断るで埋まったら終了表示
  function advance() {
    idx += 1;
    if (idx > LAST) { idx = LAST; showEnding(); return; }
    saveInt(PROGRESS_KEY, idx);
    puzzle = PUZZLES[idx];
    loadPuzzle();
  }

  function showEnding() {
    const solved = status.filter(s => s === 'solved').length;
    $('result-card').className = 'ok';
    $('result-mark').textContent = '✦';
    $('result-title').textContent = 'ここまでが今回の試作';
    $('result-text').textContent =
      'お疲れさま。5つの悩みに向き合った。\n（解決 ' + solved + ' / ' + PUZZLES.length + '）';
    $('result-trust').textContent = '（信頼 ' + trust + '）';
    const next = $('result-next');
    next.textContent = '最初から遊ぶ';
    next.onclick = () => {
      $('result').hidden = true;
      trust = 0; saveInt(TRUST_KEY, trust);
      idx = 0; saveInt(PROGRESS_KEY, idx);
      status = PUZZLES.map(() => 'open'); saveStatus();
      puzzle = PUZZLES[idx];
      loadPuzzle();
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
  $('btn-hint').addEventListener('click', consult);
  $('btn-decline').addEventListener('click', decline);
  // オーバーレイ背景タップでは閉じない（誤操作防止：結果は必ずボタンで進める）

  renderFace();
  loadPuzzle();
})();
