'use strict'

const { sanitiseLines, sanitiseCombo } = require('./validate')

/**
 * Saving combos from an import.
 *
 * A combo is matched to an existing one by name within the same restaurant,
 * so running the same menu through twice updates rather than duplicates. The
 * match ignores case and spacing, because "Combo - 1" and "Combo -1" are the
 * same combo to everyone except a database.
 *
 * ---------------------------------------------------------------------------
 * This version writes the LIVE schema, which has no Combo table.
 *
 * A combo there is an ordinary dish carrying three extra fields:
 *
 *   isCombo      true
 *   comboItems   [{"name":"Chicken Biriyani or Mugual Biriyani","quantity":""},
 *                 {"name":"Gobi 65","quantity":"2 pcs"}]
 *   comboLabel   the badge the customer menu prints, e.g. "Combo - 1"
 *
 * `comboItems` is JSON in a text column and the customer menu reads exactly
 * `name` and `quantity` off each entry, printing the quantity in bold before
 * the name. A key it does not know never reaches anyone's phone, so the
 * mapping below is the only place that shape is decided.
 *
 * One thing worth knowing about the live menu: it groups dishes by category
 * and has no bucket for a dish without one, so a combo saved with a null
 * category would import successfully and then be invisible. Every combo is
 * therefore filed under a category, created once if it does not exist.
 */

/**
 * The name used for matching, with everything cosmetic taken out.
 *
 * Collapsing whitespace alone was not enough and quietly broke the promise
 * above: the database held "Combo -1", the reprinted menu said "Combo - 1",
 * and the two keys differed by one space around the hyphen - so a second
 * import created a duplicate combo rather than updating the first. Dropping
 * punctuation as well makes both read "combo 1". This matches how dish names
 * are compared elsewhere in the importer.
 */
const key = (name) =>
  String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// Where combos are filed, so they appear on the menu at all.
const COMBO_CATEGORY = 'Combos'

/**
 * Flatten one combo line into the live product's {name, quantity}.
 *
 * A line can offer a choice - "Chicken Biriyani / Mugual Biriyani" is one
 * item the diner picks. The live shape has no notion of alternatives, so the
 * choice is written into the name with "or", which is how the printed menu
 * reads it anyway. The quantity note keeps its own field, because the menu
 * prints it in bold in front of the name.
 */
const lineToComboItem = (line) => ({
  name: (line.options || []).join(' or '),
  quantity: line.note ? String(line.note) : '',
})

/** The fields of a combo dish, ready for Prisma. */
function comboDish (fields, lines, categoryId) {
  const items = lines.map(lineToComboItem).filter((item) => item.name.length > 0)

  return {
    categoryId,
    name: fields.name,
    price: fields.price,
    isCombo: true,
    comboItems: items.length > 0 ? JSON.stringify(items) : null,
    // The badge reads whatever the menu printed. The live admin auto-numbers
    // "Combo 1", "Combo 2" when a person leaves it blank, but an imported
    // combo already has the name the restaurant uses, and that is better than
    // a number this import invented.
    comboLabel: fields.name,
    isVeg: fields.isVeg === true,
    isAvailable: fields.isAvailable !== false,
    sortOrder: fields.sortOrder,
  }
}

async function importCombos ({ prisma, restaurantId, combos }) {
  const created = []
  const updated = []
  const rejected = []

  if (!Array.isArray(combos) || combos.length === 0) {
    return { created, updated, rejected }
  }
  if (!restaurantId) throw new Error('restaurantId is required')

  // Validate everything before touching the database, so a bad combo is
  // reported rather than leaving half an import behind.
  const accepted = []
  for (const [index, raw] of combos.entries()) {
    try {
      const fields = sanitiseCombo({ ...raw, sortOrder: raw?.sortOrder ?? index })
      const lines = sanitiseLines(raw?.lines)
      accepted.push({ fields, lines })
    } catch (err) {
      rejected.push({ name: raw?.name ?? `#${index + 1}`, reason: err.message })
    }
  }

  if (accepted.length === 0) {
    return { created, updated, rejected }
  }

  // Existing combos, read once, so a second run of the same menu updates.
  const existingCombos = await prisma.foodItem.findMany({
    where: { restaurantId, isCombo: true },
    select: { id: true, name: true, price: true, comboItems: true, categoryId: true },
  })
  const byName = new Map(existingCombos.map((dish) => [key(dish.name), dish]))

  await prisma.$transaction(async (tx) => {
    // The category combos live in. Created once, never duplicated: a dish
    // with no category is dropped by the public menu, so this is what keeps
    // an imported combo visible.
    let category = await tx.category.findFirst({
      where: { restaurantId, name: COMBO_CATEGORY },
      select: { id: true },
    })
    if (!category) {
      category = await tx.category.create({
        data: { restaurantId, name: COMBO_CATEGORY },
        select: { id: true },
      })
    }

    const toCreate = []

    for (const { fields, lines } of accepted) {
      const dish = comboDish(fields, lines, category.id)
      const existing = byName.get(key(fields.name))

      if (!existing) {
        toCreate.push({ restaurantId, ...dish })
        // Guard against the same combo appearing twice in one upload.
        byName.set(key(fields.name), { id: null, name: fields.name })
        created.push(fields.name)
        continue
      }

      // Replace what the import knows and nothing else. A description or an
      // image somebody added by hand survives a re-import untouched; only the
      // price, the contents and the badge come from the menu.
      const data = {}
      if (Number(existing.price) !== Number(dish.price)) data.price = dish.price
      if (existing.comboItems !== dish.comboItems) data.comboItems = dish.comboItems
      if (existing.categoryId !== category.id) data.categoryId = category.id

      if (Object.keys(data).length === 0) continue

      await tx.foodItem.update({ where: { id: existing.id }, data })
      updated.push(fields.name)
    }

    // Every new combo in one statement, rather than a transaction per combo
    // as before - a page of eight combos was eight separate transactions.
    if (toCreate.length > 0) {
      await tx.foodItem.createMany({ data: toCreate })
    }
  }, {
    maxWait: 15000,
    timeout: 60 * 1000,
  })

  return { created, updated, rejected }
}

module.exports = { importCombos, key, lineToComboItem, comboDish, COMBO_CATEGORY }
