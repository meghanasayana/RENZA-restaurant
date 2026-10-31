const test = require('node:test')
const assert = require('node:assert')

const { buildBatchPrompt, matchBatchReply, normaliseKey } = require('../batchPrompt')

const dishes = [
  { id: '1', name: 'Chicken Chukka', categoryName: 'Non-Veg Starters' },
  { id: '2', name: 'Kolshi Prawn', categoryName: 'Prawn' },
  { id: '3', name: 'Paneer Tikka' },
]

test('every dish asked about appears in the prompt', () => {
  const prompt = buildBatchPrompt(dishes)
  for (const dish of dishes) assert.match(prompt, new RegExp(dish.name))
  assert.match(prompt, /Non-Veg Starters/)
})

test('the prompt still gives permission to refuse', () => {
  const prompt = buildBatchPrompt(dishes)
  assert.match(prompt, /not known/i)
  assert.match(prompt, /allergy/)
  assert.match(prompt, /"known": false/)
})

test('the house style travels with the batch prompt', () => {
  const prompt = buildBatchPrompt(dishes)
  assert.match(prompt, /Gulab Jamun/)
  assert.match(prompt, /sugar syrup/)
})

test('replies are matched by name, not by position', () => {
  // The model answered in a different order and skipped one.
  const reply = {
    'Paneer Tikka': { known: true, description: 'Marinated paneer grilled in the tandoor.' },
    'Chicken Chukka': { known: true, description: 'Dry-roasted chicken with shallots and pepper.' },
  }

  const matched = matchBatchReply(reply, dishes)
  assert.strictEqual(matched[0].dish.name, 'Chicken Chukka')
  assert.match(matched[0].raw.description, /shallots/)
  assert.strictEqual(matched[1].raw, null, 'the skipped dish is missing, not shifted')
  assert.match(matched[2].raw.description, /tandoor/)
})

test('a tidied-up name still matches its dish', () => {
  const reply = { 'chicken chukka': { known: true, description: 'Dry-roasted chicken with pepper.' } }
  const matched = matchBatchReply(reply, [dishes[0]])
  assert.ok(matched[0].raw, 'case and spacing should not break the match')
})

test('a reply that is not an object leaves every dish unanswered', () => {
  for (const reply of [null, 'nonsense', 42]) {
    const matched = matchBatchReply(reply, dishes)
    assert.ok(matched.every((m) => m.raw === null))
  }
})

test('a dish the model invented is ignored', () => {
  const reply = {
    'Chicken Chukka': { known: true, description: 'Dry-roasted chicken with shallots and pepper.' },
    'Something Nobody Asked For': { known: true, description: 'A dish that is not on the menu.' },
  }
  const matched = matchBatchReply(reply, dishes)
  assert.strictEqual(matched.length, 3, 'only the dishes asked about come back')
})

test('names are normalised the same way on both sides', () => {
  assert.strictEqual(normaliseKey('Chicken - 65 (Boneless)'), normaliseKey('chicken 65 boneless'))
})
