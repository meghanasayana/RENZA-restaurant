'use strict'

/**
 * Turning what the admin typed into one of the seven commands.
 *
 * The model's only job here is to classify and pull out the arguments. It
 * never writes SQL, never names a database field, and never decides whether a
 * change is safe - `intentSchema` throws out anything that is not one of the
 * known actions, and `buildChangePlan` works out what it would actually do.
 * So the worst a confused model can produce is a plan the admin reads and
 * rejects.
 *
 * Refusing is a valid answer and the prompt says so plainly. "Make my menu
 * better" is not a command, and inventing one from it would be worse than
 * saying it was not understood.
 */

const { COMMANDS } = require('./commands')

const EXAMPLES = [
  ['change chicken biryani price to 300',
   '{"action":"update_price","arguments":{"dishName":"Chicken Biryani","price":300}}'],
  ['make the half portion of mutton biryani 220',
   '{"action":"update_price","arguments":{"dishName":"Mutton Biryani","portion":"Half","price":220}}'],
  ['change fresh lime soda name to lemonade',
   '{"action":"rename_dish","arguments":{"dishName":"Fresh Lime Soda","newName":"Lemonade"}}'],
  ['rename chicken 65 to chicken sixty five',
   '{"action":"rename_dish","arguments":{"dishName":"Chicken 65","newName":"Chicken Sixty Five"}}'],
  ['gobi 65 is sold out',
   '{"action":"set_availability","arguments":{"dishName":"Gobi 65","isAvailable":false}}'],
  ['bring back paneer tikka',
   '{"action":"set_availability","arguments":{"dishName":"Paneer Tikka","isAvailable":true}}'],
  ['move fish fry to seafood',
   '{"action":"move_dish","arguments":{"dishName":"Fish Fry","categoryName":"Seafood"}}'],
  ['add a category called desserts',
   '{"action":"create_category","arguments":{"categoryName":"Desserts"}}'],
  ['add veg biryani 180 under rice',
   '{"action":"add_dish","arguments":{"dishName":"Veg Biryani","price":180,"categoryName":"Rice"}}'],
  ['remove the old prawn starter',
   '{"action":"delete_dish","arguments":{"dishName":"old prawn starter"}}'],
  ['what do we have under 250',
   '{"action":"show_menu","arguments":{"maxPrice":250}}'],
  ['show me the veg starters',
   '{"action":"show_menu","arguments":{"categoryName":"Starters","isVeg":true}}'],
  ['which dishes are sold out',
   '{"action":"show_menu","arguments":{"isAvailable":false}}'],
  ['list everything above 500',
   '{"action":"show_menu","arguments":{"minPrice":500}}'],
  ['show me all the biryanis',
   '{"action":"show_menu","arguments":{"nameContains":"biryani"}}'],
]

/**
 * @param {string} text        what the admin typed
 * @param {string[]} categories category names, so the model matches the real ones
 */
function buildIntentPrompt (text, categories = []) {
  const actions = Object.entries(COMMANDS)
    .map(([name, spec]) => {
      const required = spec.required && spec.required.length
        ? ` requires ${spec.required.join(', ')}`
        : ' takes nothing'
      const optional = spec.optional && spec.optional.length
        ? `, optional ${spec.optional.join(', ')}`
        : ''
      return `  ${name} -${required}${optional}`
    })
    .join('\n')

  const sections = categories.length
    ? `\nThe categories on this menu are: ${categories.join(', ')}.\n` +
      'Use one of these names exactly when an action needs a category.\n'
    : ''

  const examples = EXAMPLES.map(([said, json]) => `"${said}"\n${json}`).join('\n\n')

  return `You turn a restaurant admin's instruction into one command.

The admin typed:
"${text}"
${sections}
The only actions you may use:
${actions}

Rules:
- Reply with one JSON object and nothing else.
- Use the dish name as the admin wrote it. Do not correct spelling, expand it,
  or add words. Something else matches it against the real menu.
- Only include an argument the admin actually gave. Never invent a price or a
  portion.
- A category is the one exception: if the dish name clearly belongs to one of
  the categories listed above - "Masala Dosa" to "Dosa", "Chicken Fried Rice"
  to "Fried Rice" - use that category name exactly as listed. Otherwise leave
  it out rather than inventing one.
- "sold out", "finished", "not available", "86" mean isAvailable false.
  "back", "available again" mean isAvailable true.
- A QUESTION about the menu is show_menu, with whatever filters the question
  implies: maxPrice for "under", minPrice for "over", categoryName, isVeg,
  isAvailable, nameContains for a word in the dish name. Answering a question
  changes nothing, so prefer show_menu whenever the admin is asking rather
  than instructing.
- If the instruction is unclear, asks for more than one change at once, or is
  not about the menu at all, do NOT guess. Reply exactly:
  {"action":"unclear","arguments":{}}

Examples:

${examples}

Now the admin's instruction. JSON only:`
}

module.exports = { buildIntentPrompt, EXAMPLES }
