/* ============================================================
   灯火の街リーザ（仮）— カードパズル 静的データ（v2）
   ビルド不要・素のJS。window.LisaCards 名前空間で共有。
   各問に observe（観察メモ）/ hints（浅・深）を持つ。判定は集合一致。
   ============================================================ */
(function () {
  'use strict';

  /* カード辞書（id → 表示名・アイコン） */
  const CARDS = {
    fire:  { label: '火', icon: '🔥' },
    water: { label: '水', icon: '💧' },
    pot:   { label: '鍋', icon: '🍲' },
    cloth: { label: '布', icon: '🧵' },
    wind:  { label: '風', icon: '🌀' },
    earth: { label: '土', icon: '🟤' },
    jar:   { label: '壺', icon: '🏺' },
    oil:   { label: '油', icon: '🫗' },
    wood:  { label: '木', icon: '🪵' },
  };

  /* 問1：澄んだ水で腹を下す。正解は「鍋・水・火」（＝煮沸） */
  const PUZZLE_1 = {
    id: 'q1',
    problem: '拠点の水は澄んでいるのに、飲むと決まって腹を下す。……なぜだ?',
    observe: '気づいた——煮炊きに使った後の水で腹を下した者は、一人もいない',
    hand: ['fire', 'water', 'pot', 'cloth'],
    answer: ['pot', 'water', 'fire'],
    success:
      '火を通した水は安全になる。"澄んでいるか"ではなく"煮たか"で水を見る——お前の世界では、当たり前の眼だった',
    fails: [
      { set: ['cloth', 'water'], text: '濁りは取れた。だが翌日も腹を下した。濁りと病は、別物だ' },
      { set: ['fire', 'water'],  text: '器がなければ、水は煮える前に蒸発して消えた' },
    ],
    failDefault: 'それでは、解決にならなかった',
    hints: {
      shallow: { who: 'レイン', text: 'たしか…火を通すと、水は良くなる…ような' },
      deep:    { who: 'レイン', text: '煮るには、水を逃がさない"器"が要る。じかに火では消えてしまう' },
    },
  };

  /* 問2：傷の手当て。正解は「鍋・水・火・布」（＝沸かした湯で洗い清潔な布で覆う） */
  const PUZZLE_2 = {
    id: 'q2',
    problem: 'バルト「廃材で腕を切った。唾でもつけときゃ塞がる。……ん? なんだその顔」',
    observe: 'あの水と同じだ。傷が膿むのも、目に見えない"悪いもの"の仕業なら——火を通した湯なら',
    hand: ['fire', 'water', 'pot', 'cloth'],
    answer: ['pot', 'water', 'fire', 'cloth'],
    success:
      '数日後、傷は膿まず塞がった。リーザ「…ねえレイン。それだけで、いいの? 沸かした水と、洗った手だけで」——彼女の中で、何かが静かに動き始めた',
    fails: [
      { set: ['cloth'],         text: '傷は数日で熱を持ち、膿んだ' },
      { set: ['water', 'cloth'], text: '煮ていない生の水で洗っては、別の病の元を塗り込むだけだ' },
    ],
    failDefault: 'それでは、傷は塞がらなかった',
    hints: {
      shallow: { who: 'リーザ', text: '水を煮るの、飲むときだけじゃないんじゃない?' },
      deep:    { who: 'レイン', text: '煮た湯で洗って、きれいな布で覆う。触る手も清潔に' },
    },
  };

  /* 問3：物を冷やす。正解は「水・布・風」（＝気化熱で冷やす） */
  const PUZZLE_3 = {
    id: 'q3',
    problem: '夏の盛り、薬草も食い物もすぐ腐る。氷なんざ手に入らねえ。"冷やす魔法"なんて、聞いたこともねえ',
    observe: '汗をかいた後、風が吹くとひやりとする。濡れたものが乾くとき、何かが熱を持っていく——',
    hand: ['fire', 'water', 'wind', 'cloth', 'jar'],
    answer: ['water', 'cloth', 'wind'],
    success:
      'この街の魔法使いは"熱を出す"ことしか知らない。"冷やす"は、お前の世界では誰もが知る当たり前だった',
    fails: [
      { set: ['wind'],  text: 'あおいでも、涼しいのは今だけ。物は冷えない' },
      { set: ['water'], text: '濡らしただけでは、冷えはしなかった' },
    ],
    failDefault: 'それでは、物は冷えなかった',
    hints: {
      shallow: { who: 'アルノ', text: '"熱を出す"の、逆。それを術にできるかもしれません' },
      deep:    { who: 'アルノ', text: '濡らした布に風を。乾くときに、熱が逃げます' },
    },
  };

  /* 問4：かまど。正解は「土・火・風」（＝囲って空気を導き火力を上げる） */
  const PUZZLE_4 = {
    id: 'q4',
    problem: '飯を炊くにも鍛冶にも、焚き火じゃ火力が足りねえ。薪ばかり食って、ちっとも強くならねえ',
    observe: '焚き火を石で囲い、下に隙間を残したら、勢いが増した。火は、空気を吸って育つ——',
    hand: ['fire', 'earth', 'wind', 'jar', 'wood'],
    answer: ['earth', 'fire', 'wind'],
    success:
      '囲って空気を導けば、火は強く、長く、きれいに燃える。——この"空気を導く"理屈は、次の灯りに効いてくる',
    fails: [
      { set: ['fire', 'wood'], text: '火は大きくなった。だが煙くて、すぐ崩れた' },
      { set: ['fire', 'wind'], text: '風で煽れば、火は散って消えた' },
    ],
    failDefault: 'それでは、火力は上がらなかった',
    hints: {
      shallow: { who: 'バルト', text: '鍛冶屋の炉、わざわざ下から風を送り込んでたぞ' },
      deep:    { who: 'アルノ', text: '土で囲い、空気の道を一本。煽るのではなく、導くのです' },
    },
  };

  /* 問5：安定した灯り。正解は「壺・油・布・火」（＝芯のランプ） */
  const PUZZLE_5 = {
    id: 'q5',
    problem: '夜のアジトは真っ暗だ。松明は煙くてすぐ消える、火事も怖い。ずっと安心して灯せる明かりが欲しい',
    observe: '油を布に吸わせると、じわじわと長く燃えた。布が油を吸い上げている——壺に納めれば、こぼれず、ずっと',
    hand: ['fire', 'oil', 'cloth', 'jar', 'wind'],
    answer: ['jar', 'oil', 'cloth', 'fire'],
    success:
      '4人「これがあれば暗闇は怖くない」。——かまどで掴んだ"空気を導く"理屈を加えれば、もっと明るく。その灯りはいつか、街中を照らすことになる',
    fails: [
      { set: ['fire', 'cloth'], text: '今まで通りの松明。煙くて、すぐ消える' },
      { set: ['fire', 'wind'],  text: '風で煽れば、火は安定するどころか消えた' },
    ],
    failDefault: 'それでは、安定した灯りにはならなかった',
    hints: {
      shallow: { who: 'アルノ', text: '布が、油を吸い上げています。あれを"芯"にすれば' },
      deep:    { who: 'リーザ', text: '壺に油、布を芯に挿して、火を。麻紐で吊るせば持ち運べる' },
    },
  };

  const PUZZLES = [PUZZLE_1, PUZZLE_2, PUZZLE_3, PUZZLE_4, PUZZLE_5];

  window.LisaCards = {
    CARDS,
    PUZZLES,
    PUZZLE_1, PUZZLE_2, PUZZLE_3, PUZZLE_4, PUZZLE_5,
  };
})();
