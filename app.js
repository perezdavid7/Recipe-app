(() => {
"use strict";

const BUILD_VERSION = "2.9.3";
const BUILD_NAME = "Recipe Search + Smart Timers";
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

let state = {appVersion:BUILD_VERSION, buildName:BUILD_NAME, recipes:[], productionSessions:{}};
let activeView = "library";
let selectedRecipeId = null;
let labDraft = null;
let importDraft = null;
let unitPickerTarget = null;
let libraryScreen = "list";
let libraryRecipeId = null;
let editDraft = null;
let librarySearchQuery = "";
let productionSearchQuery = "";
let labSearchQuery = "";
let productionTimerTickId = null;
let timerAudioCtx = null;

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

function guessTimerMinutes(text){
  const raw = String(text || "").toLowerCase().replace(/,/g,".");
  // Ranges are intentionally not guessed: "3-6 hours", "3 a 6 horas", "3 to 6 hours".
  if(/\b\d+(?:\.\d+)?\s*(?:-|–|—|\ba\b|\bto\b|\bha\b)\s*\d+(?:\.\d+)?\s*(?:hours?|hrs?|hr|horas?|hora|min(?:utes?)?|mins?|mnts?|minutos?|minuto|seconds?|secs?|sec|segundos?|segundo)\b/i.test(raw)){
    return null;
  }

  let total = 0;
  let found = false;

  const halfHour = raw.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|horas?|hora)\s*(?:and|y)\s*(?:a\s*)?(?:half|media)\b/);
  if(halfHour){
    total += Number(halfHour[1]) * 60 + 30;
    found = true;
  }

  // Also understand "una hora y media" / "one hour and a half".
  if(!halfHour && /\b(?:una?|one|an)\s+(?:hora|hour)\s*(?:and|y)\s*(?:a\s*)?(?:half|media)\b/.test(raw)){
    total += 90;
    found = true;
  }

  const cleaned = raw
    .replace(/\b\d+(?:\.\d+)?\s*(?:hours?|hrs?|hr|horas?|hora)\s*(?:and|y)\s*(?:a\s*)?(?:half|media)\b/g," ")
    .replace(/\b(?:una?|one|an)\s+(?:hora|hour)\s*(?:and|y)\s*(?:a\s*)?(?:half|media)\b/g," ");

  const patterns = [
    {re:/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|hr|horas?|hora)\b/g, mult:60},
    {re:/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|mnts?|minutos?|minuto|min)\b/g, mult:1},
    {re:/(\d+(?:\.\d+)?)\s*(?:seconds?|secs?|segundos?|segundo|sec)\b/g, mult:1/60}
  ];
  for(const {re,mult} of patterns){
    let m;
    while((m = re.exec(cleaned))){
      total += Number(m[1]) * mult;
      found = true;
    }
  }

  return found && total > 0 ? Math.round(total * 100) / 100 : null;
}
function isTimedStep(step){
  if(step?.timedStep === false) return false;
  const mins = Number(step?.timerMinutes);
  return (step?.timedStep === true && Number.isFinite(mins) && mins > 0) ||
         (step?.timedStep == null && Number.isFinite(mins) && mins > 0);
}
function normalizeTimerStep(step){
  if(!step || typeof step !== "object") return step;
  if(step.timedStep === false){
    step.timerMinutes = null;
    return step;
  }
  const existing = Number(step.timerMinutes);
  if(Number.isFinite(existing) && existing > 0){
    step.timedStep = true;
    step.timerMinutes = Math.round(existing * 100) / 100;
    return step;
  }
  if(step.timedStep === true){
    const guessed = guessTimerMinutes(step.text);
    step.timerMinutes = guessed || 5;
    return step;
  }
  const guessed = guessTimerMinutes(step.text);
  if(guessed){
    step.timedStep = true;
    step.timerMinutes = guessed;
  }else{
    step.timedStep = false;
    step.timerMinutes = null;
  }
  return step;
}
function normalizeState(){
  state ||= {appVersion:BUILD_VERSION,buildName:BUILD_NAME,recipes:[],productionSessions:{}};
  state.recipes ||= [];
  state.productionSessions ||= {};
  state.appVersion = BUILD_VERSION;
  state.buildName = BUILD_NAME;
  state.recipes.forEach(recipe => {
    recipe.ingredients ||= [];
    recipe.steps ||= [];
    recipe.tests ||= [];
    recipe.steps.forEach(normalizeTimerStep);
  });
}
function stepKey(step,idx){ return String(step?.id || `step-${idx}`); }
function ingredientKey(ingredient,idx){ return String(ingredient?.id || `ingredient-${idx}`); }
function newProductionSession(recipe, scale=1){
  return {
    batchId:uid("batch"),
    recipeVersion:Number(recipe?.officialVersion || 1),
    scale:Number(scale) || 1,
    ingredientChecks:{},
    stepChecks:{},
    timers:{},
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
}
function getProductionSession(recipeId=selectedRecipeId){
  normalizeState();
  const recipe = getRecipe(recipeId);
  if(!recipe) return null;
  let session = state.productionSessions[recipeId];
  if(!session || typeof session !== "object" || Number(session.recipeVersion) !== Number(recipe.officialVersion || 1)){
    const scale = Number(session?.scale || 1);
    session = newProductionSession(recipe, scale);
    state.productionSessions[recipeId] = session;
    saveState();
  }
  session.ingredientChecks ||= {};
  session.stepChecks ||= {};
  session.timers ||= {};
  if(!Number.isFinite(Number(session.scale))) session.scale = 1;
  return session;
}
function saveProductionSession(session){
  if(!session || !selectedRecipeId) return;
  session.updatedAt = new Date().toISOString();
  state.productionSessions[selectedRecipeId] = session;
  saveState();
}
function formatTimerDuration(ms){
  const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`;
}
function timerDisplayText(timer){
  const diff = Number(timer?.endAt || 0) - Date.now();
  return diff > 0 ? `⏱ ${formatTimerDuration(diff)} remaining` : `⚠ ${formatTimerDuration(Math.abs(diff))} overdue`;
}
function armTimerAudio(){
  try{
    if(!timerAudioCtx && (window.AudioContext || window.webkitAudioContext)){
      const Ctx = window.AudioContext || window.webkitAudioContext;
      timerAudioCtx = new Ctx();
    }
    timerAudioCtx?.resume?.().catch(()=>{});
  }catch(e){}
}
function playTimerAlert(){
  try{
    if(timerAudioCtx){
      const osc = timerAudioCtx.createOscillator();
      const gain = timerAudioCtx.createGain();
      osc.connect(gain); gain.connect(timerAudioCtx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(.0001,timerAudioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(.16,timerAudioCtx.currentTime+.02);
      gain.gain.exponentialRampToValueAtTime(.0001,timerAudioCtx.currentTime+.6);
      osc.start(); osc.stop(timerAudioCtx.currentTime+.65);
    }
  }catch(e){}
  try{ navigator.vibrate?.([250,120,250]); }catch(e){}
}
function notifyTimerComplete(timer){
  playTimerAlert();
  try{
    if("Notification" in window && Notification.permission === "granted"){
      new Notification("Kitchen Pro timer", {body:`Step ${timer.stepNumber}: ${timer.label}`});
    }
  }catch(e){}
}
async function enableTimerAlerts(){
  armTimerAudio();
  if(!("Notification" in window)){
    toast("Sound/vibration alerts are enabled when supported");
    return;
  }
  if(Notification.permission === "granted"){
    toast("Timer alerts are enabled");
    return;
  }
  if(Notification.permission === "denied"){
    toast("Notifications are blocked in browser settings");
    return;
  }
  try{
    const permission = await Notification.requestPermission();
    toast(permission === "granted" ? "Timer alerts enabled" : "Timer notifications not enabled");
  }catch(e){
    toast("Could not enable notifications");
  }
}
function startStepTimer(key, manual=false){
  const r = getRecipe(), session = getProductionSession();
  if(!r || !session) return;
  const idx = r.steps.findIndex((s,i)=>stepKey(s,i)===key);
  if(idx < 0) return;
  const step = r.steps[idx];
  const mins = Number(step?.timerMinutes);
  if(!isTimedStep(step) || !Number.isFinite(mins) || mins <= 0){
    toast("This step does not have a timer configured");
    return;
  }
  const now = Date.now();
  session.timers[key] = {
    stepId:key,
    stepNumber:idx+1,
    label:step.text || "Recipe step",
    durationMinutes:mins,
    startedAt:now,
    endAt:now + mins*60000,
    notified:false
  };
  saveProductionSession(session);
  armTimerAudio();
  if(activeView === "production"){
    renderProdChecklist();
    tickProductionTimers(false);
  }
  if(manual) toast(`Timer started for ${fmt(mins)} min`);
}
function addTimerMinutes(key, mins){
  const session = getProductionSession();
  const timer = session?.timers?.[key];
  if(!timer) return;
  timer.endAt = Number(timer.endAt) + Number(mins)*60000;
  timer.notified = false;
  saveProductionSession(session);
  if(activeView === "production"){
    renderProdChecklist();
    tickProductionTimers(false);
  }
}
function dismissStepTimer(key){
  const session = getProductionSession();
  if(!session?.timers?.[key]) return;
  delete session.timers[key];
  saveProductionSession(session);
  if(activeView === "production") renderProdChecklist();
}
function resetProductionBatch(){
  const r = getRecipe(), current = getProductionSession();
  if(!r || !current) return;
  const hasProgress = Object.values(current.ingredientChecks||{}).some(Boolean) ||
    Object.values(current.stepChecks||{}).some(Boolean) ||
    Object.keys(current.timers||{}).length;
  if(hasProgress && !confirm("Start a new batch? This clears the saved checks and active timers for this recipe.")) return;
  state.productionSessions[r.id] = newProductionSession(r,current.scale||1);
  saveState();
  renderProduction();
  toast("New production batch started");
}
function updateActiveTimerSummary(){
  const host = $("#activeTimerSummary");
  const session = getProductionSession();
  if(!host || !session) return;
  const entries = Object.entries(session.timers || {}).sort((a,b)=>Number(a[1].endAt)-Number(b[1].endAt));
  if(!entries.length){
    host.innerHTML = "";
    host.style.display = "none";
    return;
  }
  host.style.display = "block";
  const [key,timer] = entries[0];
  const overdue = Number(timer.endAt) <= Date.now();
  host.innerHTML = `
    <div style="border:1px solid ${overdue?"#e2bbbb":"#ead6b8"};background:${overdue?"#fff1f1":"#fff8ec"};border-radius:13px;padding:10px 12px;margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap">
        <div style="min-width:0">
          <div class="small">Active timer · Step ${esc(timer.stepNumber)}</div>
          <div style="font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(timer.label)}</div>
        </div>
        <div style="font-weight:900;font-variant-numeric:tabular-nums" data-active-timer-display="${esc(key)}">${esc(timerDisplayText(timer))}</div>
      </div>
    </div>`;
}
function tickProductionTimers(checkAlerts=true){
  normalizeState();
  const now = Date.now();
  let changed = false;
  for(const session of Object.values(state.productionSessions || {})){
    for(const timer of Object.values(session?.timers || {})){
      if(Number(timer.endAt) <= now && !timer.notified && checkAlerts){
        timer.notified = true;
        changed = true;
        notifyTimerComplete(timer);
      }
    }
  }
  if(changed) saveState();

  $$("[data-timer-display]").forEach(el => {
    const session = getProductionSession();
    const timer = session?.timers?.[el.dataset.timerDisplay];
    if(timer) el.textContent = timerDisplayText(timer);
  });
  $$("[data-active-timer-display]").forEach(el => {
    const session = getProductionSession();
    const timer = session?.timers?.[el.dataset.activeTimerDisplay];
    if(timer) el.textContent = timerDisplayText(timer);
  });
  if(activeView === "production") updateActiveTimerSummary();
}
function startProductionTimerTicker(){
  if(productionTimerTickId) clearInterval(productionTimerTickId);
  productionTimerTickId = setInterval(()=>tickProductionTimers(true),1000);
}

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
  merged.productionSessions = clone(current?.productionSessions || {});
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
    try{ state = await loadSeed(); }
    catch(e){
      state = {appVersion:BUILD_VERSION, buildName:BUILD_NAME, recipes:[], productionSessions:{}};
      toast("Could not load starter recipes. Try refreshing.");
    }
  }
  normalizeState();
  saveState();
  selectedRecipeId = state.recipes[0]?.id || null;
  bindBaseEvents();
  renderAll();
  startProductionTimerTicker();
  document.addEventListener("visibilitychange",()=>{ if(!document.hidden) tickProductionTimers(true); });
  window.addEventListener("focus",()=>tickProductionTimers(true));
  window.addEventListener("pageshow",()=>tickProductionTimers(true));
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./sw.js?v=293", {updateViaCache:"none"}).then(reg => reg.update()).catch(() => {});
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
function normalizeRecipeSearch(value){
  return String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase().trim();
}

function recipeMatchesQuery(recipe,query){
  const q=normalizeRecipeSearch(query);
  if(!q)return true;
  const text=normalizeRecipeSearch([recipe.name,recipe.category,recipe.yield?.text,...(recipe.ingredients||[]).map(i=>i.name),...(Array.isArray(recipe.tags)?recipe.tags:[])].join(" "));
  return q.split(/\s+/).filter(Boolean).every(term=>text.includes(term));
}

function updateLibraryRecipeSearch(){
  const input=$("#recipeSearchInput");
  if(!input)return;
  librarySearchQuery=input.value;
  let shown=0;
  $$(".recipe-open-card",$("#view-library")).forEach(card=>{
    const recipe=getRecipe(card.dataset.id);
    const match=!!recipe&&recipeMatchesQuery(recipe,librarySearchQuery);
    card.hidden=!match;
    if(match)shown++;
  });
  $("#clearRecipeSearch").hidden=!librarySearchQuery.length;
  $("#recipeSearchCount").textContent=librarySearchQuery.trim()?`${shown} of ${state.recipes.length} recipes`:`${state.recipes.length} recipes`;
  $("#recipeSearchNoResults").hidden=shown!==0;
}

function updateProductionRecipeSearch(){
  const input=$("#prodRecipeSearch"),host=$("#prodRecipeMatches");
  if(!input||!host)return;
  productionSearchQuery=input.value;
  $("#clearProdRecipeSearch").hidden=!productionSearchQuery.length;
  const query=productionSearchQuery.trim();
  if(!query){host.innerHTML="";return;}
  const matches=state.recipes.filter(recipe=>recipeMatchesQuery(recipe,query));
  if(!matches.length){host.innerHTML=`<div class="empty recipe-search-empty">No recipes found. Try another keyword.</div>`;return;}
  const results=matches.slice(0,12);
  host.innerHTML=`
    <div class="small">${matches.length} matching recipe${matches.length===1?"":"s"}</div>
    ${results.map(recipe=>`
      <button type="button" class="production-recipe-match" data-id="${esc(recipe.id)}" ${recipe.id===selectedRecipeId?'aria-current="true"':""}>
        <span class="production-recipe-icon" aria-hidden="true">${esc(recipe.icon||"🍽️")}</span>
        <span><strong>${esc(recipe.name)}</strong><span class="small">${esc(recipe.category||"Recipe")}${recipe.id===selectedRecipeId?" · Current recipe":""}</span></span>
      </button>
    `).join("")}
    ${matches.length>results.length?`<div class="small">Showing the first ${results.length} results. Enter more keywords to narrow your search.</div>`:""}
  `;
}

function updateLabRecipeSearch(){
  const input=$("#labRecipeSearch"),host=$("#labRecipeMatches");
  if(!input||!host)return;
  labSearchQuery=input.value;
  $("#clearLabRecipeSearch").hidden=!labSearchQuery.length;
  const query=labSearchQuery.trim();
  if(!query){host.innerHTML="";return;}
  const matches=state.recipes.filter(recipe=>recipeMatchesQuery(recipe,query));
  if(!matches.length){
    host.innerHTML=`<div class="empty recipe-search-empty">No recipes found. Try another keyword.</div>`;
    return;
  }
  const results=matches.slice(0,12);
  host.innerHTML=`
    <div class="small">${matches.length} matching recipe${matches.length===1?"":"s"}</div>
    ${results.map(recipe=>`
      <button type="button" class="production-recipe-match lab-recipe-match" data-id="${esc(recipe.id)}" ${recipe.id===selectedRecipeId?'aria-current="true"':""}>
        <span class="production-recipe-icon" aria-hidden="true">${esc(recipe.icon||"🍽️")}</span>
        <span><strong>${esc(recipe.name)}</strong><span class="small">${esc(recipe.category||"Recipe")}${recipe.id===selectedRecipeId?" · Current recipe":""}</span></span>
      </button>
    `).join("")}
  `;
}

function bindRecipeSearchViewport(input){
  if(!input)return;
  const bringIntoView=()=>{
    const field=input.closest(".recipe-search-field");
    if(!field)return;
    field.scrollIntoView({behavior:"smooth",block:"start"});
  };
  input.addEventListener("focus",()=>{
    document.body.classList.add("recipe-search-active");
    requestAnimationFrame(bringIntoView);
    setTimeout(bringIntoView,180);
    setTimeout(bringIntoView,420);
  });
  input.addEventListener("blur",()=>{
    setTimeout(()=>{
      const active=document.activeElement;
      if(!active?.closest?.(".recipe-search-field")){
        document.body.classList.remove("recipe-search-active");
      }
    },180);
  });
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

      <div class="recipe-search-field" role="search" aria-label="Find a recipe">
        <label for="recipeSearchInput">Find a recipe</label>
        <div class="recipe-search-control">
          <span class="recipe-search-icon" aria-hidden="true">🔎</span>
          <input type="search" id="recipeSearchInput" value="${esc(librarySearchQuery)}" placeholder="Name, category, or ingredient" autocomplete="off" aria-label="Search recipes by name, category, or ingredient">
          <button type="button" id="clearRecipeSearch" class="recipe-search-clear" aria-label="Clear recipe search" hidden>✕</button>
        </div>
        <div id="recipeSearchCount" class="small recipe-search-count" role="status" aria-live="polite"></div>
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

      <div id="recipeSearchNoResults" class="empty recipe-search-empty" hidden>No recipes found. Try another keyword.</div>

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

  bindRecipeSearchViewport($("#recipeSearchInput"));
  $("#recipeSearchInput").addEventListener("input", updateLibraryRecipeSearch);
  $("#clearRecipeSearch").addEventListener("click", () => {
    $("#recipeSearchInput").value = "";
    updateLibraryRecipeSearch();
    $("#recipeSearchInput").focus();
  });
  updateLibraryRecipeSearch();
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
        <button class="ghost" id="overviewEditRecipe">✏️ Edit Recipe</button>
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
                <div>${esc(s.text)}${isTimedStep(s)?`<div class="small" style="margin-top:5px;font-weight:850">⏱ ${esc(fmt(s.timerMinutes))} min timer</div>`:""}</div>
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
  $("#overviewEditRecipe").addEventListener("click", ()=>{
    startRecipeEdit(r.id);
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
  if(state.productionSessions) delete state.productionSessions[id];
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
    editDraft.steps.push({id:uid("step"),text:"",videoUrl:"",timedStep:false,timerMinutes:null});
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
  host.innerHTML = editDraft.steps.map((s,idx)=>{
    normalizeTimerStep(s);
    const timed = isTimedStep(s);
    return `
      <div class="edit-step-row" style="align-items:flex-start">
        <div class="step-bubble">${idx+1}</div>
        <div style="flex:1;min-width:0">
          <textarea class="edit-step-text" data-idx="${idx}">${esc(s.text)}</textarea>
          <div style="margin-top:9px;padding:10px;border:1px dashed rgba(31,79,61,.25);border-radius:12px;background:rgba(31,79,61,.035)">
            <label style="display:flex;align-items:center;gap:8px;margin:0;font-weight:850">
              <input type="checkbox" class="edit-step-timed" data-idx="${idx}" ${timed?"checked":""} style="width:20px;height:20px;min-height:20px">
              Timed step
            </label>
            <div class="edit-timer-controls ${timed?"":"hidden"}" data-edit-timer-controls="${idx}" style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:8px">
              <button type="button" class="ghost small edit-timer-adjust" data-idx="${idx}" data-delta="-5">−5</button>
              <button type="button" class="ghost small edit-timer-adjust" data-idx="${idx}" data-delta="-1">−1</button>
              <input class="edit-timer-minutes" data-idx="${idx}" inputmode="decimal" type="number" min="0.1" step="0.5" value="${timed?esc(fmt(s.timerMinutes)):""}" style="width:92px" aria-label="Timer minutes">
              <span class="small">minutes</span>
              <button type="button" class="ghost small edit-timer-adjust" data-idx="${idx}" data-delta="1">+1</button>
              <button type="button" class="ghost small edit-timer-adjust" data-idx="${idx}" data-delta="5">+5</button>
            </div>
            <div class="small" style="margin-top:5px">In Production, checking a timed step automatically starts this timer.</div>
          </div>
        </div>
        <button class="ghost small remove-edit-step" data-idx="${idx}">Remove</button>
      </div>`;
  }).join("");

  $$(".edit-step-text",host).forEach(el=>el.addEventListener("input",e=>{
    editDraft.steps[Number(e.target.dataset.idx)].text=e.target.value;
  }));
  $$(".edit-step-timed",host).forEach(el=>el.addEventListener("change",e=>{
    const idx=Number(e.target.dataset.idx), step=editDraft.steps[idx];
    if(e.target.checked){
      step.timedStep=true;
      step.timerMinutes=Number(step.timerMinutes)>0?Number(step.timerMinutes):(guessTimerMinutes(step.text)||5);
    }else{
      step.timedStep=false;
      step.timerMinutes=null;
    }
    renderEditSteps();
  }));
  $$(".edit-timer-minutes",host).forEach(el=>el.addEventListener("input",e=>{
    const idx=Number(e.target.dataset.idx), v=Number(e.target.value), step=editDraft.steps[idx];
    step.timedStep=true;
    step.timerMinutes=Number.isFinite(v)&&v>0?v:null;
  }));
  $$(".edit-timer-adjust",host).forEach(btn=>btn.addEventListener("click",()=>{
    const idx=Number(btn.dataset.idx), delta=Number(btn.dataset.delta), step=editDraft.steps[idx];
    const current=Number(step.timerMinutes)>0?Number(step.timerMinutes):(guessTimerMinutes(step.text)||5);
    step.timedStep=true;
    step.timerMinutes=Math.max(.5,Math.round((current+delta)*2)/2);
    renderEditSteps();
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
  const invalidTimerStep = editDraft.steps.find(s=>s?.timedStep===true && !(Number(s.timerMinutes)>0));
  if(invalidTimerStep){ toast("Every timed step needs a timer longer than 0 minutes"); return; }
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
    steps:editDraft.steps.filter(s=>String(s.text||"").trim()).map(s=>{
      const timed = isTimedStep(s);
      return {
        ...s,
        id:s.id || uid("step"),
        text:String(s.text).trim(),
        videoUrl:s.videoUrl || "",
        timedStep:timed,
        timerMinutes:timed?Number(s.timerMinutes):null
      };
    }),
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
  const session = getProductionSession();
  host.innerHTML = `
    <div class="grid two">
      <div class="card">
        <div class="section-head">
          <div><h2>Production Mode</h2><div class="subtle">Checks, batch size, and timers are saved automatically on this device.</div></div>
          <div style="min-width:180px">${recipeSelect("prodRecipe")}</div>
        </div>

        <div class="field recipe-search-field" role="search" aria-label="Find a production recipe">
          <label for="prodRecipeSearch">Find a recipe</label>
          <div class="recipe-search-control">
            <span class="recipe-search-icon" aria-hidden="true">🔎</span>
            <input type="search" id="prodRecipeSearch" value="${esc(productionSearchQuery)}" placeholder="Name or ingredient" autocomplete="off" aria-label="Search production recipes">
            <button type="button" id="clearProdRecipeSearch" class="recipe-search-clear" aria-label="Clear production recipe search" hidden>✕</button>
          </div>
          <div id="prodRecipeMatches" class="production-recipe-matches" aria-live="polite"></div>
        </div>

        <div class="field">
          <label>Batch size</label>
          <select id="prodScale">
            <option value=".5">½ batch</option>
            <option value="1">1 batch</option>
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
          <div><h3>Process</h3><div class="subtle">Checking a timed step starts its preset timer automatically.</div></div>
          <button class="ghost small" id="resetProdChecks">New Batch</button>
        </div>
        <div id="activeTimerSummary" style="display:none"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
          <button class="ghost small" id="enableTimerAlerts">🔔 Enable timer alerts</button>
        </div>
        <div id="prodSteps"></div>
      </div>
    </div>
  `;
  $("#prodScale").value=String(session.scale||1);
  $("#prodRecipe").addEventListener("change", e => { selectedRecipeId = e.target.value; productionSearchQuery = ""; renderProduction(); });
  bindRecipeSearchViewport($("#prodRecipeSearch"));
  $("#prodRecipeSearch").addEventListener("input", updateProductionRecipeSearch);
  $("#clearProdRecipeSearch").addEventListener("click", () => {
    $("#prodRecipeSearch").value = "";
    updateProductionRecipeSearch();
    $("#prodRecipeSearch").focus();
  });
  $("#prodRecipeMatches").addEventListener("click", event => {
    const button = event.target.closest("button[data-id]");
    if(!button) return;
    selectedRecipeId = button.dataset.id;
    productionSearchQuery = "";
    renderProduction();
  });
  updateProductionRecipeSearch();
  $("#prodScale").addEventListener("change", e => {
    const s=getProductionSession();
    s.scale=Number(e.target.value)||1;
    saveProductionSession(s);
    renderProdChecklist();
  });
  $("#resetProdChecks").addEventListener("click", resetProductionBatch);
  $("#enableTimerAlerts").addEventListener("click", enableTimerAlerts);
  renderProdChecklist();
  tickProductionTimers(false);
}
function renderProdChecklist(){
  const r = getRecipe(), session = getProductionSession();
  if(!r || !session) return;
  const scale = Number(session.scale || 1);

  $("#prodIngredients").innerHTML = r.ingredients.map((i,idx)=>{
    const key=ingredientKey(i,idx), checked=!!session.ingredientChecks[key];
    return `
      <label class="checkline">
        <input type="checkbox" class="prod-check" data-kind="ingredient" data-key="${esc(key)}" ${checked?"checked":""}>
        <span><strong>${fmt(scaledAmount(i.amount, scale))} ${esc(i.unit)}</strong> ${esc(i.name)}</span>
      </label>`;
  }).join("");

  $("#prodSteps").innerHTML = r.steps.map((s, idx) => {
    normalizeTimerStep(s);
    const key=stepKey(s,idx), checked=!!session.stepChecks[key], timer=session.timers[key], timed=isTimedStep(s);
    const timerHtml = timer
      ? `<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:7px">
           <span class="chip" data-timer-display="${esc(key)}">${esc(timerDisplayText(timer))}</span>
           <button type="button" class="ghost small add-five" data-key="${esc(key)}">+5 min</button>
           <button type="button" class="ghost small dismiss-timer" data-key="${esc(key)}">Dismiss</button>
         </div>`
      : timed
        ? `<div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:7px">
             <span class="chip">⏱ ${esc(fmt(s.timerMinutes))} min · starts when checked</span>
             <button type="button" class="ghost small start-step-timer" data-key="${esc(key)}">Start now</button>
           </div>`
        : "";
    return `
      <div class="checkline" style="display:flex;gap:10px;align-items:flex-start">
        <input type="checkbox" class="prod-check" data-kind="step" data-key="${esc(key)}" ${checked?"checked":""} style="flex:0 0 auto">
        <div style="min-width:0;flex:1">
          <div><strong>${idx+1}.</strong> <span class="step-text ${checked?"done-text":""}">${esc(s.text)}</span></div>
          ${timerHtml}
        </div>
      </div>`;
  }).join("");

  $$(".prod-check",$("#view-production")).forEach(cb => cb.addEventListener("change", () => {
    const key=cb.dataset.key;
    if(cb.dataset.kind==="ingredient"){
      session.ingredientChecks[key]=cb.checked;
      saveProductionSession(session);
      updateProdProgress();
      return;
    }
    const wasChecked=!!session.stepChecks[key];
    session.stepChecks[key]=cb.checked;
    saveProductionSession(session);
    const idx=r.steps.findIndex((s,i)=>stepKey(s,i)===key);
    const step=r.steps[idx];
    if(cb.checked && !wasChecked && isTimedStep(step) && !session.timers[key]){
      startStepTimer(key,false);
      return;
    }
    cb.closest(".checkline")?.querySelector(".step-text")?.classList.toggle("done-text",cb.checked);
    updateProdProgress();
  }));
  $$(".start-step-timer",$("#prodSteps")).forEach(btn=>btn.addEventListener("click",()=>startStepTimer(btn.dataset.key,true)));
  $$(".add-five",$("#prodSteps")).forEach(btn=>btn.addEventListener("click",()=>addTimerMinutes(btn.dataset.key,5)));
  $$(".dismiss-timer",$("#prodSteps")).forEach(btn=>btn.addEventListener("click",()=>dismissStepTimer(btn.dataset.key)));
  updateProdProgress();
  updateActiveTimerSummary();
}
function updateProdProgress(){
  const checks = $$(".prod-check",$("#view-production"));
  const done = checks.filter(c => c.checked).length;
  const pct = checks.length ? Math.round(done / checks.length * 100) : 0;
  if($("#prodProgressText")) $("#prodProgressText").textContent = `${done} of ${checks.length} · ${pct}%`;
  if($("#prodProgressBar")) $("#prodProgressBar").style.width = pct + "%";
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

<div class="field recipe-search-field" role="search" aria-label="Find a Recipe Lab recipe">
          <label for="labRecipeSearch">Find a recipe</label>
          <div class="recipe-search-control">
            <span class="recipe-search-icon" aria-hidden="true">🔎</span>
            <input type="search" id="labRecipeSearch" value="${esc(labSearchQuery)}" placeholder="Name, category, or ingredient" autocomplete="off" aria-label="Search Recipe Lab recipes">
            <button type="button" id="clearLabRecipeSearch" class="recipe-search-clear" aria-label="Clear Recipe Lab search" hidden>✕</button>
          </div>
          <div id="labRecipeMatches" class="production-recipe-matches" aria-live="polite"></div>
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
  $("#labRecipe").addEventListener("change", e => { selectedRecipeId = e.target.value; labDraft = null; labSearchQuery = ""; renderLab(); });
  bindRecipeSearchViewport($("#labRecipeSearch"));
  $("#labRecipeSearch").addEventListener("input", updateLabRecipeSearch);
  $("#clearLabRecipeSearch").addEventListener("click", () => {
    $("#labRecipeSearch").value = "";
    updateLabRecipeSearch();
    $("#labRecipeSearch").focus();
  });
  $("#labRecipeMatches").addEventListener("click", event => {
    const button = event.target.closest("button[data-id]");
    if(!button) return;
    selectedRecipeId = button.dataset.id;
    labDraft = null;
    labSearchQuery = "";
    renderLab();
  });
  updateLabRecipeSearch();
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
  $("#addImpStep").addEventListener("click", () => { importDraft.steps.push({id:uid("step"), text:"", videoUrl:"", timedStep:false, timerMinutes:null}); renderImportReview(); });
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
  host.innerHTML = importDraft.steps.map((s, idx) => {
    normalizeTimerStep(s);
    const timed=isTimedStep(s);
    return `
      <div style="border:1px solid rgba(31,79,61,.16);border-radius:13px;padding:10px;margin-bottom:10px">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <div class="chip">${idx+1}</div>
          <textarea class="imp-step" data-idx="${idx}" style="flex:1;min-width:180px">${esc(s.text)}</textarea>
          <button class="ghost small remove-step" data-idx="${idx}">Remove</button>
        </div>
        <div style="margin:9px 0 0 42px">
          <label style="display:flex;align-items:center;gap:8px;margin:0;font-weight:850">
            <input type="checkbox" class="imp-timed" data-idx="${idx}" ${timed?"checked":""} style="width:20px;height:20px;min-height:20px">
            Timed step
          </label>
          <div class="${timed?"":"hidden"}" data-imp-timer-controls="${idx}" style="display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-top:7px">
            <button type="button" class="ghost small imp-timer-adjust" data-idx="${idx}" data-delta="-5">−5</button>
            <button type="button" class="ghost small imp-timer-adjust" data-idx="${idx}" data-delta="-1">−1</button>
            <input class="imp-timer-minutes" data-idx="${idx}" inputmode="decimal" type="number" min="0.1" step="0.5" value="${timed?esc(fmt(s.timerMinutes)):""}" style="width:92px">
            <span class="small">minutes</span>
            <button type="button" class="ghost small imp-timer-adjust" data-idx="${idx}" data-delta="1">+1</button>
            <button type="button" class="ghost small imp-timer-adjust" data-idx="${idx}" data-delta="5">+5</button>
          </div>
          <div class="small" style="margin-top:5px">English and Spanish durations are detected automatically when clear. Time ranges are left for review.</div>
        </div>
      </div>`;
  }).join("");

  $$(".imp-step", host).forEach(el => el.addEventListener("input", e => {
    importDraft.steps[Number(e.target.dataset.idx)].text=e.target.value;
  }));
  $$(".imp-timed",host).forEach(el=>el.addEventListener("change",e=>{
    const idx=Number(e.target.dataset.idx), step=importDraft.steps[idx];
    if(e.target.checked){
      step.timedStep=true;
      step.timerMinutes=Number(step.timerMinutes)>0?Number(step.timerMinutes):(guessTimerMinutes(step.text)||5);
    }else{
      step.timedStep=false;
      step.timerMinutes=null;
    }
    renderImportSteps();
  }));
  $$(".imp-timer-minutes",host).forEach(el=>el.addEventListener("input",e=>{
    const idx=Number(e.target.dataset.idx), v=Number(e.target.value), step=importDraft.steps[idx];
    step.timedStep=true;
    step.timerMinutes=Number.isFinite(v)&&v>0?v:null;
  }));
  $$(".imp-timer-adjust",host).forEach(btn=>btn.addEventListener("click",()=>{
    const idx=Number(btn.dataset.idx), delta=Number(btn.dataset.delta), step=importDraft.steps[idx];
    const current=Number(step.timerMinutes)>0?Number(step.timerMinutes):(guessTimerMinutes(step.text)||5);
    step.timedStep=true;
    step.timerMinutes=Math.max(.5,Math.round((current+delta)*2)/2);
    renderImportSteps();
  }));
  $$(".remove-step", host).forEach(btn => btn.addEventListener("click", () => {
    importDraft.steps.splice(Number(btn.dataset.idx), 1);
    renderImportReview();
  }));
}

function saveImportedRecipe(){
  const name = importDraft.name.trim();
  if(!name){ toast("Recipe name is required"); return; }
  const invalidTimerStep = importDraft.steps.find(s=>s?.timedStep===true && !(Number(s.timerMinutes)>0));
  if(invalidTimerStep){ toast("Every timed step needs a timer longer than 0 minutes"); return; }
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
    steps:importDraft.steps.filter(s => s.text.trim()).map(s => ({...s,id:s.id || uid("step"), text:s.text.trim(), videoUrl:s.videoUrl || "", timedStep:isTimedStep(s), timerMinutes:isTimedStep(s)?Number(s.timerMinutes):null})),
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
  const heading = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[:\-]/g,"").trim();
  const isIngHead = s => ["ingredients","ingredient","ingredientes","ingrediente"].includes(heading(s));
  const isStepHead = s => ["directions","direction","instructions","instruction","method","process","preparation","steps","direcciones","direccion","instrucciones","instruccion","metodo","proceso","preparacion","pasos","procedimiento"].includes(heading(s));
  const yieldRe = /^(yield|makes|serves|batch(?: size)?|rendimiento|rinde|porciones?)\s*:?\s*(.+)$/i;

  const makeStep = line => {
    const clean = line.replace(/^\d+[\.\)]\s*/,"");
    const timerMinutes = guessTimerMinutes(clean);
    return {id:uid("step"), text:clean, videoUrl:"", timedStep:!!timerMinutes, timerMinutes:timerMinutes||null};
  };

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
      steps.push(makeStep(line));
      continue;
    }
    if(!title) title = line;
    else steps.push(makeStep(line));
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
  const portable = clone(state);
  portable.productionSessions = {};
  portable.appVersion = BUILD_VERSION;
  portable.buildName = BUILD_NAME;
  const blob = new Blob([JSON.stringify(portable, null, 2)], {type:"application/json"});
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
      state.productionSessions = {};
      normalizeState();
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
