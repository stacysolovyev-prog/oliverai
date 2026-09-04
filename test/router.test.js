import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/router/chat.js';
import { spreadAcrossProviders, classifyTask } from '../src/router/router.js';

test('a retired model is permanent, whatever status the provider used', () => {
  // NVIDIA returns this wording without a 404, so the code alone is not enough.
  const eol = "The model 'meta/llama-3.3-70b-instruct' has reached its end of life "
    + 'on 2026-08-26T09:00:00Z and is no longer available.';
  for (const status of [200, 400, 402, 410, 500]) {
    const r = classify(status, eol);
    assert.equal(r.kind, 'badmodel', `status ${status} should be badmodel`);
    assert.equal(r.retryable, false);
  }
});

test('other decommissioning wordings are caught too', () => {
  for (const msg of [
    'This model has been deprecated and is no longer available',
    'model has been retired',
    'this endpoint is discontinued',
  ]) {
    assert.equal(classify(400, msg).kind, 'badmodel');
  }
});

test('transient faults stay retryable', () => {
  assert.equal(classify(429, 'rate limit exceeded').kind, 'rate');
  assert.equal(classify(503, 'model is overloaded').kind, 'server');
  assert.equal(classify(503, 'model is overloaded').retryable, true);
  assert.equal(classify(401, 'bad key').kind, 'auth');
  assert.equal(classify(401, 'bad key').retryable, false);
});

test('one broken provider cannot eat the whole failover budget', () => {
  // Eight top-ranked models from a provider whose catalog is entirely retired,
  // plus one healthy model scored below all of them.
  const ranked = [
    ...Array.from({ length: 8 }, (_, i) => ({
      provider: 'nvidia', model: { id: `dead-${i}` }, score: 20 - i,
    })),
    { provider: 'google', model: { id: 'gemini-3.8-flash' }, score: 5 },
  ];
  const order = spreadAcrossProviders(ranked);
  assert.equal(order.length, ranked.length, 'no candidate may be dropped');
  const googleAt = order.findIndex((r) => r.provider === 'google');
  assert.equal(googleAt, 1, 'the healthy provider must be the second attempt');
  // Each provider keeps its own best-first order.
  const nvidia = order.filter((r) => r.provider === 'nvidia').map((r) => r.model.id);
  assert.deepEqual(nvidia, Array.from({ length: 8 }, (_, i) => `dead-${i}`));
});

test('spreading a single-provider list changes nothing', () => {
  const ranked = [
    { provider: 'google', model: { id: 'a' }, score: 3 },
    { provider: 'google', model: { id: 'b' }, score: 2 },
  ];
  assert.deepEqual(spreadAcrossProviders(ranked).map((r) => r.model.id), ['a', 'b']);
});

test('task classification routes work to the right model class', () => {
  assert.equal(classifyTask('why is the auth middleware dropping sessions'), 'plan');
  assert.equal(classifyTask('add a logout button to Header.tsx'), 'code');
  assert.equal(classifyTask('what is the version in package.json'), 'fast');
  assert.equal(classifyTask('summarise this', { contextTokens: 200000 }), 'long');
});
