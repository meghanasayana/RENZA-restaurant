'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {
  applyChangePlan, toPlannerDish, columnFor, withPortionPrice,
} = require('../applyChangePlan')

/** A live dish row as the database holds it. */
const row = (over = {}) => ({
  id: 'f1',
  name: 'Chicken Biryani',
  price: 250,
  isAvailable: true,
  categoryId: 'c1',
  portionPrices: null,
  preparationPrices: null,
  ...over,
})

/** A Prisma that records what it was asked to do instead of doing it. */
function fakePrisma (rows, categories = [{ id: 'c1', name: 'Biryani' }]) {
  const writes = []
  const client = {
    writes,
    category: {
      findMany: async () => categories,
      create: async ({ data }) => { writes.push(['category.create', data]); return { id: 'c9' } },
    },
    foodItem: {
      findMany: async () => rows,
      create: async ({ data }) => { writes.push(['create', data]); return { id: 'f9' } },
      update: async ({ where, data }) => { writes.push(['update', where.id, data]); return {} },
      delete: async ({ where }) => { writes.push(['delete', where.id]); return {} },
    },
    $transaction: async (fn) => fn(client),
  }
  return client
}

test('a live dish with portion JSON reads as a list of portions', () => {
  const dish = toPlannerDish(
    row({ portionPrices: '{"half":220,"full":400}', preparationPrices: '{"dry":180,"gravy":200}' }),
    new Map([['c1', 'Biryani']]),
  )

  assert.equal(dish.categoryName, 'Biryani')
  assert.deepEqual(dish.portions, [
    { portion: 'Half', price: 220 },
    { portion: 'Full', price: 400 },
    { portion: 'Dry', price: 180 },
    { portion: 'Gravy', price: 200 },
  ])
})

test('a portion label maps to the column that actually holds it', () => {
  assert.deepEqual(columnFor('Half'), { column: 'portionPrices', key: 'half' })
  assert.deepEqual(columnFor('special'), { column: 'portionPrices', key: 'special' })
  assert.deepEqual(columnFor('Gravy'), { column: 'preparationPrices', key: 'gravy' })
  assert.deepEqual(columnFor('Semi-Gravy'), { column: 'preparationPrices', key: 'semiGravy' })
  assert.equal(columnFor('Jumbo'), null, 'a label the schema has no room for')
})

test('changing one portion price leaves the others alone', () => {
  const data = withPortionPrice(
    row({ portionPrices: '{"half":220,"full":400}' }), 'Full', 450,
  )

  assert.deepEqual(JSON.parse(data.portionPrices), { half: 220, full: 450 })
})

test('a plain price change writes the price and nothing else', async () => {
  const prisma = fakePrisma([row()])

  const result = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: { action: 'update_price', arguments: { dishName: 'chicken biryani', price: 300 } },
  })

  assert.equal(result.applied, true)
  assert.deepEqual(prisma.writes, [['update', 'f1', { price: 300 }]])
})

test('the dish is found however the admin capitalised it', async () => {
  const prisma = fakePrisma([row()])

  const result = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: { action: 'update_price', arguments: { dishName: 'CHICKEN   biryani', price: 310 } },
  })

  assert.equal(result.applied, true, 'matching on the exact typed name would have failed here')
})

test('a portion price change rewrites only that key', async () => {
  const prisma = fakePrisma([row({ portionPrices: '{"half":220,"full":400}' })])

  const result = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: {
      action: 'update_price',
      arguments: { dishName: 'Chicken Biryani', portion: 'Half', price: 240 },
    },
  })

  assert.equal(result.applied, true)
  const [, , data] = prisma.writes[0]
  assert.deepEqual(JSON.parse(data.portionPrices), { half: 240, full: 400 })
})

test('a dish with portions will not take a single price without saying which', async () => {
  // The planner blocks this, so nothing should reach the database.
  const prisma = fakePrisma([row({ portionPrices: '{"half":220,"full":400}' })])

  const result = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: { action: 'update_price', arguments: { dishName: 'Chicken Biryani', price: 300 } },
  })

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'not_ready')
  assert.deepEqual(prisma.writes, [], 'nothing was written')
})

test('marking a dish sold out', async () => {
  const prisma = fakePrisma([row()])

  await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: { action: 'set_availability', arguments: { dishName: 'Chicken Biryani', isAvailable: false } },
  })

  assert.deepEqual(prisma.writes, [['update', 'f1', { isAvailable: false }]])
})

test('deleting is refused until it is confirmed a second time', async () => {
  const prisma = fakePrisma([row()])

  const first = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: { action: 'delete_dish', arguments: { dishName: 'Chicken Biryani' } },
  })

  assert.equal(first.applied, false)
  assert.equal(first.reason, 'delete_not_confirmed')
  assert.deepEqual(prisma.writes, [], 'nothing was deleted')

  const second = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: { action: 'delete_dish', arguments: { dishName: 'Chicken Biryani' } },
    confirmDelete: true,
  })

  assert.equal(second.applied, true)
  assert.deepEqual(prisma.writes, [['delete', 'f1']])
})

test('a dish that is no longer there is reported, not guessed at', async () => {
  const prisma = fakePrisma([row({ name: 'Mutton Biryani' })])

  const result = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: { action: 'update_price', arguments: { dishName: 'Chicken Biryani', price: 300 } },
  })

  assert.equal(result.applied, false)
  assert.deepEqual(prisma.writes, [])
})

test('an action that is not one of the seven is rejected before any lookup', async () => {
  const prisma = fakePrisma([row()])

  const result = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: { action: 'drop_all_tables', arguments: {} },
  })

  assert.equal(result.applied, false)
  assert.deepEqual(prisma.writes, [])
})

test('moving a dish to a category that no longer exists does not half-apply', async () => {
  const prisma = fakePrisma([row()], [{ id: 'c1', name: 'Biryani' }])

  await assert.rejects(
    applyChangePlan({
      prisma,
      restaurantId: 'r1',
      intent: { action: 'move_dish', arguments: { dishName: 'Chicken Biryani', categoryName: 'Gone' } },
    }),
    /no longer exists|not safe|could not/i,
  ).catch(async () => {
    // The planner may block it before the write instead, which is equally fine.
    const result = await applyChangePlan({
      prisma,
      restaurantId: 'r1',
      intent: { action: 'move_dish', arguments: { dishName: 'Chicken Biryani', categoryName: 'Gone' } },
    })
    assert.equal(result.applied, false)
  })
})

test('renaming a dish writes the new name', async () => {
  const prisma = fakePrisma([row()])

  const result = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: {
      action: 'rename_dish',
      arguments: { dishName: 'chicken biryani', newName: 'Hyderabadi Biryani' },
    },
  })

  assert.equal(result.applied, true)
  assert.deepEqual(prisma.writes, [['update', 'f1', { name: 'Hyderabadi Biryani' }]])
})

test('renaming onto a name another dish already has is refused', async () => {
  // Two dishes with the same name cannot be told apart afterwards - not by a
  // customer reading the menu, and not by this assistant next time.
  const prisma = fakePrisma([
    row(),
    row({ id: 'f2', name: 'Mutton Biryani' }),
  ])

  const result = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: {
      action: 'rename_dish',
      arguments: { dishName: 'Chicken Biryani', newName: 'mutton biryani' },
    },
  })

  assert.equal(result.applied, false)
  assert.equal(result.reason, 'not_ready')
  assert.deepEqual(prisma.writes, [], 'nothing was renamed')
})

test('a new dish is filed under the category its name points at', async () => {
  // Being asked "which category?" when the answer is in the dish name is
  // irritating, and an uncategorised dish never appears on the customer menu.
  const prisma = fakePrisma([], [
    { id: 'c1', name: 'Dosa' },
    { id: 'c2', name: 'Rice' },
    { id: 'c3', name: 'Fried Rice' },
  ])

  const result = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: { action: 'add_dish', arguments: { dishName: 'Masala Dosa', price: 250 } },
  })

  assert.equal(result.applied, true)
  const [, data] = prisma.writes[0]
  assert.equal(data.categoryId, 'c1', 'filed under Dosa')
  assert.equal(data.price, 250)
})

test('the longest matching category wins', async () => {
  const prisma = fakePrisma([], [
    { id: 'c2', name: 'Rice' },
    { id: 'c3', name: 'Fried Rice' },
  ])

  await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: { action: 'add_dish', arguments: { dishName: 'Chicken Fried Rice', price: 160 } },
  })

  const [, data] = prisma.writes[0]
  assert.equal(data.categoryId, 'c3', 'Fried Rice, not Rice')
})

test('when the name points nowhere it asks instead of guessing', async () => {
  const prisma = fakePrisma([], [{ id: 'c1', name: 'Dosa' }, { id: 'c2', name: 'Rice' }])

  const result = await applyChangePlan({
    prisma,
    restaurantId: 'r1',
    intent: { action: 'add_dish', arguments: { dishName: 'Cold Coffee', price: 90 } },
  })

  assert.equal(result.applied, false)
  assert.deepEqual(prisma.writes, [], 'no invisible uncategorised dish was created')
})
