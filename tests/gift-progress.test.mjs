import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadPureModule(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { combineGiftProgress, clampPercentage } = await loadPureModule('../src/lib/gifts/progress.ts');
const { formatGoalAmount, formatGiftPercentage } = await loadPureModule('../src/lib/gifts/format.ts');
const gift = { id: 'goal', funding_mode: 'goal', target_amount: 3500 };
const row = { gift_id: 'goal', target_amount: '3500', total_raised: '1225', percentage: '35', remaining_amount: '2275', goal_reached: false };

test('Progress joins by gift_id, preserves order and uses only RPC goal aggregates', () => {
  const gifts = [gift, { ...gift, id: 'zero' }, { ...gift, id: 'reached' }, { ...gift, id: 'open', funding_mode: 'open', target_amount: null }, { ...gift, id: 'fixed', funding_mode: 'fixed' }];
  const rows = [
    { ...row, gift_id: 'fixed', total_raised: 99999 },
    { ...row, gift_id: 'reached', total_raised: 3500, percentage: 100, remaining_amount: 0, goal_reached: true },
    { ...row, gift_id: 'zero', total_raised: 0, percentage: 0, remaining_amount: 3500 },
    { ...row, external_reference: 'must-not-serialize', contributor_name: 'must-not-serialize' },
    { ...row, gift_id: 'open', total_raised: 99999 },
  ];
  const result = combineGiftProgress(gifts, rows);
  assert.deepEqual(result.map(item => item.id), gifts.map(item => item.id));
  assert.deepEqual(result[0].progress, { target_amount: 3500, total_raised: 1225, percentage: 35, remaining_amount: 2275, goal_reached: false });
  assert.equal(result[1].progress.percentage, 0);
  assert.equal(result[2].progress.goal_reached, true);
  assert.equal(result[2].progress.percentage, 100);
  assert.equal(result[3].progress, null);
  assert.equal(result[4].progress, null);
  assert.ok(!JSON.stringify(result).includes('must-not-serialize'));
  assert.ok(!JSON.stringify(result).includes('99999'));
  assert.equal(gift.progress, undefined);
});

test('Unavailable or invalid RPC results never pretend to be zero progress', () => {
  for (const rows of [null, {}, [], [{ ...row, target_amount: 4000 }], [{ ...row, percentage: 'NaN' }], [{ ...row, total_raised: null }], [{ ...row, remaining_amount: -1 }], [{ ...row, goal_reached: 'false' }]]) {
    assert.equal(combineGiftProgress([gift], rows)[0].progress, null);
  }
});

test('Visual percentages are bounded and achieved goals always show 100', () => {
  for (const [input, expected] of [[-12, 0], [0, 0], [35, 35], [100, 100], [130, 100], [NaN, 0], [Infinity, 0]]) {
    assert.equal(clampPercentage(input), expected);
  }
  assert.equal(combineGiftProgress([gift], [{ ...row, percentage: -10 }])[0].progress.percentage, 0);
  assert.equal(combineGiftProgress([gift], [{ ...row, percentage: 120 }])[0].progress.percentage, 100);
  assert.equal(combineGiftProgress([gift], [{ ...row, percentage: 99, goal_reached: true }])[0].progress.percentage, 100);
});

test('pt-BR amounts preserve cents and omit unnecessary decimal zeros', () => {
  const money = value => formatGoalAmount(value).replace(/\u00a0/g, ' ');
  assert.equal(money(0), 'R$ 0');
  assert.equal(money(600), 'R$ 600');
  assert.equal(money(1250), 'R$ 1.250');
  assert.equal(money(3500), 'R$ 3.500');
  assert.equal(money(12.5), 'R$ 12,50');
  assert.deepEqual([0, 35, 100].map(formatGiftPercentage), ['0%', '35%', '100%']);
  assert.equal(formatGiftPercentage(99.99), '99,99%');
});
