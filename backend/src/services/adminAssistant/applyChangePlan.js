'use strict'

/**
 * Carrying out a change the admin typed and then confirmed.
 *
 * The rest of this folder decides WHAT should happen and refuses when it is
 * not sure. This file is the only part that writes, and it is deliberately
 * dull: it rebuilds the plan from scratch, checks it is still READY, and then
 * performs exactly the changes that plan describes.
 *
 * Rebuilding rather than trusting matters. The browser sends back what the
 * admin confirmed, but a browser can send anything. Re-planning server side
 * from the same intent means the only changes that can happen are the ones
 * the planner would have allowed anyway, against the menu as it is right now
 * rather than as it was when the preview was drawn.
 *
 * ---------------------------------------------------------------------------
 * The live schema keeps a dish's portion prices as JSON on the dish:
 *
 *   portionPrices      {"quarter":200,"half":300,"full":510,
 *                       "regular":280,"special":320}
 *   preparationPrices  {"dry":180,"gravy":200,"semiGravy":190}
 *
 * The planner works with a plain list of {portion, price}, so dishes are
 * translated on the way in and the right JSON column is rewritten on the way
 * out. That mapping lives here and nowhere else.
 */

const { buildChangePlan, READY } = require('./buildChangePlan')
const { resolveDish } = require('./resolveDish')
const { validateIntent } = require('./intentSchema')

// label as a person says it -> which column, and the key inside it
const SIZE_KEYS = {
  quarter: 'Quarter', half: 'Half', full: 'Full',
  regular: 'Regular', special: 'Special',
}
const PREP_KEYS = { dry: 'Dry', gravy: 'Gravy', semiGravy: 'Semi-Gravy' }

const parseJson = (value) => {
  if (!value) return {}
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** A live dish row, in the shape the planner understands. */
function toPlannerDish (row, categoryNameById) {
  const portions = []

  const sizes = parseJson(row.portionPrices)
  for (const [key, label] of Object.entries(SIZE_KEYS)) {
    if (Number(sizes[key]) > 0) portions.push({ portion: label, price: Number(sizes[key]) })
  }

  const preps = parseJson(row.preparationPrices)
  for (const [key, label] of Object.entries(PREP_KEYS)) {
    if (Number(preps[key]) > 0) portions.push({ portion: label, price: Number(preps[key]) })
  }

  return {
    id: row.id,
    name: row.name,
    price: Number(row.price),
    isAvailable: row.isAvailable,
    isVeg: row.isVeg,
    categoryId: row.categoryId,
    categoryName: row.categoryId ? categoryNameById.get(row.categoryId) || null : null,
    portions,
  }
}

/** Which column and key a portion label belongs to, or null if unknown. */
function columnFor (label) {
  const clean = String(label || '').trim().toLowerCase().replace(/[\s_-]+/g, '')

  for (const [key, name] of Object.entries(SIZE_KEYS)) {
    if (clean === key || clean === name.toLowerCase().replace(/[\s_-]+/g, '')) {
      return { column: 'portionPrices', key }
    }
  }
  for (const [key, name] of Object.entries(PREP_KEYS)) {
    if (clean === key.toLowerCase() || clean === name.toLowerCase().replace(/[\s_-]+/g, '')) {
      return { column: 'preparationPrices', key }
    }
  }
  return null
}

/** The row's JSON column, with one portion's price replaced. */
function withPortionPrice (row, label, value) {
  const target = columnFor(label)
  if (!target) return null

  const current = parseJson(row[target.column])
  current[target.key] = value

  return { [target.column]: JSON.stringify(current) }
}

/**
 * Load the menu, plan the change, and carry it out if it is safe to.
 *
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {string} params.restaurantId   from the session, never the browser
 * @param {object} params.intent         what the assistant understood
 * @param {boolean} params.confirmDelete explicit second confirmation
 * @returns {Promise<{applied: boolean, plan: object, reason?: string}>}
 */
async function applyChangePlan ({ prisma, restaurantId, intent, confirmDelete = false }) {
  if (!restaurantId) throw new Error('restaurantId is required')

  const checked = validateIntent(intent)
  if (!checked.ok) {
    return { applied: false, plan: null, reason: checked.message }
  }

  const [categories, rows] = await Promise.all([
    prisma.category.findMany({ where: { restaurantId }, select: { id: true, name: true } }),
    prisma.foodItem.findMany({
      where: { restaurantId },
      select: {
        id: true, name: true, price: true, isAvailable: true, isVeg: true,
        categoryId: true, portionPrices: true, preparationPrices: true,
      },
    }),
  ])

  const categoryNameById = new Map(categories.map((c) => [c.id, c.name]))
  const dishes = rows.map((row) => toPlannerDish(row, categoryNameById))
  const byId = new Map(rows.map((row) => [row.id, row]))

  const plan = buildChangePlan(checked, { dishes, categories })

  if (plan.status !== READY) {
    return { applied: false, plan, reason: 'not_ready' }
  }
  if (plan.changes.length === 0) {
    return { applied: false, plan, reason: 'nothing_to_do' }
  }

  // Deleting is the one action that cannot be undone, so it needs a second,
  // explicit yes rather than the same confirmation every other change uses.
  if (plan.destructive && confirmDelete !== true) {
    return { applied: false, plan, reason: 'delete_not_confirmed' }
  }

  // The same resolver the planner used, so the dish written to is exactly the
  // dish the preview described. Matching on the typed name here instead would
  // miss on case and spacing - "chicken biryani" would not find "Chicken
  // Biryani" - and the apply would fail after the admin had already said yes.
  let target = null
  if (plan.action !== 'create_category' && plan.action !== 'add_dish') {
    const resolution = resolveDish(checked.arguments.dishName, dishes)
    if (resolution.status !== 'resolved') {
      return { applied: false, plan, reason: 'dish_changed' }
    }
    target = resolution.dish
  }

  await prisma.$transaction(async (tx) => {
    switch (plan.action) {
      case 'create_category':
        await tx.category.create({
          data: { restaurantId, name: checked.arguments.categoryName.trim() },
        })
        break

      case 'add_dish': {
        const args = checked.arguments
        // The category comes from the PLAN, not the arguments: when the admin
        // did not name one, the planner works it out from the dish name, and
        // that decision is what the preview showed.
        const planned = plan.changes.find((c) => c.field === 'category')
        const categoryName = planned ? planned.to : args.categoryName
        // A dish added by typing gets a single price. Portion pricing is set
        // on the dish form, where the admin can see every portion at once
        // rather than describing them in a sentence.
        if (Array.isArray(args.portions) && args.portions.length > 0) {
          throw new Error('Add the dish first, then set its portions on the dish form.')
        }
        let category = categories.find(
          (c) => c.name.toLowerCase() === String(categoryName || '').toLowerCase(),
        )
        // A category the admin named that does not exist yet is created, which
        // is what the preview warned would happen.
        if (!category && categoryName) {
          category = await tx.category.create({
            data: { restaurantId, name: String(categoryName).trim() },
            select: { id: true, name: true },
          })
        }
        await tx.foodItem.create({
          data: {
            restaurantId,
            categoryId: category ? category.id : null,
            name: args.dishName.trim(),
            price: Number(args.price) || 0,
            isAvailable: true,
          },
        })
        break
      }

      case 'update_price': {
        const change = plan.changes[0]
        if (change.field === 'price') {
          await tx.foodItem.update({ where: { id: target.id }, data: { price: change.to } })
          break
        }
        // "portion:Half" - rewrite that one key inside the JSON column.
        const label = change.field.slice('portion:'.length)
        const data = withPortionPrice(byId.get(target.id), label, change.to)
        if (!data) throw new Error(`No column holds a "${label}" price.`)
        await tx.foodItem.update({ where: { id: target.id }, data })
        break
      }

      case 'rename_dish':
        await tx.foodItem.update({
          where: { id: target.id },
          data: { name: plan.changes[0].to },
        })
        break

      case 'set_availability':
        await tx.foodItem.update({
          where: { id: target.id },
          data: { isAvailable: plan.changes[0].to },
        })
        break

      case 'move_dish': {
        const args = checked.arguments
        const category = categories.find(
          (c) => c.name.toLowerCase() === String(args.categoryName || '').toLowerCase(),
        )
        if (!category) throw new Error('That category no longer exists.')
        await tx.foodItem.update({
          where: { id: target.id },
          data: { categoryId: category.id },
        })
        break
      }

      case 'delete_dish':
        await tx.foodItem.delete({ where: { id: target.id } })
        break

      default:
        throw new Error(`Nothing applies the action "${plan.action}".`)
    }
  }, { maxWait: 10000, timeout: 30000 })

  return { applied: true, plan }
}

module.exports = {
  applyChangePlan,
  toPlannerDish,
  columnFor,
  withPortionPrice,
}
