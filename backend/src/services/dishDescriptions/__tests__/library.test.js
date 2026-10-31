const test = require('node:test')
const assert = require('node:assert')

const { lookup, normalise, splitName } = require('../library')
const { validateDescription } = require('../validate')

test('brackets and punctuation are stripped before matching', () => {
  assert.strictEqual(normalise('Chicken - 65 (Boneless)'), 'chicken 65')
  assert.strictEqual(normalise('Ginger & Garlic Panner'), 'ginger garlic panner')
})

test('a dish on every menu is answered outright', () => {
  const found = lookup('Gulab Jamun')
  assert.strictEqual(found.source, 'exact')
  assert.match(found.description, /sugar syrup/)
})

test('the same dish spelled differently still matches', () => {
  assert.ok(lookup('Chicken - 65 (bone)'))
  assert.ok(lookup('Chicken 65'))
})

test('a preparation is separated from its ingredient', () => {
  assert.deepStrictEqual(splitName('Mushroom Pepper Fry'), {
    ingredient: 'mushroom',
    preparation: 'pepper fry',
  })
  assert.deepStrictEqual(splitName('Chilly Gobi'), {
    ingredient: 'cauliflower florets',
    preparation: 'chilly',
  })
})

test('one preparation covers a whole family', () => {
  // The four dishes a menu prints as one row of variants.
  const family = ['Chilly Paneer', 'Chilly Gobi', 'Chilly Mushroom', 'Chilly Baby Corn']
  const found = family.map((name) => lookup(name))

  assert.ok(found.every((f) => f && f.source === 'pattern'), 'all four matched')
  assert.strictEqual(new Set(found.map((f) => f.description)).size, 4, 'each names its own ingredient')
  assert.match(found[1].description, /cauliflower/)
})

test("the menu's own spelling is matched, not the correct one", () => {
  // Real spellings off a real menu.
  assert.ok(lookup('Taj Spl. Chicken Biriyani'), 'biriyani')
  assert.ok(lookup('Prawn Manchuriyan'), 'manchuriyan')
  assert.ok(lookup('Panner Kadai Masala'), 'panner')
})

test('noise words do not stop a match', () => {
  assert.ok(lookup('Taj Spl. Mutton Biriyani'))
  assert.ok(lookup('Kerala Style Panner'))
})

test('a dish the library does not know returns nothing', () => {
  // These go to the model, which may also refuse. Inventing here would be
  // the same mistake as inventing there.
  for (const name of ['Kolshi Prawn', 'Lippu Chicken', 'Saathi Chicken', 'Talimen Chicken Soup']) {
    assert.strictEqual(lookup(name), null, name)
  }
})

test('an empty or nonsense name returns nothing', () => {
  for (const name of ['', '   ', '...', null, undefined]) {
    assert.strictEqual(lookup(name), null)
  }
})

test('every library description passes the same check as the model output', () => {
  // The library must not hold anything the validator would reject - no sales
  // claims, nothing over the line length.
  const names = [
    'Gulab Jamun', 'Chicken 65', 'Chilly Paneer', 'Mushroom Pepper Fry',
    'Taj Spl. Chicken Biriyani', 'Butter Chicken', 'Paneer Butter Masala',
    'Mutton Chukka', 'Prawn Manchuriyan', 'Chicken Fried Rice Noodles',
    'Mango Milk Shake', 'Apple Juice', 'Veg Kuthu Paratha',
  ]

  for (const name of names) {
    const found = lookup(name)
    assert.ok(found, `library should know ${name}`)
    const checked = validateDescription({ known: true, description: found.description }, name)
    assert.strictEqual(checked.ok, true, `${name}: ${checked.reason} - "${found.description}"`)
  }
})
