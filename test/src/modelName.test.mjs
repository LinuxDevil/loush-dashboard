import test from 'node:test'
import assert from 'node:assert/strict'
import { modelName } from '../../src/lib/modelName.js'

test('the six models this machine actually runs all format correctly', () => {
  assert.equal(modelName('claude-opus-4-8'), 'Claude Opus 4.8')
  assert.equal(modelName('claude-sonnet-5'), 'Claude Sonnet 5')
  assert.equal(modelName('claude-opus-5'), 'Claude Opus 5')
  assert.equal(modelName('claude-fable-5'), 'Claude Fable 5')
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Claude Haiku 4.5')
  assert.equal(modelName('claude-sonnet-4-6'), 'Claude Sonnet 4.6')
})

test('a single-component version does not gain a spurious dot', () => {
  assert.equal(modelName('claude-opus-5'), 'Claude Opus 5')
  assert.doesNotMatch(modelName('claude-opus-5'), /\./)
})

test('a dated snapshot suffix is dropped', () => {
  assert.equal(modelName('claude-haiku-4-5-20251001'), 'Claude Haiku 4.5')
  assert.equal(modelName('claude-opus-4-1-20250805'), 'Claude Opus 4.1')
  assert.equal(modelName('claude-sonnet-5-latest'), 'Claude Sonnet 5')
})

test('a context-window tag becomes a readable suffix', () => {
  assert.equal(modelName('claude-opus-4-7[1m]'), 'Claude Opus 4.7 (1M)')
  assert.equal(modelName('claude-sonnet-5[200k]'), 'Claude Sonnet 5 (200K)')
})

test('provider prefixes are stripped', () => {
  assert.equal(modelName('anthropic.claude-opus-5'), 'Claude Opus 5')
  assert.equal(modelName('us.anthropic.claude-opus-5'), 'Claude Opus 5')
  assert.equal(modelName('openai/gpt-4o'), 'GPT 4o')
})

test('the older name order still reads correctly', () => {
  assert.equal(modelName('claude-3-5-sonnet-20241022'), 'Claude 3.5 Sonnet')
  assert.equal(modelName('claude-3-haiku-20240307'), 'Claude 3 Haiku')
})

test('other families get the same treatment', () => {
  assert.equal(modelName('gemini-2-5-pro'), 'Gemini 2.5 Pro')
  assert.equal(modelName('gpt-4o'), 'GPT 4o')
})

test('an unrecognised id is returned untouched, never guessed at or blanked', () => {
  assert.equal(modelName('llama3-local'), 'llama3-local')
  assert.equal(modelName('my-finetune-v2'), 'my-finetune-v2')
  assert.equal(modelName('<synthetic>'), '<synthetic>')
})

test('a bare tier word is left alone', () => {
  for (const s of ['opus', 'sonnet', 'haiku']) assert.equal(modelName(s), s)
})

test('a bare family name is left alone', () => {
  assert.equal(modelName('claude'), 'claude')
})

test('non-string and empty input passes straight through', () => {
  assert.equal(modelName(''), '')
  assert.equal(modelName(null), null)
  assert.equal(modelName(undefined), undefined)
  assert.equal(modelName(42), 42)
})

test('formatting is idempotent for ids it does not recognise', () => {
  assert.equal(modelName(modelName('llama3-local')), 'llama3-local')
  assert.equal(modelName('Claude Opus 4.8'), 'Claude Opus 4.8')
})
