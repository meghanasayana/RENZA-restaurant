# AI menu import + dish descriptions — deployment notes

Two features, added to `RenzaTech/RENZA-restaurant`:

1. **Menu import.** An admin uploads a menu PDF (or photo). It reads the
   dishes, categories, prices, portions and combos, shows a review screen,
   and on confirmation writes them to the database.
2. **Dish descriptions.** One button writes a one-line description for every
   dish that has none.

52 files. Built and tested inside a clone of this repo — 241 unit tests pass,
and a 100-dish menu was run end to end against a stand-in database to confirm
what lands in each column.

---

## Install

```bash
tar -xzf renza-ai-port.tar.gz      # from the repo root
cd backend
npm install
npm test                           # expect 241 passing
```

`npm install` adds three packages: `pdfjs-dist`, `tesseract.js`, `pdf-parse`.

## Two manual steps

**1. Mount the admin components.** In
`restaurant-admin/app/(app)/menu/page.jsx`, add the imports:

```js
import MenuImportDialog from '@/components/MenuImportDialog';
import DishDescriptionsPanel from '@/components/DishDescriptionsPanel';
```

and place them inside the page, above the dish list:

```jsx
<MenuImportDialog onImported={fetchItems} />
<DishDescriptionsPanel onChanged={fetchItems} />
```

`fetchItems` already exists in that component.

**2. Set one environment variable — in two places.**

```
DESCRIPTION_API_KEY=<the Groq key sent separately>
```

- **Running locally:** put it in `backend/.env`. There is a placeholder for it
  in `backend/.env.example`, with a comment. `.env` is gitignored, so the key
  must never be committed.
- **On the server:** add it in the hosting dashboard, not in a file. This
  backend deploys on Vercel (`backend/vercel.json`), so that is
  Project → Settings → Environment Variables → add `DESCRIPTION_API_KEY`,
  then **redeploy** — an environment variable added after a deploy is not
  picked up until the next one.

Without it, descriptions fall back to a local Ollama model, which is not
present on a server — so descriptions simply will not work. Menu import does
not need it and works without any key at all.

Optional overrides, all with sensible defaults:

| Variable | Default | Why you might change it |
|---|---|---|
| `DESCRIPTION_API_MODEL` | `openai/gpt-oss-20b` | The model was retired once already — see below |
| `DESCRIPTION_API_URL` | Groq's chat completions endpoint | A different OpenAI-compatible provider |
| `DESCRIPTION_BATCH_SIZE` | `10` | Dishes per request |
| `DESCRIPTION_REQUEST_GAP_MS` | `7000` | Lower to go faster, at the risk of rate limits |

---

## What changed in existing files

Only two, both small:

- **`backend/src/index.js`** — two `require`s and two `app.use` lines, to mount
  `/api/restaurant/menu-import` and `/api/restaurant/descriptions`.
- **`backend/package.json`** — three dependencies and a `test` script.
- **`backend/.env.example`** — a commented placeholder for `DESCRIPTION_API_KEY`.

Everything else is new files. Nothing existing was rewritten, and no schema
change is needed: the import writes the columns this repo already has.

## How it writes the existing schema

There is no portions table here, so portions are written as JSON into the
columns this repo already uses, with the exact keys the customer menu reads:

| The menu prints | Written as |
|---|---|
| One price | `price` |
| Half / Full | `portionPrices` `{"half":220,"full":400}` |
| Quarter / Half / Full | `portionPrices` `{"quarter":200,"half":300,"full":510}` |
| Regular / Special | `portionPrices` `{"regular":100,"special":120}` |
| Dry / Gravy | `preparationPrices` `{"dry":180,"gravy":200}`, `preparationType: "both"` |
| A combo | a dish with `isCombo: true`, `comboItems` `[{"name":"...","quantity":"2 pcs"}]` |

Combos are filed under a category called **Combos**, created once. This is not
cosmetic: the public menu groups dishes by category and has no bucket for a
dish without one, so a combo saved with a null category would import
successfully and then never appear.

---

## Known limits — worth reading before you deploy

**Small / Large is approximated.** This product has only quarter, half, full,
regular and special. A menu priced `(S/L)` is therefore written onto the size
slots that do exist, in printed order:

```
two sizes   (S/L)    ->  half, full
three sizes (S/M/L)  ->  quarter, half, full
```

Prices are correct and the dish is sold in the right number of sizes, but a
customer reads "Half / Full" rather than "Small / Large". Adding small/medium/
large properly means a schema change, the admin form and the customer menu.
The mapping lives in one table, `SIZE_LADDER` in
`backend/src/services/menuImport/importToDatabase.js`.

**Dishes the menu prices "Seasonal"** (lobster, crab, whole fish) import with
no price and are held in the review list with `price_on_request`, for someone
to price. They are not dropped and not guessed at.

**Photo OCR is untested on serverless hosting.** `tesseract.js` plus its 5 MB
language file is large, and a Vercel function is capped at 250 MB unzipped.
PDF import is the tested path and the one to rely on. If OCR will not fit,
PDF-only still covers the normal case.

**The description model can be retired under you.** The original default,
`llama-3.1-8b-instant`, was shut down by Groq in August 2026, and every
request failed until the model was changed. If descriptions stop working
months from now, check <https://console.groq.com/docs/deprecations> first and
set `DESCRIPTION_API_MODEL` to whatever replacement is named. No code change.

**What still needs a human after an import:** dishes the menu genuinely
duplicates at different prices, two prices with no label printed anywhere, and
dishes the description model does not recognise. All three are listed in the
review screen rather than guessed at.

---

## Measured results

| Menu | Dishes read | Unreadable | Needing review |
|---|---|---|---|
| 13-page restaurant menu | 351 | 0 | 9 |
| 4-page Tamil Nadu menu, 100 dishes | 100 | 0 | 2 |
| 3-page cafe menu, 67 dishes | 67 | 0 | 0 |
| Seven generated layouts | exact | 0 | 0 |

Descriptions: a built-in library answers 96% of a Tamil Nadu menu instantly
with no model call. The rest take roughly a minute per hundred dishes.

## Rollback

Delete `backend/src/services/`, the two controllers, the two routes,
`backend/src/middleware/menuUpload.js` and the two admin components, then
revert `backend/src/index.js` and `backend/package.json`. Nothing else was
touched and no data migration was performed, so there is nothing to undo in
the database.
