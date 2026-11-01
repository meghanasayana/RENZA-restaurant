'use strict'

/**
 * Answering a question about the menu.
 *
 * The same box that changes the menu also answers questions about it -
 * "what's under 250", "show me the veg starters", "what's sold out". One
 * input, because an admin should not have to know which of three boxes a
 * sentence belongs in.
 *
 * Questions are the safe half: nothing here writes, so a misunderstood
 * question shows the wrong list and costs nothing. That is why a question
 * answers immediately while a change still has to be previewed and confirmed.
 *
 * The filtering is done here rather than in SQL because the dishes are
 * already loaded to plan changes against, and because a price can live in
 * three different places on a dish - its own column, its portions, or its
 * dry/gravy pair - which is easier to reason about in one function than in a
 * query.
 */

const LIMIT = 60

/** Every price a dish can be bought at, cheapest first. */
function pricesOf (dish) {
  const prices = []
  if (Number(dish.price) > 0) prices.push(Number(dish.price))
  for (const portion of dish.portions || []) {
    if (Number(portion.price) > 0) prices.push(Number(portion.price))
  }
  return prices.sort((a, b) => a - b)
}

const clean = (text) => String(text || '').trim().toLowerCase()

/**
 * The dishes matching a question.
 *
 * @param {object[]} dishes   as toPlannerDish returns them
 * @param {object} filters    from the assistant's show_menu arguments
 * @returns {{dishes: object[], total: number, summary: string}}
 */
function queryMenu (dishes, filters = {}) {
  const maxPrice = Number(filters.maxPrice)
  const minPrice = Number(filters.minPrice)
  const category = clean(filters.categoryName)
  const contains = clean(filters.nameContains)
  const wants = []

  let matched = dishes.filter((dish) => {
    const prices = pricesOf(dish)

    // "under 250" means you can buy it for under 250 - so a dish whose half
    // portion is 220 counts, even if its full portion is 400. Anything else
    // reads as wrong to the person who asked.
    if (Number.isFinite(maxPrice)) {
      if (prices.length === 0 || prices[0] > maxPrice) return false
    }
    if (Number.isFinite(minPrice)) {
      if (prices.length === 0 || prices[prices.length - 1] < minPrice) return false
    }
    if (category && clean(dish.categoryName) !== category) {
      // Allow a partial match too: "starters" should find "Veg Starters".
      if (!clean(dish.categoryName).includes(category)) return false
    }
    if (contains && !clean(dish.name).includes(contains)) return false

    if (filters.isVeg === true && dish.isVeg !== true) return false
    if (filters.isVeg === false && dish.isVeg !== false) return false

    if (filters.isAvailable === true && dish.isAvailable !== true) return false
    if (filters.isAvailable === false && dish.isAvailable !== false) return false

    return true
  })

  const total = matched.length

  // Cheapest first when a price was asked about, otherwise by name, so the
  // answer reads the way the question was framed.
  if (Number.isFinite(maxPrice) || Number.isFinite(minPrice)) {
    matched.sort((a, b) => (pricesOf(a)[0] ?? Infinity) - (pricesOf(b)[0] ?? Infinity))
  } else {
    matched.sort((a, b) => a.name.localeCompare(b.name))
  }

  if (Number.isFinite(maxPrice)) wants.push(`under ${maxPrice}`)
  if (Number.isFinite(minPrice)) wants.push(`over ${minPrice}`)
  if (category) wants.push(`in ${filters.categoryName}`)
  if (contains) wants.push(`matching "${filters.nameContains}"`)
  if (filters.isVeg === true) wants.push('veg')
  if (filters.isVeg === false) wants.push('non-veg')
  if (filters.isAvailable === false) wants.push('sold out')
  if (filters.isAvailable === true) wants.push('available')

  const what = wants.length ? `dishes ${wants.join(', ')}` : 'dishes'
  const summary = total === 0
    ? `No ${what}.`
    : `${total} ${total === 1 ? 'dish' : what}${total === 1 ? ` ${wants.join(', ')}` : ''}`.trim()

  return { dishes: matched.slice(0, LIMIT), total, summary }
}

module.exports = { queryMenu, pricesOf, LIMIT }
