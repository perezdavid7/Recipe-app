Kitchen Pro V2.6.2 — DATA RECOVERY PATCH

IMPORTANT
This patch is designed to recover recipe libraries that became invisible after
earlier builds changed the browser local-storage key.

It checks these older storage locations automatically:
- recipeAppV2_state
- recipeApp_forest_v24
- kitchenPro_v25_state
- kitchenPro_v25
- recipeLabTestMode_v1

It merges recovered recipes into the current Kitchen Pro library and DOES NOT
delete the legacy storage keys.

BEFORE UPDATING YOUR DAUGHTER'S IPHONE
Do not clear Safari website data, browser storage, or app/site data. Those old
browser records are what this recovery patch will try to read.

UPLOAD
Upload/replace all files from this package in the GitHub repository and commit
to main. Wait for GitHub Pages to redeploy.

RECOVERY
Then have your daughter open the exact same Kitchen Pro GitHub Pages address
she used before and refresh it. If the old local data is still present under
that origin, Kitchen Pro will recover and merge it automatically.

After the recipes reappear, immediately use Data > Export JSON to make a backup.
