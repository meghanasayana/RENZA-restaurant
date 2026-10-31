'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normaliseRows,
  stripLeaders,
  splitSideBySide,
  splitInline,
  splitNameEndingInNumber,
  joinStackedPrices,
  isPageFurniture,
  isPriceOnly,
  isNameOnly,
} = require('../rowShapes')

test('stripLeaders takes out the dots drawn between a name and its price', () => {
  assert.equal(stripLeaders('Paneer Tikka ................ 260'), 'Paneer Tikka 260')
  assert.equal(stripLeaders('Veg Seekh . . . . . . 250'), 'Veg Seekh 250')
  assert.equal(stripLeaders('Cold Brew ———— 210'), 'Cold Brew 210')
  assert.equal(stripLeaders('Filter Coffee …… 90'), 'Filter Coffee 90')
})

test('stripLeaders leaves ordinary punctuation in a dish name alone', () => {
  // One or two marks are punctuation, not a leader. These names are real.
  assert.equal(stripLeaders('Chicken - 65'), 'Chicken - 65')
  assert.equal(stripLeaders('Salt & Pepper Mushroom'), 'Salt & Pepper Mushroom')
  assert.equal(stripLeaders('Taj Spl. Vajaram Fish'), 'Taj Spl. Vajaram Fish')
  assert.equal(stripLeaders('Fish -- Served Cold'), 'Fish -- Served Cold')
})

test('isPriceOnly accepts money and refuses a name that happens to have digits', () => {
  for (const yes of ['260', '₹260', 'Rs. 260', '260/-', '260/300', '99.50']) {
    assert.equal(isPriceOnly(yes), true, `${yes} is money`)
  }
  for (const no of ['7 Up', 'Chicken 65', 'Combo - 8', '', 'Half']) {
    assert.equal(isPriceOnly(no), false, `${no} is not money`)
  }
})

test('isNameOnly accepts a dish name and refuses a bare price', () => {
  assert.equal(isNameOnly('Butter Chicken'), true)
  assert.equal(isNameOnly('7 Up'), true)
  assert.equal(isNameOnly('260'), false)
  assert.equal(isNameOnly('₹260'), false)
})

test('splitSideBySide recovers three dishes printed across one line', () => {
  // A three column menu reconstructs as one row spanning the whole page.
  const pairs = splitSideBySide([
    'Paneer Tikka', '260', 'Chicken 65', '240', 'Butter Chicken', '380',
  ])

  assert.deepEqual(pairs, [
    ['Paneer Tikka', '260'],
    ['Chicken 65', '240'],
    ['Butter Chicken', '380'],
  ])
})

test('splitSideBySide refuses a row that does not divide cleanly into pairs', () => {
  // Leaving a cell over means the shape was something else, and guessing
  // would file a price under the wrong dish.
  assert.equal(splitSideBySide(['Quarter', 'Half', 'Full']), null)
  assert.equal(splitSideBySide(['Chicken Biryani', '220', '400', '-']), null)
  assert.equal(splitSideBySide(['Paneer Tikka', '260']), null, 'two cells are already the right shape')
})

test('splitInline recovers a dish per cell when the price follows the name', () => {
  assert.deepEqual(splitInline(['Paneer Tikka 260', 'Butter Chicken 380']), [
    ['Paneer Tikka', '260'],
    ['Butter Chicken', '380'],
  ])
})

test('splitInline refuses unless every cell carries its own price', () => {
  assert.equal(splitInline(['Paneer Tikka 260', 'Butter Chicken']), null)
  assert.equal(splitInline(['Paneer Tikka', '260']), null)
})

test('splitNameEndingInNumber keeps the number when it is part of the name', () => {
  // 240 is nearly four times 65, which no portion of one dish ever is.
  assert.deepEqual(splitNameEndingInNumber('Chicken 65 240'), ['Chicken 65', '240'])
  assert.deepEqual(splitNameEndingInNumber('Fish 65 250'), ['Fish 65', '250'])
  assert.deepEqual(splitNameEndingInNumber('Gobi 65 180'), ['Gobi 65', '180'])
})

test('splitNameEndingInNumber leaves a genuine pair of prices for review', () => {
  // A half and a full portion sit within about twice each other. Deciding
  // which of these is a name would silently rewrite the menu.
  assert.equal(splitNameEndingInNumber('Tandoori Roti 30 60'), null)
  assert.equal(splitNameEndingInNumber('Paneer Mandi 1100 570'), null)
  assert.equal(splitNameEndingInNumber('Veg Seekh 250'), null, 'one price is not this shape')
})

test('joinStackedPrices joins a price printed on the line below its name', () => {
  const rows = joinStackedPrices([
    ["CHEF'S SELECTION"],
    ['Paneer Tikka'], ['260'],
    ['Gobi Manchurian'], ['220'],
    ['Hara Bhara Kebab'], ['240'],
  ])

  assert.deepEqual(rows, [
    ["CHEF'S SELECTION"],
    ['Paneer Tikka', '260'],
    ['Gobi Manchurian', '220'],
    ['Hara Bhara Kebab', '240'],
  ])
})

test('joinStackedPrices leaves a heading and a stray number alone', () => {
  // Once or twice is not a layout. Joining on this little evidence would turn
  // a section heading into a dish.
  const rows = [['SOUPS'], ['120'], ['Sweet Corn Soup', '120']]
  assert.deepEqual(joinStackedPrices(rows), rows)
})

test('normaliseRows leaves rows the parser already reads exactly as they are', () => {
  const rows = [
    ['VEG STARTERS'],
    ['Paneer - 65', '180'],
    ['Quarter', 'Half', 'Full'],
    ['Chicken Biryani', '220', '400'],
  ]

  assert.deepEqual(normaliseRows(rows), rows)
})

test('normaliseRows handles leaders, columns and stacking together', () => {
  const rows = normaliseRows([
    ['SMALL PLATES'],
    ['Paneer Tikka ......... 260'],
    ['Gobi Manchurian 220', 'Dal Makhani 260'],
    ['Veg Seekh', '250', 'Egg Curry', '220'],
  ])

  // The leaders are gone. The single cell is left for the dish parser, which
  // already reads a name followed by its price; only a name ending in a
  // number is split here, because that one it reads wrongly.
  assert.deepEqual(rows, [
    ['SMALL PLATES'],
    ['Paneer Tikka 260'],
    ['Gobi Manchurian', '220'],
    ['Dal Makhani', '260'],
    ['Veg Seekh', '250'],
    ['Egg Curry', '220'],
  ])
})

test('isPageFurniture recognises the small print at the foot of a menu', () => {
  // Left in, the dish parser made a dish called "For Reservations Please
  // Contact 9884 445 767" and priced it 9884.
  const furniture = [
    ['For Reservations Please Contact 9884 445 767'],
    ['9840014360 | 9884880570'],
    ['GST @ 5 % Are Applicable'],
    ['Restaurant Timings Are 11 am to 11 pm'],
    ['No.7 Vallal M.G.R Salai, Maraimalai Nagar, Chengalpattu,'],
    ['Kancheepuram-603209'],
    ['Food Will Be Delivered Freshly to The Table Within 15 to 20 min Prior to Order'],
  ]

  for (const row of furniture) {
    assert.equal(isPageFurniture(row), true, `should be dropped: ${row[0]}`)
  }
})

test('isPageFurniture keeps every row that could be a dish or a heading', () => {
  const keep = [
    ['Chinese Fry with Worcester Sauce', '250'],
    ['Taj Spl. Vajaram Fish Masala', '320'],
    ['Chicken - 65 (Boneless)', '230'],
    ['Cream Lobster', 'Seasonal'],
    ['Chicken, Mutton & Fish Platter', '450'],
    ['Veg Starters'],
    ['Rice, Noodles, Breads'],
    ['Regular Special'],
    ['Paneer Tikka'],
    ['260'],
  ]

  for (const row of keep) {
    assert.equal(isPageFurniture(row), false, `should be kept: ${JSON.stringify(row)}`)
  }
})

test('normaliseRows drops the footer and keeps the dishes around it', () => {
  const rows = normaliseRows([
    ['Sea Food'],
    ['Apollo Fish', '290'],
    ['GST @ 5 % Are Applicable'],
    ['For Reservations Please Contact 9884 445 767'],
    ['Fish & Chips', '250'],
  ])

  assert.deepEqual(rows, [
    ['Sea Food'],
    ['Apollo Fish', '290'],
    ['Fish & Chips', '250'],
  ])
})

test('normaliseRows drops a line printed at the top of every page', () => {
  // "ANBU MESS" heads all four pages. Read as a heading it became a category
  // and collected the dishes printed above the first real heading.
  const rows = [
    ['ANBU MESS'], ['TIFFIN'], ['Idly', '30'],
    ['ANBU MESS'], ['BIRIYANI'], ['Veg Biriyani', '190'],
    ['ANBU MESS'], ['MUTTAI'], ['Omlette', '60'],
  ]

  const out = normaliseRows(rows).map((r) => r[0])
  assert.ok(!out.includes('ANBU MESS'), out.join(' | '))
  assert.ok(out.includes('TIFFIN') && out.includes('BIRIYANI') && out.includes('MUTTAI'))
})

test('a section heading repeated once, where it carries on overleaf, is kept', () => {
  // Twice is a section continued on the next page. Dropping it would merge
  // those dishes into whatever came before.
  const rows = [
    ['VEG STARTERS'], ['Gobi 65', '140'],
    ['VEG STARTERS'], ['Paneer 65', '180'],
  ]

  const out = normaliseRows(rows).map((r) => r[0]);
  assert.equal(out.filter((t) => t === 'VEG STARTERS').length, 2)
})

test('isPageFurniture drops a lower-case strapline', () => {
  assert.equal(isPageFurniture(['military hotel . since 1974 . madurai']), true)
  assert.equal(isPageFurniture(['coffee house · kitchen · open from seven']), true)
  assert.equal(isPageFurniture(['biriyani, kari and kuzhambu']), true)

  // Capitalised headings and dishes are untouched.
  assert.equal(isPageFurniture(['Veg Starters']), false)
  assert.equal(isPageFurniture(['MEEN & KADAL UNAVU']), false)
  assert.equal(isPageFurniture(['Kothu Parotta Mutton', '180']), false)
})
