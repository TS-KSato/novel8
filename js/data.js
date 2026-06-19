/* ============================================================
   灯火の街リーザ（仮）— カードパズル 静的データ
   ビルド不要・素のJS。window.LisaCards 名前空間で共有。
   問1〜5を順番に解く試作。
   ============================================================ */
(function () {
  'use strict';

  /* カード辞書（id → 表示名・アイコン） */
  const CARDS = {
    fire:  { label: '火', icon: '🔥' },
    water: { label: '水', icon: '💧' },
    pot:   { label: '鍋', icon: '🍲' },
    cloth: { label: '布', icon: '🧵' },
    ash:   { label: '灰', icon: '◍' },
    oil:   { label: '油', icon: '🫗' },
    jar:   { label: '壺', icon: '🏺' },
    wind:  { label: '風', icon: '🌀' },
  };

  /* 問1：澄んだ水で腹を下す。正解は「鍋・水・火」（＝煮沸） */
  const PUZZLE_1 = {
    id: 'q1',
    problem: '拠点の水は澄んでいるのに、飲むと決まって腹を下す。……なぜだ?',
    hand: ['fire', 'water', 'pot', 'cloth'],
    answer: ['pot', 'water', 'fire'], // 集合一致で判定（順序は問わない）
    success:
      '火を通した水は安全になる。"澄んでいるか"ではなく"煮たか"で水を見る——お前の世界では、当たり前の眼だった',
    // 特定の外し方への専用テキスト
    fails: [
      { set: ['cloth', 'water'], text: '濁りは取れた。だが翌日も腹を下した。濁りと病は、別物だ' },
      { set: ['fire', 'water'],  text: '器がなければ、水は煮える前に蒸発して消えた' },
    ],
    failDefault: 'それでは、解決にならなかった',
  };

  /* 問2：傷の手当て。正解は「鍋・水・火・布」（＝沸かした湯で洗い清潔な布で覆う） */
  const PUZZLE_2 = {
    id: 'q2',
    lead: '——アルノ、バルトとリーザが加わった。使えるカードが増えた',
    problem: 'バルト「廃材で腕を切った。唾でもつけときゃ塞がる。……ん? なんだその顔」',
    hand: ['fire', 'water', 'pot', 'cloth', 'ash'],
    answer: ['pot', 'water', 'fire', 'cloth'],
    success:
      '数日後、傷は膿まずに塞がった。リーザ「…ねえレイン。それだけで、いいの? 沸かした水と、洗った手だけで、膿まないの?」——彼女の中で、何かが静かに動き始めた',
    fails: [
      { set: ['cloth'],         text: '傷は数日で熱を持ち、膿んだ' },
      { set: ['water', 'cloth'], text: '煮ていない生の水で洗っては、別の病の元を塗り込むだけだ' },
    ],
    failDefault: 'それでは、傷は塞がらなかった',
  };

  /* 問3：脂汚れを落とす塊。正解は「鍋・灰・油・火」（＝灰汁と油を煮る＝石鹸） */
  const PUZZLE_3 = {
    id: 'q3',
    lead: '——リーザが「もっと知りたい」と言い出した。灰と油が手に入る',
    problem: 'リーザ「手を洗うのが大事なのは分かった。でも水でこすっても脂汚れは落ちない。みんなに広めるには、どうしたら…」',
    hand: ['fire', 'water', 'pot', 'ash', 'oil'],
    answer: ['pot', 'ash', 'oil', 'fire'],
    success:
      'バルト「……ふっ、ふふ。これは——儲かるぞぉ」。"儲かる"とは"広まる"こと。リーザの『洗った手』が、誰の手にも届く塊になった',
    fails: [
      { set: ['ash', 'water'], text: '汚れは落ちる。だが固まらない。皆に配れる"形"がない' },
      { set: ['oil', 'water'], text: '油と水は、ただ分かれるだけだった' },
    ],
    failDefault: 'それでは、汚れを落とす塊にはならなかった',
  };

  /* 問4：物を冷やす。正解は「水・布・風」（＝気化熱で冷やす） */
  const PUZZLE_4 = {
    id: 'q4',
    lead: '——壺と、風を起こす道具が揃った',
    problem: '「夏の盛り、薬草も食い物もすぐ腐る。氷なんざ手に入らねえ。"冷やす魔法"なんて、聞いたこともねえ」',
    hand: ['fire', 'water', 'wind', 'cloth', 'jar'],
    answer: ['water', 'cloth', 'wind'],
    success:
      'この街の魔法使いは"熱を出す"ことしか知らない。"冷やす"は、お前の世界では誰もが知る当たり前だった',
    fails: [
      { set: ['wind'],  text: 'あおいでも、涼しいのは今だけ。物は冷えない' },
      { set: ['water'], text: '濡らしただけでは、冷えはしなかった' },
    ],
    failDefault: 'それでは、物は冷えなかった',
  };

  /* 問5：安定した灯り。正解は「壺・油・布・火」（＝芯のランプ） */
  const PUZZLE_5 = {
    id: 'q5',
    lead: '——最後の悩みだ',
    problem: '「夜のアジトは真っ暗だ。松明は煙くてすぐ消える、火事も怖い。ずっと安心して灯せる明かりが欲しい」',
    hand: ['fire', 'oil', 'cloth', 'jar', 'wind'],
    answer: ['jar', 'oil', 'cloth', 'fire'],
    success:
      '4人「これがあれば暗闇は怖くない」。——空気を上手く導けば、もっと明るく、もっと長く灯せる。その灯りはいつか、街中を照らすことになる',
    fails: [
      { set: ['fire', 'cloth'], text: '今まで通りの松明。煙くて、すぐ消える' },
      { set: ['fire', 'wind'],  text: '風で煽れば、火は安定するどころか消えた' },
    ],
    failDefault: 'それでは、安定した灯りにはならなかった',
  };

  const PUZZLES = [PUZZLE_1, PUZZLE_2, PUZZLE_3, PUZZLE_4, PUZZLE_5];

  window.LisaCards = {
    CARDS,
    PUZZLES,
    PUZZLE_1, PUZZLE_2, PUZZLE_3, PUZZLE_4, PUZZLE_5,
  };
})();
