const test = require('node:test')
const assert = require('node:assert')

const { validateDescription } = require('../validate')
const { buildDescribePrompt } = require('../prompt')

test('a sound description is accepted', () => {
  const result = validateDescription(
    { known: true, description: 'Boneless chicken fried with curry leaves and red chillies.' },
    'Chicken 65',
  )
  assert.strictEqual(result.ok, true)
  assert.match(result.description, /curry leaves/)
})

test('the model saying it does not know is honoured, not overridden', () => {
  const result = validateDescription({ known: false, description: '' }, 'Kolshi Prawn')
  assert.strictEqual(result.ok, false)
  assert.strictEqual(result.reason, 'not known')
})

test('known true with nothing written is rejected', () => {
  assert.strictEqual(validateDescription({ known: true, description: '   ' }, 'X').ok, false)
})

test('a claim about the restaurant is refused', () => {
  // Not a claim about the food - a claim about the place, which a
  // description cannot support.
  for (const line of [
    'Our famous mutton curry, slow cooked with spices.',
    'Award-winning fish fry from the Kerala coast.',
    'Legendary chicken, the best in the city.',
  ]) {
    const result = validateDescription({ known: true, description: line }, 'Dish')
    assert.strictEqual(result.ok, false, `should refuse: ${line}`)
    assert.match(result.reason, /sales word/)
  }
})

test('appetising menu words are kept, because a menu uses them', () => {
  // The ban list once held "delicious" and "succulent" and threw away
  // perfectly good menu writing - including the restaurant's own examples.
  for (const line of [
    'Soft, golden dumplings soaked in sweet, aromatic sugar syrup.',
    'Tender, marinated pieces roasted for a smoky, delicious charred finish.',
    'A refreshing mix of fresh, juicy seasonal fruits.',
  ]) {
    assert.strictEqual(validateDescription({ known: true, description: line }, 'Dish').ok, true, line)
  }
})

test("the restaurant's own examples all pass", () => {
  const examples = [
    ['Gulab Jamun', 'Soft, golden milk-solid dumplings soaked in sweet, aromatic sugar syrup.'],
    ['Fruit Salad', 'A refreshing mix of fresh, juicy seasonal fruits with natural sweetness in every bite.'],
    ['Biryani', 'Fragrant basmati rice cooked with aromatic spices and rich flavors for a delicious, satisfying meal.'],
    ['Tandoori', 'Tender, marinated pieces roasted in a traditional tandoor for a smoky flavor and delicious charred finish.'],
    ['Apricot Delight', 'A rich, creamy dessert made with soft apricots, topped with nuts for a delightful blend of sweetness and texture.'],
    ['Beef Biryani', 'Aromatic basmati rice layered with tender, flavorful beef and traditional spices for a rich and satisfying biryani.'],
  ]

  for (const [name, description] of examples) {
    const result = validateDescription({ known: true, description }, name)
    assert.strictEqual(result.ok, true, `${name}: ${result.reason}`)
  }
})

test('a description that runs past one line is refused', () => {
  const long =
    'A dish of chicken cooked slowly with onions tomatoes ginger garlic chillies ' +
    'coriander cumin garam masala curry leaves and fresh cream until deeply tender and rich'
  assert.strictEqual(validateDescription({ known: true, description: long }, 'X').ok, false)
})

test('a description that is only the dish name is refused', () => {
  assert.strictEqual(validateDescription({ known: true, description: 'Chicken 65' }, 'Chicken 65').ok, false)
  assert.strictEqual(validateDescription({ known: true, description: 'chicken 65.' }, 'Chicken 65').ok, false)
})

test('a hedged sentence is refused even when known says true', () => {
  for (const line of [
    'I do not know this dish but it may contain prawns.',
    'Unclear, possibly a coastal prawn preparation.',
    'As an AI I cannot determine the ingredients.',
  ]) {
    assert.strictEqual(validateDescription({ known: true, description: line }, 'X').ok, false, line)
  }
})

test('a reply that is not an object is refused', () => {
  for (const raw of [null, undefined, 'a string', 42]) {
    assert.strictEqual(validateDescription(raw, 'X').ok, false)
  }
})

test('whitespace is tidied rather than rejected', () => {
  const result = validateDescription(
    { known: true, description: '  Fried   prawns  with pepper.  ' },
    'Prawn Pepper Fry',
  )
  assert.strictEqual(result.description, 'Fried prawns with pepper.')
})

test('the prompt gives the model permission to refuse', () => {
  const prompt = buildDescribePrompt({ name: 'Kolshi Prawn', categoryName: 'Prawn' })
  assert.match(prompt, /Kolshi Prawn/)
  assert.match(prompt, /"Prawn"/)
  assert.match(prompt, /do not know/i)
  assert.match(prompt, /"known": false/)
  // The house style travels with the prompt, because a small model copies an
  // example far more reliably than it follows an instruction.
  assert.match(prompt, /Gulab Jamun/)
  assert.match(prompt, /sugar syrup/)
})

test('the prompt works for a dish with no section', () => {
  const prompt = buildDescribePrompt({ name: 'Paneer Tikka' })
  assert.match(prompt, /Paneer Tikka/)
  assert.ok(!prompt.includes('Section on the menu'))
})
