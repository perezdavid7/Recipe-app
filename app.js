(() => {
"use strict";

const BUILD_VERSION = "2.7";
const BUILD_NAME = "Recipe Overview";
const STORAGE_KEY = "recipeApp_forest_v24";
const VOLUME_FRACTION_UNITS = new Set(["cup","cups","tbsp","tablespoon","tablespoons","tsp","teaspoon","teaspoons"]);
const UNIT_GROUPS = {
  "Weight": ["g","kg","oz","lb"],
  "Volume": ["tsp","tbsp","cup","fl oz","mL","L"],
  "Count": ["each","egg","clove","slice","piece"],
  "Package / container": ["can","jar","bag","package","bunch","container"]
};
const UNIT_ALIASES = {
  "grams":"g","gram":"g","g":"g","kilograms":"kg","kilogram":"kg","kg":"kg",
  "ounces":"oz","ounce":"oz","oz":"oz","pounds":"lb","pound":"lb","lbs":"lb","lb":"lb",
  "teaspoons":"tsp","teaspoon":"tsp","tsp":"tsp","t":"tsp",
  "tablespoons":"tbsp","tablespoon":"tbsp","tbsp":"tbsp","tbs":"tbsp",
  "cups":"cup","cup":"cup","c":"cup",
  "fluid ounces":"fl oz","fluid ounce":"fl oz","fl oz":"fl oz",
  "milliliters":"mL","milliliter":"mL","ml":"mL","liters":"L","liter":"L","l":"L",
  "each":"each","egg":"egg","eggs":"egg","clove":"clove","cloves":"clove","slice":"slice","slices":"slice","piece":"piece","pieces":"piece",
  "can":"can","cans":"can","jar":"jar","jars":"jar","bag":"bag","bags":"bag","package":"package","packages":"package","pkg":"package",
  "bunch":"bunch","bunches":"bunch","container":"container","containers":"container"
};
const UNICODE_FRACTIONS = {"¼":0.25,"⅓":1/3,"½":0.5,"⅔":2/3,"¾":0.75,"⅛":0.125,"⅜":0.375,"⅝":0.625,"⅞":0.875};
const FRACTION_BUTTONS = [["¼",0.25],["⅓",1/3],["½",0.5],["⅔",2/3],["¾",0.75]];

let state = {appVersion:"2.4", buildName:"Forest Refresh", recipes:[]};
let activeView = "library";
let selectedRecipeId = null;
let labDraft = null;
let importDraft = null;
let unitPickerTarget = null;
let libraryScreen = "list";
let libraryRecipeId = null;
let editDraft = null;

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = p => `${p}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const num = v => (v === "" || v === null || v === undefined) ? null : Number(v);
const fmt = n => {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  return Number.isInteger(x) ? String(x) : String(Math.round(x*1000)/1000);
};

function toast(msg){
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1900);
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

const LEGACY_STORAGE_KEYS = [
  "recipeAppV2_state",
  "recipeApp_forest_v24",
  "kitchenPro_v25_state",
  "kitchenPro_v25",
  "recipeLabTestMode_v1"
];

function parseStoredState(key){
  try{
    const raw = localStorage.getItem(key);
    if(!raw) return null;
    const parsed = JSON.parse(raw);

    // Recipe Lab V1 stored a single recipe object instead of a recipes array.
    if(parsed?.recipe && !parsed?.recipes){
      return {
        appVersion: "legacy",
        buildName: "Recovered Recipe Lab",
        recipes: [parsed.recipe]
      };
    }
    return Array.isArray(parsed?.recipes) ? parsed : null;
  }catch(e){
    return null;
  }
}

function mergeRecoveredStates(states){
  const merged = {appVersion: BUILD_VERSION, buildName: BUILD_NAME, recipes: []};
  const byId = new Map();

  for(const snapshot of states){
    for(const incoming of (snapshot?.recipes || [])){
      if(!incoming || !incoming.name) continue;
      const recipe = JSON.parse(JSON.stringify(incoming));
      const key = recipe.id || `name:${recipe.name.trim().toLowerCase()}`;

      if(!byId.has(key)){
        byId.set(key, recipe);
        continue;
      }

      const existing = byId.get(key);
      const existingTests = existing.tests?.length || 0;
      const incomingTests = recipe.tests?.length || 0;

      // Prefer the copy with more development history. If tied, prefer the
      // higher official version. Preserve any missing tests from both.
      const existingVersion = Number(existing.officialVersion || 0);
      const incomingVersion = Number(recipe.officialVersion || 0);
      const preferred = (incomingTests > existingTests ||
        (incomingTests === existingTests && incomingVersion > existingVersion))
        ? recipe : existing;
      const secondary = preferred === recipe ? existing : recipe;

      const seenTests = new Set((preferred.tests || []).map(t => t.id || `${t.createdAt}|${t.number}|${t.title}`));
      preferred.tests ||= [];
      for(const t of (secondary.tests || [])){
        const tk = t.id || `${t.createdAt}|${t.number}|${t.title}`;
        if(!seenTests.has(tk)){
          preferred.tests.push(t);
          seenTests.add(tk);
        }
      }
      byId.set(key, preferred);
    }
  }

  merged.recipes = [...byId.values()];
  return merged;
}

function loadStored(){
  const snapshots = [];
  const keysSeen = new Set();

  // Current key first, then every known legacy key from earlier Kitchen Pro /
  // Recipe App builds. We intentionally DO NOT delete any old key.
  for(const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]){
    if(keysSeen.has(key)) continue;
    keysSeen.add(key);
    const parsed = parseStoredState(key);
    if(parsed?.recipes?.length) snapshots.push({key, data:parsed});
  }

  if(!snapshots.length) return null;

  const merged = mergeRecoveredStates(snapshots.map(s => s.data));
  const current = parseStoredState(STORAGE_KEY);
  const currentCount = current?.recipes?.length || 0;
  const recoveredCount = Math.max(0, merged.recipes.length - currentCount);

  // Save the merged recovery result under the current key, while retaining
  // every legacy key as an untouched fallback.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));

  if(recoveredCount > 0){
    setTimeout(() => {
      toast(`Recovered ${recoveredCount} recipe${recoveredCount===1?"":"s"} from an older build`);
    }, 500);
  }
  return merged;
}
async function loadSeed(){
  const resp = await fetch("recipes.json", {cache:"no-store"});
  if(!resp.ok) throw new Error("Could not load recipes.json");
  return await resp.json();
}
async function init(){
  const stored = loadStored();
  if (stored?.recipes) state = stored;
  else {
    try{ state = await loadSeed(); saveState(); }
    catch(e){
      state = {appVersion:"2.4", buildName:"Forest Refresh", recipes:[]};
      toast("Could not load starter recipes. Try refreshing.");
    }
  }
  selectedRecipeId = state.recipes[0]?.id || null;
  bindBaseEvents();
  renderAll();
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js?v=270", {updateViaCache:"none"}).then(reg => reg.update()).catch(() => {});
  }
}
function bindBaseEvents(){
  $$(".mode-btn").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
  $$(".nav-btn").forEach(btn => btn.addEventListener("click", () => showView(btn.dataset.view)));
  $("#heroGoLibrary").addEventListener("click", () => showView("library"));
  $("#heroGoImport").addEventListener("click", () => showView("import"));
  $("#jsonImportFile").addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (file) importJsonFile(file);
    e.target.value = "";
  });
}
function showView(view){
  activeView = view;
  $$(".mode-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  $$(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  ["library","production","lab","import","data"].forEach(v => $("#view-"+v).classList.toggle("hidden", v !== view));

  // Home keeps the full landing area. Working screens collapse it.
  document.querySelector(".hero")?.classList.toggle("compact", view !== "library");

  renderView(view);

  // Make each menu/icon tap act like true page navigation.
  requestAnimationFrame(() => {
    const target = $("#view-" + view);
    if(!target) return;
    const top = target.getBoundingClientRect().top + window.scrollY - 12;
    window.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  });
}
function renderAll(){
  $("#buildTag").textContent = `V${BUILD_VERSION} ${BUILD_NAME}`;
  $("#statRecipes").textContent = state.recipes.length;
  $("#statTests").textContent = state.recipes.reduce((sum, r) => sum + (r.tests?.length || 0), 0);
  ["library","production","lab","import","data"].forEach(renderView);
}
function renderView(v){
  if(v==="library") renderLibrary();
  if(v==="production") renderProduction();
  if(v==="lab") renderLab();
  if(v==="import") renderImport();
  if(v==="data") renderData();
}
function getRecipe(id = selectedRecipeId){
  return state.recipes.find(r => r.id === id) || null;
}
function recipeSelect(id){
  return `<select id="${id}">${state.recipes.map(r => `<option value="${esc(r.id)}" ${r.id===selectedRecipeId?"selected":""}>${esc(r.name)}</option>`).join("")}</select>`;
}
function scaledAmount(amount, scale){ return Math.round(Number(amount) * Number(scale) * 1000) / 1000; }

function renderLibrary(){
  if(libraryScreen === "detail" && libraryRecipeId){
    renderRecipeOverview(libraryRecipeId);
    return;
  }
  if(libraryScreen === "edit" && editDraft){
    renderRecipeEditor();
    return;
  }

  const host = $("#view-library");
  if(!state.recipes.length){
    host.innerHTML = `<div class="card"><div class="empty">No recipes yet. Start by importing one.</div><div style="margin-top:12px"><button class="primary" id="goImportEmpty">Import Recipe</button></div></div>`;
    $("#goImportEmpty")?.addEventListener("click", ()=>showView("import"));
    return;
  }

  host.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div>
          <h2>My Recipes</h2>
          <div class="subtle">Tap any recipe card to open the full recipe.</div>
        </div>
        <span class="badge">Kitchen Pro</span>
      </div>

      <div class="recipe-list">
        ${state.recipes.map(r => `
          <article class="recipe-card recipe-open-card" data-id="${esc(r.id)}" tabindex="0" role="button" aria-label="Open ${esc(r.name)}">
            <div class="thumb">${esc(r.icon || "🍽️")}</div>
            <div>
              <div class="recipe-title">${esc(r.name)}</div>
              <div class="recipe-meta">${esc(r.category || "Recipe")} · ${esc(r.yield?.text || "Yield not set")}</div>
              <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
                <span class="chip">v${esc(r.officialVersion)}</span>
                <span class="chip">${r.ingredients.length} ingredients</span>
              </div>
            </div>
            <div class="recipe-actions">
              <button class="icon-btn open-prod" data-id="${esc(r.id)}" title="Start Production" aria-label="Start Production for ${esc(r.name)}">👨‍🍳</button>
              <button class="icon-btn open-lab" data-id="${esc(r.id)}" title="Open Recipe Lab" aria-label="Open Recipe Lab for ${esc(r.name)}">🧪</button>
              <button class="icon-btn recipe-menu-btn" data-id="${esc(r.id)}" title="Recipe options" aria-label="Options for ${esc(r.name)}">⋯</button>
            </div>
          </article>
        `).join("")}
      </div>

      <button class="cta-wide" id="libraryImportBtn">＋ Add New Recipe</button>

      <button class="tip-card tip-action" id="betterRecipesTip" type="button">
        <div class="tip-left">
          <div class="tip-icon">🧪</div>
          <div style="text-align:left">
            <div style="font-weight:900">Better recipes.</div>
            <div class="subtle">A brighter kitchen.</div>
          </div>
        </div>
        <div>›</div>
      </button>
    </div>
  `;

  $("#libraryImportBtn").addEventListener("click", ()=>showView("import"));
  $("#betterRecipesTip").addEventListener("click", ()=>{
    const first = state.recipes[0];
    if(first) selectedRecipeId = first.id;
    labDraft = null;
    showView("lab");
  });

  $$(".recipe-open-card", host).forEach(card => {
    const open = () => openRecipeOverview(card.dataset.id);
    card.addEventListener("click", e => {
      if(e.target.closest("button")) return;
      open();
    });
    card.addEventListener("keydown", e => {
      if((e.key === "Enter" || e.key === " ") && !e.target.closest("button")){
        e.preventDefault();
        open();
      }
    });
  });

  $$(".open-prod", host).forEach(btn => btn.addEventListener("click", e => {
    e.stopPropagation();
    selectedRecipeId = btn.dataset.id;
    showView("production");
  }));
  $$(".open-lab", host).forEach(btn => btn.addEventListener("click", e => {
    e.stopPropagation();
    selectedRecipeId = btn.dataset.id;
    labDraft = null;
    showView("lab");
  }));
  $$(".recipe-menu-btn", host).forEach(btn => btn.addEventListener("click", e => {
    e.stopPropagation();
    openRecipeMenu(btn.dataset.id);
  }));
}

function openRecipeOverview(id){
  libraryRecipeId = id;
  selectedRecipeId = id;
  libraryScreen = "detail";
  renderLibrary();
  requestAnimationFrame(() => {
    const target = $("#view-library");
    if(target) window.scrollTo({top:Math.max(0,target.getBoundingClientRect().top + window.scrollY - 8),behavior:"smooth"});
  });
}

function renderRecipeOverview(id){
  const host = $("#view-library");
  const r = state.recipes.find(x => x.id === id);
  if(!r){
    libraryScreen = "list";
    libraryRecipeId = null;
    renderLibrary();
    return;
  }

  host.innerHTML = `
    <div class="card recipe-overview">
      <div class="overview-toolbar">
        <button class="ghost small" id="backToLibrary">← My Recipes</button>
        <button class="ghost small" id="overviewMenu">⋯ Options</button>
      </div>

      <div class="overview-hero">
        <div class="overview-icon">${esc(r.icon || "🍽️")}</div>
        <div class="overview-title-block">
          <span class="badge">${esc(r.category || "Recipe")}</span>
          <h2>${esc(r.name)}</h2>
          <div class="subtle">${esc(r.yield?.text || "Yield not set")} · Official v${esc(r.officialVersion)}</div>
        </div>
      </div>

      <div class="overview-actions">
        <button class="primary" id="overviewProduction">👨‍🍳 Start Production</button>
        <button class="good" id="overviewLab">🧪 Recipe Lab</button>
      </div>

      <div class="grid two overview-content">
        <div>
          <div class="section-head"><div><h3>Ingredients</h3><div class="subtle">${r.ingredients.length} ingredients</div></div></div>
          <div class="overview-list">
            ${r.ingredients.map(i => `
              <div class="overview-row">
                <strong>${fmt(i.amount)} ${esc(i.unit)}</strong>
                <span>${esc(i.name)}</span>
              </div>
            `).join("")}
          </div>
        </div>
        <div>
          <div class="section-head"><div><h3>Process</h3><div class="subtle">${r.steps.length} steps</div></div></div>
          <div class="overview-steps">
            ${r.steps.map((s,idx) => `
              <div class="overview-step">
                <div class="step-bubble">${idx+1}</div>
                <div>${esc(s.text)}</div>
              </div>
            `).join("") || `<div class="empty">No process steps saved yet.</div>`}
          </div>
        </div>
      </div>
    </div>
  `;

  $("#backToLibrary").addEventListener("click", ()=>{
    libraryScreen = "list";
    libraryRecipeId = null;
    editDraft = null;
    renderLibrary();
  });
  $("#overviewMenu").addEventListener("click", ()=>openRecipeMenu(r.id));
  $("#overviewProduction").addEventListener("click", ()=>{
    selectedRecipeId = r.id;
    showView("production");
  });
  $("#overviewLab").addEventListener("click", ()=>{
    selectedRecipeId = r.id;
    labDraft = null;
    showView("lab");
  });
}

function openRecipeMenu(id){
  const r = state.recipes.find(x => x.id === id);
  if(!r) return;
  $("#sheetHost").innerHTML = `
    <div class="sheet-backdrop" id="recipeMenuBackdrop">
      <div class="sheet">
        <div class="sheet-head">
          <div><strong>${esc(r.name)}</strong><div class="small">Recipe options</div></div>
          <button class="ghost small" id="closeRecipeMenu">Close</button>
        </div>
        <div class="recipe-option-list">
          <button type="button" id="menuEditRecipe">✏️ Edit Recipe</button>
          <button type="button" id="menuDuplicateRecipe">⧉ Duplicate Recipe</button>
          <button type="button" class="danger" id="menuDeleteRecipe">🗑️ Delete Recipe</button>
        </div>
      </div>
    </div>
  `;
  $("#closeRecipeMenu").addEventListener("click", closeRecipeMenu);
  $("#recipeMenuBackdrop").addEventListener("click", e => {
    if(e.target.id === "recipeMenuBackdrop") closeRecipeMenu();
  });
  $("#menuEditRecipe").addEventListener("click", ()=>{
    closeRecipeMenu();
    startRecipeEdit(id);
  });
  $("#menuDuplicateRecipe").addEventListener("click", ()=>{
    closeRecipeMenu();
    duplicateRecipe(id);
  });
  $("#menuDeleteRecipe").addEventListener("click", ()=>{
    closeRecipeMenu();
    deleteRecipe(id);
  });
}

function closeRecipeMenu(){
  $("#sheetHost").innerHTML = "";
}

function duplicateRecipe(id){
  const source = state.recipes.find(r => r.id === id);
  if(!source) return;
  const copy = clone(source);
  copy.id = uid("recipe");
  copy.name = `${source.name} Copy`;
  copy.officialVersion = 1;
  copy.tests = [];
  copy.ingredients = copy.ingredients.map(i => ({...i,id:uid("ing")}));
  copy.steps = copy.steps.map(s => ({...s,id:uid("step")}));
  state.recipes.push(copy);
  saveState();
  libraryScreen = "list";
  libraryRecipeId = null;
  renderAll();
  toast("Recipe duplicated");
}

function deleteRecipe(id){
  const r = state.recipes.find(x => x.id === id);
  if(!r) return;
  const tests = r.tests?.length || 0;
  const extra = tests ? ` This also removes ${tests} saved test${tests===1?"":"s"} on this device.` : "";
  if(!confirm(`Delete "${r.name}"?${extra}\n\nThis cannot be undone unless you restore a JSON backup.`)) return;

  state.recipes = state.recipes.filter(x => x.id !== id);
  if(selectedRecipeId === id) selectedRecipeId = state.recipes[0]?.id || null;
  libraryScreen = "list";
  libraryRecipeId = null;
  editDraft = null;
  saveState();
  renderAll();
  toast("Recipe deleted");
}

function startRecipeEdit(id){
  const r = state.recipes.find(x => x.id === id);
  if(!r) return;
  editDraft = clone(r);
  editDraft.yieldText = r.yield?.text || "";
  libraryRecipeId = id;
  libraryScreen = "edit";
  renderLibrary();
  requestAnimationFrame(() => {
    const target = $("#view-library");
    if(target) window.scrollTo({top:Math.max(0,target.getBoundingClientRect().top + window.scrollY - 8),behavior:"smooth"});
  });
}

function renderRecipeEditor(){
  const host = $("#view-library");
  if(!editDraft){
    libraryScreen = "list";
    renderLibrary();
    return;
  }
  host.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div><h2>Edit Recipe</h2><div class="subtle">Changes update the official recipe and create a new version number.</div></div>
        <button class="ghost small" id="cancelRecipeEdit">Cancel</button>
      </div>

      <div class="grid two">
        <div class="field"><label>Recipe name</label><input id="editName" value="${esc(editDraft.name)}"></div>
        <div class="field"><label>Category</label><input id="editCategory" value="${esc(editDraft.category || "")}"></div>
      </div>
      <div class="field"><label>Yield / batch size</label><input id="editYield" value="${esc(editDraft.yieldText || "")}"></div>

      <div class="section-head">
        <div><h3>Ingredients</h3></div>
        <button class="small" id="addEditIngredient">+ Ingredient</button>
      </div>
      <div id="editIngredients"></div>

      <div class="section-head" style="margin-top:12px">
        <div><h3>Process</h3></div>
        <button class="small" id="addEditStep">+ Step</button>
      </div>
      <div id="editSteps"></div>

      <div class="overview-actions" style="margin-top:16px">
        <button class="primary" id="saveRecipeEdit">Save Changes</button>
        <button class="ghost" id="cancelRecipeEditBottom">Cancel</button>
      </div>
    </div>
  `;

  $("#editName").addEventListener("input",e=>editDraft.name=e.target.value);
  $("#editCategory").addEventListener("input",e=>editDraft.category=e.target.value);
  $("#editYield").addEventListener("input",e=>editDraft.yieldText=e.target.value);
  $("#addEditIngredient").addEventListener("click",()=>{
    editDraft.ingredients.push({id:uid("ing"),amount:null,unit:"",name:""});
    renderRecipeEditor();
  });
  $("#addEditStep").addEventListener("click",()=>{
    editDraft.steps.push({id:uid("step"),text:"",videoUrl:""});
    renderRecipeEditor();
  });
  $("#saveRecipeEdit").addEventListener("click",saveRecipeEdit);
  $("#cancelRecipeEdit").addEventListener("click",cancelRecipeEdit);
  $("#cancelRecipeEditBottom").addEventListener("click",cancelRecipeEdit);

  renderEditIngredients();
  renderEditSteps();
}

function renderEditIngredients(){
  const host = $("#editIngredients");
  if(!editDraft.ingredients.length){
    host.innerHTML = `<div class="empty">No ingredients. Add one above.</div>`;
    return;
  }
  host.innerHTML = editDraft.ingredients.map((i,idx)=>`
    <div class="ingredient-row">
      <div class="namecell">
        <label>Ingredient</label>
        <input class="edit-ing-name" data-idx="${idx}" value="${esc(i.name)}">
        <button class="ghost small remove-edit-ing" data-idx="${idx}" style="margin-top:7px">Remove</button>
      </div>
      <div><label>Amount</label>${renderAmountControls("edit",i,idx)}</div>
      <div><label>Unit</label><button type="button" class="unit-btn" data-context="edit" data-idx="${idx}">${esc(i.unit || "Select")}</button></div>
    </div>
  `).join("");
  bindIngredientEditors("edit",host);
  $$(".edit-ing-name",host).forEach(el=>el.addEventListener("input",e=>{
    editDraft.ingredients[Number(e.target.dataset.idx)].name=e.target.value;
  }));
  $$(".remove-edit-ing",host).forEach(btn=>btn.addEventListener("click",()=>{
    editDraft.ingredients.splice(Number(btn.dataset.idx),1);
    renderRecipeEditor();
  }));
}

function renderEditSteps(){
  const host = $("#editSteps");
  if(!editDraft.steps.length){
    host.innerHTML = `<div class="empty">No process steps. Add one above.</div>`;
    return;
  }
  host.innerHTML = editDraft.steps.map((s,idx)=>`
    <div class="edit-step-row">
      <div class="step-bubble">${idx+1}</div>
      <textarea class="edit-step-text" data-idx="${idx}">${esc(s.text)}</textarea>
      <button class="ghost small remove-edit-step" data-idx="${idx}">Remove</button>
    </div>
  `).join("");
  $$(".edit-step-text",host).forEach(el=>el.addEventListener("input",e=>{
    editDraft.steps[Number(e.target.dataset.idx)].text=e.target.value;
  }));
  $$(".remove-edit-step",host).forEach(btn=>btn.addEventListener("click",()=>{
    editDraft.steps.splice(Number(btn.dataset.idx),1);
    renderRecipeEditor();
  }));
}

function cancelRecipeEdit(){
  const id = libraryRecipeId;
  editDraft = null;
  libraryScreen = id ? "detail" : "list";
  renderLibrary();
}

function saveRecipeEdit(){
  const name = editDraft.name.trim();
  if(!name){ toast("Recipe name is required"); return; }
  const ingredients = editDraft.ingredients.filter(i=>String(i.name||"").trim()).map(i=>({
    id:i.id || uid("ing"),
    name:String(i.name).trim(),
    amount:Number(i.amount || 0),
    unit:i.unit || "each"
  }));
  if(!ingredients.length){ toast("Add at least one ingredient"); return; }

  const idx = state.recipes.findIndex(r=>r.id===editDraft.id);
  if(idx<0) return;
  const existing = state.recipes[idx];
  const updated = {
    ...existing,
    name,
    category:String(editDraft.category || "").trim() || "Recipe",
    yield:{...(existing.yield||{}),text:String(editDraft.yieldText||"").trim() || "Yield not set"},
    ingredients,
    steps:editDraft.steps.filter(s=>String(s.text||"").trim()).map(s=>({
      id:s.id || uid("step"),
      text:String(s.text).trim(),
      videoUrl:s.videoUrl || ""
    })),
    officialVersion:Number(existing.officialVersion || 0)+1
  };
  state.recipes[idx]=updated;
  saveState();
  editDraft=null;
  libraryRecipeId=updated.id;
  libraryScreen="detail";
  renderAll();
  toast(`Saved as official v${updated.officialVersion}`);
}

function renderProduction(){
  const host = $("#view-production");
  if(!state.recipes.length){
    host.innerHTML = `<div class="card"><div class="empty">Import a recipe first.</div></div>`;
    return;
  }
  if(!getRecipe()) selectedRecipeId = state.recipes[0].id;
  const r = getRecipe();
  host.innerHTML = `
    <div class="grid two">
      <div class="card">
        <div class="section-head">
          <div><h2>Production Mode</h2><div class="subtle">Follow the official recipe without changing it.</div></div>
          <div style="min-width:180px">${recipeSelect("prodRecipe")}</div>
        </div>

        <div class="field">
          <label>Batch size</label>
          <select id="prodScale">
            <option value=".5">½ batch</option>
            <option value="1" selected>1 batch</option>
            <option value="1.5">1½ batches</option>
            <option value="2">2 batches</option>
            <option value="3">3 batches</option>
          </select>
        </div>

        <div class="field">
          <div class="section-head" style="margin-bottom:6px">
            <div><strong>${esc(r.name)}</strong><div class="small">Official v${esc(r.officialVersion)} · ${esc(r.yield?.text || "Yield not set")}</div></div>
            <span class="badge">Kitchen Mode</span>
          </div>
          <div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:6px">
            <span class="small">Progress</span>
            <span class="small" id="prodProgressText">0%</span>
          </div>
          <div class="progress"><div id="prodProgressBar"></div></div>
        </div>

        <div class="field">
          <h3 style="margin-bottom:10px">Ingredients</h3>
          <div id="prodIngredients"></div>
        </div>
      </div>

      <div class="card">
        <div class="section-head">
          <div><h3>Process</h3><div class="subtle">Check off each step as you go.</div></div>
          <button class="ghost small" id="resetProdChecks">Reset</button>
        </div>
        <div id="prodSteps"></div>
      </div>
    </div>
  `;
  $("#prodRecipe").addEventListener("change", e => { selectedRecipeId = e.target.value; renderProduction(); });
  $("#prodScale").addEventListener("change", renderProdChecklist);
  $("#resetProdChecks").addEventListener("click", () => { renderProdChecklist(); toast("Production checks reset"); });
  renderProdChecklist();
}
function renderProdChecklist(){
  const r = getRecipe();
  const scale = Number($("#prodScale")?.value || 1);
  $("#prodIngredients").innerHTML = r.ingredients.map(i => `
    <label class="checkline">
      <input type="checkbox" class="prod-check">
      <span><strong>${fmt(scaledAmount(i.amount, scale))} ${esc(i.unit)}</strong> ${esc(i.name)}</span>
    </label>
  `).join("");
  $("#prodSteps").innerHTML = r.steps.map((s, idx) => `
    <label class="checkline">
      <input type="checkbox" class="prod-check">
      <span><strong>${idx+1}.</strong> <span class="step-text">${esc(s.text)}</span></span>
    </label>
  `).join("");
  $$(".prod-check").forEach(cb => cb.addEventListener("change", () => {
    cb.closest(".checkline").querySelector(".step-text")?.classList.toggle("done-text", cb.checked);
    updateProdProgress();
  }));
  updateProdProgress();
}
function updateProdProgress(){
  const checks = $$(".prod-check");
  const done = checks.filter(c => c.checked).length;
  const pct = checks.length ? Math.round(done / checks.length * 100) : 0;
  $("#prodProgressText").textContent = pct + "%";
  $("#prodProgressBar").style.width = pct + "%";
}

function newLabDraft(){
  const r = getRecipe();
  return {
    title: "",
    scale: 1,
    ingredients: r.ingredients.map(i => ({...clone(i), baseAmount:i.amount})),
    changeReason: "",
    ratings: {overall:null, taste:null, texture:null, appearance:null},
    resultNotes: "",
    nextTime: "",
    decision: "needs-work"
  };
}
function ensureLabDraft(){ if(!labDraft) labDraft = newLabDraft(); }
function syncLabFields(){
  labDraft.title = $("#labTitle").value;
  labDraft.changeReason = $("#labReason").value;
  labDraft.resultNotes = $("#labResult").value;
  labDraft.nextTime = $("#labNext").value;
  labDraft.decision = $("#labDecision").value;
  ["overall","taste","texture","appearance"].forEach(k => labDraft.ratings[k] = num($("#rate-"+k).value));
}
function renderLab(){
  const host = $("#view-lab");
  if(!state.recipes.length){
    host.innerHTML = `<div class="card"><div class="empty">Import a recipe first.</div></div>`;
    return;
  }
  if(!getRecipe()) selectedRecipeId = state.recipes[0].id;
  ensureLabDraft();
  const r = getRecipe();
  const last = r.tests?.[r.tests.length-1];

  host.innerHTML = `
    <div class="grid two">
      <div class="card">
        <div class="section-head">
          <div><h2>Recipe Lab</h2><div class="subtle">Experiment without changing the official recipe.</div></div>
          <div style="min-width:180px">${recipeSelect("labRecipe")}</div>
        </div>

        <div class="note" ${last?.nextTime && last.decision!=="winner" ? "" : 'style="display:none"'}>
          <strong>From the last test:</strong>
          <div style="margin-top:5px">${esc(last?.nextTime || "")}</div>
        </div>

        <div class="field" style="margin-top:12px">
          <label>Test name</label>
          <input id="labTitle" value="${esc(labDraft.title)}" placeholder="Example: Softer center, less sweet">
        </div>

        <div class="field">
          <label>Batch size</label>
          <select id="labScale">
            <option value=".5">½ batch</option>
            <option value="1">1 batch</option>
            <option value="1.5">1½ batches</option>
            <option value="2">2 batches</option>
            <option value="3">3 batches</option>
          </select>
        </div>

        <div class="field">
          <label>Ingredients</label>
          <div class="kbd-note">Amounts use the numeric keypad. Cups, tablespoons, and teaspoons show quick fraction buttons.</div>
          <div id="labIngredients" style="margin-top:10px"></div>
        </div>

        <div class="field">
          <label>What are you changing, and why?</label>
          <textarea id="labReason">${esc(labDraft.changeReason)}</textarea>
        </div>
      </div>

      <div class="card">
        <div class="section-head">
          <div><h2>After the test</h2><div class="subtle">Record the result while it is fresh.</div></div>
          <span class="badge">Test #${(r.tests?.length || 0) + 1}</span>
        </div>

        <div class="score-grid">
          ${["overall","taste","texture","appearance"].map(k => `
            <div class="score">
              <label>${k[0].toUpperCase()+k.slice(1)}</label>
              <input id="rate-${k}" inputmode="decimal" type="number" min="1" max="5" step=".5" value="${labDraft.ratings[k] ?? ""}" placeholder="1–5">
            </div>
          `).join("")}
        </div>

        <div class="field" style="margin-top:14px">
          <label>What happened?</label>
          <textarea id="labResult">${esc(labDraft.resultNotes)}</textarea>
        </div>

        <div class="field">
          <label>Next time, try…</label>
          <textarea id="labNext">${esc(labDraft.nextTime)}</textarea>
        </div>

        <div class="field">
          <label>Decision</label>
          <select id="labDecision">
            <option value="needs-work">Needs another test</option>
            <option value="good">Good — keep as candidate</option>
            <option value="winner">Winner — ready to become official</option>
          </select>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="primary" id="saveLab">Save Test</button>
          <button class="good" id="promoteLab">Promote to Official</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="section-head">
        <div><h3>Test History</h3><div class="subtle">Keep every experiment, even the ones you did not like.</div></div>
        <span class="badge">${r.tests?.length || 0} saved</span>
      </div>
      <div id="labHistory"></div>
    </div>
  `;
  $("#labRecipe").addEventListener("change", e => { selectedRecipeId = e.target.value; labDraft = null; renderLab(); });
  $("#labScale").value = String(labDraft.scale);
  $("#labDecision").value = labDraft.decision;
  $("#labScale").addEventListener("change", e => {
    const scale = Number(e.target.value);
    labDraft.scale = scale;
    const rr = getRecipe();
    labDraft.ingredients = rr.ingredients.map(i => ({...clone(i), baseAmount:i.amount, amount:scaledAmount(i.amount, scale)}));
    renderLabIngredients();
  });
  ["labTitle","labReason","labResult","labNext","labDecision"].forEach(id => $("#"+id).addEventListener("input", syncLabFields));
  ["overall","taste","texture","appearance"].forEach(k => $("#rate-"+k).addEventListener("input", syncLabFields));
  $("#saveLab").addEventListener("click", saveLabTest);
  $("#promoteLab").addEventListener("click", promoteLabTest);

  renderLabIngredients();
  renderLabHistory();
}
function renderAmountControls(context, row, idx){
  const isVol = VOLUME_FRACTION_UNITS.has(String(row.unit).toLowerCase());
  return `<input class="amount-input" inputmode="decimal" type="number" step="any" data-context="${context}" data-idx="${idx}" value="${fmt(row.amount)}">
    ${isVol ? `<div class="fractions">${FRACTION_BUTTONS.map(([lab,val]) => `<button type="button" class="frac-btn" data-context="${context}" data-idx="${idx}" data-frac="${val}">${lab}</button>`).join("")}</div>` : ""}`;
}
function renderLabIngredients(){
  const host = $("#labIngredients");
  const official = getRecipe().ingredients;
  host.innerHTML = labDraft.ingredients.map((i, idx) => {
    const officialScaled = scaledAmount(official[idx].amount, labDraft.scale);
    const changed = Math.abs(Number(i.amount) - Number(officialScaled)) > 0.0001 || i.unit !== official[idx].unit;
    return `
      <div class="ingredient-row ${changed ? "changed" : ""}">
        <div class="namecell">
          <strong>${esc(i.name)}</strong>
          <div class="small">Official at this size: ${fmt(officialScaled)} ${esc(official[idx].unit)}</div>
        </div>
        <div><label>Amount</label>${renderAmountControls("lab", i, idx)}</div>
        <div><label>Unit</label><button type="button" class="unit-btn" data-context="lab" data-idx="${idx}">${esc(i.unit || "Select")}</button></div>
      </div>
    `;
  }).join("");
  bindIngredientEditors("lab", host);
}
function ingredientTarget(context){
  if(context === "lab") return labDraft.ingredients;
  if(context === "edit") return editDraft.ingredients;
  return importDraft.ingredients;
}
function bindIngredientEditors(context, host){
  $$(".amount-input", host).forEach(el => el.addEventListener("input", e => {
    const idx = Number(e.target.dataset.idx);
    ingredientTarget(context)[idx].amount = num(e.target.value);
  }));
  $$(".frac-btn", host).forEach(btn => btn.addEventListener("click", () => {
    const idx = Number(btn.dataset.idx);
    const frac = Number(btn.dataset.frac);
    const target = ingredientTarget(context);
    const current = Number(target[idx].amount || 0);
    target[idx].amount = Math.floor(Math.max(0, current)) + frac;
    if(context === "lab") renderLabIngredients();
    else if(context === "edit") renderRecipeEditor();
    else renderImportReview();
  }));
  $$(".unit-btn", host).forEach(btn => btn.addEventListener("click", () => openUnitPicker(context, Number(btn.dataset.idx))));
}
function openUnitPicker(context, idx){
  unitPickerTarget = {context, idx};
  $("#sheetHost").innerHTML = `
    <div class="sheet-backdrop" id="sheetBackdrop">
      <div class="sheet">
        <div class="sheet-head">
          <div><strong>Select unit</strong><div class="small">Tap a unit to use it.</div></div>
          <button class="ghost small" id="closeSheet">Close</button>
        </div>
        ${Object.entries(UNIT_GROUPS).map(([group, units]) => `
          <div class="group-title">${esc(group)}</div>
          <div class="unit-grid">
            ${units.map(u => `<button type="button" class="pick-unit" data-unit="${esc(u)}">${esc(u)}</button>`).join("")}
          </div>
        `).join("")}
        <div class="group-title">Other</div>
        <button class="ghost" type="button" id="customUnitBtn">Custom / legacy unit</button>
      </div>
    </div>
  `;
  $("#closeSheet").addEventListener("click", closeUnitPicker);
  $("#sheetBackdrop").addEventListener("click", e => { if(e.target.id === "sheetBackdrop") closeUnitPicker(); });
  $$(".pick-unit").forEach(btn => btn.addEventListener("click", () => setPickedUnit(btn.dataset.unit)));
  $("#customUnitBtn").addEventListener("click", () => {
    const u = prompt("Enter the custom unit exactly as you want it shown:");
    if(u?.trim()) setPickedUnit(u.trim());
  });
}
function closeUnitPicker(){
  $("#sheetHost").innerHTML = "";
  unitPickerTarget = null;
}
function setPickedUnit(unit){
  const {context, idx} = unitPickerTarget;
  const target = ingredientTarget(context);
  target[idx].unit = unit;
  closeUnitPicker();
  if(context === "lab") renderLabIngredients();
  else if(context === "edit") renderRecipeEditor();
  else renderImportReview();
}
function saveLabTest(){
  syncLabFields();
  const r = getRecipe();
  r.tests ||= [];
  const test = { id:uid("test"), number:r.tests.length+1, createdAt:new Date().toISOString(), baseOfficialVersion:r.officialVersion, ...clone(labDraft) };
  r.tests.push(test);
  saveState();
  toast("Test saved");
  labDraft = null;
  renderAll();
}
function promoteLabTest(){
  syncLabFields();
  const r = getRecipe();
  if(!confirm("Make this test the new official recipe?")) return;
  r.tests ||= [];
  const test = { id:uid("test"), number:r.tests.length+1, createdAt:new Date().toISOString(), baseOfficialVersion:r.officialVersion, ...clone(labDraft), decision:"winner", promoted:true };
  r.tests.push(test);
  r.ingredients = labDraft.ingredients.map(i => ({id:i.id, name:i.name, amount:Math.round((Number(i.amount)/labDraft.scale)*1000)/1000, unit:i.unit}));
  r.officialVersion += 1;
  saveState();
  toast("New official recipe saved");
  labDraft = null;
  renderAll();
}
function renderLabHistory(){
  const host = $("#labHistory");
  const tests = [...(getRecipe().tests || [])].reverse();
  if(!tests.length){
    host.innerHTML = `<div class="empty">No tests yet.</div>`;
    return;
  }
  host.innerHTML = tests.map(t => `
    <div class="test-card">
      <div class="section-head" style="margin-bottom:4px">
        <div><strong>Test #${t.number}: ${esc(t.title || "Untitled test")}</strong><div class="small">${new Date(t.createdAt).toLocaleString()} · based on v${t.baseOfficialVersion}</div></div>
        <span class="badge">${esc(t.promoted ? "Promoted" : (t.decision || "Saved"))}</span>
      </div>
      ${t.ratings?.overall != null ? `<div><strong>Overall:</strong> ${t.ratings.overall}/5</div>` : ""}
      ${t.resultNotes ? `<div style="margin-top:7px"><strong>Result:</strong> ${esc(t.resultNotes)}</div>` : ""}
      ${t.nextTime ? `<div class="note" style="margin-top:10px"><strong>Next time:</strong> ${esc(t.nextTime)}</div>` : ""}
    </div>
  `).join("");
}

function renderImport(){
  const host = $("#view-import");
  if(!importDraft){
    host.innerHTML = `
      <div class="grid two">
        <div class="card">
          <div class="section-head">
            <div><h2>Import Recipe</h2><div class="subtle">Paste a recipe and let the app separate the title, yield, ingredients, and process.</div></div>
            <span class="badge">Paste & Parse</span>
          </div>
          <div class="field">
            <label>Recipe text</label>
            <textarea id="pasteRecipe" style="min-height:320px" placeholder="Chocolate Chip Cookies&#10;Yield: 24 cookies&#10;&#10;Ingredients&#10;2 cups flour&#10;1 cup sugar&#10;2 eggs&#10;&#10;Directions&#10;Mix everything together.&#10;Bake at 350°F for 12 minutes."></textarea>
          </div>
          <button class="primary" id="parseRecipeBtn">Parse Recipe</button>
        </div>
        <div class="card">
          <h3>What the importer looks for</h3>
          <div class="note" style="margin-top:12px">
            <div><strong>Title</strong> — usually the first line</div>
            <div style="margin-top:7px"><strong>Yield</strong> — “Yield: 24”, “Makes 2 dozen”, “Serves 8”</div>
            <div style="margin-top:7px"><strong>Ingredients</strong> — quantity + unit + ingredient name</div>
            <div style="margin-top:7px"><strong>Process</strong> — directions, method, or preparation steps</div>
          </div>
          <div class="footer-note">Anything unclear is flagged for review instead of being silently guessed.</div>
        </div>
      </div>
    `;
    $("#parseRecipeBtn").addEventListener("click", () => {
      const text = $("#pasteRecipe").value.trim();
      if(!text){ toast("Paste a recipe first"); return; }
      importDraft = parseRecipeText(text);
      renderImport();
    });
  } else {
    renderImportReview();
  }
}
function renderImportReview(){
  const host = $("#view-import");
  host.innerHTML = `
    <div class="card">
      <div class="section-head">
        <div><h2>Review Imported Recipe</h2><div class="subtle">Fix anything that was parsed incorrectly before saving.</div></div>
        <span class="badge">${importDraft.ambiguous.length} flagged</span>
      </div>

      <div class="grid two">
        <div class="field"><label>Recipe name</label><input id="impName" value="${esc(importDraft.name)}"></div>
        <div class="field"><label>Category</label><input id="impCategory" value="${esc(importDraft.category)}" placeholder="Bakery, Sauce, Prep, etc."></div>
      </div>

      <div class="field"><label>Yield / batch size</label><input id="impYield" value="${esc(importDraft.yieldText)}" placeholder="Example: 24 cookies"></div>

      <div class="section-head" style="margin-top:8px">
        <div><h3>Ingredients</h3></div>
        <button class="small" id="addImpIng">+ Ingredient</button>
      </div>
      <div id="impIngredients"></div>

      <div class="section-head" style="margin-top:8px">
        <div><h3>Process</h3></div>
        <button class="small" id="addImpStep">+ Step</button>
      </div>
      <div id="impSteps"></div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px">
        <button class="primary" id="saveImported">Save as Base Recipe</button>
        <button class="ghost" id="cancelImport">Start Over</button>
      </div>
    </div>
  `;
  $("#impName").addEventListener("input", e => importDraft.name = e.target.value);
  $("#impCategory").addEventListener("input", e => importDraft.category = e.target.value);
  $("#impYield").addEventListener("input", e => importDraft.yieldText = e.target.value);
  $("#addImpIng").addEventListener("click", () => { importDraft.ingredients.push({id:uid("ing"), amount:null, unit:"", name:"", flagged:true, flagReason:"New ingredient"}); renderImportReview(); });
  $("#addImpStep").addEventListener("click", () => { importDraft.steps.push({id:uid("step"), text:"", videoUrl:""}); renderImportReview(); });
  $("#saveImported").addEventListener("click", saveImportedRecipe);
  $("#cancelImport").addEventListener("click", () => { importDraft = null; renderImport(); });

  renderImportIngredients();
  renderImportSteps();
}
function renderImportIngredients(){
  const host = $("#impIngredients");
  if(!importDraft.ingredients.length){
    host.innerHTML = `<div class="empty">No ingredients detected. Add them manually.</div>`;
    return;
  }
  host.innerHTML = importDraft.ingredients.map((i, idx) => `
    <div class="ingredient-row ${i.flagged ? "flagged" : ""}">
      <div class="namecell">
        <label>Ingredient</label>
        <input class="imp-name" data-idx="${idx}" value="${esc(i.name)}" placeholder="Ingredient name">
        ${i.flagged ? `<div class="small" style="color:#b56c24;margin-top:5px">${esc(i.flagReason || "Needs review")}</div>` : ""}
      </div>
      <div><label>Amount</label>${renderAmountControls("import", i, idx)}</div>
      <div><label>Unit</label><button type="button" class="unit-btn" data-context="import" data-idx="${idx}">${esc(i.unit || "Select")}</button></div>
    </div>
  `).join("");
  bindIngredientEditors("import", host);
  $$(".imp-name", host).forEach(el => el.addEventListener("input", e => {
    const idx = Number(e.target.dataset.idx);
    importDraft.ingredients[idx].name = e.target.value;
    importDraft.ingredients[idx].flagged = false;
  }));
}
function renderImportSteps(){
  const host = $("#impSteps");
  if(!importDraft.steps.length){
    host.innerHTML = `<div class="empty">No process steps detected. Add them manually.</div>`;
    return;
  }
  host.innerHTML = importDraft.steps.map((s, idx) => `
    <div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px">
      <div class="chip">${idx+1}</div>
      <textarea class="imp-step" data-idx="${idx}" style="flex:1;min-width:180px">${esc(s.text)}</textarea>
      <button class="ghost small remove-step" data-idx="${idx}">Remove</button>
    </div>
  `).join("");
  $$(".imp-step", host).forEach(el => el.addEventListener("input", e => importDraft.steps[Number(e.target.dataset.idx)].text = e.target.value));
  $$(".remove-step", host).forEach(btn => btn.addEventListener("click", () => { importDraft.steps.splice(Number(btn.dataset.idx), 1); renderImportReview(); }));
}
function saveImportedRecipe(){
  const name = importDraft.name.trim();
  if(!name){ toast("Recipe name is required"); return; }
  const ingredients = importDraft.ingredients.filter(i => i.name.trim()).map(i => ({
    id:i.id || uid("ing"),
    amount:Number(i.amount || 0),
    unit:i.unit || "each",
    name:i.name.trim()
  }));
  if(!ingredients.length){ toast("Add at least one ingredient"); return; }
  const recipe = {
    id:uid("recipe"),
    name,
    category:importDraft.category.trim() || "Recipe",
    icon: guessRecipeIcon(name, importDraft.category),
    yield:{text:importDraft.yieldText.trim() || "Yield not set"},
    officialVersion:1,
    ingredients,
    steps:importDraft.steps.filter(s => s.text.trim()).map(s => ({id:s.id || uid("step"), text:s.text.trim(), videoUrl:s.videoUrl || ""})),
    tests:[]
  };
  state.recipes.push(recipe);
  selectedRecipeId = recipe.id;
  saveState();
  importDraft = null;
  toast("Recipe saved");
  renderAll();
  showView("library");
}
function guessRecipeIcon(name, category){
  const text = (name + " " + (category || "")).toLowerCase();
  if(text.includes("cookie") || text.includes("dessert")) return "🍪";
  if(text.includes("salsa") || text.includes("sauce")) return "🌶️";
  if(text.includes("chicken")) return "🍗";
  if(text.includes("beef") || text.includes("steak")) return "🥩";
  if(text.includes("rice")) return "🍚";
  if(text.includes("drink")) return "🥤";
  return "🍽️";
}
function parseRecipeText(text){
  const lines = text.replace(/\r/g,"").split("\n").map(l => l.trim()).filter(Boolean);
  let title = "", yieldText = "", mode = "unknown";
  const ingredients = [], steps = [], ambiguous = [];
  const heading = s => s.toLowerCase().replace(/[:\-]/g,"").trim();
  const isIngHead = s => ["ingredients","ingredient"].includes(heading(s));
  const isStepHead = s => ["directions","direction","instructions","instruction","method","process","preparation","steps"].includes(heading(s));
  const yieldRe = /^(yield|makes|serves|batch(?: size)?)\s*:?\s*(.+)$/i;

  for(let i=0;i<lines.length;i++){
    const line = lines[i];
    if(!title && !isIngHead(line) && !isStepHead(line) && !yieldRe.test(line) && !looksLikeIngredient(line)){
      title = line;
      continue;
    }
    const ym = line.match(yieldRe);
    if(ym){ yieldText = ym[2].trim(); continue; }
    if(isIngHead(line)){ mode = "ingredients"; continue; }
    if(isStepHead(line)){ mode = "steps"; continue; }
    if(mode === "unknown" && looksLikeIngredient(line)) mode = "ingredients";
    if(mode === "ingredients"){
      if(/^\d+[\.\)]\s+/.test(line) && !looksLikeIngredient(line)){ mode = "steps"; }
      else {
        const p = parseIngredientLine(line);
        ingredients.push({...p, id:uid("ing")});
        if(p.flagged) ambiguous.push(line);
        continue;
      }
    }
    if(mode === "steps"){
      steps.push({id:uid("step"), text:line.replace(/^\d+[\.\)]\s*/,""), videoUrl:""});
      continue;
    }
    if(!title) title = line;
    else steps.push({id:uid("step"), text:line, videoUrl:""});
  }

  if(!title) title = "Imported Recipe";
  if(!ingredients.length){
    lines.forEach(line => {
      if(looksLikeIngredient(line)){
        const p = parseIngredientLine(line);
        ingredients.push({...p, id:uid("ing")});
      }
    });
  }
  return {name:title, category:"", yieldText, ingredients, steps, ambiguous};
}
function looksLikeIngredient(line){
  return /^(\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|[¼⅓½⅔¾⅛⅜⅝⅞])\s+/.test(line.trim());
}
function quantityToDecimal(token, maybeFrac){
  const parseOne = t => {
    if(UNICODE_FRACTIONS[t] != null) return UNICODE_FRACTIONS[t];
    if(/^\d+\/\d+$/.test(t)){
      const [a,b] = t.split("/").map(Number);
      return b ? a/b : 0;
    }
    return Number(t);
  };
  let total = parseOne(token);
  if(maybeFrac && /^\d+\/\d+$/.test(maybeFrac)) total += parseOne(maybeFrac);
  return total;
}
function parseIngredientLine(line){
  const clean = line.replace(/^[-•*]\s*/,"").trim();
  const m = clean.match(/^(\d+(?:\.\d+)?|\d+\/\d+|[¼⅓½⅔¾⅛⅜⅝⅞])(?:\s+(\d+\/\d+))?\s+(.+)$/);
  if(!m) return {amount:null, unit:"", name:clean, flagged:true, flagReason:"No clear quantity"};
  const amount = quantityToDecimal(m[1], m[2]);
  let rest = m[3].trim();
  let unit = "", name = rest, flagged = false, flagReason = "";
  const aliasKeys = Object.keys(UNIT_ALIASES).sort((a,b) => b.length - a.length);
  const lower = rest.toLowerCase();
  const matchUnit = aliasKeys.find(k => lower === k || lower.startsWith(k + " "));
  if(matchUnit){
    unit = UNIT_ALIASES[matchUnit];
    name = rest.slice(matchUnit.length).trim().replace(/^of\s+/i,"");
  } else {
    unit = "each";
    name = rest;
    flagged = true;
    flagReason = "Unit assumed as each";
  }
  if(!name){
    name = rest;
    flagged = true;
    flagReason = "Ingredient name needs review";
  }
  return {amount, unit, name, flagged, flagReason};
}

function renderData(){
  const host = $("#view-data");
  host.innerHTML = `
    <div class="grid two">
      <div class="card">
        <div class="section-head">
          <div><h2>Backup & Transfer</h2><div class="subtle">Keep your recipe data portable between phones.</div></div>
          <span class="badge">JSON</span>
        </div>
        <button class="primary" id="exportJsonBtn">Export JSON</button>
        <button class="ghost" id="importJsonBtn" style="margin-top:10px">Import JSON</button>
        <div class="footer-note">Use this if you want to move test data between your Android and your daughter’s iPhone.</div>
      </div>

      <div class="card">
        <div class="section-head">
          <div><h2>Home-screen App</h2><div class="subtle">This build includes home-screen support for iPhone and Android.</div></div>
          <span class="badge">PWA Ready</span>
        </div>
        <div class="note">
          <strong>iPhone:</strong> Open in Safari → Share → Add to Home Screen.<br><br>
          <strong>Android:</strong> Open in Chrome → menu → Add to Home screen / Install app.
        </div>
        <div class="footer-note">Uploaded to GitHub Pages, this build uses a manifest, app icons, theme color, and a service worker.</div>
      </div>
    </div>
  `;
  $("#exportJsonBtn").addEventListener("click", exportJson);
  $("#importJsonBtn").addEventListener("click", () => $("#jsonImportFile").click());
}
function exportJson(){
  const blob = new Blob([JSON.stringify(state, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "recipe-app-backup.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 800);
}
function importJsonFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const parsed = JSON.parse(reader.result);
      if(!Array.isArray(parsed.recipes)) throw new Error();
      state = parsed;
      selectedRecipeId = state.recipes[0]?.id || null;
      labDraft = null;
      importDraft = null;
      saveState();
      renderAll();
      toast("JSON imported");
    }catch(e){
      alert("That is not a valid Kitchen Pro JSON file.");
    }
  };
  reader.readAsText(file);
}

init();
})();
