'use strict'

/**
 * Writes a confirmed import plan to the database.
 *
 * This is the only file in menuImport/ that touches Prisma. Everything else
 * is pure. It runs AFTER the admin has reviewed the plan and chosen which
 * entries to keep.
 *
 * Rules, in priority order:
 *   1. Never delete. A dish missing from the uploaded menu is left alone.
 *   2. Never create a duplicate. Matching is by normalised name within the
 *      restaurant.
 *   3. Never touch fields the import did not supply - descriptions, images,
 *      dietary flags and IDs all survive an update untouched.
 *   4. Everything happens in one transaction, so a failure halfway leaves
 *      the menu exactly as it was.
 *
 * ---------------------------------------------------------------------------
 * This version writes the LIVE schema, which stores portions differently from
 * the older one this importer was first built against.
 *
 * There is no FoodItemPortion table. A dish carries its own pricing:
 *
 *   portionPrices      {"quarter":200,"half":300,"full":510,
 *                       "regular":280,"special":320}
 *   preparationPrices  {"dry":180,"gravy":200,"semiGravy":190}
 *   preparationType    "dry" | "gravy" | "semi-gravy" | "both"
 *
 * Both are JSON held in a text column, with those exact key names - the
 * customer menu reads them by name, so a key it does not know simply never
 * appears on anyone's phone. Everything written here goes through
 * `pricingFor`, which is the one place that mapping lives.
 */

const { normaliseName } = require('./dishName')

/**
 * Which live column each portion label belongs in.
 *
 * Quarter, Half, Full, Regular and Special exist in the live product and map
 * straight across. Dry, Gravy and Semi-Gravy are not sizes at all - they are
 * the preparation pair, stored separately.
 */
const SIZE_KEYS = {
  quarter: 'quarter',
  half: 'half',
  full: 'full',
  regular: 'regular',
  special: 'special',
}

const PREP_KEYS = {
  dry: 'dry',
  gravy: 'gravy',
  'semi-gravy': 'semiGravy',
  'semi gravy': 'semiGravy',
  semigravy: 'semiGravy',
}

/**
 * Small, Medium and Large have no column of their own in the live product -
 * only quarter, half, full, regular and special exist. Rather than drop those
 * prices, a size ladder is laid onto the slots the schema does have, keeping
 * the order the menu printed:
 *
 *   two sizes   (S/L)    -> half, full
 *   three sizes (S/M/L)  -> quarter, half, full
 *
 * The prices are therefore right and the dish is sold in the right number of
 * sizes; what a customer reads is "Half / Full" rather than "Small / Large".
 * Changing that means adding small/medium/large to the live schema, the admin
 * form and the customer menu - until then this is the honest approximation,
 * and it is confined to this one table.
 */
const SIZE_LADDER = { 2: ['half', 'full'], 3: ['quarter', 'half', 'full'] }
const LADDER_LABELS = new Set(['small', 'medium', 'large'])

const keyOf = (label) => String(label || '').trim().toLowerCase()

/**
 * Turn an entry's portions into the live columns.
 *
 * @returns {{price: number|null, portionPrices: string|null,
 *            preparationPrices: string|null, preparationType: string|null}}
 */
function pricingFor (entry) {
  const portions = Array.isArray(entry.portions) ? entry.portions : []
  const sizes = {}
  const preps = {}

  // Sizes the live schema does not have, mapped onto the slots it does.
  const ladderLabels = portions.filter((p) => LADDER_LABELS.has(keyOf(p.portion || p.label)))
  const ladder = SIZE_LADDER[ladderLabels.length] || null

  let ladderIndex = 0

  for (const portion of portions) {
    const label = keyOf(portion.portion || portion.label)
    const price = Number(portion.price)
    if (!Number.isFinite(price) || price <= 0) continue

    if (PREP_KEYS[label]) {
      preps[PREP_KEYS[label]] = price
      continue
    }

    if (SIZE_KEYS[label]) {
      sizes[SIZE_KEYS[label]] = price
      continue
    }

    if (ladder && LADDER_LABELS.has(label)) {
      sizes[ladder[ladderIndex]] = price
      ladderIndex += 1
      continue
    }

    // A label the live product cannot show. Deliberately skipped rather than
    // guessed at, so nothing silently appears under the wrong name.
  }

  const hasSizes = Object.keys(sizes).length > 0
  const hasPreps = Object.keys(preps).length > 0

  // The dish's own price column is NOT NULL. When a menu prices only by
  // portion, the live admin takes the cheapest as the headline price, so this
  // does the same rather than inventing a number or failing the insert.
  let price = entry.price !== null && entry.price !== undefined ? Number(entry.price) : null
  if ((price === null || !Number.isFinite(price)) && (hasSizes || hasPreps)) {
    price = Math.min(...Object.values(sizes), ...Object.values(preps))
  }

  return {
    price: Number.isFinite(price) ? price : null,
    portionPrices: hasSizes ? JSON.stringify(sizes) : null,
    preparationPrices: hasPreps ? JSON.stringify(preps) : null,
    // The live controller sets "both" whenever preparation prices exist, and
    // the customer menu keys off it. Same rule here.
    preparationType: hasPreps ? 'both' : null,
  }
}

/** Compare two JSON price columns without caring about key order. */
function samePricing (stored, incoming) {
  if (!stored && !incoming) return true
  if (!stored || !incoming) return false
  try {
    const a = typeof stored === 'string' ? JSON.parse(stored) : stored
    const b = typeof incoming === 'string' ? JSON.parse(incoming) : incoming
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})])
    for (const key of keys) {
      if (Number(a?.[key]) !== Number(b?.[key])) return false
    }
    return true
  } catch {
    return false
  }
}

/**
 * @param {object} params
 * @param {import('@prisma/client').PrismaClient} params.prisma
 * @param {string} params.restaurantId  derived from the session, never the browser
 * @param {Array} params.entries        confirmed entries from the plan
 */
async function importToDatabase ({ prisma, restaurantId, entries }) {
  if (!restaurantId) throw new Error('restaurantId is required')
  if (!Array.isArray(entries) || entries.length === 0) {
    return emptyReport()
  }

  // Current state, read once. Name matching happens in JS because the
  // normalisation rules (accents, punctuation, spacing) are ours, not SQL's.
  const [existingCategories, existingDishes] = await Promise.all([
    prisma.category.findMany({ where: { restaurantId }, select: { id: true, name: true } }),
    prisma.foodItem.findMany({
      where: { restaurantId },
      select: {
        id: true,
        name: true,
        price: true,
        categoryId: true,
        portionPrices: true,
        preparationPrices: true,
        preparationType: true,
      },
    }),
  ])

  const categoryByName = new Map(existingCategories.map((c) => [normaliseName(c.name), c]))
  const dishByName = new Map(existingDishes.map((d) => [normaliseName(d.name), d]))
  const report = emptyReport()

  // Categories first, outside the per-dish loop.
  //
  // The previous version created a category the moment a dish needed one,
  // which meant a round trip in the middle of the loop for every new section.
  // Every category this upload needs is known up front, so they go in one
  // statement.
  const wantedCategories = []
  const seenCategory = new Set()
  for (const entry of entries) {
    const name = entry.categoryName
    if (!name) continue
    const key = normaliseName(name)
    if (categoryByName.has(key) || seenCategory.has(key)) continue
    seenCategory.add(key)
    wantedCategories.push({ key, name: name.trim() })
  }

  // One transaction for the whole menu, so a failure half way leaves the menu
  // exactly as it was.
  await prisma.$transaction(async (tx) => {
    if (wantedCategories.length > 0) {
      await tx.category.createMany({
        data: wantedCategories.map((c) => ({ restaurantId, name: c.name })),
        skipDuplicates: true,
      })
      const refreshed = await tx.category.findMany({
        where: { restaurantId },
        select: { id: true, name: true },
      })
      categoryByName.clear()
      for (const c of refreshed) categoryByName.set(normaliseName(c.name), c)
      for (const c of wantedCategories) report.categoriesCreated.push(c.name)
    }

    const toCreate = []
    const toUpdate = []

    for (const entry of entries) {
      const categoryId = entry.categoryName
        ? categoryByName.get(normaliseName(entry.categoryName))?.id ?? null
        : null

      const key = normaliseName(entry.name)
      const existing = dishByName.get(key)
      const pricing = pricingFor(entry)

      if (!existing) {
        toCreate.push({
          restaurantId,
          categoryId,
          name: entry.name,
          price: pricing.price ?? 0,
          portionPrices: pricing.portionPrices,
          preparationPrices: pricing.preparationPrices,
          preparationType: pricing.preparationType,
          isAvailable: true,
          // Only when the import worked it out; otherwise the column default
          // applies, rather than this asserting a diet from nothing.
          ...(typeof entry.isVeg === 'boolean' ? { isVeg: entry.isVeg } : {}),
        })
        // Guard against the same name appearing twice in one upload.
        dishByName.set(key, { id: null, name: entry.name })
        continue
      }

      // Update only what the import actually knows about.
      const data = {}
      if (pricing.price !== null && Number(existing.price) !== pricing.price) {
        data.price = pricing.price
      }
      if (categoryId && existing.categoryId !== categoryId) {
        data.categoryId = categoryId
      }
      // Prices are replaced rather than merged, because they are one column:
      // there is no way to add a Half without rewriting the object. The
      // import only writes when it actually read prices, so a dish whose
      // section was not in this upload keeps what it had.
      if (pricing.portionPrices && !samePricing(existing.portionPrices, pricing.portionPrices)) {
        data.portionPrices = pricing.portionPrices
        report.portionsUpdated += 1
      }
      if (pricing.preparationPrices &&
          !samePricing(existing.preparationPrices, pricing.preparationPrices)) {
        data.preparationPrices = pricing.preparationPrices
        data.preparationType = pricing.preparationType
        report.portionsUpdated += 1
      }
      // The diet of an existing dish is deliberately NOT touched.
      //
      // There is no column recording whether a person set it, so there is no
      // way to tell a human's decision from a previous default. Re-importing
      // must not quietly flip a flag someone set by hand, so an inference
      // applies only to a dish this import creates.

      if (Object.keys(data).length === 0) {
        report.unchanged.push({ id: existing.id, name: existing.name })
        continue
      }

      toUpdate.push({ id: existing.id, name: existing.name, data })
    }

    // Every new dish in one statement. The old version issued a create per
    // dish because it then needed the new id to write portion rows; portions
    // are columns now, so nothing needs the id and the whole insert is one
    // round trip instead of several hundred.
    if (toCreate.length > 0) {
      await tx.foodItem.createMany({ data: toCreate })
      report.portionsCreated += toCreate.filter((d) => d.portionPrices || d.preparationPrices).length

      // Read the ids back once, so the report keeps naming real records.
      const names = new Set(toCreate.map((d) => normaliseName(d.name)))
      const saved = await tx.foodItem.findMany({
        where: { restaurantId },
        select: { id: true, name: true },
      })
      for (const dish of saved) {
        if (names.has(normaliseName(dish.name))) {
          report.created.push({ id: dish.id, name: dish.name })
        }
      }
    }

    // Only dishes that genuinely changed are written. Sequentially, because
    // parallel writes inside one transaction invite deadlocks for no gain.
    for (const dish of toUpdate) {
      await tx.foodItem.update({ where: { id: dish.id }, data: dish.data })
      report.updated.push({ id: dish.id, name: dish.name })
    }
  }, {
    maxWait: 15000,
    // Two minutes is now generous. The previous version needed ten, because a
    // 650 dish menu meant a round trip per dish plus one per portion; this one
    // issues two statements for the inserts and then touches only what changed.
    timeout: 2 * 60 * 1000,
  })

  return report
}

function emptyReport () {
  return {
    created: [],
    updated: [],
    unchanged: [],
    categoriesCreated: [],
    portionsCreated: 0,
    portionsUpdated: 0,
  }
}

module.exports = { importToDatabase, pricingFor, samePricing }
