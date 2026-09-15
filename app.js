(() => {
"use strict";

const STORAGE_KEY = "recipeAppV2_state";
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
  "each":"each","egg":"egg","eggs":"egg","clove":"clove","cloves":"clove","slice":"slice","slices":"slice",
  "piece":"piece","pieces":"piece","can":"can","cans":"can","jar":"jar","jars":"jar","bag":"bag","bags":"bag",
  "package":"package","packages":"package","pkg":"package","bunch":"bunch","bunches":"bunch",
  "container":"container","containers":"container"
};
const UNICODE_FRACTIONS = {"¼":0.25,"⅓":1/3,"½":0.5,"⅔":2/3,"¾":0.75,"⅛":0.125,"⅜":0.375,"⅝":0.625,"⅞":0.875};
const FRACTION_BUTTONS = [["¼",0.25],["⅓",1/3],["½",0.5],["⅔",2/3],["¾",0.75]];

let state = {appVersion:2, recipes:[]};
let activeView = "library";
let selectedRecipeId = null;
let labDraft = null;
let importDraft = null;
let unitPickerTarget = null;

const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = p => `${p}-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const num = v => v === "" || v === null || v === undefined ? null : Number(v);
const fmt = n => {
  const x = Number(n);
  if (!Number.isFinite(x)) return "";
  return Number.isInteger(x) ? String(x) : String(Math.round(x*1000)/1000);
};

function toast(msg){
  const el=$("#toast"); el.textContent=msg; el.classList.add("show");
  setTimeout(()=>el.classList.remove("show"),1900);
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function loadStored(){
  try{ const raw=localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
  catch(e){ return null; }
}
async function loadSeed(){
  if (window.RECIPE_APP_SEED) return clone(window.RECIPE_APP_SEED);
  const resp = await fetch("recipes.json",{cache:"no-store"});
  if(!resp.ok) throw new Error("Could not load recipes.json");
  return await resp.json();
}
async function init(){
  const stored = loadStored();
  if(stored?.recipes){ state=stored; }
  else{
    try{ state=await loadSeed(); saveState(); }
    catch(e){
      state={appVersion:2,recipes:[]};
      toast("Open through a local/web server, or import recipes.json in Data.");
    }
  }
  selectedRecipeId = state.recipes[0]?.id || null;
  wireNav();
  renderAll();
}
function wireNav(){
  $$(".nav button").forEach(b=>b.addEventListener("click",()=>showView(b.dataset.view)));
  $("#jsonImportFile").addEventListener("change",e=>{
    const f=e.target.files?.[0]; if(f) importJsonFile(f); e.target.value="";
  });
}
function showView(view){
  activeView=view;
  $$(".nav button").forEach(b=>b.classList.toggle("active",b.dataset.view===view));
  ["library","production","lab","import","data"].forEach(v=>$("#view-"+v).classList.toggle("hidden",v!==view));
  renderView(view);
}
function renderAll(){
  $("#recipeCountBadge").textContent=`${state.recipes.length} recipe${state.recipes.length===1?"":"s"}`;
  ["library","production","lab","import","data"].forEach(renderView);
}
function renderView(v){
  if(v==="library") renderLibrary();
  if(v==="production") renderProduction();
  if(v==="lab") renderLab();
  if(v==="import") renderImport();
  if(v==="data") renderData();
}
function getRecipe(id=selectedRecipeId){ return state.recipes.find(r=>r.id===id) || null; }

function renderLibrary(){
  const host=$("#view-library");
  if(!state.recipes.length){
    host.innerHTML=`<div class="card"><div class="empty">No recipes yet. Import your first recipe to begin.</div><div class="actions" style="margin-top:12px"><button class="primary" id="goImport">Import Recipe</button></div></div>`;
    $("#goImport")?.addEventListener("click",()=>showView("import"));
    return;
  }
  host.innerHTML=`
    <div class="row between" style="margin-bottom:12px">
      <div><h2 style="margin:0">Recipe Library</h2><div class="meta">Official recipes your team can use.</div></div>
      <button class="primary" id="libraryImport">+ Import Recipe</button>
    </div>
    <div class="grid three">
      ${state.recipes.map(r=>`
        <article class="recipe-card">
          <div class="row between">
            <span class="badge">${esc(r.category||"Recipe")}</span>
            <span class="small">v${r.officialVersion}.0</span>
          </div>
          <h3 style="margin-top:10px">${esc(r.name)}</h3>
          <div class="small">${esc(r.yield?.text||"Yield not set")} · ${r.ingredients.length} ingredients · ${r.steps.length} steps</div>
          <div class="actions" style="margin-top:12px">
            <button class="primary start-prod" data-id="${r.id}">Production</button>
            <button class="ghost start-lab" data-id="${r.id}">Recipe Lab</button>
          </div>
        </article>`).join("")}
    </div>`;
  $("#libraryImport").addEventListener("click",()=>showView("import"));
  $$(".start-prod",host).forEach(b=>b.addEventListener("click",()=>{selectedRecipeId=b.dataset.id;showView("production")}));
  $$(".start-lab",host).forEach(b=>b.addEventListener("click",()=>{selectedRecipeId=b.dataset.id;labDraft=null;showView("lab")}));
}

function recipeSelector(id, extra=""){
  return `<select id="${id}" class="inline-select">${state.recipes.map(r=>`<option value="${r.id}" ${r.id===selectedRecipeId?"selected":""}>${esc(r.name)}</option>`).join("")}</select>${extra}`;
}

function scaledAmount(amount, scale){ return Math.round(Number(amount)*Number(scale)*1000)/1000; }

function renderProduction(){
  const host=$("#view-production");
  if(!state.recipes.length){ host.innerHTML=`<div class="card"><div class="empty">Import a recipe first.</div></div>`; return; }
  if(!getRecipe()) selectedRecipeId=state.recipes[0].id;
  const r=getRecipe();
  host.innerHTML=`
    <div class="card">
      <div class="row between">
        <div><h2>Production Mode</h2><div class="meta">Follow the official recipe without changing it.</div></div>
        ${recipeSelector("prodRecipe")}
      </div>
      <div class="divider"></div>
      <div class="row between">
        <div><div style="font-weight:900;font-size:1.15rem">${esc(r.name)}</div><div class="small">Official v${r.officialVersion}.0 · ${esc(r.yield?.text||"Yield not set")}</div></div>
        <select id="prodScale" style="max-width:160px">
          <option value=".5">½ batch</option><option value="1" selected>1 batch</option><option value="1.5">1½ batches</option><option value="2">2 batches</option><option value="3">3 batches</option>
        </select>
      </div>
      <div style="margin:14px 0"><div class="row between"><span class="small">Prep progress</span><span class="small" id="prodProgressText">0%</span></div><div class="progress"><div id="prodProgressBar"></div></div></div>
      <div class="grid two">
        <div>
          <h3>Ingredients</h3>
          <div id="prodIngredients"></div>
        </div>
        <div>
          <h3>Process</h3>
          <div id="prodSteps"></div>
        </div>
      </div>
      <div class="actions" style="margin-top:14px"><button class="ghost" id="resetProd">Reset checks</button></div>
    </div>`;
  $("#prodRecipe").addEventListener("change",e=>{selectedRecipeId=e.target.value;renderProduction()});
  $("#prodScale").addEventListener("change",renderProdChecklist);
  $("#resetProd").addEventListener("click",()=>{renderProdChecklist(true);toast("Production checks reset")});
  renderProdChecklist(true);
}
function renderProdChecklist(reset=false){
  const r=getRecipe(); if(!r) return;
  const scale=Number($("#prodScale")?.value||1);
  const ingHost=$("#prodIngredients"), stepHost=$("#prodSteps");
  ingHost.innerHTML=r.ingredients.map((i,idx)=>`
    <label class="checkline">
      <input type="checkbox" class="prod-check">
      <span><strong>${fmt(scaledAmount(i.amount,scale))} ${esc(i.unit)}</strong> ${esc(i.name)}</span>
    </label>`).join("");
  stepHost.innerHTML=r.steps.map((s,idx)=>`
    <label class="checkline">
      <input type="checkbox" class="prod-check">
      <span class="stepnum">${idx+1}</span>
      <span>${esc(s.text)}${s.videoUrl?`<div><a href="${esc(s.videoUrl)}" target="_blank" rel="noopener">Watch step video</a></div>`:""}</span>
    </label>`).join("");
  $$(".prod-check").forEach(c=>c.addEventListener("change",()=>{
    c.closest(".checkline").classList.toggle("done",c.checked); updateProdProgress();
  }));
  updateProdProgress();
}
function updateProdProgress(){
  const checks=$$(".prod-check"), done=checks.filter(c=>c.checked).length;
  const pct=checks.length?Math.round(done/checks.length*100):0;
  $("#prodProgressText").textContent=`${pct}%`;
  $("#prodProgressBar").style.width=`${pct}%`;
}

function newLabDraft(){
  const r=getRecipe();
  return {
    scale:1,
    ingredients:r.ingredients.map(i=>({...clone(i),baseAmount:i.amount})),
    title:"",changeReason:"",ratings:{overall:null,taste:null,texture:null,appearance:null},
    resultNotes:"",nextTime:"",decision:"needs-work"
  };
}
function ensureLabDraft(){ if(!labDraft) labDraft=newLabDraft(); }

function renderLab(){
  const host=$("#view-lab");
  if(!state.recipes.length){ host.innerHTML=`<div class="card"><div class="empty">Import a recipe first.</div></div>`; return; }
  if(!getRecipe()) selectedRecipeId=state.recipes[0].id;
  ensureLabDraft();
  const r=getRecipe(), last=r.tests?.[r.tests.length-1];
  host.innerHTML=`
    <div class="row between" style="margin-bottom:12px">
      <div><h2 style="margin:0">Recipe Lab</h2><div class="meta">Experiment without changing the official recipe.</div></div>
      ${recipeSelector("labRecipe")}
    </div>
    <div class="grid two">
      <div class="card">
        <div class="row between"><div><h3>${esc(r.name)}</h3><div class="small">Official v${r.officialVersion}.0</div></div><span class="badge">Test #${(r.tests?.length||0)+1}</span></div>
        ${last?.nextTime && last.decision!=="winner"?`<div class="note" style="margin-top:12px"><strong>From the last test:</strong><div style="margin-top:4px">${esc(last.nextTime)}</div></div>`:""}
        <div class="divider"></div>
        <div class="field"><label>Test name</label><input id="labTitle" value="${esc(labDraft.title)}" placeholder="Example: Softer center, less sweet"></div>
        <div class="field"><label>Batch size</label><select id="labScale" class="inline-select"><option value=".5">½ batch</option><option value="1">1 batch</option><option value="1.5">1½ batches</option><option value="2">2 batches</option><option value="3">3 batches</option></select></div>
        <div class="field"><label>Ingredients</label><div class="small">Tap the unit to select it. Amounts use a numeric keypad; volume units also show fraction shortcuts.</div><div id="labIngredients" style="margin-top:9px"></div></div>
        <div class="field"><label>What are you changing, and why?</label><textarea id="labReason" placeholder="Describe the goal of this test.">${esc(labDraft.changeReason)}</textarea></div>
      </div>
      <div class="card">
        <h3>After the test</h3>
        <div class="rating-grid">
          ${["overall","taste","texture","appearance"].map(k=>`<div class="score"><label>${k[0].toUpperCase()+k.slice(1)}</label><input id="rate-${k}" inputmode="decimal" type="number" min="1" max="5" step=".5" value="${labDraft.ratings[k]??""}" placeholder="1–5"></div>`).join("")}
        </div>
        <div class="field" style="margin-top:13px"><label>What happened?</label><textarea id="labResult">${esc(labDraft.resultNotes)}</textarea></div>
        <div class="field"><label>Next time, try…</label><textarea id="labNext">${esc(labDraft.nextTime)}</textarea><div class="small">This will be carried into the next test.</div></div>
        <div class="field"><label>Decision</label><select id="labDecision"><option value="needs-work">Needs another test</option><option value="good">Good — keep as candidate</option><option value="winner">Winner — ready to become official</option></select></div>
        <div class="sticky-actions"><div class="actions"><button class="primary" id="saveLab">Save Test</button><button class="good" id="promoteLab">Promote to Official</button></div></div>
      </div>
    </div>
    <div class="card" style="margin-top:16px"><div class="row between"><h3>Test history</h3><span class="badge">${r.tests?.length||0} tests</span></div><div id="labHistory"></div></div>`;
  $("#labRecipe").addEventListener("change",e=>{selectedRecipeId=e.target.value;labDraft=null;renderLab()});
  $("#labScale").value=String(labDraft.scale);
  $("#labDecision").value=labDraft.decision;
  $("#labScale").addEventListener("change",e=>{
    const newScale=Number(e.target.value);
    labDraft.scale=newScale;
    const rr=getRecipe();
    labDraft.ingredients=rr.ingredients.map(i=>({...clone(i),baseAmount:i.amount,amount:scaledAmount(i.amount,newScale)}));
    renderLabIngredients();
  });
  ["labTitle","labReason","labResult","labNext","labDecision"].forEach(id=>{
    $("#"+id).addEventListener("input",syncLabFields);
  });
  ["overall","taste","texture","appearance"].forEach(k=>$("#rate-"+k).addEventListener("input",syncLabFields));
  $("#saveLab").addEventListener("click",saveLabTest);
  $("#promoteLab").addEventListener("click",promoteLabTest);
  renderLabIngredients();
  renderLabHistory();
}
function syncLabFields(){
  labDraft.title=$("#labTitle").value;
  labDraft.changeReason=$("#labReason").value;
  labDraft.resultNotes=$("#labResult").value;
  labDraft.nextTime=$("#labNext").value;
  labDraft.decision=$("#labDecision").value;
  ["overall","taste","texture","appearance"].forEach(k=>labDraft.ratings[k]=num($("#rate-"+k).value));
}
function renderAmountControls(context,row,idx){
  const isVol=VOLUME_FRACTION_UNITS.has(String(row.unit).toLowerCase());
  return `<input class="amount-input" inputmode="decimal" type="number" step="any" data-context="${context}" data-idx="${idx}" value="${fmt(row.amount)}">
    ${isVol?`<div class="fractions">${FRACTION_BUTTONS.map(([lab,val])=>`<button type="button" class="frac-btn" data-context="${context}" data-idx="${idx}" data-frac="${val}">${lab}</button>`).join("")}</div>`:""}`;
}
function renderLabIngredients(){
  const host=$("#labIngredients"); if(!host) return;
  const r=getRecipe();
  host.innerHTML=labDraft.ingredients.map((i,idx)=>{
    const official=r.ingredients[idx], officialScaled=scaledAmount(official.amount,labDraft.scale);
    const changed=Math.abs(Number(i.amount)-Number(officialScaled))>.0001 || i.unit!==official.unit;
    return `<div class="ingredient-row ${changed?"changed":""}">
      <div class="namecell"><strong>${esc(i.name)}</strong><div class="small">Official at this size: ${fmt(officialScaled)} ${esc(official.unit)}</div></div>
      <div><label>Amount</label>${renderAmountControls("lab",i,idx)}</div>
      <div><label>Unit</label><button type="button" class="unit-btn" data-context="lab" data-idx="${idx}">${esc(i.unit||"Select")}</button></div>
    </div>`;
  }).join("");
  bindIngredientEditors("lab",host);
}
function bindIngredientEditors(context,host){
  $$(".amount-input",host).forEach(el=>el.addEventListener("input",e=>{
    const i=Number(e.target.dataset.idx);
    const target=context==="lab"?labDraft.ingredients:importDraft.ingredients;
    target[i].amount=num(e.target.value);
  }));
  $$(".frac-btn",host).forEach(b=>b.addEventListener("click",()=>{
    const i=Number(b.dataset.idx), frac=Number(b.dataset.frac);
    const target=context==="lab"?labDraft.ingredients:importDraft.ingredients;
    const current=Number(target[i].amount||0);
    target[i].amount=Math.floor(Math.max(0,current))+frac;
    if(context==="lab") renderLabIngredients(); else renderImportReview();
  }));
  $$(".unit-btn",host).forEach(b=>b.addEventListener("click",()=>openUnitPicker(context,Number(b.dataset.idx))));
}
function openUnitPicker(context,idx){
  unitPickerTarget={context,idx};
  const host=$("#sheetHost");
  host.innerHTML=`<div class="sheet-backdrop" id="sheetBackdrop">
    <div class="sheet" role="dialog" aria-modal="true" aria-label="Select unit">
      <div class="sheet-head"><div><strong>Select unit</strong><div class="small">Tap a unit to use it.</div></div><button class="ghost" id="closeSheet">Close</button></div>
      ${Object.entries(UNIT_GROUPS).map(([g,units])=>`<div class="group-title">${esc(g)}</div><div class="unit-grid">${units.map(u=>`<button type="button" class="pick-unit" data-unit="${esc(u)}">${esc(u)}</button>`).join("")}</div>`).join("")}
      <div class="group-title">Other</div>
      <button type="button" class="ghost" id="customUnit">Custom / legacy unit</button>
    </div>
  </div>`;
  $("#closeSheet").addEventListener("click",closeUnitPicker);
  $("#sheetBackdrop").addEventListener("click",e=>{if(e.target.id==="sheetBackdrop") closeUnitPicker()});
  $$(".pick-unit",host).forEach(b=>b.addEventListener("click",()=>setPickedUnit(b.dataset.unit)));
  $("#customUnit").addEventListener("click",()=>{
    const u=prompt("Enter the custom unit exactly as you want it shown:");
    if(u?.trim()) setPickedUnit(u.trim());
  });
}
function closeUnitPicker(){ $("#sheetHost").innerHTML=""; unitPickerTarget=null; }
function setPickedUnit(unit){
  const {context,idx}=unitPickerTarget;
  const target=context==="lab"?labDraft.ingredients:importDraft.ingredients;
  target[idx].unit=unit;
  closeUnitPicker();
  if(context==="lab") renderLabIngredients(); else renderImportReview();
}
function saveLabTest(){
  syncLabFields();
  const r=getRecipe();
  r.tests ||= [];
  const t={id:uid("test"),number:r.tests.length+1,createdAt:new Date().toISOString(),baseOfficialVersion:r.officialVersion,...clone(labDraft)};
  r.tests.push(t); saveState(); toast("Test saved"); labDraft=null; renderLab(); renderLibrary();
}
function promoteLabTest(){
  syncLabFields();
  const r=getRecipe();
  if(!confirm("Make this test the new official recipe?")) return;
  r.tests ||= [];
  const t={id:uid("test"),number:r.tests.length+1,createdAt:new Date().toISOString(),baseOfficialVersion:r.officialVersion,...clone(labDraft),decision:"winner",promoted:true};
  r.tests.push(t);
  r.ingredients=labDraft.ingredients.map(i=>({id:i.id,name:i.name,unit:i.unit,amount:Math.round((Number(i.amount)/labDraft.scale)*1000)/1000}));
  r.officialVersion+=1;
  saveState(); toast(`Promoted to Official v${r.officialVersion}.0`); labDraft=null; renderAll();
}
function renderLabHistory(){
  const host=$("#labHistory"), r=getRecipe(), tests=[...(r.tests||[])].reverse();
  if(!tests.length){host.innerHTML=`<div class="empty">No tests yet.</div>`;return}
  host.innerHTML=tests.map(t=>`<div class="test-card">
    <div class="row between"><strong>Test #${t.number}: ${esc(t.title||"Untitled test")}</strong><span class="badge ${t.promoted?"goodbadge":""}">${esc(t.promoted?"Promoted":t.decision||"Saved")}</span></div>
    <div class="small">${new Date(t.createdAt).toLocaleString()} · based on v${t.baseOfficialVersion}.0 · ${t.scale}× batch</div>
    ${t.ratings?.overall!=null?`<div style="margin-top:8px"><strong>Overall:</strong> ${t.ratings.overall}/5</div>`:""}
    ${t.resultNotes?`<div style="margin-top:6px"><strong>Result:</strong> ${esc(t.resultNotes)}</div>`:""}
    ${t.nextTime?`<div class="note" style="margin-top:8px"><strong>Next time:</strong> ${esc(t.nextTime)}</div>`:""}
  </div>`).join("");
}

function renderImport(){
  const host=$("#view-import");
  if(!importDraft){
    host.innerHTML=`
      <div class="grid two">
        <div class="card">
          <h2>Paste a Recipe</h2>
          <div class="meta">Paste the recipe exactly as you have it. The app will separate the title, yield, ingredients, and process.</div>
          <div class="field" style="margin-top:13px"><label>Recipe text</label><textarea id="pasteRecipe" style="min-height:320px" placeholder="Chocolate Chip Cookies&#10;Yield: 24 cookies&#10;&#10;Ingredients&#10;2 cups flour&#10;1 cup sugar&#10;2 eggs&#10;&#10;Directions&#10;Mix ingredients.&#10;Bake at 350°F for 12 minutes."></textarea></div>
          <button class="primary" id="parseRecipe">Parse Recipe</button>
        </div>
        <div class="card">
          <h3>What the importer looks for</h3>
          <div class="parse-preview">
            <strong>Title</strong><div class="small">Usually the first line</div>
            <div class="divider"></div><strong>Yield / batch size</strong><div class="small">“Yield: 24”, “Makes 2 dozen”, “Serves 8”</div>
            <div class="divider"></div><strong>Ingredients</strong><div class="small">Quantity + unit + ingredient name</div>
            <div class="divider"></div><strong>Process</strong><div class="small">Directions, method, or preparation steps</div>
          </div>
          <div class="note" style="margin-top:12px">Anything ambiguous is flagged for review instead of being silently guessed.</div>
        </div>
      </div>`;
    $("#parseRecipe").addEventListener("click",()=>{
      const text=$("#pasteRecipe").value.trim();
      if(!text){toast("Paste a recipe first");return}
      importDraft=parseRecipeText(text);
      renderImport();
    });
  } else {
    renderImportReview();
  }
}
function parseRecipeText(text){
  const lines=text.replace(/\r/g,"").split("\n").map(x=>x.trim()).filter(Boolean);
  let title="", yieldText="", mode="unknown";
  const ingredients=[], steps=[], ambiguous=[];
  const heading = s => s.toLowerCase().replace(/[:\-]/g,"").trim();
  const isIngHead=s=>["ingredients","ingredient"].includes(heading(s));
  const isStepHead=s=>["directions","direction","instructions","instruction","method","process","preparation","steps"].includes(heading(s));
  const yieldRe=/^(yield|makes|serves|batch(?: size)?)\s*:?\s*(.+)$/i;

  for(let li=0; li<lines.length; li++){
    const line=lines[li];
    if(!title && !isIngHead(line) && !isStepHead(line) && !yieldRe.test(line) && !looksLikeIngredient(line)){
      title=line; continue;
    }
    const ym=line.match(yieldRe);
    if(ym){yieldText=ym[2].trim();continue}
    if(isIngHead(line)){mode="ingredients";continue}
    if(isStepHead(line)){mode="steps";continue}
    if(mode==="unknown" && looksLikeIngredient(line)) mode="ingredients";
    if(mode==="ingredients"){
      if(/^\d+[\.\)]\s+/.test(line) && !looksLikeIngredient(line)){ mode="steps"; }
      else{
        const p=parseIngredientLine(line);
        ingredients.push({...p,id:uid("ing")});
        if(p.flagged) ambiguous.push(line);
        continue;
      }
    }
    if(mode==="steps"){
      steps.push({id:uid("step"),text:line.replace(/^\d+[\.\)]\s*/,""),videoUrl:""});continue;
    }
    if(!title) title=line; else steps.push({id:uid("step"),text:line,videoUrl:""});
  }
  if(!title) title="Imported Recipe";
  if(!ingredients.length && lines.length){
    // fallback: any lines that parse like ingredients
    lines.forEach(line=>{if(looksLikeIngredient(line)){const p=parseIngredientLine(line);ingredients.push({...p,id:uid("ing")})}});
  }
  return {name:title,category:"",yieldText,ingredients,steps,ambiguous};
}
function looksLikeIngredient(line){
  return /^(\d+(?:\.\d+)?|\d+\s+\d+\/\d+|\d+\/\d+|[¼⅓½⅔¾⅛⅜⅝⅞])\s+/.test(line.trim());
}
function quantityToDecimal(token, maybeFrac){
  let total=0;
  const parseOne=t=>{
    if(UNICODE_FRACTIONS[t]!=null) return UNICODE_FRACTIONS[t];
    if(/^\d+\/\d+$/.test(t)){const [a,b]=t.split("/").map(Number);return b?a/b:0}
    return Number(t);
  };
  total=parseOne(token);
  if(maybeFrac && /^\d+\/\d+$/.test(maybeFrac)) total+=parseOne(maybeFrac);
  return total;
}
function parseIngredientLine(line){
  let clean=line.replace(/^[-•*]\s*/,"").trim();
  const m=clean.match(/^(\d+(?:\.\d+)?|\d+\/\d+|[¼⅓½⅔¾⅛⅜⅝⅞])(?:\s+(\d+\/\d+))?\s+(.+)$/);
  if(!m) return {amount:null,unit:"",name:clean,flagged:true,flagReason:"No clear quantity"};
  const amount=quantityToDecimal(m[1],m[2]);
  let rest=m[3].trim();
  let unit="", name=rest, flagged=false, flagReason="";
  const aliasKeys=Object.keys(UNIT_ALIASES).sort((a,b)=>b.length-a.length);
  const lower=rest.toLowerCase();
  const matchUnit=aliasKeys.find(k=>lower===k || lower.startsWith(k+" "));
  if(matchUnit){
    unit=UNIT_ALIASES[matchUnit];
    name=rest.slice(matchUnit.length).trim().replace(/^of\s+/i,"");
  }else{
    // count-like ingredients can legitimately omit a unit
    unit="each";
    name=rest;
    flagged=true;
    flagReason="Unit assumed as each";
  }
  if(!name){name=rest;flagged=true;flagReason="Ingredient name needs review"}
  return {amount,unit,name,flagged,flagReason};
}
function renderImportReview(){
  const host=$("#view-import");
  host.innerHTML=`
    <div class="card">
      <div class="row between"><div><h2>Review Imported Recipe</h2><div class="meta">Fix anything that was parsed incorrectly before saving.</div></div><span class="badge ${importDraft.ambiguous.length?"warnbadge":"goodbadge"}">${importDraft.ambiguous.length} flagged</span></div>
      <div class="grid two" style="margin-top:14px">
        <div class="field"><label>Recipe name</label><input id="impName" value="${esc(importDraft.name)}"></div>
        <div class="field"><label>Category</label><input id="impCategory" value="${esc(importDraft.category)}" placeholder="Bakery, Salsa, Prep, etc."></div>
      </div>
      <div class="field"><label>Yield / batch size</label><input id="impYield" value="${esc(importDraft.yieldText)}" placeholder="Example: 24 cookies"></div>
      <div class="divider"></div>
      <div class="row between"><h3>Ingredients</h3><button class="small" id="addImpIng">+ Ingredient</button></div>
      <div id="impIngredients"></div>
      <div class="divider"></div>
      <div class="row between"><h3>Process</h3><button class="small" id="addImpStep">+ Step</button></div>
      <div id="impSteps"></div>
      <div class="sticky-actions"><div class="actions"><button class="primary" id="saveImported">Save as Base Recipe</button><button class="ghost" id="cancelImport">Start Over</button></div></div>
    </div>`;
  $("#impName").addEventListener("input",e=>importDraft.name=e.target.value);
  $("#impCategory").addEventListener("input",e=>importDraft.category=e.target.value);
  $("#impYield").addEventListener("input",e=>importDraft.yieldText=e.target.value);
  $("#addImpIng").addEventListener("click",()=>{importDraft.ingredients.push({id:uid("ing"),amount:null,unit:"",name:"",flagged:true,flagReason:"New ingredient"});renderImportReview()});
  $("#addImpStep").addEventListener("click",()=>{importDraft.steps.push({id:uid("step"),text:"",videoUrl:""});renderImportReview()});
  $("#saveImported").addEventListener("click",saveImportedRecipe);
  $("#cancelImport").addEventListener("click",()=>{importDraft=null;renderImport()});
  renderImportIngredients();
  renderImportSteps();
}
function renderImportIngredients(){
  const host=$("#impIngredients");
  if(!importDraft.ingredients.length){host.innerHTML=`<div class="empty">No ingredients detected. Add them manually.</div>`;return}
  host.innerHTML=importDraft.ingredients.map((i,idx)=>`
    <div class="ingredient-row ${i.flagged?"flagged":""}">
      <div class="namecell">
        <label>Ingredient</label><input class="imp-name" data-idx="${idx}" value="${esc(i.name)}" placeholder="Ingredient name">
        ${i.flagged?`<div class="flag">${esc(i.flagReason||"Needs review")}</div>`:""}
      </div>
      <div><label>Amount</label>${renderAmountControls("import",i,idx)}</div>
      <div><label>Unit</label><button type="button" class="unit-btn" data-context="import" data-idx="${idx}">${esc(i.unit||"Select")}</button></div>
    </div>`).join("");
  bindIngredientEditors("import",host);
  $$(".imp-name",host).forEach(el=>el.addEventListener("input",e=>{const i=Number(e.target.dataset.idx);importDraft.ingredients[i].name=e.target.value;importDraft.ingredients[i].flagged=false}));
}
function renderImportSteps(){
  const host=$("#impSteps");
  if(!importDraft.steps.length){host.innerHTML=`<div class="empty">No process steps detected. Add them manually.</div>`;return}
  host.innerHTML=importDraft.steps.map((s,idx)=>`
    <div class="row" style="align-items:flex-start;margin-bottom:9px">
      <span class="stepnum">${idx+1}</span>
      <textarea class="imp-step" data-idx="${idx}" style="flex:1;min-width:200px">${esc(s.text)}</textarea>
      <button class="ghost small remove-step" data-idx="${idx}">Remove</button>
    </div>`).join("");
  $$(".imp-step",host).forEach(el=>el.addEventListener("input",e=>importDraft.steps[Number(e.target.dataset.idx)].text=e.target.value));
  $$(".remove-step",host).forEach(b=>b.addEventListener("click",()=>{importDraft.steps.splice(Number(b.dataset.idx),1);renderImportReview()}));
}
function saveImportedRecipe(){
  const name=importDraft.name.trim(); if(!name){toast("Recipe name is required");return}
  const cleanIngredients=importDraft.ingredients.filter(i=>i.name.trim()).map(i=>({
    id:i.id||uid("ing"),name:i.name.trim(),amount:Number(i.amount||0),unit:i.unit||"each"
  }));
  if(!cleanIngredients.length){toast("Add at least one ingredient");return}
  const recipe={
    id:uid("recipe"),name,category:importDraft.category.trim()||"Recipe",officialVersion:1,
    yield:{text:importDraft.yieldText.trim()||"Yield not set"},
    ingredients:cleanIngredients,
    steps:importDraft.steps.filter(s=>s.text.trim()).map(s=>({id:s.id||uid("step"),text:s.text.trim(),videoUrl:s.videoUrl||""})),
    tests:[]
  };
  state.recipes.push(recipe); selectedRecipeId=recipe.id; saveState(); importDraft=null; toast("Recipe saved"); renderAll(); showView("library");
}

function renderData(){
  const host=$("#view-data");
  host.innerHTML=`
    <div class="grid two">
      <div class="card">
        <h2>Backup & Transfer</h2>
        <div class="meta">Browser changes are saved locally. Export JSON to back up or move your recipes.</div>
        <div class="actions" style="margin-top:13px"><button class="primary" id="exportJson">Export JSON</button><button id="importJson">Import JSON</button></div>
      </div>
      <div class="card">
        <h2>Source file</h2>
        <div class="meta">In the multi-file build, recipes.json is the starter/master data file. After the first load, edits stay in local storage until you export them.</div>
        <div class="actions" style="margin-top:13px"><button class="danger" id="clearLocal">Clear Local Data</button></div>
      </div>
    </div>`;
  $("#exportJson").addEventListener("click",exportJson);
  $("#importJson").addEventListener("click",()=>$("#jsonImportFile").click());
  $("#clearLocal").addEventListener("click",()=>{
    if(!confirm("Clear locally saved recipes? You can reload recipes.json afterward.")) return;
    localStorage.removeItem(STORAGE_KEY); location.reload();
  });
}
function exportJson(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="recipe-app-backup.json"; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),500);
}
function importJsonFile(file){
  const rd=new FileReader();
  rd.onload=()=>{try{
    const parsed=JSON.parse(rd.result);
    if(!Array.isArray(parsed.recipes)) throw new Error();
    state=parsed; saveState(); selectedRecipeId=state.recipes[0]?.id||null; labDraft=null; importDraft=null; renderAll(); toast("JSON imported");
  }catch(e){alert("That is not a valid Recipe App JSON file.")}};
  rd.readAsText(file);
}

init();
})();
