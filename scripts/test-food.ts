// Checks food names and half-step quantities. Usage: node scripts/test-food.ts
import { feedLabel, formatQty, isMenuFood, joinFeedItems, joinFood, splitFeedItems, normaliseFood, nudgeAmount, parseQty, splitFood } from '../src/food.ts';

let fails = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`, ok ? '' : `got ${JSON.stringify(got)}`);
  if (!ok) fails++;
};

eq('½', formatQty(0.5), '½');
eq('1', formatQty(1), '1');
eq('1½', formatQty(1.5), '1½');
eq('2½', formatQty(2.5), '2½');
for (const [t, n] of [['1½', 1.5], ['1 1/2', 1.5], ['1.5', 1.5], ['½', 0.5], ['1/2', 0.5], ['2 ×', 2], ['2x', 2], ['3', 3], ['1.3', 1.5]] as const) eq(`parse "${t}"`, parseQty(t), n);
for (const t of ['', 'half leg', 'lots', '0']) eq(`parse "${t}" -> null`, parseQty(t), null);
eq('round trip', [0.5, 1, 1.5, 2, 2.5, 10].map((n) => parseQty(formatQty(n))), [0.5, 1, 1.5, 2, 2.5, 10]);
eq('mouse -> Mice', normaliseFood('mouse'), 'Mice');
eq('chicks -> Chick', normaliseFood('chicks'), 'Chick');
eq('RAT -> Rat', normaliseFood('RAT'), 'Rat');
eq('unknown kept', normaliseFood('Beef heart'), 'Beef heart');
eq('blank -> null', normaliseFood('  '), null);
eq('label', feedLabel('1½', 'Chick'), '1½ Chick');

eq('nudge 2 Chick +1', nudgeAmount('2', 'Chick', 1), { amount: '2½', food: 'Chick', qty: 2.5 });
eq('nudge 2 Chick -1', nudgeAmount('2', 'Chick', -1), { amount: '1½', food: 'Chick', qty: 1.5 });
eq('nudge never below ½', nudgeAmount('½', 'Quail', -3), { amount: '½', food: 'Quail', qty: 0.5 });
eq('nudge top-up text "1 Chick"', nudgeAmount('1 Chick', null, 1), { amount: '1½', food: 'Chick', qty: 1.5 });
eq('nudge "1½ Quail" -1', nudgeAmount('1½ Quail', null, -1), { amount: '1', food: 'Quail', qty: 1 });
eq('nudge unparseable is null', nudgeAmount('half leg', 'Rabbit', 1), null);
eq('nudge 0 keeps amount', nudgeAmount('2', 'Chick', 0), { amount: '2', food: 'Chick', qty: 2 });

eq('split plain', splitFood('Rabbit'), { base: 'Rabbit', parts: [] });
eq('split cuts', splitFood('Rabbit saddle + head'), { base: 'Rabbit', parts: ['saddle', 'head'] });
eq('split typed', splitFood('rabbit Front Legs and head'), { base: 'Rabbit', parts: ['front leg', 'head'] });
eq('split bad cut', splitFood('Rabbit kidney'), null);
eq('split pheasant cut on rabbit', splitFood('Rabbit wing'), null);
eq('join keeps menu order', joinFood('Pheasant', ['head', 'leg']), 'Pheasant leg + head');
eq('normalise cuts', normaliseFood('pheasant breast, wing'), 'Pheasant wing + breast');
eq('menu food with cuts', isMenuFood('Rabbit front leg'), true);
eq('menu food plain', isMenuFood('Pheasant'), true);
eq('not menu: wrong order', isMenuFood('Rabbit head + saddle'), false);
eq('not menu: typed', isMenuFood('Beef heart'), false);
eq('label with cuts', feedLabel('1', 'Rabbit saddle + head'), '1 Rabbit saddle + head');
eq('nudge cut feed', nudgeAmount('1', 'Rabbit front leg', 1), { amount: '1½', food: 'Rabbit front leg', qty: 1.5 });
eq('nudge top-up with cut', nudgeAmount('1 Pheasant wing', null, 1), { amount: '1½', food: 'Pheasant wing', qty: 1.5 });

const mixed = joinFeedItems([{ food: 'Rabbit front leg', qty: 1 }, { food: 'Chick', qty: 2 }]);
eq('two foods stored as text', mixed, { food_type: null, amount: '1 Rabbit front leg, 2 Chick' });
eq('one food stored as food + amount', joinFeedItems([{ food: 'Chick', qty: 1.5 }]), { food_type: 'Chick', amount: '1½' });
eq('blank food ignored', joinFeedItems([{ food: 'Chick', qty: 2 }, { food: ' ', qty: 1 }]), { food_type: 'Chick', amount: '2' });
eq('two foods read back', splitFeedItems(mixed.amount, mixed.food_type), [{ food: 'Rabbit front leg', qty: 1 }, { food: 'Chick', qty: 2 }]);
eq('cuts with + stay one food', splitFeedItems('1', 'Rabbit saddle + head'), [{ food: 'Rabbit saddle + head', qty: 1 }]);
eq('half first', splitFeedItems('½ Quail, 1 Chick', null), [{ food: 'Quail', qty: 0.5 }, { food: 'Chick', qty: 1 }]);
eq('free text is null', splitFeedItems('half leg', 'Rabbit'), null);
eq('mixed amount can not be nudged', nudgeAmount('1 Rabbit front leg, 2 Chick', null, 1), null);

console.log(fails ? `\n${fails} FAILED` : '\nAll checks passed');
process.exit(fails ? 1 : 0);
