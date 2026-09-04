import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKeys, parseKey, redact } from '../src/router/keyparse.js';

const K = {
  nvidia: 'nvapi-AbCdEf1234567890AbCdEf1234567890AbCdEf1234567890xyz',
  openrouter: 'sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef',
  groq: 'gsk_ABCdef1234567890ABCdef1234567890xyz',
  google: 'AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7',
};

test('detects a bare key from its prefix', () => {
  assert.equal(parseKey(K.nvidia).provider, 'nvidia');
  assert.equal(parseKey(K.openrouter).provider, 'openrouter');
});

test('detects keys inside env, export, JSON, YAML and curl forms', () => {
  assert.equal(parseKey(`OPENROUTER_API_KEY=${K.openrouter}`).provider, 'openrouter');
  assert.equal(parseKey(`export GROQ_API_KEY="${K.groq}"`).provider, 'groq');
  assert.equal(parseKey(`{"nvidia_api_key": "${K.nvidia}"}`).provider, 'nvidia');
  assert.equal(parseKey(`groq_api_key: ${K.groq}`).provider, 'groq');
  assert.equal(parseKey(`curl -H "Authorization: Bearer ${K.groq}" https://x`).provider, 'groq');
});

test('pulls every key out of a multi-line .env dump', () => {
  const found = parseKeys(`NVIDIA_API_KEY=${K.nvidia}\n# comment\nGROQ_API_KEY=${K.groq}`);
  const providers = new Set(found.map((f) => f.provider));
  assert.ok(providers.has('nvidia'));
  assert.ok(providers.has('groq'));
});

test('a GitHub-shaped token named for GitHub Models routes to inference', () => {
  const r = parseKey('GITHUB_MODELS_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890AB');
  assert.equal(r.provider, 'github-models');
});

test('does not mistake URLs or prose for credentials', () => {
  assert.equal(parseKeys('see https://example.com/docs/getting-started-with-things').length, 0);
  assert.equal(parseKeys('the quick brown fox jumps over the lazy dog').length, 0);
});

test('finds the key even when embedded in a URL query string', () => {
  const r = parseKey(`https://generativelanguage.googleapis.com/v1beta/models?key=${K.google}`);
  assert.equal(r.provider, 'google');
  assert.equal(r.key, K.google);
});

test('redact keeps a recognisable prefix and hides the body', () => {
  const masked = redact(K.nvidia);
  assert.ok(masked.startsWith('nvapi-'));
  assert.ok(!masked.includes('CdEf1234567890AbCdEf'));
});
