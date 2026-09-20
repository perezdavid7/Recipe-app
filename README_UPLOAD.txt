Kitchen Pro V2.8 — GitHub update overlay

This package is built directly from the uploaded V2.7 Recipe Overview app.

UPLOAD / REPLACE these files in the root of your existing GitHub Pages repo:
- index.html
- app.js
- sw.js
- kitchenpro-v28.webmanifest
- recipes.json
- apple-touch-icon.png
- favicon-32.png
- icon-192.png
- icon-512.png
- kitchenpro-logo.png

KEEP your existing styles.css file in the repo. V2.8 uses the same V2.7 styling and loads it as styles.css?v=280.

What V2.8 adds:
- Timed-step toggle and editable minutes in Edit Recipe
- -5, -1, +1, +5 minute preset controls
- English + Spanish duration detection when importing recipes
- Clear time ranges such as "3 a 6 horas" are NOT guessed
- Checking a timed Production step automatically starts its timer
- Active timer countdown with +5 minutes and Dismiss
- Timer target end time persists in local storage; returning after suspension shows correct remaining/overdue time
- Production checks, batch size, and timers persist per recipe/batch
- New Batch clears that recipe's checks and timers
- Existing V2.7 local recipes are migrated for clear durations without changing the storage key
- Recipe Overview displays a timer badge on timed steps

Important:
Existing phone data stays in the same local-storage key. Replacing these GitHub files updates the app code but does not automatically sync one employee's local edits to another phone.
