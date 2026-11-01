'use strict'

const prisma = require('../lib/prisma')
const { ask } = require('../services/dishDescriptions/provider')
const { buildIntentPrompt } = require('../services/adminAssistant/prompt')
const { validateIntent } = require('../services/adminAssistant/intentSchema')
const { buildChangePlan, READY } = require('../services/adminAssistant/buildChangePlan')
const { applyChangePlan, toPlannerDish } = require('../services/adminAssistant/applyChangePlan')
const { queryMenu } = require('../services/adminAssistant/queryMenu')

/**
 * Changing the menu by typing what you want.
 *
 * Two endpoints, deliberately. `preview` reads the instruction and says what
 * it WOULD do; `apply` carries it out. Nothing is ever written from a single
 * request, so there is always a screen between a sentence and a changed menu.
 *
 * The restaurant always comes from the session, never the request, so no
 * account can reach another restaurant's menu however the text is worded.
 */

const restaurantOf = (req, res) => {
  const restaurantId = req.user.restaurantId
  if (!restaurantId) {
    res.status(403).json({ error: 'This account is not linked to a restaurant.' })
    return null
  }
  return restaurantId
}

async function loadMenu (restaurantId) {
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
  return { categories, dishes: rows.map((r) => toPlannerDish(r, categoryNameById)) }
}

/**
 * POST /api/restaurant/assistant/preview
 * Body: { text }
 * Returns the intent and what it would change. Writes nothing.
 */
const preview = async (req, res) => {
  const restaurantId = restaurantOf(req, res)
  if (!restaurantId) return undefined

  const text = String(req.body?.text || '').trim()
  if (!text) return res.status(400).json({ error: 'Type what you want to change.' })
  if (text.length > 400) return res.status(400).json({ error: 'That is too long to be one change.' })

  const { categories, dishes } = await loadMenu(restaurantId)

  let reply
  try {
    reply = await ask(buildIntentPrompt(text, categories.map((c) => c.name)))
  } catch (err) {
    return res.status(503).json({
      error: err.message || 'The assistant could not be reached.',
      code: err.code || 'failed',
    })
  }

  // "unclear" is the model's way of refusing, and refusing is a valid answer.
  if (reply && reply.action === 'unclear') {
    return res.json({
      understood: false,
      message: 'I did not understand that as one change to the menu. Try something like '
        + '"change Chicken Biryani price to 300" or "Gobi 65 is sold out".',
    })
  }

  const checked = validateIntent(reply)
  if (!checked.ok) {
    return res.json({ understood: false, message: checked.message })
  }

  // A question is answered on the spot. Nothing is written, so there is
  // nothing to confirm - making someone press Apply to see a list would be
  // pure ceremony.
  if (checked.action === 'show_menu') {
    const answer = queryMenu(dishes, checked.arguments)
    return res.json({
      understood: true,
      kind: 'answer',
      summary: answer.summary,
      total: answer.total,
      dishes: answer.dishes.map((d) => ({
        name: d.name,
        price: d.price,
        portions: d.portions,
        categoryName: d.categoryName,
        isVeg: d.isVeg,
        isAvailable: d.isAvailable,
      })),
    })
  }

  const plan = buildChangePlan(checked, { dishes, categories })

  return res.json({
    understood: true,
    kind: 'change',
    intent: { action: checked.action, arguments: checked.arguments },
    plan: {
      action: plan.action,
      summary: plan.summary,
      changes: plan.changes,
      warnings: plan.warnings,
      candidates: plan.candidates,
      status: plan.status,
      destructive: plan.destructive,
      canApply: plan.status === READY && plan.changes.length > 0,
    },
  })
}

/**
 * POST /api/restaurant/assistant/apply
 * Body: { intent, confirmDelete }
 *
 * The intent is re-planned here against the menu as it is now, so what gets
 * written is only ever what the planner would allow - not whatever the
 * browser posted.
 */
const apply = async (req, res) => {
  const restaurantId = restaurantOf(req, res)
  if (!restaurantId) return undefined

  const intent = req.body?.intent
  if (!intent) return res.status(400).json({ error: 'Nothing to apply.' })

  let result
  try {
    result = await applyChangePlan({
      prisma,
      restaurantId,
      intent,
      confirmDelete: req.body?.confirmDelete === true,
    })
  } catch (err) {
    console.error('[assistant] apply failed:', err)
    return res.status(500).json({ error: err.message || 'The change could not be applied.' })
  }

  if (!result.applied) {
    const message = {
      not_ready: 'That change is not safe to make as described.',
      nothing_to_do: 'Nothing would change.',
      delete_not_confirmed: 'Deleting needs to be confirmed.',
      dish_changed: 'That dish is no longer on the menu, or its name has changed.',
    }[result.reason] || result.reason || 'The change was not applied.'

    return res.status(409).json({ applied: false, reason: result.reason, message, plan: result.plan })
  }

  console.log(
    `[assistant] restaurant ${restaurantId}: ${result.plan.action} - ${result.plan.summary}`,
  )

  return res.json({ applied: true, plan: result.plan })
}

module.exports = { preview, apply }
