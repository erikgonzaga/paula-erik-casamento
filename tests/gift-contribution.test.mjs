import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/gifts/contribution.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
});
const { createPendingContributionWith, preparePendingContribution } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
);

const id = '10000000-0000-4000-8000-000000000099';
const key = '30000000-0000-4000-8000-000000000001';
const request = {
  idempotency_key: key,
  gift_id: id,
  amount: '50,00',
  contributor_name: '  Pessoa de Teste  ',
  contributor_phone: '(11) 99999-9999',
  message: '  Com carinho  ',
};
const goal = { id, active: true, funding_mode: 'goal', target_amount: '3500.00', gift_type: 'regular' };
const progress = { remaining_amount: '2275.00', goal_reached: false };
const open = { ...goal, funding_mode: 'open', target_amount: null };
const fixed = { ...goal, funding_mode: 'fixed', target_amount: '75.00', gift_type: 'insanos' };

function errorCode(code) {
  return error => error?.code === code;
}

test('goal/open/fixed contributions are normalized without trusting browser money', () => {
  const goalContribution = preparePendingContribution(request, goal, progress);
  assert.equal(goalContribution.idempotency_key, key);
  assert.match(goalContribution.request_fingerprint, /^[0-9a-f]{64}$/);
  const { idempotency_key, request_fingerprint, ...publicFields } = goalContribution;
  assert.ok(idempotency_key && request_fingerprint);
  assert.deepEqual(publicFields, {
    gift_id: id,
    contributor_name: 'Pessoa de Teste',
    contributor_phone: '+5511999999999',
    amount: '50.00',
    payment_status: 'pending',
    payment_method: 'pix',
    external_reference: null,
    message: 'Com carinho',
    vest_name: null,
    regional_division: null,
    confirmed_at: null,
  });
  assert.equal(preparePendingContribution({ ...request, amount: '1.250,50' }, open, null).amount, '1250.50');
  const insane = preparePendingContribution({ ...request, amount: '999999,99', vest_name: '  Estradeiro  ', regional_division: 'ABC' }, fixed, null);
  assert.equal(insane.amount, '75.00');
  assert.equal(insane.vest_name, 'Estradeiro');
  assert.equal(insane.regional_division, 'ABC');
});

test('goal validation rejects amounts over remaining and goals already reached', () => {
  assert.equal(preparePendingContribution({ ...request, amount: '2.275,00' }, goal, progress).amount, '2275.00');
  assert.throws(() => preparePendingContribution({ ...request, amount: '2.275,01' }, goal, progress), errorCode('goal_remaining'));
  assert.throws(() => preparePendingContribution(request, goal, { remaining_amount: 0, goal_reached: true }), errorCode('goal_reached'));
  assert.throws(() => preparePendingContribution(request, goal, null), errorCode('progress_unavailable'));
});

test('required fields, money, gift state and Insanos vest name are enforced', () => {
  for (const amount of ['0', '-1', 'NaN', 'Infinity', 'texto', '0,001']) {
    assert.throws(() => preparePendingContribution({ ...request, amount }, open, null), errorCode('invalid_amount'));
  }
  assert.throws(() => preparePendingContribution({ ...request, amount: Number.NaN }, open, null), errorCode('invalid_amount'));
  assert.throws(() => preparePendingContribution({ ...request, contributor_name: '   ' }, open, null), errorCode('invalid_name'));
  assert.throws(() => preparePendingContribution({ ...request, contributor_phone: '123' }, open, null), errorCode('invalid_phone'));
  assert.throws(() => preparePendingContribution(request, null, null), errorCode('gift_unavailable'));
  assert.throws(() => preparePendingContribution(request, { ...goal, active: false }, progress), errorCode('gift_unavailable'));
  assert.throws(() => preparePendingContribution(request, fixed, null), errorCode('vest_name_required'));
});

test('submission refreshes state after a write race and returns only the pending state', async () => {
  let inserted;
  const emptyIdempotency = {
    expirePending: async () => {},
    getExisting: async () => null,
  };
  const success = await createPendingContributionWith(request, {
    ...emptyIdempotency,
    getGift: async () => goal,
    getProgress: async () => progress,
    insert: async contribution => { inserted = contribution; },
  });
  assert.deepEqual(success, { ok: true, payment_status: 'pending' });
  assert.equal(inserted.confirmed_at, null);
  assert.equal(inserted.payment_status, 'pending');
  assert.equal(inserted.external_reference, null);
  assert.equal(inserted.idempotency_key, key);
  assert.match(inserted.request_fingerprint, /^[0-9a-f]{64}$/);

  let progressReads = 0;
  await assert.rejects(createPendingContributionWith({ ...request, amount: '150,00' }, {
    ...emptyIdempotency,
    getGift: async () => goal,
    getProgress: async () => (++progressReads === 1 ? { remaining_amount: 200, goal_reached: false } : { remaining_amount: 100, goal_reached: false }),
    insert: async () => { throw new Error('simulated database race'); },
  }), errorCode('goal_remaining'));

  progressReads = 0;
  await assert.rejects(createPendingContributionWith(request, {
    ...emptyIdempotency,
    getGift: async () => goal,
    getProgress: async () => (++progressReads === 1 ? progress : { remaining_amount: 0, goal_reached: true }),
    insert: async () => { throw new Error('simulated database race'); },
  }), errorCode('goal_reached'));
});

test('persistent idempotency reuses equal payloads and rejects key reuse with different data', async () => {
  let existing = null;
  let inserts = 0;
  const dependencies = {
    getGift: async () => goal,
    getProgress: async () => progress,
    expirePending: async () => {},
    getExisting: async () => existing,
    insert: async contribution => {
      inserts += 1;
      existing = { request_fingerprint: contribution.request_fingerprint, payment_status: 'pending' };
    },
  };
  assert.deepEqual(await createPendingContributionWith(request, dependencies), { ok: true, payment_status: 'pending' });
  assert.deepEqual(await createPendingContributionWith(request, dependencies), { ok: true, payment_status: 'pending' });
  assert.equal(inserts, 1);
  await assert.rejects(createPendingContributionWith({ ...request, amount: '100,00' }, dependencies), errorCode('idempotency_conflict'));

  const newRequest = { ...request, idempotency_key: '30000000-0000-4000-8000-000000000002' };
  existing = null;
  await createPendingContributionWith(newRequest, dependencies);
  assert.equal(inserts, 2);
});

test('an expired retry returns the persisted attempt without exposing its key or fingerprint', async () => {
  const prepared = preparePendingContribution(request, goal, progress);
  const result = await createPendingContributionWith(request, {
    getGift: async () => goal,
    getProgress: async () => { throw new Error('progress must not be read for an existing retry'); },
    expirePending: async () => {},
    getExisting: async () => ({ request_fingerprint: prepared.request_fingerprint, payment_status: 'expired' }),
    insert: async () => { throw new Error('insert must not run for an existing retry'); },
  });
  assert.deepEqual(result, { ok: true, payment_status: 'expired' });
  assert.ok(!JSON.stringify(result).includes(key));
  assert.ok(!JSON.stringify(result).includes(prepared.request_fingerprint));
});

test('client contribution code never contains the service-role environment key', async () => {
  const clientFiles = [
    '../src/components/gift-contribution-form.tsx',
    '../src/components/insane-contribution-button.tsx',
    '../src/components/gift-list.tsx',
  ];
  const clientSource = (await Promise.all(clientFiles.map(path => readFile(new URL(path, import.meta.url), 'utf8')))).join('\n');
  assert.ok(!clientSource.includes('SUPABASE_SERVICE_ROLE_KEY'));
  assert.ok(!clientSource.includes('gift_contributions'));
});
