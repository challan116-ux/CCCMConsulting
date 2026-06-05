# CCCM Consulting — Website

Marketing site for **CCCM Consulting**, an AI-first product studio building web
apps and automation across **Marketing**, **Commerce**, and bespoke **Apps**
(including [SignalEDI](#selected-work)).

A single, self-contained static site — no build step, no dependencies to install.

## Highlights

- **Premium dark design system** — navy canvas, gold + cyan accents, aurora &
  grid atmospherics (designed to avoid the generic "AI gradient" cliché).
- **Selected Work** — portfolio cards with inline-SVG product mockups. SignalEDI
  is a live build; Vantage Commerce, Beacon, and Atlas are live templates.
- **Documented tool stack** — the real production stack behind SignalEDI.
- **Scout — AI project intake assistant** (`intake.js`) — an adaptive chatbot
  that interviews a prospect, branches on their answers, and drafts a rough
  **LOE**, **FSD outline**, **industry build + maintenance cost range**, and a
  **recommended tooling plan** — then submits the brief.

## Run locally

It's plain HTML/CSS/JS. Serve the folder with anything:

```bash
# Python
python -m http.server 4178
# or Node
npx serve .
```

Then open <http://localhost:4178>.

## Deploy

Drop-in deployable to **Vercel**, **Netlify**, or **GitHub Pages** — it's static.
On Vercel: import the repo, framework preset **Other**, no build command, output
directory `.`.

## Project intake — wiring it up

`intake.js` runs a deterministic question/estimate engine so it works with no
backend or API key. Three clearly-marked swap points make it production-ready:

| Function | Today | Swap to |
| --- | --- | --- |
| `askBrain()` | deterministic next-question logic | OpenAI / Vercel AI SDK for free-form conversation |
| `buildEstimate()` | heuristic LOE / FSD / cost | LLM-generated estimate |
| `submitIntake()` | `POST /api/intake` → localStorage + mailto fallback | real intake mailbox endpoint |

Estimate constants (blended rates, feature hour-weights, scale multipliers,
maintenance band) live at the top of `intake.js` — calibrate them to your rate
card.

## Notes

- Tailwind is loaded via the Play CDN for portability. For production, compile
  Tailwind to remove the CDN console advisory.
- The three template projects are illustrative; replace with real case studies.
