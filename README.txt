Kitchen Pro V2.6.3 — iPhone Update Fix

PURPOSE
This build fixes the installed iPhone Home Screen web app getting stuck on an older cached build.

IMPORTANT
- It does NOT change or clear the recipe storage key.
- It keeps the V2.6.2 legacy-data recovery logic.
- It does NOT delete localStorage.
- Do not delete the existing iPhone Home Screen app before trying this build.

WHAT CHANGED
- The service-worker URL is versioned so iOS must request the new worker.
- App HTML, CSS, and JavaScript use cache-busting version parameters.
- Navigation/app code is now network-first with cache fallback.
- Static icon/image files remain cache-first.
- Old service-worker caches are removed during activation.

AFTER UPLOADING
1. Wait for GitHub Pages to finish deploying.
2. On the iPhone, open the Kitchen Pro URL in Safari and verify V2.6.3.
3. Close Safari.
4. Force-close the existing Home Screen Kitchen Pro app.
5. Reopen the same Home Screen app.
6. If needed, close/reopen it once more so the new service worker can take control.

Do not clear Safari website data while recovering recipes.
