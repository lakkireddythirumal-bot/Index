
/* =====================================================
   WORKING GOOGLE APPS SCRIPT URL — KEEP UNCHANGED • UI REFINEMENT
===================================================== */
const API_URL="https://script.google.com/macros/s/AKfycbxhiO5LAGwqkvDHW9DjH8jynYzYlyjAvNxgYlV9J3Y1GGZJxGb_3oXCvk-Bzefp74oa/exec";
const SPARE_PARTS_API="https://script.google.com/macros/s/AKfycbweDXm7if7XuHwAUju9WkIkNXkg0CakJJ9mmEBkQBwuQVuyYC9YkxjClVvovSSjv320/exec";

/* =====================================================
   SETTINGS
===================================================== */
const CACHE_KEY="manager_dashboard_last_success_v2";
const CACHE_TIME_KEY="manager_dashboard_last_success_time_v2";
const DEFAULT_SAFETY_DAYS=7;

/* =====================================================
   DATA
===================================================== */
let DATA={
  stock:[],production:[],bags:[],feedUnitData:[],feedUnitTotals:[],
  productionTrend:[],usage:{},reorder_items:[],consumption:null,
  efficiency:null,processLoss:null,report_date:null
};
let ALERTS=[];
let DISMISSED_ALERTS=new Set();
try{DISMISSED_ALERTS=new Set(JSON.parse(localStorage.getItem("manager_dashboard_dismissed_alerts_v1")||"[]"))}catch(e){}
function alertKey(a){return normalize((a.title||"")+"|"+(a.msg||""))}
function saveDismissedAlerts(){try{localStorage.setItem("manager_dashboard_dismissed_alerts_v1",JSON.stringify([...DISMISSED_ALERTS]))}catch(e){}}
function dismissAlert(key){DISMISSED_ALERTS.add(key);saveDismissedAlerts();renderAlerts();if(document.getElementById("modal").classList.contains("show"))openNotifications()}
function clearDismissedAlerts(){DISMISSED_ALERTS.clear();saveDismissedAlerts();renderAlerts();openNotifications()}

function clean(v){return String(v??"").trim()}
function normalize(v){return clean(v).replace(/\s+/g," ").toUpperCase()}
function num(v){const n=Number(v);return Number.isFinite(n)?n:null}
function fmt(v){if(v===null||v===undefined||v==="")return"--";const n=Number(v);return Number.isFinite(n)?n.toLocaleString("en-IN",{maximumFractionDigits:2}):String(v)}
function fmtMT(v){return v===null||v===undefined||v===""?"--":fmt(v)+" MT"}
function isPremixProduct(name){return /PREMIX/i.test(clean(name));}
function isPremixMaterial(name){return isPremixProduct(name);}
function fmtFeed(v,product){return v===null||v===undefined||v===""?"--":isPremixProduct(product)?fmt(v)+" KG":fmt(v)+" MT"}
function feedValueInMT(v,product){const n=num(v)||0;return isPremixProduct(product)?n/1000:n;}
function materialUnit(material,fallback="MT"){return isPremixMaterial(material)?"KG":fallback}
function fmtMaterial(v,material,fallback="MT"){return v===null||v===undefined||v===""?"--":fmt(v)+" "+materialUnit(material,fallback)}
function materialValueInMT(v,material){const n=num(v)||0;return isPremixMaterial(material)?n/1000:n;}
function isBommakalTransfer(t){const ty=tType(t);return ty.includes("TRANSFER FROM BMKL");}
function latestBommakalDate(){
  const rows=[];
  getMaterials().forEach(m=>transactions(m).forEach(t=>{if(isPremixMaterial(m)&&isBommakalTransfer(t))rows.push(rowDate(t));}));
  const dates=rows.filter(Boolean).sort();
  return dates.length?dates[dates.length-1]:"";
}
function premixBommakalTransfers(){
  const latest=latestBommakalDate(), map={};
  getMaterials().forEach(m=>{
    if(!isPremixMaterial(m))return;
    transactions(m).forEach(t=>{
      if(!isBommakalTransfer(t))return;
      const d=rowDate(t);
      if(latest && d!==latest)return;
      const v=tVal(t);
      if(v>0)map[m]=(map[m]||0)+v;
    });
  });
  return Object.entries(map).map(([material,value])=>({material,value})).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
}
function renderPremixTransfers(){
  const el=document.getElementById("premixTransferList");
  if(!el)return;
  const rows=premixBommakalTransfers();
  const totalMT=rows.reduce((a,r)=>a+r.value/1000,0);
  el.innerHTML=rows.length?rows.map(r=>`<div class="feed-row premix-row" onclick="openMaterialDetails('${jsq(r.material)}')"><div class="row-name">${esc(r.material)}</div><div class="row-right"><strong>${fmt(r.value)} KG</strong><small>Transfer from Bommakal</small></div></div>`).join("")+`<div class="premix-total"><span>Total</span><strong>${fmt(totalMT)} MT</strong></div>`:"<div class='empty'>No premix transferred from Bommakal</div>";
}
function rawTotal(material,tab){
  if(tab==="STOCK")return num(getMaterial(material)?.closing)||0;
  return transactions(material).filter(t=>{
    const ty=tType(t);
    if(tab==="CONSUMPTION")return ty.includes("CONSUMPTION") || ty.includes("CONSUMPION");
    if(tab==="PURCHASE")return ty==="PURCHASE" || ty==="RECEIVED";
    if(tab==="TRANSFER")return ty==="TRANSFER" || ty.includes("TRANSFER FROM") || ty.includes("TRANSFER TO");
    if(tab==="GAIN")return ty==="GAIN";
    if(tab==="SHORTAGE")return ty.includes("SHORTAGE");
    if(tab==="SALE")return ty.includes("SALE");
    return ty===tab;
  }).reduce((a,t)=>a+tVal(t),0);
}
function fmtBags(v){return v===null||v===undefined||v===""?"--":fmt(v)+" Bags"}
function esc(v){return clean(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;")}
function jsq(v){return clean(v).replace(/\\/g,"\\\\").replace(/'/g,"\\'")}
function txName(v){return clean(v).replace(/\s+/g," ")}






function tType(t){return normalize(t.transaction||t.type||t.movement||"")}
function tVal(t){return Math.abs(num(t.for_day??t.value??t.quantity??t.qty??0)||0)}
function rowDate(t){return clean(t.report_date||t.date||t.Report_Date||"")}
function feedField(r,key){
  const map={
    Production_Day_MT:["Production_Day_MT","production_day_mt","Production_Day","production_day","Production","production"],
    Production_Month_MT:["Production_Month_MT","production_month_mt","Production_Month","production_month"],
    Dispatch_Day_MT:["Dispatch_Day_MT","dispatch_day_mt","Dispatch_Day","dispatch_day","Dispatch","dispatch"],
    Dispatch_Month_MT:["Dispatch_Month_MT","dispatch_month_mt","Dispatch_Month","dispatch_month"]
  };
  for(const k of (map[key]||[key])){const v=num(r?.[k]);if(v!==null)return v;}
  return null;
}






function feedClosingBagSize(product){
  const name=String(product||"").toUpperCase();
  if(/\bLOOSE\b/.test(name))return null;
  if(/^FC30(?:\s*CRUMBLES)?(?:\b|$)/.test(name))return 60;
  if(/50\s*KG?\b/.test(name))return 50;
  if(/60\s*KG?\b/.test(name))return 60;
  if(/FINISHER\s*MASH|LAYER\s*MASH\s*\/\s*PLM/.test(name))return 75;
  return 70;
}
function fmtFeedClosingBags(value,product){
  const bagKg=feedClosingBagSize(product);
  if(bagKg===null||value===null||value===undefined||value==="")return "";
  const mt=feedValueInMT(value,product);
  return fmt(mt*1000/bagKg)+" Bags ("+bagKg+" KG)";
}
function latestFeedClosingBagEquivalent(){
  return latestFeedRows().reduce((sum,r)=>{
    const p=r.Product||r.product||"";
    const v=num(r.Closing_Day_MT??r.closing_day_mt??r.Closing_Day??r.closing_day??r.Closing??r.closing);
    const bagKg=feedClosingBagSize(p);
    if(bagKg===null||v===null||v===undefined||v==="")return sum;
    const mt=feedValueInMT(v,p);
    return sum+(mt*1000/bagKg);
  },0);
}
function openFeedClosingDetails(){
  const rows=latestFeedRows().slice().sort((a,b)=>{
    const av=num(a.Closing_Day_MT??a.closing_day_mt??a.Closing_Day??a.closing_day??a.Closing??a.closing)||0;
    const bv=num(b.Closing_Day_MT??b.closing_day_mt??b.Closing_Day??b.closing_day??b.Closing??b.closing)||0;
    return (bv>0)-(av>0)||bv-av;
  });
  const total=latestFeedClosingTotal();
  showModal("Feed Closing Stock",`<div class="detail-section">${detail("Total Closing Stock",fmtMT(total))}</div>`+rows.map(r=>{
    const p=r.Product||r.product||"--";
    const v=num(r.Closing_Day_MT??r.closing_day_mt??r.Closing_Day??r.closing_day??r.Closing??r.closing);
    return `<div class="feed-row" onclick="closeModal();openFeedProductDetails('${jsq(p)}')"><div class="row-name">${esc(p)}</div><div class="row-right"><strong>${fmtFeed(v,p)}</strong><small>Closing Stock</small>${feedClosingBagSize(p)===null?"":`<small>${fmtFeedClosingBags(v,p)}</small>`}</div></div>`;
  }).join(""));
}
function setText(id,v){const e=document.getElementById(id);if(e)e.textContent=v}

/* =====================================================
   CACHE
===================================================== */
function saveCache(payload){
  try{localStorage.setItem(CACHE_KEY,JSON.stringify(payload));localStorage.setItem(CACHE_TIME_KEY,String(Date.now()))}catch(e){}
}
function cachedData(){
  try{const s=localStorage.getItem(CACHE_KEY);return s?JSON.parse(s):null}catch(e){return null}
}
function applyData(apiData,fromCache=false){
  DATA={
    stock:Array.isArray(apiData.stock)?apiData.stock:[],
    stockHistory:Array.isArray(apiData.stock_history)?apiData.stock_history:[],
    production:Array.isArray(apiData.production)?apiData.production:[],
    productionHistory:Array.isArray(apiData.production_history)?apiData.production_history:[],
    bags:Array.isArray(apiData.pp_bags)?apiData.pp_bags:[],
    bagsHistory:Array.isArray(apiData.pp_bags_history)?apiData.pp_bags_history:[],
    feedUnitData:Array.isArray(apiData.feedUnitData)?apiData.feedUnitData:[],
    feedUnitTotals:Array.isArray(apiData.feedUnitTotals)?apiData.feedUnitTotals:(apiData.feedUnitTotals||[]),
    productionTrend:Array.isArray(apiData.productionTrend)?apiData.productionTrend:[],
    usage:apiData.usage&&typeof apiData.usage==="object"?apiData.usage:{},
    reorder_items:Array.isArray(apiData.reorder_items)?apiData.reorder_items:[],
    consumption:apiData.consumption??null,
    efficiency:apiData.efficiency??null,
    processLoss:apiData.processLoss??null,
    report_date:apiData.report_date??null
  };
  if(DATA.report_date)setText("reportDate",VIEW_DATE||DATA.report_date);
  renderDashboard();
  if(!fromCache)saveCache(apiData);
}
function restoreCache(){
  const c=cachedData();
  if(!c||c.status!=="success")return false;
  applyData(c,true);
  const tm=Number(localStorage.getItem(CACHE_TIME_KEY)||0);
  setText("lastUpdated",tm?"Cached "+new Date(tm).toLocaleString("en-IN",{dateStyle:"short",timeStyle:"short"}):"Cached");
  setConnection(false,"Showing saved data • refreshing...");
  return true;
}
function setConnection(ok,text){
  const dot=document.getElementById("statusDot");
  if(dot)dot.classList.toggle("off",!ok);
  setText("connectionStatus",text);
}

/* =====================================================
   JSONP LOAD — SAME WORKING MECHANISM
===================================================== */
function loadDashboard(attempt=0){
  return new Promise(function(resolve,reject){
    const callbackName="managerDashboardCallback_"+Date.now()+"_"+Math.random().toString(36).slice(2);
    const script=document.createElement("script");
    let finished=false;
    let timeout;

    function cleanup(){
      if(timeout)clearTimeout(timeout);
      if(script.parentNode)script.parentNode.removeChild(script);
      try{delete window[callbackName]}catch(e){window[callbackName]=undefined}
    }
    function fail(message,code){
      if(finished)return;
      finished=true;
      cleanup();
      const e=new Error(message);e.code=code;reject(e);
    }

    window[callbackName]=function(apiData){
      if(finished)return;
      try{
        if(!apiData || apiData.status!=="success"){
          fail("Invalid API response","API_RESPONSE");
          return;
        }
        finished=true;
        cleanup();
        try{
          applyData(apiData,false);
          resolve(apiData);
        }catch(error){
          const e=new Error(error&&error.message?error.message:"Dashboard processing failed");
          e.code="DASHBOARD_PROCESSING";
          reject(e);
        }
      }catch(error){
        fail(error&&error.message?error.message:"API response handling failed","API_RESPONSE");
      }
    };

    script.async=true;
    script.referrerPolicy="no-referrer";
    script.onerror=function(){
      if(finished)return;
      if(attempt<1){
        cleanup();
        setTimeout(function(){loadDashboard(attempt+1).then(resolve).catch(reject)},800);
      }else{
        fail("Google Apps Script connection failed","API_NETWORK");
      }
    };

    script.src=API_URL+"?callback="+encodeURIComponent(callbackName)+"&t="+Date.now();
    document.head.appendChild(script);

    timeout=setTimeout(function(){
      if(finished)return;
      if(attempt<1){
        finished=true;
        cleanup();
        setTimeout(function(){loadDashboard(attempt+1).then(resolve).catch(reject)},800);
      }else{
        fail("API timeout","API_TIMEOUT");
      }
    },20000);
  });
}

let refreshing=false;
async function refreshData(){
  if(refreshing)return;
  refreshing=true;
  setConnection(true,"Connecting...");
  try{
    await loadDashboard();
    setConnection(true,"Live");
    const tm=Date.now();setText("lastUpdated","Updated "+new Date(tm).toLocaleString("en-IN",{dateStyle:"short",timeStyle:"short"}));
  }catch(e){
    console.error(e);
    const has=!!cachedData();
    let msg="Unable to refresh";
    if(e&&e.code==="DASHBOARD_PROCESSING")msg="Data received • dashboard processing error";
    else if(e&&e.code==="API_TIMEOUT")msg="API timeout • showing saved data";
    else if(e&&e.code==="API_NETWORK")msg="API connection issue • showing saved data";
    else if(e&&e.code==="API_RESPONSE")msg="API response error • showing saved data";
    setConnection(false,has?msg:"Unable to load dashboard");
    if(!has)document.getElementById("stockList").innerHTML="<div class='error-box'>❌ Unable to load dashboard data.</div>";
  }finally{refreshing=false}
}

function manualRefresh(){refreshData()}

/* =====================================================
   DASHBOARD RENDER
===================================================== */

/* =====================================================
   MANAGER CONTROL FEATURES
===================================================== */
function dateOnly(v){
  const s=clean(v);
  if(!s)return "";
  const m=s.match(/(\d{4}-\d{2}-\d{2})/);
  return m?m[1]:s.slice(0,10);
}
function materialReconciliation(material){
  const rows=transactions(material);
  if(!rows.length)return {status:"NO DATA",message:"No transaction history available."};
  const dates=rows.map(t=>dateOnly(rowDate(t))).filter(Boolean).sort();
  const latest=dates.length?dates[dates.length-1]:"";
  const dayRows=latest?rows.filter(t=>dateOnly(rowDate(t))===latest):rows.slice();
  let opening=null,closing=null,add=0,otherOut=0,recorded=0;
  dayRows.forEach(t=>{
    const ty=tType(t),v=tVal(t);
    // One opening/closing balance represents the stock balance for the day.
    // If the source contains a duplicate balance row, use the latest value instead of double-counting it.
    if(ty==="OPENING STOCK") opening=v;
    else if(ty==="CL. STOCK") closing=v;
    // Preserve source transaction names; recognize the known MIS spelling variant as consumption.
    else if(ty.includes("CONSUMPTION")||ty.includes("CONSUMPION")) recorded+=v;
    // Keep existing transaction names and classify only clear inbound/outbound movements.
    else if(ty==="PURCHASE"||ty==="RECEIVED"||ty==="GAIN"||ty.includes("TRANSFER FROM")) add+=v;
    else if(ty.includes("TRANSFER TO")||ty.includes("SALE")||ty.includes("SHORTAGE")||ty==="DAMAGE"||ty==="ISSUE"||ty.includes("RETURN TO")) otherOut+=v;
  });
  if(opening===null||closing===null)return {status:"NO DATA",message:"Opening/closing pair is not available for the latest transaction date.",date:latest};
  const calculated=Math.max(0,opening+add-otherOut-closing);
  const diff=calculated-recorded;
  const tol=isPremixMaterial(material)?0.01:0.01;
  return {status:Math.abs(diff)<=tol?"MATCH":"MISMATCH",date:latest,opening,add,otherOut,closing,calculated,recorded,diff,tolerance:tol};
}
function reconciliationItems(){
  return getMaterials().map(material=>({material,r:materialReconciliation(material)}));
}
function abnormalConsumptionItems(){
  const out=[];
  getMaterials().forEach(m=>{
    const avg=avgConsumption(m);
    if(!avg)return;
    const rows=transactions(m).filter(t=>tType(t).includes("CONSUMPTION"));
    if(!rows.length)return;
    const latestDate=rows.map(t=>dateOnly(rowDate(t))).filter(Boolean).sort().pop()||"";
    const today=rows.filter(t=>!latestDate||dateOnly(rowDate(t))===latestDate).reduce((a,t)=>a+tVal(t),0);
    if(today>0 && (today>avg*1.5 || today<avg*0.5))out.push({material:m,current:today,avg,ratio:today/avg,date:latestDate, direction:today>avg?"HIGH":"LOW"});
  });
  return out.sort((a,b)=>b.ratio-a.ratio);
}




function duplicateTransactionCount(){let count=0;getMaterials().forEach(m=>{const seen=new Set();transactions(m).forEach(t=>{const key=[dateOnly(rowDate(t)),tType(t),tVal(t),clean(t.for_day),clean(t.for_month),clean(t.for_year)].join("|");if(seen.has(key))count++;else seen.add(key);});});return count;}
function openDataHealth(){
  const rec=reconciliationItems(),bad=rec.filter(x=>x.r.status==="MISMATCH"),no=rec.filter(x=>x.r.status==="NO DATA");
  const feedRec=feedUnitReconciliationItems(),feedBad=feedRec.filter(x=>x.r.status==="MISMATCH");
  const bagRec=ppBagReconciliationItems(),bagBad=bagRec.filter(x=>x.r.status==="MISMATCH");
  const abnormal=abnormalConsumptionItems();
  const dupCount=duplicateTransactionCount();
  let html=`<div class="detail-section"><h3>⚠ Data Issues</h3>${detail("Materials checked",rec.length)}${detail("Stock mismatches",bad.length)}${detail("Feed Unit / Dispatch mismatches",feedBad.length)}${detail("PP Bags mismatches",bagBad.length)}${detail("Duplicate transactions",dupCount)}${detail("Abnormal consumption",abnormal.length)}${detail("Materials without daily pair",no.length)}</div>`;
  if(bad.length){
    html+=`<div class="detail-section"><h3>⚠ Stock Reconciliation</h3>`;
    bad.forEach(x=>{const u=materialUnit(x.material,getMaterial(x.material)?.unit||"MT");html+=`<div class="transaction" onclick="closeModal();openMaterialDetails('${jsq(x.material)}')"><div class="transaction-title"><strong>${esc(x.material)}</strong><span>${esc(x.r.date||"--")}</span></div>${detail("Calculated consumption",fmt(x.r.calculated)+" "+u)}${detail("Recorded consumption",fmt(x.r.recorded)+" "+u)}${detail("Difference",fmt(x.r.diff)+" "+u)}</div>`});
    html+="</div>";
  }
  if(feedBad.length){
    html+=`<div class="detail-section"><h3>⚠ Feed Unit / Dispatch Reconciliation</h3>`;
    feedBad.forEach(x=>{html+=`<div class="transaction" onclick="closeModal();openFeedProductDetails('${jsq(x.product)}')"><div class="transaction-title"><strong>${esc(x.product)}</strong><span>${esc(x.r.date||"--")}</span></div>${detail("Calculated Closing",fmtFeed(x.r.calculated,x.product))}${detail("Actual Closing",fmtFeed(x.r.closing,x.product))}${detail("Difference",fmtFeed(x.r.diff,x.product))}</div>`});
    html+="</div>";
  }
  if(bagBad.length){
    html+=`<div class="detail-section"><h3>⚠ PP Bags Reconciliation</h3>`;
    bagBad.forEach(x=>{html+=`<div class="transaction" onclick="closeModal();openBagProduct('${jsq(x.product)}')"><div class="transaction-title"><strong>${esc(x.product)}</strong><span>${esc(x.r.date||"--")}</span></div>${detail("Calculated Closing",fmt(x.r.calculated)+" Bags")}${detail("Actual Closing",fmt(x.r.closing)+" Bags")}${detail("Difference",fmt(x.r.diff)+" Bags")}</div>`});
    html+="</div>";
  }
  if(abnormal.length){
    html+=`<div class="detail-section"><h3>📈 Abnormal Consumption</h3>`;
    abnormal.slice(0,10).forEach(a=>{html+=`<div class="transaction" onclick="closeModal();openMaterialDetails('${jsq(a.material)}')">${detail("Material",a.material)}${detail("Latest consumption",fmt(a.current)+" "+materialUnit(a.material,getMaterial(a.material)?.unit||"MT"))}${detail("Average",fmt(a.avg)+" "+materialUnit(a.material,getMaterial(a.material)?.unit||"MT")+"/day")}${detail(a.direction==="LOW"?"Below average":"Above average",fmt(Math.abs(a.ratio*100-100))+" %")}</div>`});
    html+="</div>";
  }
  if(!bad.length&&!feedBad.length&&!bagBad.length&&!abnormal.length)html+=`<div class="detail-section reconcile-ok"><h3>✓ Data Issues</h3><div class="empty">No reconciliation or abnormal-consumption issues detected in the available data.</div></div>`;
  showModal("Data Issues",html);
}
function buildDailyReportText(){
  const m=dailyControlMetrics(),pd=latestTotal("Production_Day_MT"),dd=latestTotal("Dispatch_Day_MT");
  const reorder=getMaterials().filter(x=>stockStatus(num(getMaterial(x)?.closing)||0,avgConsumption(x)).status==="REORDER");
  const rec=reconciliationItems().filter(x=>x.r.status==="MISMATCH");
  const abnormal=abnormalConsumptionItems();
  return `FEED PLANT DAILY REPORT
Date: ${DATA.report_date||"Latest"}

Production: ${fmtMT(pd)}
Dispatch: ${fmtMT(dd)}
Feed Closing: ${fmtMT(latestFeedClosingTotal())}
Premix Transfer: ${fmt(m.premix)} MT
Average Output: ${m.efficiency===null?"--":fmt(m.efficiency)+" %"}
Average Process Loss: ${m.loss===null?"--":fmt(m.loss)+" %"}

Reorder Materials: ${reorder.length}
Stock Mismatches: ${rec.length}
Abnormal Consumption: ${abnormal.length}
PP Bag Damage: ${fmt(m.damage)}

Reorder:
${reorder.slice(0,10).map(x=>"- "+x).join("\n")||"- None"}`;
}
async function copyDailyReport(){
  const txt=buildDailyReportText();
  try{await navigator.clipboard.writeText(txt);showToast("Daily report copied");}
  catch(e){showModal("Daily Report",`<div class="report-box">${esc(txt)}</div>`);}
}
function downloadDailyReport(){
  const blob=new Blob([buildDailyReportText()],{type:"text/plain;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;
  a.download=`Feed_Plant_Daily_Report_${dateOnly(DATA.report_date)||"latest"}.txt`;
  document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),500);
  showToast("Daily report downloaded");
}
function showToast(msg){
  let t=document.getElementById("dashToast");
  if(!t){t=document.createElement("div");t.id="dashToast";t.style.cssText="position:fixed;left:50%;bottom:82px;transform:translateX(-50%);background:#202938;color:#fff;padding:9px 13px;border-radius:12px;font-size:11px;z-index:900;box-shadow:0 5px 20px rgba(0,0,0,.2)";document.body.appendChild(t);}
  t.textContent=msg;t.style.display="block";clearTimeout(window.__toastTimer);window.__toastTimer=setTimeout(()=>t.style.display="none",1800);
}






function openGlobalSearch(){
  showModal("🔎 Search",`<div class="detail-section"><input id="globalSearchInput" class="search-input" placeholder="Search material or feed product..." oninput="renderGlobalSearch(this.value)" autofocus><div id="globalSearchResults" style="margin-top:8px"></div></div>`);
  renderGlobalSearch("");
  setTimeout(()=>document.getElementById("globalSearchInput")?.focus(),80);
}
function renderGlobalSearch(q){
  const el=document.getElementById("globalSearchResults");if(!el)return;
  const term=normalize(q);
  const mats=getMaterials().filter(m=>!term||normalize(m).includes(term));
  const feeds=latestFeedRows().map(r=>clean(r.Product||r.product)).filter(Boolean).filter(p=>!term||normalize(p).includes(term));
  const prods=DATA.production.map(r=>clean(r.product)).filter(Boolean).filter(p=>!term||normalize(p).includes(term));
  const bags=(DATA.bags||[]).map(r=>clean(r.product)).filter(Boolean).filter(p=>!term||normalize(p).includes(term));
  const items=[];
  mats.slice(0,12).forEach(m=>{const x=getMaterial(m);items.push(`<div class="search-result" onclick="closeModal();openMaterialDetails('${jsq(m)}')"><strong>📦 ${esc(m)}</strong><small>Stock ${fmtMaterial(x?.closing,m,x?.unit||"MT")} • Raw material</small></div>`)});
  feeds.slice(0,8).forEach(p=>items.push(`<div class="search-result" onclick="closeModal();openFeedProductDetails('${jsq(p)}')"><strong>🌾 ${esc(p)}</strong><small>Feed Unit product</small></div>`));
  prods.slice(0,8).forEach(p=>items.push(`<div class="search-result" onclick="closeModal();openProductDetails('${jsq(p)}')"><strong>🏭 ${esc(p)}</strong><small>Production product</small></div>`));
  bags.slice(0,8).forEach(p=>items.push(`<div class="search-result" onclick="closeModal();openBagProduct('${jsq(p)}')"><strong>👜 ${esc(p)}</strong><small>PP Bags product</small></div>`));
  el.innerHTML=items.join("")||"<div class='empty'>No matching material or product.</div>";
}

let MIX_MONTH=null;
function monthKey(v){const d=dateOnly(v);return d?d.slice(0,7):""}
function monthLabel(m){
  if(!m)return "Latest";
  const p=m.split("-");
  const d=new Date(Number(p[0]),Number(p[1])-1,1);
  return d.toLocaleDateString("en-IN",{month:"long",year:"numeric"});
}
function mixAvailableMonths(){
  const s=new Set();
  (DATA.stock||[]).forEach(x=>(x.transactions||[]).forEach(t=>{const m=monthKey(rowDate(t));if(m)s.add(m)}));
  (DATA.stockHistory||[]).forEach(t=>{const m=monthKey(rowDate(t));if(m)s.add(m)});
  (DATA.feedUnitData||[]).forEach(r=>{const m=monthKey(r.report_date||r.Report_Date);if(m)s.add(m)});
  if(DATA.report_date){const m=monthKey(DATA.report_date);if(m)s.add(m)}
  return [...s].filter(Boolean).sort().reverse();
}
function mixDefaultMonth(){return monthKey(VIEW_DATE||DATA.report_date)||mixAvailableMonths()[0]||""}
function isConsumptionMovement(ty){return ty.includes("CONSUMPTION")||ty.includes("CONSUMPION")||ty.includes("CONSUMPTON")||ty.includes("CONSUMPTI")}
function allMixMaterialTransactions(){
  const out=[];
  (DATA.stock||[]).forEach(x=>{
    const material=clean(x.material); if(!material)return;
    (Array.isArray(x.transactions)?x.transactions:[]).forEach(t=>out.push({material,t}));
  });
  // Use history only when the current stock objects do not contain transaction history.
  // Do not deduplicate rows: genuine duplicate transactions must remain countable.
  if(!out.length){
    (DATA.stockHistory||[]).forEach(t=>{const material=clean(t.material);if(material)out.push({material,t})});
  }
  return out;
}
function monthlyRMConsumption(m){
  // RM transaction rows contain cumulative MTD values in for_month.
  // For a month, use the latest dated Consumption record for each material
  // instead of summing daily/MTD snapshots (which would double-count).
  const latest={};
  allMixMaterialTransactions().forEach(({material,t})=>{
    const d=rowDate(t);
    if(monthKey(d)!==m || !isConsumptionMovement(tType(t)))return;
    const day=dateOnly(d)||"";
    const key=normalize(material);
    if(!latest[key] || day>=latest[key].day){
      latest[key]={material,t,day};
    }
  });

  return Object.values(latest).map(({material,t})=>{
    const monthly=num(t.for_month??t.For_Month??t.monthly_consumption??t.Monthly_Consumption);
    const value=monthly!==null
      ? materialValueInMT(Math.abs(monthly),material)
      : materialValueInMT(tVal(t),material);
    return {name:material,value};
  }).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
}
function monthlyFeedMix(m,key){
  const rows=(DATA.feedUnitData||[]).filter(r=>monthKey(r.report_date||r.Report_Date)===m);
  const latest={};
  rows.forEach((r,i)=>{
    const p=clean(r.Product||r.product); if(!p)return;
    const d=dateOnly(r.report_date||r.Report_Date)||"";
    const k=normalize(p);
    if(!latest[k] || d>=latest[k].__mixDate)latest[k]={...r,__mixDate:d,__mixIndex:i};
    else if(d===latest[k].__mixDate)latest[k].__mixIndex=i;
  });
  const result=[];
  Object.values(latest).forEach(r=>{
    const p=r.Product||r.product||"";
    let value=feedField(r,key);
    if(value===null){
      value=rows.filter(x=>normalize(x.Product||x.product)===normalize(p)).reduce((a,x)=>a+(key.includes("Production")?(num(x.Production_Day_MT??x.production_day_mt??x.Production??x.production)||0):(num(x.Dispatch_Day_MT??x.dispatch_day_mt??x.Dispatch??x.dispatch)||0)),0);
    }
    value=feedValueInMT(value,p);
    if(value>0)result.push({name:p,value});
  });
  return result.sort((a,b)=>b.value-a.value);
}
function mixTop5(rows){
  const top=rows.slice(0,5),others=rows.slice(5).reduce((a,r)=>a+r.value,0);
  if(others>0)top.push({name:"Others",value:others,others:true});
  return top;
}
function renderMixList(id,rows,total){
  const el=document.getElementById(id); if(!el)return;
  if(!rows.length){el.innerHTML="<div class='empty'>No monthly data available.</div>";return}
  el.innerHTML=mixTop5(rows).map(r=>{
    const pct=total>0?(r.value/total*100):0;
    return `<div class="mix-row ${r.others?"mix-others":""}"><div class="mix-row-top"><span class="mix-name" title="${esc(r.name)}">${esc(r.name)}</span><span class="mix-value">${fmt(r.value)} MT <span class="mix-pct">${fmt(pct)}%</span></span></div><div class="mix-bar"><div class="mix-fill" style="width:${Math.min(100,pct)}%"></div></div></div>`;
  }).join("");
}
function renderMonthlyMix(){
  const sel=document.getElementById("mixMonthSelect"); if(!sel)return;
  const months=mixAvailableMonths();
  const wanted=MIX_MONTH&&months.includes(MIX_MONTH)?MIX_MONTH:mixDefaultMonth();
  MIX_MONTH=wanted;
  sel.innerHTML=months.map(m=>`<option value="${m}">${esc(monthLabel(m))}</option>`).join("");
  if(wanted)sel.value=wanted;
  const rm=monthlyRMConsumption(wanted),prod=monthlyFeedMix(wanted,"Production_Month_MT"),disp=monthlyFeedMix(wanted,"Dispatch_Month_MT");
  const rt=rm.reduce((a,r)=>a+r.value,0),pt=prod.reduce((a,r)=>a+r.value,0),dt=disp.reduce((a,r)=>a+r.value,0);
  setText("mixRmTotal",`Total ${fmt(rt)} MT`);setText("mixProdTotal",`Total ${fmt(pt)} MT`);setText("mixDispTotal",`Total ${fmt(dt)} MT`);
  renderMixList("mixRmList",rm,rt);renderMixList("mixProdList",prod,pt);renderMixList("mixDispList",disp,dt);
}
function setMixMonth(m){MIX_MONTH=m||null;renderMonthlyMix()}
function setMonthlyMixTab(type,btn){
  const allowed=['rm','production','dispatch'];
  const active=allowed.includes(type)?type:'rm';
  document.querySelectorAll('.monthly-mix-tab').forEach(b=>b.classList.toggle('active',b.dataset.mixTab===active));
  document.querySelectorAll('.monthly-mix-tab-panel').forEach(panel=>{
    const show=panel.dataset.mixPanel===active;
    panel.classList.toggle('active',show);
    panel.hidden=!show;
  });
}
function openMonthlyMixDetails(type){
  const m=MIX_MONTH||mixDefaultMonth(), label=monthLabel(m);
  let title="",rows=[];
  if(type==="rm"){title="🧪 RM Consumption Mix";rows=monthlyRMConsumption(m)}
  else if(type==="production"){title="🏭 Production Mix";rows=monthlyFeedMix(m,"Production_Month_MT")}
  else {title="🚚 Dispatch Mix";rows=monthlyFeedMix(m,"Dispatch_Month_MT")}
  const total=rows.reduce((a,r)=>a+r.value,0);
  const html=`<div class="detail-section"><h3>${title} • ${esc(label)}</h3>${detail("Monthly Total",fmtMT(total))}</div><div class="detail-section mix-detail-list">${rows.map(r=>{const pct=total?(r.value/total*100):0;return `<div class="mix-detail-row"><div class="mix-detail-main"><div class="mix-detail-name">${esc(r.name)}</div><div class="mix-detail-bar"><div class="mix-detail-fill" style="width:${Math.min(100,pct)}%;background:${type==="rm"?"#55b978":type==="production"?"#7657d9":"#e9a43a"}"></div></div></div><div class="mix-detail-right"><strong>${fmt(r.value)} MT</strong><small>${fmt(pct)}%</small></div></div>`}).join("")||"<div class='empty'>No monthly data available.</div>"}</div><div class="small-note">Percentage = item monthly value ÷ monthly total × 100.</div>`;
  showModal(title+" • "+label,html);
}

function formatSectionDate(v){
  const d=dateOnly(v);
  if(!d)return "Data: --";
  const m=d.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(!m)return "Data: "+d;
  const names=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `Data: ${m[3]}-${names[Number(m[2])-1]||m[2]}-${m[1]}`;
}
function latestDateFromRows(rows, keys=[]){
  const dates=[];
  (Array.isArray(rows)?rows:[]).forEach(r=>{
    if(!r)return;
    keys.forEach(k=>{if(r[k]){const d=dateOnly(r[k]);if(d)dates.push(d)}});
  });
  return dates.sort().pop()||"";
}
function latestStockDataDate(){
  const dates=[];
  (DATA.stock||[]).forEach(r=>{
    [r.report_date,r.Report_Date,r.date,r.DATE].forEach(v=>{const d=dateOnly(v);if(d)dates.push(d)});
    (r.transactions||[]).forEach(t=>{const d=dateOnly(rowDate(t));if(d)dates.push(d)});
  });
  (DATA.stockHistory||[]).forEach(r=>{const d=dateOnly(r.report_date||r.Report_Date||r.date);if(d)dates.push(d)});
  return dates.sort().pop()||"";
}
function latestProductionDataDate(){
  const dates=[];
  (DATA.production||[]).forEach(r=>{const d=dateOnly(r.report_date||r.Report_Date||r.date);if(d)dates.push(d)});
  (DATA.productionHistory||[]).forEach(r=>{const d=dateOnly(r.report_date||r.Report_Date||r.date);if(d)dates.push(d)});
  (DATA.productionTrend||[]).forEach(r=>{const d=dateOnly(r.report_date||r.Report_Date||r.date);if(d)dates.push(d)});
  return dates.sort().pop()||"";
}
function latestFeedUnitDataDate(){
  return latestDateFromRows(DATA.feedUnitData,["report_date","Report_Date","date","DATE"])||latestDateFromRows(DATA.feedUnitTotals,["report_date","Report_Date","date","DATE"]);
}
function latestPPBagDataDate(){
  const a=latestDateFromRows(DATA.bags,["report_date","Report_Date","date","DATE"]);
  const b=latestDateFromRows(DATA.bagsHistory,["report_date","Report_Date","date","DATE"]);
  return [a,b].filter(Boolean).sort().pop()||"";
}
function latestTrendDataDate(){
  return [latestStockDataDate(),latestProductionDataDate(),latestFeedUnitDataDate(),latestPPBagDataDate(),dateOnly(DATA.report_date)].filter(Boolean).sort().pop()||"";
}
function latestSpareDataDate(tab=spareTab){
  const rows=Array.isArray(SPARE_DATA[tab])?SPARE_DATA[tab]:[];
  const dates=[];
  rows.forEach(r=>{
    Object.keys(r||{}).forEach(k=>{
      const nk=normalize(k);
      if(nk.includes("DATE")||nk.includes("UPDATED")){
        const d=dateOnly(r[k]);if(d)dates.push(d);
      }
    });
  });
  return dates.sort().pop()||"";
}
function updateSectionDates(){
  const selected=VIEW_DATE?dateOnly(VIEW_DATE):"";
  const stockDate=selected||latestStockDataDate()||dateOnly(DATA.report_date);
  const prodDate=selected||latestProductionDataDate()||dateOnly(DATA.report_date);
  const feedDate=selected||latestFeedUnitDataDate()||dateOnly(DATA.report_date);
  const bagDate=selected||latestPPBagDataDate()||dateOnly(DATA.report_date);
  const trendDate=selected||latestTrendDataDate()||dateOnly(DATA.report_date);
  setText("dateQuickView",formatSectionDate(selected||dateOnly(DATA.report_date)||trendDate));
  setText("datePremix",formatSectionDate(selected||latestBommakalDate()||dateOnly(DATA.report_date)));
  setText("dateMonthlyMix",MIX_MONTH?`Month: ${monthLabel(MIX_MONTH)}`:"Month: --");
  setText("dateRawReorder",formatSectionDate(stockDate));
  setText("dateProduction",formatSectionDate(prodDate));
  setText("dateFeedUnit",formatSectionDate(feedDate));
  setText("dateRawMovements",formatSectionDate(stockDate));
  setText("datePPBags",formatSectionDate(bagDate));
  setText("dateTrends",trendDate?`Data through: ${formatSectionDate(trendDate).replace(/^Data: /,"")}`:"Data through: --");
  const spareDate=latestSpareDataDate(spareTab);
  setText("dateSpareParts",spareDate?formatSectionDate(spareDate):"Data: --");
  setText("trendDateMaterial",formatSectionDate(stockDate));
  setText("trendDatePurchase",formatSectionDate(stockDate));
  setText("trendDateClosing",formatSectionDate(stockDate));
  setText("trendDateProduction",trendDate?`Data through: ${formatSectionDate(trendDate).replace(/^Data: /,"")}`:"Data through: --");
  setText("trendDateOutput",formatSectionDate(prodDate));
  setText("trendDateLoss",formatSectionDate(prodDate));
  setText("trendDateFeed",formatSectionDate(feedDate));
  setText("trendDateBags",formatSectionDate(bagDate));
}


/* =====================================================
   COLLAPSED HISTORY CARDS — MATERIAL / PRODUCT / DATE
===================================================== */
function toggleHistoryCard(cardId,bodyId){
  const card=document.getElementById(cardId), body=document.getElementById(bodyId);
  if(!card||!body)return;
  const opening=!card.classList.contains("open");
  card.classList.toggle("open",opening);
  const key=cardId.replace("HistoryCard","");
  const chev=document.getElementById(key+"HistoryChevron");
  if(chev)chev.textContent=opening?"−":"＋";
  if(opening){
    if(key==="rm")renderRMHistoryCard();
    else if(key==="feed")renderFeedHistoryCard();
    else if(key==="bags")renderBagsHistoryCard();
  }
}
function historyDateOptions(dates,selected){
  return dates.slice().sort().reverse().map(d=>`<option value="${esc(d)}" ${d===selected?"selected":""}>${esc(d)}</option>`).join("");
}
function historySelectOptions(items,selected){
  return items.map(x=>`<option value="${esc(x)}" ${normalize(x)===normalize(selected)?"selected":""}>${esc(x)}</option>`).join("");
}
function rmHistoryTransactions(material){
  const target=normalize(material),map=new Map();
  /* Prefer the dedicated stock_history because it contains the full dated
     movement history. Current STOCK transaction arrays can be only a latest
     snapshot on some API responses. */
  (DATA.stockHistory||[]).forEach(t=>{
    if(normalize(t.material)!==target)return;
    const d=dateOnly(rowDate(t));
    const key=[d,tType(t),String(tVal(t)),String(t.for_day??""),String(t.for_month??""),String(t.for_year??"")].join("|");
    map.set(key,t);
  });
  /* If stock_history is unavailable for this material, fall back to the
     transactions embedded in the current stock object. */
  if(!map.size){
    (DATA.stock||[]).forEach(x=>{
      if(normalize(x.material)!==target)return;
      (Array.isArray(x.transactions)?x.transactions:[]).forEach(t=>{
        const d=dateOnly(rowDate(t));
        const key=[d,tType(t),String(tVal(t)),String(t.for_day??""),String(t.for_month??""),String(t.for_year??"")].join("|");
        map.set(key,t);
      });
    });
  }
  return [...map.values()].sort((a,b)=>dateOnly(rowDate(a)).localeCompare(dateOnly(rowDate(b))));
}
function rmHistoryMaterials(){
  const set=new Map();
  (DATA.stock||[]).forEach(x=>{const m=clean(x.material);if(m)set.set(normalize(m),m)});
  (DATA.stockHistory||[]).forEach(x=>{const m=clean(x.material);if(m)set.set(normalize(m),m)});
  return [...set.values()].sort((a,b)=>a.localeCompare(b));
}
function rmHistoryDates(material){
  return [...new Set(rmHistoryTransactions(material).map(t=>dateOnly(rowDate(t))).filter(Boolean))].sort().reverse();
}
function rmHistoryValue(rows,kind){
  return rows.filter(t=>{
    const type=tType(t);
    if(kind==="received")return type==="PURCHASE";
    if(kind==="consumption")return type.includes("CONSUMPTION");
    if(kind==="transfer")return type.includes("TRANSFER");
    return type==="CL. STOCK";
  }).reduce((sum,t)=>sum+tVal(t),0);
}
function rmHistoryClosing(rows){
  const r=rows.filter(t=>tType(t)==="CL. STOCK").slice(-1)[0];
  return r? tVal(r):null;
}
function historyRangeDefaults(dates){
  const ds=[...new Set(dates.filter(Boolean))].sort();
  if(!ds.length)return {all:[],from:"",to:""};
  const last=ds[ds.length-1];
  const from=ds[Math.max(0,ds.length-7)];
  return {all:ds,from,to:last};
}
function historyRangeOptions(dates,selected){
  return dates.slice().sort().reverse().map(d=>`<option value="${esc(d)}" ${d===selected?"selected":""}>${esc(d)}</option>`).join("");
}
function inHistoryRange(d,from,to){return !!d && (!from||d>=from) && (!to||d<=to)}
function rmHistoryRowsForRange(material,from,to){
  return rmHistoryTransactions(material).filter(t=>inHistoryRange(dateOnly(rowDate(t)),from,to));
}
function renderRMHistoryCard(){
  const body=document.getElementById("rmHistoryBody");if(!body)return;
  const mats=rmHistoryMaterials(),material=mats[0]||"",defaults=historyRangeDefaults(rmHistoryDates(material));
  body.innerHTML=`<div class="history-filter history-filter-3">
    <label>Material<select id="rmHistoryMaterial" onchange="refreshRMHistoryCard()">${historySelectOptions(mats,material)}</select></label>
    <label>From Date<select id="rmHistoryFrom">${historyRangeOptions(defaults.all,defaults.from)}</select></label>
    <label>To Date<select id="rmHistoryTo">${historyRangeOptions(defaults.all,defaults.to)}</select></label>
  </div><div id="rmHistoryTable"></div>`;
  document.getElementById("rmHistoryFrom")?.addEventListener("change",refreshRMHistoryTable);
  document.getElementById("rmHistoryTo")?.addEventListener("change",refreshRMHistoryTable);
  refreshRMHistoryTable();
}
function refreshRMHistoryCard(){
  const m=document.getElementById("rmHistoryMaterial")?.value||"";
  const dates=rmHistoryDates(m),defaults=historyRangeDefaults(dates);
  const fs=document.getElementById("rmHistoryFrom"),ts=document.getElementById("rmHistoryTo");
  if(fs)fs.innerHTML=historyRangeOptions(defaults.all,defaults.from);
  if(ts)ts.innerHTML=historyRangeOptions(defaults.all,defaults.to);
  fs?.addEventListener("change",refreshRMHistoryTable);ts?.addEventListener("change",refreshRMHistoryTable);
  refreshRMHistoryTable();
}
function refreshRMHistoryTable(){
  const m=document.getElementById("rmHistoryMaterial")?.value||"",from=document.getElementById("rmHistoryFrom")?.value||"",to=document.getElementById("rmHistoryTo")?.value||"",el=document.getElementById("rmHistoryTable");
  if(!el)return;
  if(from&&to&&from>to){el.innerHTML='<div class="history-empty">From Date must be before To Date.</div>';return}
  const unit=materialUnit(m,getMaterial(m)?.unit||"MT");
  const rows=rmHistoryTransactions(m).filter(t=>inHistoryRange(dateOnly(rowDate(t)),from,to));
  const dates=[...new Set(rows.map(t=>dateOnly(rowDate(t))).filter(Boolean))].sort();
  if(!dates.length){el.innerHTML='<div class="history-empty">No history available for selected date range.</div>';return}
  el.innerHTML=`<div class="history-range-note">${esc(from)} → ${esc(to)} • ${dates.length} days</div><div class="history-table"><table><thead><tr><th>Date</th><th>Received</th><th>Consumption</th><th>Transfer</th><th>Closing</th></tr></thead><tbody>${dates.map(d=>{const day=rows.filter(t=>dateOnly(rowDate(t))===d);const received=rmHistoryValue(day,"received"),consumption=rmHistoryValue(day,"consumption"),transfer=rmHistoryValue(day,"transfer"),closing=rmHistoryClosing(day);return `<tr><td>${esc(d)}</td><td>${fmt(received)} ${esc(unit)}</td><td>${fmt(consumption)} ${esc(unit)}</td><td>${fmt(transfer)} ${esc(unit)}</td><td>${closing===null?"--":fmt(closing)+" "+esc(unit)}</td></tr>`}).join("")}</tbody></table></div>`;
}
function feedHistoryProducts(){
  const set=new Map();
  (DATA.feedUnitData||[]).forEach(r=>{const p=clean(r.Product||r.product);if(p)set.set(normalize(p),p)});
  return [...set.values()].sort((a,b)=>a.localeCompare(b));
}
function feedHistoryRows(product){return (DATA.feedUnitData||[]).filter(r=>normalize(r.Product||r.product)===normalize(product));}
function feedHistoryDates(product){return [...new Set(feedHistoryRows(product).map(r=>dateOnly(r.Report_Date||r.report_date||r.date)).filter(Boolean))].sort();}
function feedHistoryValue(r,names){for(const n of names){const v=num(r[n]);if(v!==null)return v}return null;}
function renderFeedHistoryCard(){
  const body=document.getElementById("feedHistoryBody");if(!body)return;
  const products=feedHistoryProducts(),product=products[0]||"",defaults=historyRangeDefaults(feedHistoryDates(product));
  body.innerHTML=`<div class="history-filter history-filter-3"><label>Product<select id="feedHistoryProduct" onchange="refreshFeedHistoryCard()">${historySelectOptions(products,product)}</select></label><label>From Date<select id="feedHistoryFrom">${historyRangeOptions(defaults.all,defaults.from)}</select></label><label>To Date<select id="feedHistoryTo">${historyRangeOptions(defaults.all,defaults.to)}</select></label></div><div id="feedHistoryTable"></div>`;
  document.getElementById("feedHistoryFrom")?.addEventListener("change",refreshFeedHistoryTable);document.getElementById("feedHistoryTo")?.addEventListener("change",refreshFeedHistoryTable);refreshFeedHistoryTable();
}
function refreshFeedHistoryCard(){
  const p=document.getElementById("feedHistoryProduct")?.value||"",dates=feedHistoryDates(p),defaults=historyRangeDefaults(dates),fs=document.getElementById("feedHistoryFrom"),ts=document.getElementById("feedHistoryTo");
  if(fs)fs.innerHTML=historyRangeOptions(defaults.all,defaults.from);if(ts)ts.innerHTML=historyRangeOptions(defaults.all,defaults.to);
  fs?.addEventListener("change",refreshFeedHistoryTable);ts?.addEventListener("change",refreshFeedHistoryTable);refreshFeedHistoryTable();
}
function refreshFeedHistoryTable(){
  const p=document.getElementById("feedHistoryProduct")?.value||"",from=document.getElementById("feedHistoryFrom")?.value||"",to=document.getElementById("feedHistoryTo")?.value||"",el=document.getElementById("feedHistoryTable");if(!el)return;
  if(from&&to&&from>to){el.innerHTML='<div class="history-empty">From Date must be before To Date.</div>';return}
  const rows=feedHistoryRows(p),dates=[...new Set(rows.map(r=>dateOnly(r.Report_Date||r.report_date||r.date)).filter(d=>inHistoryRange(d,from,to)))].sort();
  if(!dates.length){el.innerHTML='<div class="history-empty">No history available for selected date range.</div>';return}
  el.innerHTML=`<div class="history-range-note">${esc(from)} → ${esc(to)} • ${dates.length} days</div><div class="history-table"><table><thead><tr><th>Date</th><th>Production</th><th>Dispatch</th><th>Closing</th></tr></thead><tbody>${dates.map(d=>{const rr=rows.filter(r=>dateOnly(r.Report_Date||r.report_date||r.date)===d);const r=rr[rr.length-1];const prod=feedHistoryValue(r,["Production_Day_MT","production_day_mt","Production_Day","production_day","Production","production"]),disp=feedHistoryValue(r,["Dispatch_Day_MT","dispatch_day_mt","Dispatch_Day","dispatch_day","Dispatch","dispatch"]),close=feedHistoryValue(r,["Closing_Day_MT","closing_day_mt","Closing_Day","closing_day","Closing","closing"]);return `<tr><td>${esc(d)}</td><td>${prod===null?"--":fmtFeed(prod,p)}</td><td>${disp===null?"--":fmtFeed(disp,p)}</td><td>${close===null?"--":fmtFeed(close,p)}</td></tr>`}).join("")}</tbody></table></div>`;
}
function bagsHistoryProducts(){
  const set=new Map();
  (DATA.bags||[]).forEach(r=>{const p=clean(r.product||"PP Bags");if(p)set.set(normalize(p),p)});
  (DATA.bagsHistory||[]).forEach(r=>{const p=clean(r.product||"PP Bags");if(p)set.set(normalize(p),p)});
  return [...set.values()].sort((a,b)=>a.localeCompare(b));
}
function bagsHistoryRows(product){const rows=(DATA.bagsHistory||[]).filter(r=>normalize(r.product||"PP Bags")===normalize(product));return rows.length?rows:(DATA.bags||[]).filter(r=>normalize(r.product||"PP Bags")===normalize(product));}
function bagsHistoryDates(product){return [...new Set(bagsHistoryRows(product).map(r=>dateOnly(r.report_date||r.Report_Date||r.date||r.DATE)).filter(Boolean))].sort();}
function renderBagsHistoryCard(){
  const body=document.getElementById("bagsHistoryBody");if(!body)return;
  const products=bagsHistoryProducts(),product=products[0]||"",defaults=historyRangeDefaults(bagsHistoryDates(product));
  body.innerHTML=`<div class="history-filter history-filter-3"><label>Product<select id="bagsHistoryProduct" onchange="refreshBagsHistoryCard()">${historySelectOptions(products,product)}</select></label><label>From Date<select id="bagsHistoryFrom">${historyRangeOptions(defaults.all,defaults.from)}</select></label><label>To Date<select id="bagsHistoryTo">${historyRangeOptions(defaults.all,defaults.to)}</select></label></div><div id="bagsHistoryTable"></div>`;
  document.getElementById("bagsHistoryFrom")?.addEventListener("change",refreshBagsHistoryTable);document.getElementById("bagsHistoryTo")?.addEventListener("change",refreshBagsHistoryTable);refreshBagsHistoryTable();
}
function refreshBagsHistoryCard(){
  const p=document.getElementById("bagsHistoryProduct")?.value||"",dates=bagsHistoryDates(p),defaults=historyRangeDefaults(dates),fs=document.getElementById("bagsHistoryFrom"),ts=document.getElementById("bagsHistoryTo");
  if(fs)fs.innerHTML=historyRangeOptions(defaults.all,defaults.from);if(ts)ts.innerHTML=historyRangeOptions(defaults.all,defaults.to);
  fs?.addEventListener("change",refreshBagsHistoryTable);ts?.addEventListener("change",refreshBagsHistoryTable);refreshBagsHistoryTable();
}
function refreshBagsHistoryTable(){
  const p=document.getElementById("bagsHistoryProduct")?.value||"",from=document.getElementById("bagsHistoryFrom")?.value||"",to=document.getElementById("bagsHistoryTo")?.value||"",el=document.getElementById("bagsHistoryTable");if(!el)return;
  if(from&&to&&from>to){el.innerHTML='<div class="history-empty">From Date must be before To Date.</div>';return}
  const rows=bagsHistoryRows(p),dates=[...new Set(rows.map(r=>dateOnly(r.report_date||r.Report_Date||r.date||r.DATE)).filter(d=>inHistoryRange(d,from,to)))].sort();
  if(!dates.length){el.innerHTML='<div class="history-empty">No history available for selected date range.</div>';return}
  el.innerHTML=`<div class="history-range-note">${esc(from)} → ${esc(to)} • ${dates.length} days</div><div class="history-table"><table><thead><tr><th>Date</th><th>Received</th><th>Issue</th><th>Damage</th><th>Closing</th></tr></thead><tbody>${dates.map(d=>{const rr=rows.filter(r=>dateOnly(r.report_date||r.Report_Date||r.date||r.DATE)===d),r=rr[rr.length-1],v=k=>num(r[k]);return `<tr><td>${esc(d)}</td><td>${v("received")===null?"--":fmt(v("received"))}</td><td>${v("issue")===null?"--":fmt(v("issue"))}</td><td>${v("damage")===null?"--":fmt(v("damage"))}</td><td>${v("closing")===null?"--":fmt(v("closing"))}</td></tr>`}).join("")}</tbody></table></div>`;
}


function renderDashboard(){
  initReportCenter();
  renderSmartHeader();
  renderQuick();
  renderMonthlyMix();
  renderControlCenter();
  renderPremixTransfers();
  renderFeedUnit();
  renderStock();
  renderProduction();
  renderPPBags();
  renderAlerts();
  renderRawCategory("STOCK");
  renderTrends();
  updateSectionDates();
}


function renderSmartHeader(){
  const d=selectedDateForIntelligence()||dateOnly(DATA.report_date)||"";
  setText("reportDate",d||"Latest");
  setText("selectedDateChip",VIEW_DATE?d:"Latest");
  setText("dateStripTitle",d?d:"Latest available day");
  setText("dateStripSub",VIEW_DATE?"Selected dashboard date":"Tap to select another day");
  setText("dateStripState",VIEW_DATE?"SELECTED":"LATEST");
  const h=new Date().getHours();
  setText("smartGreeting",h<12?"GOOD MORNING, SIR":h<17?"GOOD AFTERNOON, SIR":"GOOD EVENING, SIR");
}
function shiftViewDate(dir){
  const dates=allAvailableDates().slice().sort();
  if(!dates.length)return;
  const current=selectedDateForIntelligence()||dates[dates.length-1];
  let idx=dates.indexOf(dateOnly(current));
  if(idx<0)idx=dates.length-1;
  const next=dates[Math.max(0,Math.min(dates.length-1,idx+dir))];
  if(next)setViewDate(next);
}



function stockStatus(closing,avg){
  if(!avg)return {cover:null,status:"NO HISTORY",cls:"warn"};
  const cover=closing/avg;
  const reorder=avg*DEFAULT_SAFETY_DAYS;
  if(closing<=reorder)return {cover,status:"REORDER",cls:"bad"};
  if(cover<=DEFAULT_SAFETY_DAYS*1.5)return {cover,status:"WATCH",cls:"warn"};
  return {cover,status:"OK",cls:"good"};
}








function renderAlerts(){
  const items=[];
  const reorder=Array.isArray(DATA.reorder_items)?DATA.reorder_items:[];
  reorder.forEach(r=>{
    const title=clean(r.material||r.Material||r.name||r.product);
    if(title)items.push({title,msg:"Stock is at/below reorder level",type:"critical",icon:"🔴"});
  });
  if(!reorder.length){
    getMaterials().forEach(m=>{
      const x=getMaterial(m),s=stockStatus(num(x?.closing)||0,avgConsumption(m));
      if(s.status==="REORDER")items.push({title:m,msg:"Stock is at/below reorder level",type:"critical",icon:"🔴"});
      else if(s.status==="WATCH")items.push({title:m,msg:"Stock coverage is getting low",type:"warning",icon:"🟠"});
    });
  }
  DATA.production.forEach(r=>{
    const op=num(r.output_percentage);
    if(op!==null&&op<95)items.push({title:r.product,msg:"Output below 95%",type:"warning",icon:"🟠"});
  });
  abnormalConsumptionItems().forEach(a=>{
    items.push({title:a.material,msg:`Consumption ${fmt(a.current)} is ${fmt(Math.abs(a.ratio*100-100))}% ${a.direction==="LOW"?"below":"above"} average`,type:"warning",icon:a.direction==="LOW"?"📉":"📈"});
  });
  reconciliationItems().filter(x=>x.r.status==="MISMATCH").forEach(x=>{
    items.push({title:x.material,msg:`Stock reconciliation difference ${fmt(x.r.diff)} ${materialUnit(x.material,getMaterial(x.material)?.unit||"MT")}`,type:"critical",icon:"⚠️"});
  });
  getMaterials().forEach(m=>{
    const closing=num(getMaterial(m)?.closing);
    if(closing!==null&&closing<0)items.push({title:m,msg:`Negative closing stock: ${fmt(closing)} ${materialUnit(m,getMaterial(m)?.unit||"MT")}`,type:"critical",icon:"🔴"});
  });
  DATA.bags.forEach(r=>{
    const damage=num(r.damage)||0;
    if(damage>0)items.push({title:r.product||"PP Bags",msg:`PP bag damage recorded: ${fmt(damage)}`,type:"warning",icon:"👜"});
  });
  ALERTS=items.filter(a=>!DISMISSED_ALERTS.has(alertKey(a)));
  const badge=document.getElementById("notifyBadge");
  if(badge){badge.textContent=ALERTS.length>99?"99+":String(ALERTS.length);badge.classList.toggle("hidden",ALERTS.length===0)}
}
function openNotifications(){
  if(!ALERTS.length){
    showModal("🔔 Alerts",`<div class="detail-section"><h3>All clear</h3><div class="empty">No active alerts right now.</div></div>`);
    return;
  }
  const critical=ALERTS.filter(a=>a.type==="critical"),warning=ALERTS.filter(a=>a.type==="warning");
  let html=`<div class="detail-section"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3>🔔 Active Alerts (${ALERTS.length})</h3><button class="clear-alerts" onclick="clearDismissedAlerts()">Reset dismissed</button></div>`;
  [...critical,...warning].forEach(a=>{
    const k=alertKey(a);
    html+=`<div class="transaction notification-item"><button class="notification-dismiss" onclick="dismissAlert('${jsq(k)}')" aria-label="Dismiss alert">×</button><div class="transaction-title"><strong>${a.icon} ${esc(a.title)}</strong><span>${a.type==="critical"?"Critical":"Warning"}</span></div><div style="font-size:11px;color:#666">${esc(a.msg)}</div></div>`;
  });
  html+=`</div>`;
  showModal("🔔 Alerts",html);
}

/* =====================================================
   RAW MATERIAL CATEGORY
===================================================== */
let currentRawTab="STOCK";
let rawMovementExpanded=false;
function setRawTab(btn,tab){document.querySelectorAll(".section-tabs button").forEach(x=>x.classList.remove("active"));btn.classList.add("active");currentRawTab=tab;rawMovementExpanded=false;renderRawCategory(tab)}
function toggleRawMovementMore(){rawMovementExpanded=!rawMovementExpanded;renderRawCategory(currentRawTab)}



/* =====================================================
   DETAILS
===================================================== */
function showModal(title,html){setText("modalTitle",title);document.getElementById("modalContent").innerHTML=html;document.getElementById("modal").classList.add("show")}
function closeModal(){document.getElementById("modal").classList.remove("show")}
function outsideClose(e){if(e.target.id==="modal")closeModal()}
function detail(label,value){return `<div class="detail-row"><span>${esc(label)}</span><strong>${esc(value??"--")}</strong></div>`}
function openMaterialDetails(material){
  const x=getMaterial(material),rows=transactions(material),closing=num(x?.closing)||0,avg=avgConsumption(material),s=stockStatus(closing,avg),reorder=avg*DEFAULT_SAFETY_DAYS;
  const groups=["OPENING STOCK","PURCHASE","TRANSFER FROM SOYA DIVISION","GAIN","SALE","SHORTAGE","CONSUMPTION","CL. STOCK"];
  const unit=materialUnit(material,x?.unit||"MT");
  const rec=materialReconciliation(material);
  let html=`<div class="detail-section"><h3>${esc(material)}</h3>${detail("Current Stock",fmt(closing)+" "+unit)}${detail("Average Daily Consumption",avg?fmt(avg)+" "+unit+"/day":"Insufficient history")}${detail("Safety Days",DEFAULT_SAFETY_DAYS+" days")}${detail("Stock Coverage",s.cover!==null?fmt(s.cover)+" days":"--")}${detail("Calculated Reorder Level",fmt(reorder)+" "+unit)}${detail("Status",s.status)}</div>`;
  if(rec.status==="MATCH"||rec.status==="MISMATCH"){
    const cls=rec.status==="MATCH"?"reconcile-ok":"reconcile-bad";
    html+=`<div class="detail-section ${cls}"><h3>🔎 Stock Reconciliation • ${esc(rec.date||"Latest")}</h3>${detail("Opening",fmt(rec.opening)+" "+unit)}${detail("Additions",fmt(rec.add)+" "+unit)}${detail("Other deductions",fmt(rec.otherOut)+" "+unit)}${detail("Actual Closing",fmt(rec.closing)+" "+unit)}${detail("Calculated Consumption",fmt(rec.calculated)+" "+unit)}${detail("Recorded Consumption",fmt(rec.recorded)+" "+unit)}${detail("Difference",fmt(rec.diff)+" "+unit)}${detail("Result",rec.status==="MATCH"?"✓ MATCH":"⚠ CHECK — possible missing/wrong transaction")}</div>`;
  }else{
    html+=`<div class="detail-section reconcile-warn"><h3>🔎 Stock Reconciliation</h3><div class="empty">${esc(rec.message||"Insufficient data for reconciliation.")}</div></div>`;
  }
  html+=`<div class="detail-section"><h3>Material-wise Movement</h3>`;
  groups.forEach(g=>{const total=rows.filter(t=>tType(t)===normalize(g)).reduce((a,t)=>a+tVal(t),0);if(total)html+=detail(g,fmt(total)+" "+unit)});
  const namedConsumption=rows.filter(t=>tType(t).includes("CONSUMPTION")).reduce((a,t)=>a+tVal(t),0);
  if(namedConsumption)html+=detail("All Consumption Activities",fmt(namedConsumption)+" "+unit);
  html+="</div>";
  if(rows.length){
    html+=`<div class="detail-section"><h3>Transactions</h3>`;
    rows.forEach(t=>{html+=`<div class="transaction"><div class="transaction-title"><strong>${esc(txName(t.transaction||t.type||"Movement"))}</strong><span>${esc(rowDate(t))}</span></div><div class="transaction-values"><div class="transaction-value"><span>FOR DAY</span><strong>${fmt(t.for_day)}</strong></div><div class="transaction-value"><span>FOR MONTH</span><strong>${fmt(t.for_month)}</strong></div><div class="transaction-value"><span>FOR YEAR</span><strong>${fmt(t.for_year)}</strong></div></div></div>`});
    html+="</div>";
  }
  showModal(material,html);
}
function openStockDetails(){showModal("Raw Material Stock",getMaterials().map(m=>{const x=getMaterial(m);return `<div class="feed-row" onclick="closeModal();openMaterialDetails('${jsq(m)}')"><div class="row-name">${esc(m)}</div><div class="row-right"><strong>${fmtMaterial(x?.closing,m,x?.unit||"MT")}</strong><small>Details →</small></div></div>`}).join("")||"<div class='empty'>No stock data</div>")}
function openRawCategory(tab){const rows=getMaterials().map(m=>({m,v:rawTotal(m,tab)})).sort((a,b)=>(b.v>0)-(a.v>0)||b.v-a.v);showModal(tab==="PURCHASE"?"Raw Material Received":("Raw Material "+tab),rows.map(({m,v})=>`<div class="feed-row" onclick="closeModal();openMaterialDetails('${jsq(m)}')"><div class="row-name">${esc(m)}</div><div class="row-right"><strong>${fmtMaterial(v,m,"MT")}</strong><small>Tap for complete details</small></div></div>`).join("")||"<div class='empty'>No data</div>")}
function openProductionDetails(){const rows=selectedProduction().slice().sort((a,b)=>{const av=num(a.actual_output)||0,bv=num(b.actual_output)||0;return (bv>0)-(av>0)||bv-av});showModal("Production",rows.map(r=>`<div class="feed-row" onclick="closeModal();openProductDetails('${jsq(r.product)}')"><div class="row-name">${esc(r.product)}</div><div class="row-right"><strong>${fmtBags(r.actual_output)}</strong><small>Output ${fmt(r.output_percentage)}%</small></div></div>`).join("")||"<div class='empty'>No production data</div>")}
function packingFromRemarks(v){const m=clean(v).match(/(\d+(?:\.\d+)?)\s*(?:bags?|Bags?).*?(\d+(?:\.\d+)?)\s*kg/i);return m?`${m[1]} Bags × ${m[2]} kg/bag`:clean(v)}
function productionReconciliation(product){
  const rows=selectedFeedRows().filter(r=>normalize(r.Product||r.product)===normalize(product));
  if(!rows.length)return {status:"NO DATA",message:"No Feed Unit data available for this date."};
  const r=rows[rows.length-1];
  const opening=num(r.Opening_Day_MT??r.opening_day_mt??r.Opening_Day??r.opening_day??r.Opening??r.opening);
  const production=num(r.Production_Day_MT??r.production_day_mt??r.Production_Day??r.production_day??r.Production??r.production);
  const transfer=num(r.Transfer_Day_MT??r.transfer_day_mt??r.Transfer??r.transfer);
  const dispatch=num(r.Dispatch_Day_MT??r.dispatch_day_mt??r.Dispatch??r.dispatch);
  const closing=num(r.Closing_Day_MT??r.closing_day_mt??r.Closing_Day??r.closing_day??r.Closing??r.closing);
  if(opening===null||closing===null)return {status:"NO DATA",message:"Opening/closing pair is not available for this date.",date:dateOnly(r.Report_Date||r.report_date),row:r};
  const calc=opening+(production||0)+(transfer||0)-(dispatch||0);
  const diff=closing-calc;
  const tol=isPremixProduct(product)?0.01:0.01;
  return {status:Math.abs(diff)<=tol?"MATCH":"MISMATCH",date:dateOnly(r.Report_Date||r.report_date),opening,production:production||0,transfer:transfer||0,dispatch:dispatch||0,closing,calculated:calc,diff,tolerance:tol,row:r};
}
function ppBagReconciliation(product){
  const rows=selectedBags().filter(r=>normalize(r.product||"PP Bags")===normalize(product));
  if(!rows.length)return {status:"NO DATA",message:"No PP Bags data available for this date."};
  const r=rows[rows.length-1];
  const opening=num(r.opening),received=num(r.received),issue=num(r.issue),damage=num(r.damage),closing=num(r.closing);
  if(opening===null||closing===null)return {status:"NO DATA",message:"Opening/closing pair is not available for this date.",date:dateOnly(r.report_date||r.Report_Date),row:r};
  const calc=opening+(received||0)-(issue||0)-(damage||0);
  const diff=closing-calc;
  return {status:Math.abs(diff)<=0.01?"MATCH":"MISMATCH",date:dateOnly(r.report_date||r.Report_Date),opening,received:received||0,issue:issue||0,damage:damage||0,closing,calculated:calc,diff,tolerance:0.01,row:r};
}
function feedUnitReconciliationItems(){
  return latestFeedRows().map(r=>({product:r.Product||r.product||"",r:productionReconciliation(r.Product||r.product||"")})).filter(x=>x.product);
}
function ppBagReconciliationItems(){
  return selectedBags().map(r=>r.product||"PP Bags").filter((v,i,a)=>a.findIndex(x=>normalize(x)===normalize(v))===i).map(product=>({product,r:ppBagReconciliation(product)}));
}
function openProductDetails(product){
  const r=selectedProduction().find(x=>normalize(x.product)===normalize(product));
  if(!r){showModal(product,"<div class='empty'>No data</div>");return}
  const rec=productionReconciliation(product);
  let html="";
  if(rec.status==="MATCH"||rec.status==="MISMATCH"){
    const cls=rec.status==="MATCH"?"reconcile-ok":"reconcile-bad";
    html+=`<div class="detail-section ${cls}"><h3>🔎 Production / Dispatch Reconciliation • ${esc(rec.date||"Latest")}</h3>${detail("Opening",fmtFeed(rec.opening,product))}${detail("Production",fmtFeed(rec.production,product))}${detail("Transfer",fmtFeed(rec.transfer,product))}${detail("Dispatch",fmtFeed(rec.dispatch,product))}${detail("Actual Closing",fmtFeed(rec.closing,product))}${detail("Calculated Closing",fmtFeed(rec.calculated,product))}${detail("Difference",fmtFeed(rec.diff,product))}${detail("Result",rec.status==="MATCH"?"✓ MATCH":"⚠ CHECK — possible mismatch")}</div>`;
  }else{
    html+=`<div class="detail-section reconcile-warn"><h3>🔎 Production / Dispatch Reconciliation</h3><div class="empty">${esc(rec.message||"Insufficient data for reconciliation.")}</div></div>`;
  }
  html+=`<div class="detail-section"><h3>${esc(product)}</h3>${detail("Standard Output",fmtBags(r.standard_output))}${detail("Actual Output",fmtBags(r.actual_output))}${detail("Output %",fmt(r.output_percentage)+" %")}${detail("Process Loss %",fmt(r.process_loss)+" %")}${detail("Remarks / Packing",packingFromRemarks(r.remarks))}</div>`;
  const fr=selectedFeedRows().find(x=>normalize(x.Product||x.product)===normalize(product));
  if(fr){
    html+=`<div class="detail-section"><h3>🌾 Feed Unit Details</h3>${detail("Opening Day",fmtFeed(fr.Opening_Day_MT??fr.opening_day_mt??fr.Opening_Day??fr.opening_day??fr.Opening??fr.opening,product))}${detail("Production Day",fmtFeed(fr.Production_Day_MT??fr.production_day_mt??fr.Production_Day??fr.production_day??fr.Production??fr.production,product))}${detail("Dispatch Day",fmtFeed(fr.Dispatch_Day_MT??fr.dispatch_day_mt??fr.Dispatch_Day??fr.dispatch_day??fr.Dispatch??fr.dispatch,product))}${detail("Transfer Day",fmtFeed(fr.Transfer_Day_MT??fr.transfer_day_mt??fr.Transfer_Day??fr.transfer_day??fr.Transfer??fr.transfer,product))}${detail("Closing Day",fmtFeed(fr.Closing_Day_MT??fr.closing_day_mt??fr.Closing_Day??fr.closing_day??fr.Closing??fr.closing,product))}${detail("Production Month",fmtFeed(fr.Production_Month_MT??fr.production_month_mt??fr.Production_Month??fr.production_month,product))}${detail("Dispatch Month",fmtFeed(fr.Dispatch_Month_MT??fr.dispatch_month_mt??fr.Dispatch_Month??fr.dispatch_month,product))}</div>`;
  }
  showModal(product,html);
}
function openPPBagDetails(){showModal("PP Bags",selectedBags().map(r=>`<div class="detail-section"><h3>${esc(r.product||"PP Bags")}</h3>${detail("Opening",fmt(r.opening))}${detail("Received",fmt(r.received))}${detail("Issue",fmt(r.issue))}${detail("Damage",fmt(r.damage))}${detail("Closing",fmt(r.closing))}</div>`).join("")||"<div class='empty'>No PP Bag data</div>")}
function openBagProduct(product){
  const r=selectedBags().find(x=>normalize(x.product||"PP Bags")===normalize(product));
  if(!r)return;
  const rec=ppBagReconciliation(product);
  let html="";
  if(rec.status==="MATCH"||rec.status==="MISMATCH"){
    const cls=rec.status==="MATCH"?"reconcile-ok":"reconcile-bad";
    html+=`<div class="detail-section ${cls}"><h3>🔎 PP Bags Reconciliation • ${esc(rec.date||"Latest")}</h3>${detail("Opening",fmt(rec.opening)+" Bags")}${detail("Received",fmt(rec.received)+" Bags")}${detail("Issue",fmt(rec.issue)+" Bags")}${detail("Damage",fmt(rec.damage)+" Bags")}${detail("Actual Closing",fmt(rec.closing)+" Bags")}${detail("Calculated Closing",fmt(rec.calculated)+" Bags")}${detail("Difference",fmt(rec.diff)+" Bags")}${detail("Result",rec.status==="MATCH"?"✓ MATCH":"⚠ CHECK — possible mismatch")}</div>`;
  }else{
    html+=`<div class="detail-section reconcile-warn"><h3>🔎 PP Bags Reconciliation</h3><div class="empty">${esc(rec.message||"Insufficient data for reconciliation.")}</div></div>`;
  }
  html+=`<div class="detail-section"><h3>${esc(product)}</h3>${detail("Opening",fmt(r.opening))}${detail("Received",fmt(r.received))}${detail("Issue",fmt(r.issue))}${detail("Damage",fmt(r.damage))}${detail("Closing",fmt(r.closing))}</div>`;
  showModal(product,html);
}
function openFeedTotals(type){
  const label={production_day:"Day Production",production_month:"Month Production",dispatch_day:"Day Dispatch",dispatch_month:"Month Dispatch"}[type]||"Feed Unit";
  const key={production_day:"Production_Day_MT",production_month:"Production_Month_MT",dispatch_day:"Dispatch_Day_MT",dispatch_month:"Dispatch_Month_MT"}[type];
  const total=latestTotal(key);
  const rows=latestFeedRows().slice().sort((a,b)=>{const av=num(feedField(a,key))||0,bv=num(feedField(b,key))||0;return (bv>0)-(av>0)||bv-av});
  showModal(label,`<div class="detail-section">${detail("Total",fmtMT(total))}</div>`+rows.map(r=>{const p=r.Product||r.product||"--";const v=feedField(r,key);return `<div class="feed-row" onclick="closeModal();openFeedProductDetails('${jsq(p)}')"><div class="row-name">${esc(p)}</div><div class="row-right"><strong>${fmtFeed(v,p)}</strong><small>Product details →</small></div></div>`}).join(""));
}
function openFeedProductDetails(product){
  const rows=selectedFeedRows().filter(r=>normalize(r.Product||r.product)===normalize(product));
  if(!rows.length){showModal(product,"<div class='empty'>No Feed Unit product data available for this date.</div>");return}
  const r=rows[rows.length-1];
  const rec=productionReconciliation(product);
  let html="";
  if(rec.status==="MATCH"||rec.status==="MISMATCH"){
    const cls=rec.status==="MATCH"?"reconcile-ok":"reconcile-bad";
    html+=`<div class="detail-section ${cls}"><h3>🔎 Production / Dispatch Reconciliation • ${esc(rec.date||"Latest")}</h3>${detail("Opening",fmtFeed(rec.opening,product))}${detail("Production",fmtFeed(rec.production,product))}${detail("Transfer",fmtFeed(rec.transfer,product))}${detail("Dispatch",fmtFeed(rec.dispatch,product))}${detail("Actual Closing",fmtFeed(rec.closing,product))}${detail("Calculated Closing",fmtFeed(rec.calculated,product))}${detail("Difference",fmtFeed(rec.diff,product))}${detail("Result",rec.status==="MATCH"?"✓ MATCH":"⚠ CHECK — possible mismatch")}</div>`;
  }else{
    html+=`<div class="detail-section reconcile-warn"><h3>🔎 Production / Dispatch Reconciliation</h3><div class="empty">${esc(rec.message||"Insufficient data for reconciliation.")}</div></div>`;
  }
  html+=`<div class="detail-section"><h3>${esc(product)}</h3>${detail("Opening Day",fmtFeed(r.Opening_Day_MT??r.opening_day_mt??r.Opening_Day??r.opening_day??r.Opening??r.opening,product))}${detail("Production Day",fmtFeed(r.Production_Day_MT??r.production_day_mt??r.Production_Day??r.production_day??r.Production??r.production,product))}${detail("Dispatch Day",fmtFeed(r.Dispatch_Day_MT??r.dispatch_day_mt??r.Dispatch_Day??r.dispatch_day??r.Dispatch??r.dispatch,product))}${isPremixProduct(product)?detail("Received from Bommakal",fmtFeed(r.Transfer_Day_MT??r.transfer_day_mt??r.Transfer_Day??r.transfer_day??r.Transfer??r.transfer,product)):""}${detail("Transfer Day",fmtFeed(r.Transfer_Day_MT??r.transfer_day_mt??r.Transfer_Day??r.transfer_day??r.Transfer??r.transfer,product))}${detail("Closing Day",fmtFeed(r.Closing_Day_MT??r.closing_day_mt??r.Closing_Day??r.closing_day??r.Closing??r.closing,product))}${detail("Production Month",fmtFeed(r.Production_Month_MT??r.production_month_mt??r.Production_Month??r.production_month,product))}${detail("Dispatch Month",fmtFeed(r.Dispatch_Month_MT??r.dispatch_month_mt??r.Dispatch_Month??r.dispatch_month,product))}</div>`;
  if(rows.length>1){html+=`<div class="detail-section"><h3>Available records</h3>`+rows.map(z=>`<div class="transaction">${detail("Date",z.Report_Date||z.report_date||"--")}${detail("Opening",fmtFeed(z.Opening_Day_MT??z.opening_day_mt??z.Opening_Day??z.opening_day??z.Opening??z.opening,product))}${detail("Production",fmtFeed(z.Production_Day_MT??z.production_day_mt,product))}${detail("Dispatch",fmtFeed(z.Dispatch_Day_MT??z.dispatch_day_mt,product))}${detail("Closing",fmtFeed(z.Closing_Day_MT??z.closing_day_mt,product))}</div>`).join("")+"</div>"}
  showModal(product,html);
}

/* =====================================================
   CHARTS
===================================================== */
function chart(canvasId,labels,series){
  const c=document.getElementById(canvasId);if(!c)return;
  const ctx=c.getContext("2d"),dpr=window.devicePixelRatio||1,w=c.clientWidth||320,h=150;
  c.width=w*dpr;c.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const vals=series.map(v=>num(v)||0);if(!vals.length){ctx.fillStyle="#888";ctx.font="12px sans-serif";ctx.fillText("No trend data",12,70);return}
  const max=Math.max(...vals,1),min=Math.min(...vals,0),range=max-min||1,pad={l:28,r:8,t:12,b:25};
  ctx.strokeStyle="#e7e8ea";ctx.lineWidth=1;for(let i=0;i<4;i++){const y=pad.t+(h-pad.t-pad.b)*i/3;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke()}
  ctx.strokeStyle="#315efb";ctx.lineWidth=2;ctx.beginPath();
  vals.forEach((v,i)=>{const x=pad.l+(w-pad.l-pad.r)*(vals.length===1?.5:i/(vals.length-1));const y=pad.t+(h-pad.t-pad.b)*(1-(v-min)/range);i?ctx.lineTo(x,y):ctx.moveTo(x,y)});
  ctx.stroke();ctx.fillStyle="#777";ctx.font="9px sans-serif";labels.forEach((l,i)=>{if(i%Math.ceil(labels.length/5)===0){const x=pad.l+(w-pad.l-pad.r)*(labels.length===1?.5:i/(labels.length-1));ctx.fillText(String(l).slice(-5),x-10,h-7)}});
}
function usageLabels(){const n=Math.max(...Object.values(DATA.usage).map(a=>Array.isArray(a)?a.length:0),0);return Array.from({length:n},(_,i)=>"D"+(i+1))}
function drawMaterialChart(material){chart("materialChart",usageLabels(),Array.isArray(DATA.usage[material])?DATA.usage[material]:[])}
function productionTrendData(){return DATA.productionTrend.map(x=>typeof x==="object"?num(x.actual_output??x.actual??x.value):num(x)).filter(v=>v!==null)}


function trendFromTransactions(type){
  const map={};getMaterials().forEach(m=>transactions(m).forEach(t=>{if(tType(t)===type){const d=rowDate(t)||"Latest";map[d]=(map[d]||0)+tVal(t)}}));
  const labels=Object.keys(map).sort();return {labels,values:labels.map(k=>map[k])}
}
function trendClosing(){
  const map={};getMaterials().forEach(m=>transactions(m).forEach(t=>{const d=rowDate(t);if(d&&tType(t)==="CL. STOCK")map[d]=(map[d]||0)+(num(t.for_day)||0)}));
  const labels=Object.keys(map).sort();return {labels,values:labels.map(k=>map[k])}
}





/* =====================================================
   NAVIGATION
===================================================== */
function goHome(){window.scrollTo({top:0,behavior:"smooth"})}
function goSpareParts(){document.getElementById("sparePartsSection")?.scrollIntoView({behavior:"smooth",block:"start"});loadSpareParts(false)}
function goTrend(){document.getElementById("trendsSection").scrollIntoView({behavior:"smooth"})}


/* =====================================================
   DATE VIEW — COMPLETE DASHBOARD DATE FILTER
===================================================== */
let VIEW_DATE=null;
function historyStockRowsForDate(date){
  const d=dateOnly(date);
  if(!d)return [];
  const grouped=new Map();
  (DATA.stockHistory||[]).forEach(t=>{
    if(dateOnly(rowDate(t))!==d)return;
    const material=clean(t.material);
    if(!material)return;
    const key=normalize(material);
    if(!grouped.has(key))grouped.set(key,{material,transactions:[]});
    grouped.get(key).transactions.push(t);
  });
  const current=new Map((DATA.stock||[]).map(x=>[normalize(x.material),x]));
  return [...grouped.values()].map(g=>{
    const base=current.get(normalize(g.material))||{};
    const closingRows=g.transactions.filter(t=>tType(t)==="CL. STOCK");
    const latestClosing=closingRows.length?closingRows[closingRows.length-1]:null;
    return {...base,material:g.material,transactions:g.transactions,closing:latestClosing?tVal(latestClosing):null};
  });
}
function viewStockRows(){
  if(VIEW_DATE){
    return historyStockRowsForDate(VIEW_DATE);
  }
  return (DATA.stock||[]).map(x=>{
    const tx=Array.isArray(x.transactions)?x.transactions:[];
    const closingRows=tx.filter(t=>tType(t)==="CL. STOCK");
    const latestClosing=closingRows.length?closingRows[closingRows.length-1]:null;
    return {...x,transactions:tx,closing:latestClosing?tVal(latestClosing):num(x.closing)};
  }).filter(x=>x.material);
}
function getMaterials(){
  return [...new Set(viewStockRows().map(x=>clean(x.material)).filter(Boolean))];
}
function getMaterial(material){
  return viewStockRows().find(x=>normalize(x.material)===normalize(material))||null;
}
function transactions(material){
  const x=getMaterial(material);
  return x&&Array.isArray(x.transactions)?x.transactions:[];
}
function selectedProduction(){
  if(!VIEW_DATE)return Array.isArray(DATA.production)?DATA.production:[];
  const d=dateOnly(VIEW_DATE);
  const history=Array.isArray(DATA.productionHistory)?DATA.productionHistory:[];
  return history.filter(r=>dateOnly(r.report_date||r.Report_Date)===d);
}
function selectedBags(){
  if(!VIEW_DATE)return Array.isArray(DATA.bags)?DATA.bags:[];
  const d=dateOnly(VIEW_DATE);
  const history=Array.isArray(DATA.bagsHistory)?DATA.bagsHistory:[];
  return history.filter(r=>dateOnly(r.report_date||r.Report_Date)===d);
}
function selectedFeedRows(){
  const rows=Array.isArray(DATA.feedUnitData)?DATA.feedUnitData:[];
  return VIEW_DATE?rows.filter(r=>dateOnly(r.Report_Date||r.report_date)===dateOnly(VIEW_DATE)):rows;
}
function latestFeedRows(){
  const rows=selectedFeedRows(), latest={};
  rows.forEach(r=>{
    const p=clean(r.Product||r.product);
    if(p)latest[normalize(p)]=r;
  });
  return Object.values(latest);
}
function latestTotal(key){
  return latestFeedRows().reduce((sum,r)=>{
    const product=r.Product||r.product||"";
    return sum+feedValueInMT(feedField(r,key),product);
  },0);
}
function latestFeedClosingTotal(){
  return latestFeedRows().reduce((sum,r)=>{
    const product=r.Product||r.product||"";
    const v=num(r.Closing_Day_MT??r.closing_day_mt??r.Closing_Day??r.closing_day??r.Closing??r.closing);
    return sum+feedValueInMT(v,product);
  },0);
}
function avgConsumption(material){
  const history=Array.isArray(DATA.stockHistory)?DATA.stockHistory:[];
  const target=normalize(material);
  const dated=new Map();
  history.forEach(t=>{
    if(normalize(t.material)!==target || !tType(t).includes("CONSUMPTION"))return;
    const d=dateOnly(rowDate(t));
    const v=num(t.for_day);
    if(!d || v===null || v<=0)return;
    dated.set(d,(dated.get(d)||0)+v);
  });
  if(!dated.size)return 0;

  const availableDates=[...dated.keys()].sort();
  let anchor=dateOnly(VIEW_DATE);
  if(!anchor)anchor=availableDates[availableDates.length-1];
  const anchorTime=new Date(anchor+"T00:00:00").getTime();
  const startTime=anchorTime-29*86400000;
  const values=[...dated.entries()]
    .filter(([d])=>{const tm=new Date(d+"T00:00:00").getTime();return tm>=startTime && tm<=anchorTime;})
    .map(([,v])=>v)
    .filter(v=>v>0);
  if(!values.length)return 0;
  return values.reduce((a,b)=>a+b,0)/values.length;
}
function renderQuick(){
  const pd=latestTotal("Production_Day_MT"),pm=latestTotal("Production_Month_MT");
  const dd=latestTotal("Dispatch_Day_MT"),dm=latestTotal("Dispatch_Month_MT");
  setText("qProdDay",fmtMT(pd));setText("qProdMonth",fmtMT(pm));setText("qDispDay",fmtMT(dd));setText("qDispMonth",fmtMT(dm));
  let received=0,cons=0,closing=0;
  viewStockRows().forEach(x=>{
    const material=x.material||"";
    if(x.closing!==null)closing+=materialValueInMT(x.closing,material);
    (x.transactions||[]).forEach(t=>{
      const ty=tType(t),v=materialValueInMT(tVal(t),material);
      if(ty==="PURCHASE"||ty==="RECEIVED"||ty.includes("TRANSFER FROM"))received+=v;
      if(ty.includes("CONSUMPTION"))cons+=v;
    });
  });
  setText("qReceived",fmt(received)+" MT");setText("qConsumption",fmt(cons)+" MT");setText("qClosing",fmt(closing)+" MT");
  setText("qFeedClosing",fmtMT(latestFeedClosingTotal()));setText("qFeedClosingBagsMini",fmt(latestFeedClosingBagEquivalent())+" Bags");
  setText("reportDate",VIEW_DATE||DATA.report_date||"Latest");
  const reorderCount=getMaterials().filter(m=>stockStatus(num(getMaterial(m)?.closing)||0,avgConsumption(m)).status==="REORDER").length;
  const issueCount=reconciliationItems().filter(x=>x.r.status==="MISMATCH").length+feedUnitReconciliationItems().filter(x=>x.r.status==="MISMATCH").length+ppBagReconciliationItems().filter(x=>x.r.status==="MISMATCH").length+abnormalConsumptionItems().length+duplicateTransactionCount();
  const premixKg=premixBommakalTransfers().reduce((a,r)=>a+r.value,0);
  const damage=selectedBags().reduce((a,r)=>a+(num(r.damage)||0),0);
  setText("mergedReorder",String(reorderCount));setText("mergedIssues",String(issueCount));setText("mergedPremix",fmt(premixKg)+" KG");setText("mergedDamage",fmt(damage));

}
let feedUnitExpanded=false;
function renderFeedUnit(){
  const rows=latestFeedRows(),list=document.getElementById("feedUnitList");
  if(!rows.length){list.innerHTML="<div class='empty'>Feed Unit product-wise data not available for this date.</div>";return}
  const sorted=rows.slice().sort((a,b)=>{const av=(num(a.Production_Day_MT??a.production_day_mt??a.Production??a.production)||0)>0?1:0;const bv=(num(b.Production_Day_MT??b.production_day_mt??b.Production??b.production)||0)>0?1:0;return bv-av;});
  const visible=feedUnitExpanded?sorted:sorted.slice(0,10);
  list.innerHTML=visible.map(r=>{const p=r.Product||r.product||"--";const prod=num(r.Production_Day_MT??r.production_day_mt??(r.Production||r.production));const disp=num(r.Dispatch_Day_MT??r.dispatch_day_mt??(r.Dispatch||r.dispatch));const close=num(r.Closing_Day_MT??r.closing_day_mt??(r.Closing||r.closing));const transfer=num(r.Transfer_Day_MT??r.transfer_day_mt??r.Transfer??r.transfer);const received=isPremixProduct(p)?transfer:null;return `<div class="feed-row" onclick="openFeedProductDetails('${jsq(p)}')"><div><div class="row-name">${esc(p)}</div><div class="prod-meta">Closing ${fmtFeed(close,p)}${feedClosingBagSize(p)!==null&&close!==null?` • ${fmtFeedClosingBags(close,p)}`:""}${received!==null?` • Received ${fmtFeed(received,p)}`:""}</div></div><div class="row-right"><strong>${fmtFeed(prod,p)}</strong><small>Dispatch ${fmtFeed(disp,p)}</small></div></div>`;}).join("");
  if(sorted.length>10)list.innerHTML+=`<button class="more-toggle" onclick="toggleFeedUnitMore()">${feedUnitExpanded?"Show less ↑":"More • "+(sorted.length-10)+" more ↓"}</button>`;
}
function toggleFeedUnitMore(){feedUnitExpanded=!feedUnitExpanded;renderFeedUnit();}





function renderPPBags(){
  const rows=selectedBags(),el=document.getElementById("bagGrid");
  const seen=new Set();
  const uniqueRows=rows.filter(r=>{
    const key=normalize(r.product||"PP Bags");
    if(seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  el.innerHTML=uniqueRows.slice().sort((a,b)=>(num(b.closing)||0)-(num(a.closing)||0)).map(r=>{
    const p=r.product||"PP Bags";
    return `<div class="pp-item" onclick="openBagProduct('${jsq(p)}')"><p>${esc(p)}</p><small class="pp-closing-label">Closing</small><strong class="pp-closing-number">${fmt(r.closing)}</strong><p style="margin-top:3px">Issue ${fmt(r.issue)} • Damage ${fmt(r.damage)}</p></div>`;
  }).join("")||"<div class='empty'>No PP Bag data for this date</div>";
}
function renderStock(){
  const list=document.getElementById("stockList"),premixList=document.getElementById("premixStockList"),mats=getMaterials();
  const renderRows=(rows)=>rows.slice().sort((a,b)=>{const av=num(getMaterial(a)?.closing)||0,bv=num(getMaterial(b)?.closing)||0;return (bv>0)-(av>0)||bv-av;}).map(m=>{
    const x=getMaterial(m),closing=num(x?.closing)||0,avg=avgConsumption(m),st=stockStatus(closing,avg),unit=x?.unit||"MT";
    const dot=st.status==="REORDER"?"🔴":st.status==="WATCH"?"🟡":st.status==="OK"?"🟢":"⚪";
    return `<div class="stock-row reorder-card" onclick="openMaterialDetails('${jsq(m)}')"><div class="reorder-card-top"><strong class="reorder-material">${esc(m)}</strong><span class="status-dot ${st.cls}" title="${esc(st.status)}" aria-label="${esc(st.status)}"></span></div><div class="reorder-card-metrics"><span><b>Stock</b><strong>${fmt(closing)} ${esc(unit)}</strong></span><span><b>Avg/day</b><strong>${avg?fmt(avg):"--"} ${esc(unit)}</strong></span><span><b>Cover</b><strong>${st.cover!==null?fmt(st.cover)+" d":"--"}</strong></span></div></div>`;
  }).join("")||"<div class='empty'>No stock data for this date</div>";
  const rawMats=mats.filter(m=>!isPremixMaterial(m));
  const premixMats=mats.filter(m=>isPremixMaterial(m));
  if(list)list.innerHTML=renderRows(rawMats);
  if(premixList)premixList.innerHTML=renderRows(premixMats);
}

function renderControlCenter(){
  const m=dailyControlMetrics();
  setText("controlDate",VIEW_DATE||DATA.report_date||"Latest data");
  setText("ctlReorder",String(m.reorder));setText("ctlMismatch",String(m.mismatches+(m.abnormal?m.abnormal:0)));
  setText("ctlEfficiency",m.efficiency===null?"--":fmt(m.efficiency)+"%");
  setText("ctlLoss",m.loss===null?"--":fmt(m.loss)+"%");
  setText("ctlPremix",fmt(m.premix)+" MT");setText("ctlBagDamage",fmt(m.damage));
  const problems=m.reorder+m.mismatches+m.abnormal,h=document.getElementById("healthIcon"),t=document.getElementById("healthText");
  if(problems===0){if(h)h.textContent="✓";if(t)t.textContent="Data Issues • No issues detected";}
  else {if(h)h.textContent="⚠";if(t)t.textContent=`Data Issues • ${problems} item${problems===1?"":"s"} need checking`;}
}
function dailyControlMetrics(){
  const reorder=getMaterials().filter(m=>stockStatus(num(getMaterial(m)?.closing)||0,avgConsumption(m)).status==="REORDER").length;
  const mismatches=reconciliationItems().filter(x=>x.r.status==="MISMATCH").length;
  const abnormal=abnormalConsumptionItems().length;
  const rows=selectedProduction(),outs=rows.map(r=>num(r.output_percentage)).filter(v=>v!==null),losses=rows.map(r=>num(r.process_loss)).filter(v=>v!==null);
  const premix=premixBommakalTransfers().reduce((a,r)=>a+r.value,0)/1000;
  const damage=selectedBags().reduce((a,r)=>a+(num(r.damage)||0),0);
  return {reorder,mismatches,abnormal,efficiency:outs.length?outs.reduce((a,b)=>a+b,0)/outs.length:null,loss:losses.length?losses.reduce((a,b)=>a+b,0)/losses.length:null,premix,damage};
}
function currentViewKey(){return VIEW_DATE?dateOnly(VIEW_DATE):dateOnly(DATA.report_date)||"latest"}
function allAvailableDates(){return getAvailableDates()}
function feedRowsForDate(d){
  return (DATA.feedUnitData||[]).filter(r=>dateOnly(r.Report_Date||r.report_date)===dateOnly(d));
}
function dateFeedMetrics(d){
  const rows=feedRowsForDate(d);
  return {
    production:rows.reduce((a,r)=>a+(num(r.Production_Day_MT??r.production_day_mt??r.Production??r.production)||0),0),
    dispatch:rows.reduce((a,r)=>a+(num(r.Dispatch_Day_MT??r.dispatch_day_mt??r.Dispatch??r.dispatch)||0),0),
    closing:rows.reduce((a,r)=>a+(num(r.Closing_Day_MT??r.closing_day_mt??r.Closing??r.closing)||0),0),
    rows:rows.length
  };
}
function selectedDateForIntelligence(){return VIEW_DATE?dateOnly(VIEW_DATE):dateOnly(DATA.report_date)}
function completedComparisonDates(d){
  const dates=allAvailableDates();
  const idx=dates.indexOf(dateOnly(d));
  if(idx<0)return [];
  return dates.slice(idx+1,idx+3);
}
function managerAttentionItems(){
  const items=[];
  const reorder=getMaterials().filter(m=>stockStatus(num(getMaterial(m)?.closing)||0,avgConsumption(m)).status==="REORDER");
  reorder.slice(0,8).forEach(m=>items.push({level:"critical",title:m,msg:`Stock ${fmtMaterial(num(getMaterial(m)?.closing)||0,m,getMaterial(m)?.unit||"MT")} • coverage ${(()=>{const s=stockStatus(num(getMaterial(m)?.closing)||0,avgConsumption(m));return s.cover===null?"--":fmt(s.cover)+" days"})()}`,action:`openMaterialDetails('${jsq(m)}')`}));
  reconciliationItems().filter(x=>x.r.status==="MISMATCH").slice(0,8).forEach(x=>items.push({level:"warning",title:x.m,msg:"Stock reconciliation mismatch — check transactions",action:`openMaterialDetails('${jsq(x.m)}')`}));
  abnormalConsumptionItems().slice(0,8).forEach(x=>items.push({level:"warning",title:x.material,msg:`Consumption ${fmt(x.current)} vs avg ${fmt(x.avg)} • ${fmt(Math.abs(x.ratio*100-100))}% ${x.direction==="LOW"?"below":"above"} average`,action:`openMaterialDetails('${jsq(x.material)}')`}));
  const damage=selectedBags().reduce((a,r)=>a+(num(r.damage)||0),0);
  if(damage>0)items.push({level:"warning",title:"PP Bag Damage",msg:`${fmt(damage)} bags damaged on ${selectedDateForIntelligence()}`,action:"openPPBagDetails()"});
  return items;
}
function renderManagerIntelligence(){
  const d=selectedDateForIntelligence(), items=managerAttentionItems();
  setText("intelDate",d||"Latest");
  setText("intelAttention",String(items.length));
  const low=getMaterials().filter(m=>{const c=num(getMaterial(m)?.closing)||0,s=stockStatus(c,avgConsumption(m));return s.cover!==null&&s.cover<3}).length;
  setText("intelCoverage",String(low));
  const cmp=completedComparisonDates(d),latestCompleted=cmp[0],previousCompleted=cmp[1];
  const lc=latestCompleted?dateFeedMetrics(latestCompleted):null,pc=previousCompleted?dateFeedMetrics(previousCompleted):null;
  if(lc&&pc&&pc.production){const delta=((lc.production-pc.production)/pc.production)*100;setText("intelCompare",(delta>=0?"+":"")+fmt(delta)+"%")}else setText("intelCompare","--");
  const note=localStorage.getItem("manager_note_"+currentViewKey())||"";setText("intelNote",note?"Saved":"Add note");
  const pill=document.getElementById("intelStatusPill");
  if(pill){pill.className="attention-pill"+(items.some(x=>x.level==="critical")?" hot":items.length?" warn":"");pill.textContent=items.some(x=>x.level==="critical")?"🔴 ACTION NEEDED":items.length?"🟠 CHECK":"✓ NORMAL";}
}
function openStockForecast(){
  const rows=getMaterials().map(m=>{const x=getMaterial(m),c=num(x?.closing)||0,avg=avgConsumption(m),s=stockStatus(c,avg);return {m,c,avg,s,unit:x?.unit||"MT"}}).filter(x=>x.s.cover!==null).sort((a,b)=>a.s.cover-b.s.cover);
  const html=`<div class="detail-section"><h3>📦 Stock Coverage Forecast • ${esc(selectedDateForIntelligence()||"Latest")}</h3><div class="small-note">Coverage is based on the available recorded consumption history. It is a planning estimate, not a guaranteed depletion date.</div>${rows.slice(0,20).map(x=>`<div class="feed-row" onclick="closeModal();openMaterialDetails('${jsq(x.m)}')"><div><div class="row-name">${esc(x.m)}</div><div class="prod-meta">Avg ${fmt(x.avg)} ${esc(x.unit)}/day</div></div><div class="row-right"><strong>${fmt(x.s.cover)} days</strong><small>≈ ${esc(x.s.cover<3?"Low coverage":"Covered")}</small></div></div>`).join("")||"<div class='empty'>No consumption history available.</div>"}</div>`;
  showModal("📦 Stock Forecast",html);
}
function saveManagerNote(key){const el=document.getElementById("managerNoteInput"),v=el?el.value.trim():"";if(v)localStorage.setItem("manager_note_"+key,v);else localStorage.removeItem("manager_note_"+key);closeModal();renderManagerIntelligence();showToast("Manager note saved")}
function deleteManagerNote(key){localStorage.removeItem("manager_note_"+key);closeModal();renderManagerIntelligence();showToast("Manager note cleared")}

function setViewDate(date){
  VIEW_DATE=date?dateOnly(date):null;
  closeModal();
  renderDashboard();
  renderTrends();
  showToast(VIEW_DATE?`Dashboard set to ${VIEW_DATE}`:"Dashboard set to latest");
}
function getAvailableDates(){
  const s=new Set();
  (DATA.stockHistory||[]).forEach(t=>{const d=dateOnly(rowDate(t));if(d)s.add(d)});
  (DATA.stock||[]).forEach(x=>(x.transactions||[]).forEach(t=>{const d=dateOnly(rowDate(t));if(d)s.add(d)}));
  (DATA.production||[]).forEach(r=>{const d=dateOnly(r.report_date||r.Report_Date);if(d)s.add(d)});
  (DATA.bags||[]).forEach(r=>{const d=dateOnly(r.report_date||r.Report_Date);if(d)s.add(d)});
  (DATA.feedUnitData||[]).forEach(r=>{const d=dateOnly(r.report_date||r.Report_Date);if(d)s.add(d)});
  if(DATA.report_date)s.add(dateOnly(DATA.report_date));
  return [...s].filter(Boolean).sort().reverse();
}
function openDateSelector(){
  const dates=getAvailableDates();
  const buttons=(VIEW_DATE?`<button class="date-btn" onclick="setViewDate(null)"><strong>Latest / Today</strong><small>Return to latest dashboard</small></button>`:"")+dates.map(d=>`<button class="date-btn" onclick="setViewDate('${jsq(d)}')"><strong>${esc(d)}</strong><small>${d===dateOnly(DATA.report_date)?"Latest API date":"View complete dashboard →"}</small></button>`).join("");
  showModal("Date Selector",`<div class="detail-section"><h3>📅 Dashboard Date</h3><div class="small-note">Selecting a date now changes the entire dashboard, not just the summary popup.</div><div class="date-list">${buttons||"<div class='empty'>No dated records available.</div>"}</div></div>`);
}

/* Keep trend charts aligned with the selected dashboard date. */
function renderTrends(){
  const sel=document.getElementById("materialSelect"),mats=getMaterials();
  sel.innerHTML=mats.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join("");
  if(mats.length)drawMaterialChart(mats[0]);
  const p=VIEW_DATE?selectedProduction():DATA.productionTrend||[];
  const outs=selectedProduction().map(r=>num(r.output_percentage)).filter(v=>v!==null),loss=selectedProduction().map(r=>num(r.process_loss)).filter(v=>v!==null);
  chart("productionChart",p.map((x,i)=>x.date||x.report_date||x.Report_Date||"D"+(i+1)),productionTrendData());
  const purchase=trendFromTransactions("PURCHASE");chart("purchaseChart",purchase.labels,purchase.values);
  const closing=trendClosing();chart("closingChart",closing.labels,closing.values);
  chart("outputChart",outs.map((_,i)=>"P"+(i+1)),outs);chart("lossChart",loss.map((_,i)=>"P"+(i+1)),loss);
  const feed=feedTrend();chart("feedChart",feed.labels,feed.values);
  const bags=bagTrend();chart("bagChart",bags.labels,bags.values);
  const wrap=document.getElementById("trendWrapper"),dots=document.getElementById("trendDots");dots.innerHTML=[...wrap.children].map((_,i)=>`<div class="dot ${i===0?"active":""}"></div>`).join("");
  wrap.onscroll=function(){const i=Math.round(this.scrollLeft/this.clientWidth);[...dots.children].forEach((d,j)=>d.classList.toggle("active",i===j))};
}
function feedTrend(){
  const rows=selectedFeedRows(),map={};
  rows.forEach(r=>{const d=clean(r.Report_Date||r.report_date)||"Latest";map[d]=(map[d]||0)+(num(r.Production_Day_MT??r.production_day_mt)||0)-(num(r.Dispatch_Day_MT??r.dispatch_day_mt)||0)});
  const labels=Object.keys(map).sort();return {labels,values:labels.map(k=>map[k])}
}
function bagTrend(){
  const rows=selectedBags(),labels=[],values=[];
  rows.forEach((r,i)=>{labels.push(r.product||"P"+(i+1));values.push((num(r.issue)||0)+(num(r.damage)||0))});
  return {labels,values}
}


/* =====================================================
   DATA QUALITY / ACCURACY LAYER
   Additive only: keeps existing dashboard/API/N8N logic intact.
===================================================== */
function dqIsConsumption(t){
  const s=normalize(t);
  if(!s)return false;
  return s.includes("CONSUMPTION") || s.includes("CONSUMPION") || s.includes("CONSUMPTON") || s.includes("CONSUMPTI");
}
function dqIsKnownTransaction(t){
  const s=normalize(t);
  if(!s)return false;
  if(dqIsConsumption(s))return true;
  if(s.includes("OPENING STOCK")||s.includes("CL. STOCK")||s.includes("CLOSING STOCK"))return true;
  const known=["PURCHASE","RECEIVED","RECEV","GAIN","SALE","SHORTAGE","DAMAGE","ISSUE","TRANSFER","RETURN","PRODUCTION","DESPATCH","DISPATCH","DILUTED","REPROCESS","BOMMAKAL","BMKL"];
  return known.some(k=>s.includes(k));
}
function dqLatestDateRows(material){
  const rows=transactions(material),dates=rows.map(t=>dateOnly(rowDate(t))).filter(Boolean).sort();
  const d=VIEW_DATE?dateOnly(VIEW_DATE):(dates.length?dates[dates.length-1]:"");
  return {date:d,rows:d?rows.filter(t=>dateOnly(rowDate(t))===d):rows};
}
function dqDuplicateGroups(){
  const out=[];
  getMaterials().forEach(material=>{
    const {date,rows}=dqLatestDateRows(material),map=new Map();
    rows.forEach((t,i)=>{
      const key=[date,tType(t),tVal(t),clean(t.for_day),clean(t.for_month),clean(t.for_year)].join("|");
      if(!map.has(key))map.set(key,[]);
      map.get(key).push({t,index:i+1});
    });
    map.forEach((items,key)=>{if(items.length>1){out.push({material,date,transaction:items[0].t.transaction||tType(items[0].t),quantity:tVal(items[0].t),items});}});
  });
  return out;
}
function dqUnknownGroups(){
  const out=[];
  getMaterials().forEach(material=>{
    const {date,rows}=dqLatestDateRows(material);
    rows.forEach((t,index)=>{
      const name=clean(t.transaction||t.type||t.movement||"");
      if(name && !dqIsKnownTransaction(name)) out.push({material,date,transaction:name,quantity:tVal(t),index:index+1,row:t});
    });
  });
  return out;
}
function dqContinuityIssues(){
  const out=[];
  getMaterials().forEach(material=>{
    const rows=transactions(material),byDate={};
    rows.forEach(t=>{const d=dateOnly(rowDate(t));if(!d)return;(byDate[d]??=[]).push(t)});
    const dates=Object.keys(byDate).sort();
    for(let i=1;i<dates.length;i++){
      const prev=dates[i-1],cur=dates[i];
      // Only compare an actual calendar next-day pair.
      // Missing dates (for example holidays) are not treated as continuity failures.
      const nextDay=new Date(prev+"T00:00:00");
      nextDay.setDate(nextDay.getDate()+1);
      const expected=nextDay.toISOString().slice(0,10);
      if(cur!==expected) continue;
      const prevClosing=byDate[prev].filter(t=>tType(t).includes("CL. STOCK")||tType(t).includes("CLOSING STOCK")).map(t=>tVal(t)).filter(v=>v!==null).pop();
      const curOpening=byDate[cur].filter(t=>tType(t).includes("OPENING STOCK")).map(t=>tVal(t)).filter(v=>v!==null).pop();
      if(prevClosing!==null && prevClosing!==undefined && curOpening!==null && curOpening!==undefined && Math.abs(prevClosing-curOpening)>0.01){
        out.push({material,previousDate:prev,currentDate:cur,previousClosing:prevClosing,currentOpening:curOpening,diff:curOpening-prevClosing});
      }
    }
  });
  return out.filter(x=>!VIEW_DATE||x.currentDate===dateOnly(VIEW_DATE));
}
function dqAbnormalItems(){
  // Exact abnormal-consumption rule:
  // Current > Average × 1.5  → High consumption
  // Current < Average × 0.5  → Low consumption
  // Current = 0              → Not abnormal
  // Otherwise                → Normal (not listed)
  const out=abnormalConsumptionItems().map(x=>({
    ...x,
    type:x.direction==="LOW"?"Low consumption":"High consumption"
  }));
  const seen=new Set();
  return out.filter(x=>{
    const k=(x.material||"")+"|"+(x.date||"")+"|"+(x.type||"");
    if(seen.has(k))return false;
    seen.add(k);
    return true;
  });
}
function dqUniqueProducts(rows){return [...new Set((rows||[]).map(r=>clean(r.product||r.Product||"" )).filter(Boolean).map(normalize))].length}
function dqCoverage(){
  const feed=Array.isArray(DATA.feedUnitData)?DATA.feedUnitData:[];
  const prod=Array.isArray(DATA.production)?DATA.production:[];
  const bags=Array.isArray(DATA.bags)?DATA.bags:[];
  const materials=getMaterials();
  const validFeed=feed.filter(r=>clean(r.Product||r.product)&&dateOnly(r.Report_Date||r.report_date));
  const validProd=prod.filter(r=>clean(r.product)&&dateOnly(r.report_date||r.Report_Date||DATA.report_date));
  const validBags=bags.filter(r=>clean(r.product)&&dateOnly(r.report_date||r.Report_Date||DATA.report_date));
  const dispatchRows=feed.filter(r=>clean(r.Product||r.product)&&dateOnly(r.Report_Date||r.report_date)&&(num(r.Dispatch_Day_MT??r.dispatch_day_mt??r.Dispatch??r.dispatch)!==null));
  const materialRows=materials.reduce((n,m)=>n+transactions(m).length,0);
  const materialValid=materials.reduce((n,m)=>n+transactions(m).filter(t=>dateOnly(rowDate(t))&&clean(t.transaction||t.type||t.movement)).length,0);
  const item=(name,total,valid,products)=>({name,total,valid,products,percent:total?Math.round(valid/total*100):0});
  return [
    item("Materials",materialRows,materialValid,materials.length),
    item("Feed Unit Data",feed.length,validFeed.length,dqUniqueProducts(feed)),
    item("Production",prod.length,validProd.length,dqUniqueProducts(prod)),
    item("PP Bags",bags.length,validBags.length,dqUniqueProducts(bags)),
    item("Dispatch",dispatchRows.length,dispatchRows.length,dqUniqueProducts(dispatchRows))
  ];
}
function dqHistoricalRows(material){
  const map={};
  transactions(material).forEach(t=>{const d=dateOnly(rowDate(t));if(!d)return;if(!map[d])map[d]={date:d,opening:null,closing:null,consumption:0,additions:0,deductions:0};const x=map[d],ty=tType(t),v=tVal(t)||0;if(ty.includes("OPENING STOCK"))x.opening=v;else if(ty.includes("CL. STOCK")||ty.includes("CLOSING STOCK"))x.closing=v;else if(dqIsConsumption(ty))x.consumption+=v;else if(ty==="PURCHASE"||ty==="RECEIVED"||ty==="GAIN"||ty.includes("TRANSFER FROM"))x.additions+=v;else if(ty.includes("TRANSFER TO")||ty.includes("SALE")||ty.includes("SHORTAGE")||ty.includes("DAMAGE")||ty.includes("ISSUE")||ty.includes("RETURN TO"))x.deductions+=v;});
  return Object.values(map).sort((a,b)=>a.date.localeCompare(b.date));
}
function openDQDuplicates(){
  const groups=dqDuplicateGroups();
  let html=`<div class="detail-section"><h3>🔁 Duplicate Transactions • ${groups.length}</h3>`;
  if(!groups.length)html+=`<div class="empty">No exact duplicate transaction groups detected.</div>`;
  groups.forEach(g=>{html+=`<div class="transaction"><div class="transaction-title"><strong>${esc(g.material)}</strong><span>${esc(g.date||"--")}</span></div>${detail("Transaction",g.transaction)}${detail("Quantity",fmt(g.quantity))}${detail("Duplicate rows",g.items.length)}${g.items.map((x,i)=>`<div class="small-note">Row ${i+1}: ${esc(x.t.transaction||tType(x.t))} • Day ${esc(x.t.for_day??"--")} • Month ${esc(x.t.for_month??"--")} • Year ${esc(x.t.for_year??"--")}</div>`).join("")}</div>`});
  html+=`</div>`;showModal("Duplicate Transactions",html);
}
function openDQUnknown(){
  const rows=dqUnknownGroups();
  let html=`<div class="detail-section"><h3>❓ Unknown Transactions • ${rows.length}</h3><div class="small-note">Consumption spelling variations are classified as Consumption and are not listed here.</div>`;
  if(!rows.length)html+=`<div class="empty">No genuinely unknown transaction names detected.</div>`;
  rows.forEach(x=>html+=`<div class="transaction" onclick="closeModal();openMaterialDetails('${jsq(x.material)}')">${detail("Material",x.material)}${detail("Date",x.date)}${detail("Transaction",x.transaction)}${detail("Quantity",fmt(x.quantity))}${detail("Source row",x.index)}</div>`);
  html+=`</div>`;showModal("Unknown Transactions",html);
}
function openDQContinuity(){
  const rows=dqContinuityIssues();
  let html=`<div class="detail-section"><h3>🔗 Opening → Closing Continuity • ${rows.length}</h3>`;
  if(!rows.length)html+=`<div class="empty">No opening/closing continuity issues detected.</div>`;
  rows.forEach(x=>html+=`<div class="transaction" onclick="closeModal();openMaterialDetails('${jsq(x.material)}')">${detail("Material",x.material)}${detail("Previous date",x.previousDate)}${detail("Previous closing",fmt(x.previousClosing))}${detail("Current date",x.currentDate)}${detail("Current opening",fmt(x.currentOpening))}${detail("Difference",fmt(x.diff))}</div>`);
  html+=`</div>`;showModal("Opening → Closing Continuity",html);
}
function openDQAbnormal(){
  const rows=dqAbnormalItems();
  let html=`<div class="detail-section"><h3>⚠ Abnormal Activity • ${rows.length}</h3>`;
  if(!rows.length)html+=`<div class="empty">No abnormal activity detected.</div>`;
  rows.slice(0,100).forEach(x=>html+=`<div class="transaction" onclick="closeModal();openMaterialDetails('${jsq(x.material)}')">${detail("Material",x.material)}${detail("Date",x.date||"--")}${detail("Type",x.type||"Activity")}${detail("Transaction",x.transaction||"--")}${detail("Current",fmt(x.current))}${x.avg?detail("Average",fmt(x.avg)):""}${x.ratio>1?detail("Above average",fmt(Math.abs(x.ratio*100-100))+" %"):detail("Below average",fmt(Math.abs(x.ratio*100-100))+" %")}</div>`);
  html+=`</div>`;showModal("Abnormal Activity",html);
}
function openDQHistory(){
  const mats=getMaterials();
  const options=mats.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join("");
  const m=mats[0]||"";
  showModal("Materials Historical Trend",`<div class="detail-section"><h3>📈 Material History</h3><select id="dqHistoryMaterial" onchange="renderDQHistory(this.value)" style="width:100%;margin-bottom:8px">${options}</select><div id="dqHistoryBody"></div></div>`);
  renderDQHistory(m);
}
function renderDQHistory(material){
  const el=document.getElementById("dqHistoryBody");if(!el)return;
  const rows=dqHistoricalRows(material);
  if(!rows.length){el.innerHTML="<div class='empty'>No historical transaction data.</div>";return}
  el.innerHTML=`<div class="stock-table"><div class="stock-head" style="grid-template-columns:1.1fr .8fr .8fr .9fr .8fr"><span>Date</span><span>Opening</span><span>Movement</span><span>Consumption</span><span>Closing</span></div>${rows.slice(-30).reverse().map(r=>`<div class="stock-row" style="grid-template-columns:1.1fr .8fr .8fr .9fr .8fr"><strong>${esc(r.date)}</strong><span>${fmt(r.opening??0)}</span><span>${fmt(r.additions-r.deductions)}</span><span>${fmt(r.consumption)}</span><span>${fmt(r.closing??0)}</span></div>`).join("")}</div>`;
}
function openDQCoverage(){
  const rows=dqCoverage();
  let html=`<div class="detail-section"><h3>🎯 Data Coverage</h3><div class="small-note">Coverage checks whether source rows/products are present and structurally processable. It does not alter source data.</div>`;
  rows.forEach(x=>{html+=`<div class="transaction"><div class="transaction-title"><strong>${esc(x.name)}</strong><span>${x.percent}%</span></div>${detail("Source rows",x.total)}${detail("Valid / processed rows",x.valid)}${detail("Products / materials",x.products)}${detail("Rows needing review",Math.max(0,x.total-x.valid))}</div>`});
  html+=`</div>`;showModal("Data Coverage",html);
}
function dqBuildSummary(){
  const dup=dqDuplicateGroups(),unk=dqUnknownGroups(),cont=dqContinuityIssues(),ab=dqAbnormalItems(),cov=dqCoverage();
  return `FEED PLANT DATA QUALITY SUMMARY\nDate: ${selectedDateForIntelligence()||DATA.report_date||"Latest"}\n\nDuplicate transaction groups: ${dup.length}\nUnknown transactions: ${unk.length}\nOpening → Closing continuity issues: ${cont.length}\nAbnormal activity: ${ab.length}\n\nCoverage:\n${cov.map(x=>`- ${x.name}: ${x.valid}/${x.total} rows (${x.percent}%)`).join("\n")}`;
}
function badDataIssueCount(){
  const rec=reconciliationItems(),bad=rec.filter(x=>x.r.status==="MISMATCH"),no=rec.filter(x=>x.r.status==="NO DATA");
  return bad.length+no.length+abnormalConsumptionItems().length+duplicateTransactionCount();
}
function renderDataQualityPanel(){
  const host=document.getElementById("dataQualityPanelHost");if(!host)return;
  const dup=dqDuplicateGroups(),unk=dqUnknownGroups(),cont=dqContinuityIssues(),ab=dqAbnormalItems(),cov=dqCoverage();
  host.innerHTML=`<div class="card control-card" id="dataQualityPanel"><div class="card-title"><h2>🛡 Data Health &amp; Issues</h2><span>Quality • Accuracy • Issues</span></div><div class="control-grid"><button class="control-item" onclick="openDQDuplicates()"><small>🔁 Duplicate Transactions</small><strong>${dup.length}</strong></button><button class="control-item" onclick="openDQUnknown()"><small>❓ Unknown Transactions</small><strong>${unk.length}</strong></button><button class="control-item" onclick="openDQContinuity()"><small>🔗 Opening → Closing</small><strong>${cont.length}</strong></button><button class="control-item" onclick="openDQAbnormal()"><small>⚠ Abnormal Activity</small><strong>${ab.length}</strong></button><button class="control-item" onclick="openDQHistory()"><small>📈 Historical Trend</small><strong>${getMaterials().length}</strong></button><button class="control-item" onclick="openDQCoverage()"><small>🎯 Coverage</small><strong>${cov.filter(x=>x.percent===100).length}/${cov.length}</strong></button></div><div class="health-strip" onclick="openDataHealth()"><span>⚠ Data Issues</span><b>${badDataIssueCount()}</b> <span>View details →</span></div><div class="small-note">Consumption spelling variations are automatically treated as Consumption; only genuinely unrecognized transaction names are shown as Unknown.</div></div>`;
}
function ensureDataQualityHost(){
  const premixCard=document.getElementById("premixTransferCard");
  if(!premixCard)return;
  let host=document.getElementById("dataQualityPanelHost");
  if(!host){
    host=document.createElement("div");
    host.id="dataQualityPanelHost";
    premixCard.parentNode.insertBefore(host,premixCard.nextSibling);
  }
  renderDataQualityPanel();
}
const __dqBaseRenderControlCenter=renderControlCenter;
renderControlCenter=function(){__dqBaseRenderControlCenter();ensureDataQualityHost()};

/* =====================================================
   SPARE PARTS — ADDITIVE SEPARATE API / UI
   Existing Feed Plant API and logic remain unchanged.
===================================================== */
let SPARE_DATA={SPARE_STOCK:[],SPARE_ORDERS:[],EMPLOYEE_MESSAGES:[]};
let spareTab="SPARE_STOCK";

function spareVal(row, keys){
  for(const k of keys){ if(row && row[k]!==undefined && row[k]!==null && row[k]!=="") return row[k]; }
  return "";
}
function spareText(v){return clean(v);}
function setSpareTab(btn,tab){
  document.querySelectorAll('.spare-tabs button').forEach(x=>x.classList.remove('active'));
  if(btn)btn.classList.add('active');
  spareTab=tab;
  const input=document.getElementById('spareSearch');
  if(input)input.value="";
  renderSpareParts("");
}
function renderSpareParts(query=""){
  const el=document.getElementById('sparePartsList');
  if(!el)return;
  const q=normalize(query);
  const rows=Array.isArray(SPARE_DATA[spareTab])?SPARE_DATA[spareTab]:[];
  const filtered=q?rows.filter(r=>normalize(Object.values(r||{}).join(" ")).includes(q)):rows;
  updateSectionDates();
  if(!filtered.length){el.innerHTML=`<div class="empty">No ${spareTab==='SPARE_STOCK'?'spare stock':spareTab==='SPARE_ORDERS'?'orders':'employee messages'} found.</div>`;return;}

  if(spareTab==='SPARE_STOCK'){
    el.innerHTML=filtered.map(r=>{
      const name=spareVal(r,['NAME','Name','PART_NAME','Part_Name','PART NAME'])||'Unnamed Part';
      const category=spareVal(r,['CATEGORY','Category']);
      const size=spareVal(r,['SIZE','Size']);
      const code=spareVal(r,['CODE','Code']);
      const stock=spareVal(r,['STOCK','Stock']);
      const unit=spareVal(r,['UNIT','Unit'])||'Nos';
      const reorder=spareVal(r,['REORDER_LEVEL','Reorder_Level','REORDER LEVEL']);
      const location=spareVal(r,['LOCATION','Location']);
      const n=num(stock), rl=num(reorder);
      const low=rl!==null && n!==null && n<=rl;
      return `<div class="spare-stock-row ${low?'spare-low-stock':''}">
        <div class="spare-main"><strong>${esc(name)}</strong><small>${esc(category||'')}${size?' • '+esc(size):''}${code?' • Code: '+esc(code):''}</small></div>
        <div class="spare-stock-right"><strong>${esc(fmt(stock))}</strong><small>${esc(unit)}${low?' • Reorder':''}</small></div>
        ${location?`<div class="spare-location">📍 ${esc(location)}</div>`:''}
      </div>`;
    }).join('');
    return;
  }

  if(spareTab==='SPARE_ORDERS'){
    el.innerHTML=filtered.map(r=>{
      const date=spareVal(r,['DATE','Date']);
      const title=spareVal(r,['ORDER_TITLE','Order_Title','ORDER TITLE']);
      const msg=spareVal(r,['ORDER_MESSAGE','Order_Message','ORDER MESSAGE','MESSAGE','Message']);
      const status=spareVal(r,['STATUS','Status']);
      return `<div class="spare-message-card"><div class="spare-message-head"><strong>${esc(title||'Spare Parts Order')}</strong><small>${esc(date)}</small></div>${status?`<span class="spare-status">${esc(status)}</span>`:''}<div class="spare-message-body">${esc(msg||'')}</div></div>`;
    }).join('');
    return;
  }

  el.innerHTML=filtered.map(r=>{
    const date=spareVal(r,['DATE','Date']);
    const employee=spareVal(r,['EMPLOYEE','Employee','EMPLOYEE_NAME','Employee_Name']);
    const msg=spareVal(r,['MESSAGE','Message','EMPLOYEE_MESSAGE','Employee_Message']);
    const category=spareVal(r,['CATEGORY','Category']);
    const status=spareVal(r,['STATUS','Status']);
    return `<div class="spare-message-card"><div class="spare-message-head"><strong>${esc(employee||'Employee Message')}</strong><small>${esc(date)}</small></div>${category?`<div class="spare-message-meta">${esc(category)}${status?' • '+esc(status):''}</div>`:''}<div class="spare-message-body">${esc(msg||'')}</div></div>`;
  }).join('');
}
async function loadSpareParts(showToastOnSuccess=false){
  const el=document.getElementById('sparePartsList');
  if(el && !showToastOnSuccess)el.innerHTML='<div class="empty">Loading spare parts...</div>';
  try{
    const response=await fetch(SPARE_PARTS_API+`?t=${Date.now()}`,{cache:'no-store'});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    SPARE_DATA={
      SPARE_STOCK:Array.isArray(data.SPARE_STOCK)?data.SPARE_STOCK:[],
      SPARE_ORDERS:Array.isArray(data.SPARE_ORDERS)?data.SPARE_ORDERS:[],
      EMPLOYEE_MESSAGES:Array.isArray(data.EMPLOYEE_MESSAGES)?data.EMPLOYEE_MESSAGES:[]
    };
    renderSpareParts(document.getElementById('spareSearch')?.value||'');
    if(showToastOnSuccess)showToast('Spare Parts updated');
  }catch(error){
    console.error('Spare Parts API:',error);
    if(el)el.innerHTML='<div class="error-box">❌ Spare Parts API connection failed.</div>';
  }
}


/* =====================================================
   REPORT CENTER — ADDITIVE REPORTING LAYER
   Uses existing DATA / SPARE_DATA only. No source API or dashboard data is changed.
===================================================== */
function reportAllDates(){
  const s=new Set();
  const add=v=>{const d=dateOnly(v);if(d)s.add(d)};
  (DATA.stockHistory||[]).forEach(r=>add(rowDate(r)));
  (DATA.stock||[]).forEach(r=>{add(r.report_date||r.Report_Date||r.date);(r.transactions||[]).forEach(t=>add(rowDate(t)))});
  (DATA.productionHistory||[]).forEach(r=>add(r.report_date||r.Report_Date||r.date));
  (DATA.production||[]).forEach(r=>add(r.report_date||r.Report_Date||r.date));
  (DATA.productionTrend||[]).forEach(r=>add(r.report_date||r.Report_Date||r.date));
  (DATA.feedUnitData||[]).forEach(r=>add(r.report_date||r.Report_Date||r.date));
  (DATA.bagsHistory||[]).forEach(r=>add(r.report_date||r.Report_Date||r.date));
  (DATA.bags||[]).forEach(r=>add(r.report_date||r.Report_Date||r.date));
  add(DATA.report_date);
  Object.values(SPARE_DATA||{}).forEach(rows=>(rows||[]).forEach(r=>Object.keys(r||{}).forEach(k=>{if(normalize(k).includes('DATE'))add(r[k])})));
  return [...s].filter(Boolean).sort();
}
function reportRange(){
  const all=reportAllDates();
  let from=document.getElementById('reportFromDate')?.value||'';
  let to=document.getElementById('reportToDate')?.value||'';
  if(!all.length)return {from,to,all};
  if(!from)from=all[Math.max(0,all.length-7)];
  if(!to)to=all[all.length-1];
  if(from>to){const x=from;from=to;to=x;}
  return {from,to,all};
}
function initReportCenter(){
  refreshReportHistorySelectors();
  const all=reportAllDates();if(!all.length)return;
  const f=document.getElementById('reportFromDate'),t=document.getElementById('reportToDate');
  if(f&&!f.value)f.value=all[Math.max(0,all.length-7)];
  if(t&&!t.value)t.value=all[all.length-1];
}
function resetReportDates(){
  const all=reportAllDates();const f=document.getElementById('reportFromDate'),t=document.getElementById('reportToDate');
  if(f)f.value=all[Math.max(0,all.length-7)]||'';if(t)t.value=all[all.length-1]||'';
  showToast('Report range reset');
}
function reportInRange(d,from,to){return !!d&&(!from||d>=from)&&(!to||d<=to)}
function reportDate(v){return dateOnly(v)}
function reportNum(v){const n=Number(v);return Number.isFinite(n)?n:0}
function reportFmt(v){return reportNum(v).toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2})}
function reportDisplayCell(v){
  if(v===null||v===undefined||v==='')return '';
  const n=Number(v);
  if(Number.isFinite(n))return n.toLocaleString('en-IN',{minimumFractionDigits:0,maximumFractionDigits:2});
  return String(v);
}
function reportRound(v){
  const n=Number(v);
  return Number.isFinite(n)?Math.round(n*100)/100:v;
}
function reportCleanRows(rows){return (rows||[]).map(r=>r.map(reportRound));}
function reportTypeTotals(rows,from,to){
  const out={};
  (rows||[]).forEach(t=>{const d=reportDate(rowDate(t));if(!reportInRange(d,from,to))return;const ty=tType(t);out[ty]=(out[ty]||0)+tVal(t)});
  return out;
}
function reportRawRows(from,to){
  const map=new Map();
  const key=(d,m)=>d+'|'+normalize(m);
  (DATA.stockHistory||[]).forEach(t=>{
    const d=reportDate(rowDate(t)),m=clean(t.material);if(!m||!reportInRange(d,from,to))return;
    const k=key(d,m);if(!map.has(k))map.set(k,{Date:d,Material:m,Unit:materialUnit(m),Received:0,Consumption:0,Transfer:0,Closing:null});
    const r=map.get(k),ty=tType(t),v=tVal(t);
    if(ty==='PURCHASE'||ty==='RECEIVED')r.Received+=v;
    else if(ty.includes('CONSUMPTION')||ty.includes('CONSUMPION'))r.Consumption+=v;
    else if(ty.includes('TRANSFER'))r.Transfer+=v;
    if(ty==='CL. STOCK')r.Closing=v;
  });
  if(!map.size){
    (DATA.stock||[]).forEach(x=>(x.transactions||[]).forEach(t=>{
      const d=reportDate(rowDate(t)),m=clean(x.material||t.material);if(!m||!reportInRange(d,from,to))return;
      const k=key(d,m);if(!map.has(k))map.set(k,{Date:d,Material:m,Unit:materialUnit(m),Received:0,Consumption:0,Transfer:0,Closing:null});
      const r=map.get(k),ty=tType(t),v=tVal(t);if(ty==='PURCHASE'||ty==='RECEIVED')r.Received+=v;else if(ty.includes('CONSUMPTION')||ty.includes('CONSUMPION'))r.Consumption+=v;else if(ty.includes('TRANSFER'))r.Transfer+=v;if(ty==='CL. STOCK')r.Closing=v;
    }));
  }
  return [...map.values()].sort((a,b)=>a.Date.localeCompare(b.Date)||a.Material.localeCompare(b.Material));
}
function reportFeedRows(from,to){
  return (DATA.feedUnitData||[]).filter(r=>reportInRange(reportDate(r.report_date||r.Report_Date||r.date),from,to)).map(r=>{
    const p=clean(r.Product||r.product);
    return {Date:reportDate(r.report_date||r.Report_Date||r.date),Product:p,Production:feedHistoryValue(r,['Production_Day_MT','production_day_mt','Production_Day','production_day','Production','production']),Dispatch:feedHistoryValue(r,['Dispatch_Day_MT','dispatch_day_mt','Dispatch_Day','dispatch_day','Dispatch','dispatch']),Closing:feedHistoryValue(r,['Closing_Day_MT','closing_day_mt','Closing_Day','closing_day','Closing','closing'])};
  }).sort((a,b)=>a.Date.localeCompare(b.Date)||a.Product.localeCompare(b.Product));
}
function reportBagRows(from,to){
  const src=(DATA.bagsHistory&&DATA.bagsHistory.length?DATA.bagsHistory:DATA.bags)||[];
  return src.filter(r=>reportInRange(reportDate(r.report_date||r.Report_Date||r.date||r.DATE),from,to)).map(r=>({Date:reportDate(r.report_date||r.Report_Date||r.date||r.DATE),Product:clean(r.product||'PP Bags'),Received:reportNum(r.received),Issue:reportNum(r.issue),Damage:reportNum(r.damage),Closing:reportNum(r.closing)})).sort((a,b)=>a.Date.localeCompare(b.Date)||a.Product.localeCompare(b.Product));
}
function reportProductionRows(from,to){
  const src=(DATA.productionHistory&&DATA.productionHistory.length?DATA.productionHistory:DATA.production)||[];
  return src.filter(r=>reportInRange(reportDate(r.report_date||r.Report_Date||r.date),from,to)).map(r=>({Date:reportDate(r.report_date||r.Report_Date||r.date),Product:clean(r.product||r.Product),Actual_Output:reportNum(r.actual_output),Standard_Output:reportNum(r.standard_output),Output_Percentage:r.output_percentage===null||r.output_percentage===undefined||r.output_percentage===''?'':reportNum(r.output_percentage),Process_Loss:r.process_loss===null||r.process_loss===undefined||r.process_loss===''?'':reportNum(r.process_loss),Remarks:clean(r.remarks)})).sort((a,b)=>a.Date.localeCompare(b.Date)||a.Product.localeCompare(b.Product));
}
function reportPremixRows(from,to){
  const out=[];
  const seen=new Set();
  (DATA.stockHistory||[]).forEach(t=>{
    const d=reportDate(rowDate(t)),m=clean(t.material),ty=tType(t);if(!m||!isPremixMaterial(m)||!reportInRange(d,from,to)||!isBommakalTransfer(t))return;
    const k=d+'|'+normalize(m)+'|'+tVal(t);if(seen.has(k))return;seen.add(k);out.push({Date:d,Premix:m,Transfer_KG:tVal(t)});
  });
  return out.sort((a,b)=>a.Date.localeCompare(b.Date)||a.Premix.localeCompare(b.Premix));
}
function reportMovementRows(from,to){
  const rows=[];
  (DATA.stockHistory||[]).forEach(t=>{const d=reportDate(rowDate(t)),m=clean(t.material);if(m&&reportInRange(d,from,to))rows.push({Date:d,Material:m,Movement:tType(t),Value:tVal(t),For_Month:reportNum(t.for_month),For_Year:reportNum(t.for_year)});});
  return rows.sort((a,b)=>a.Date.localeCompare(b.Date)||a.Material.localeCompare(b.Material)||a.Movement.localeCompare(b.Movement));
}
function reportSpareRows(){
  const stock=(SPARE_DATA.SPARE_STOCK||[]).map(r=>({Category:spareVal(r,['CATEGORY','Category']),Part_Name:spareVal(r,['NAME','Name','PART_NAME','Part_Name','PART NAME']),Size:spareVal(r,['SIZE','Size']),Code:spareVal(r,['CODE','Code']),Stock:spareVal(r,['STOCK','Stock']),Unit:spareVal(r,['UNIT','Unit'])||'Nos',Reorder_Level:spareVal(r,['REORDER_LEVEL','Reorder_Level','REORDER LEVEL']),Location:spareVal(r,['LOCATION','Location'])}));
  return stock;
}
function reportHealthRows(from,to){
  let reorder=0,issues=0,abnormal=0;
  try{reorder=getMaterials().filter(m=>stockStatus(reportNum(getMaterial(m)?.closing),avgConsumption(m)).status==='REORDER').length}catch(e){}
  try{issues=reconciliationItems().length+feedUnitReconciliationItems().length+ppBagReconciliationItems().length+duplicateTransactionCount()}catch(e){}
  try{abnormal=abnormalConsumptionItems().length}catch(e){}
  return [
    {Metric:'Report Period',Value:from+' → '+to},
    {Metric:'Raw Material Reorder Items',Value:reorder},
    {Metric:'Reconciliation / Data Issues',Value:issues},
    {Metric:'Abnormal Consumption Items',Value:abnormal},
    {Metric:'Raw Material Records',Value:reportRawRows(from,to).length},
    {Metric:'Feed Unit Records',Value:reportFeedRows(from,to).length},
    {Metric:'PP Bag Records',Value:reportBagRows(from,to).length},
    {Metric:'Production Records',Value:reportProductionRows(from,to).length}
  ];
}
function reportSummary(from,to){
  const raw=reportRawRows(from,to),feed=reportFeedRows(from,to),bags=reportBagRows(from,to),prod=reportProductionRows(from,to),premix=reportPremixRows(from,to);
  const sum=(rows,k)=>rows.reduce((a,r)=>a+reportNum(r[k]),0);
  return [
    ['Raw Material Received',sum(raw,'Received'),'MT / source unit'],
    ['Raw Material Consumption',sum(raw,'Consumption'),'MT / source unit'],
    ['Raw Material Transfer',sum(raw,'Transfer'),'MT / source unit'],
    ['Feed Production',sum(feed,'Production'),'MT / product unit'],
    ['Feed Dispatch',sum(feed,'Dispatch'),'MT / product unit'],
    ['PP Bags Received',sum(bags,'Received'),'Bags'],
    ['PP Bags Issue',sum(bags,'Issue'),'Bags'],
    ['PP Bags Damage',sum(bags,'Damage'),'Bags'],
    ['Production Actual Output',sum(prod,'Actual_Output'),'Bags'],
    ['Premix Bommakal Transfer',sum(premix,'Transfer_KG'),'KG']
  ];
}
function reportMixRows(from,to){
  const months=mixAvailableMonths().filter(m=>{
    const start=m+'-01';
    return (!from||m>=from.slice(0,7))&&(!to||m<=to.slice(0,7));
  });
  const rows=[];
  months.forEach(m=>{
    monthlyRMConsumption(m).forEach(r=>rows.push({Month:monthLabel(m),Type:'RM Consumption Mix',Item:r.name,Value_MT:r.value,Percent:0}));
    monthlyFeedMix(m,'Production_Month_MT').forEach(r=>rows.push({Month:monthLabel(m),Type:'Production Mix',Item:r.name,Value_MT:r.value,Percent:0}));
    monthlyFeedMix(m,'Dispatch_Month_MT').forEach(r=>rows.push({Month:monthLabel(m),Type:'Dispatch Mix',Item:r.name,Value_MT:r.value,Percent:0}));
  });
  const totals={};rows.forEach(r=>{const k=r.Month+'|'+r.Type;totals[k]=(totals[k]||0)+r.Value_MT});
  rows.forEach(r=>{const t=totals[r.Month+'|'+r.Type]||0;r.Percent=t?r.Value_MT/t*100:0});
  return rows;
}
function reportMaterialHistoryRows(material,from,to){
  const rows=rmHistoryTransactions(material).filter(t=>inHistoryRange(dateOnly(rowDate(t)),from,to));
  const unit=materialUnit(material,getMaterial(material)?.unit||"MT");
  const dates=[...new Set(rows.map(t=>dateOnly(rowDate(t))).filter(Boolean))].sort();
  return dates.map(d=>{
    const day=rows.filter(t=>dateOnly(rowDate(t))===d);
    return {Date:d,Material:material,Unit:unit,
      Received:rmHistoryValue(day,"received"),Consumption:rmHistoryValue(day,"consumption"),
      Transfer:rmHistoryValue(day,"transfer"),Closing:rmHistoryClosing(day)};
  });
}
function reportProductHistoryRows(kind,product,from,to){
  if(kind==='feed'){
    return feedHistoryDates(product).filter(d=>inHistoryRange(d,from,to)).map(d=>{
      const rr=feedHistoryRows(product).filter(r=>dateOnly(r.Report_Date||r.report_date||r.date)===d),r=rr[rr.length-1]||{};
      return {Date:d,Product:product,
        Production:feedHistoryValue(r,['Production_Day_MT','production_day_mt','Production_Day','production_day','Production','production']),
        Dispatch:feedHistoryValue(r,['Dispatch_Day_MT','dispatch_day_mt','Dispatch_Day','dispatch_day','Dispatch','dispatch']),
        Closing:feedHistoryValue(r,['Closing_Day_MT','closing_day_mt','Closing_Day','closing_day','Closing','closing'])};
    });
  }
  return bagsHistoryDates(product).filter(d=>inHistoryRange(d,from,to)).map(d=>{
    const rr=bagsHistoryRows(product).filter(r=>dateOnly(r.report_date||r.Report_Date||r.date||r.DATE)===d),r=rr[rr.length-1]||{};
    return {Date:d,Product:product,Received:num(r.received),Issue:num(r.issue),Damage:num(r.damage),Closing:num(r.closing)};
  });
}
function reportHistorySelection(kind){
  const material=document.getElementById('reportHistoryMaterial')?.value||rmHistoryMaterials()[0]||'';
  const feed=document.getElementById('reportHistoryFeedProduct')?.value||feedHistoryProducts()[0]||'';
  const bags=document.getElementById('reportHistoryBagProduct')?.value||bagsHistoryProducts()[0]||'';
  return kind==='material'?material:(kind==='feed'?feed:bags);
}
function refreshReportHistorySelectors(){
  const fill=(id,items)=>{const el=document.getElementById(id);if(!el)return;const cur=el.value;el.innerHTML=historySelectOptions(items,items.includes(cur)?cur:(items[0]||''));};
  fill('reportHistoryMaterial',rmHistoryMaterials());
  fill('reportHistoryFeedProduct',feedHistoryProducts());
  fill('reportHistoryBagProduct',bagsHistoryProducts());
}
function reportHistoryData(kind,from,to){
  const selected=reportHistorySelection(kind);
  if(kind==='material')return {title:'Raw Material Material-wise History',headers:['Date','Material','Unit','Received','Consumption','Transfer','Closing'],rows:reportMaterialHistoryRows(selected,from,to).map(r=>[r.Date,r.Material,r.Unit,r.Received,r.Consumption,r.Transfer,r.Closing===null?'':r.Closing]),selected};
  if(kind==='feed')return {title:'Feed Unit Product-wise History',headers:['Date','Product','Production','Dispatch','Closing'],rows:reportProductHistoryRows('feed',selected,from,to).map(r=>[r.Date,r.Product,r.Production??'',r.Dispatch??'',r.Closing??'']),selected};
  return {title:'PP Bags Product-wise History',headers:['Date','Product','Received','Issue','Damage','Closing'],rows:reportProductHistoryRows('bags',selected,from,to).map(r=>[r.Date,r.Product,r.Received??'',r.Issue??'',r.Damage??'',r.Closing??'']),selected};
}
function generateHistoryReportPDF(kind){
  const {from,to}=reportRange();if(!from||!to){showToast('No report dates available');return}
  const sec=reportHistoryData(kind,from,to);if(!sec.rows.length){showToast('No history for selected range');return}
  const title=sec.title+' • '+sec.selected;
  if(!(window.jspdf&&window.jspdf.jsPDF)){reportPdfFallback(title,[sec]);return;}
  try{
    const {jsPDF}=window.jspdf,doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    doc.setFontSize(16);doc.text(title,14,14);doc.setFontSize(9);doc.text('Period: '+from+' → '+to+'   Generated: '+new Date().toLocaleString('en-IN'),14,20);
    doc.autoTable({startY:25,head:[sec.headers],body:reportCleanRows(sec.rows),margin:{left:10,right:10},styles:{fontSize:7,cellPadding:2},headStyles:{fillColor:[39,58,86],textColor:255},alternateRowStyles:{fillColor:[248,250,252]},theme:'grid',didDrawPage:d=>{doc.setFontSize(7);doc.text('Feed Plant Report • '+from+' → '+to,10,202);}});
    doc.save('Feed_Plant_'+reportSafeName(sec.title)+'_'+reportSafeName(sec.selected)+'_'+reportFileStamp()+'.pdf');showToast('History PDF generated');
  }catch(e){console.error(e);reportPdfFallback(title,[sec])}
}
function exportHistoryReportExcel(kind){
  const {from,to}=reportRange();if(!from||!to){showToast('No report dates available');return}
  const sec=reportHistoryData(kind,from,to);if(!sec.rows.length){showToast('No history for selected range');return}
  if(!(window.XLSX&&window.XLSX.utils)){showToast('Excel engine not loaded');return}
  const wb=XLSX.utils.book_new(),aoa=[sec.headers,...sec.rows.map(r=>r.map(reportRound))],ws=XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols']=sec.headers.map(h=>({wch:Math.max(12,Math.min(28,String(h).length+6))}));XLSX.utils.book_append_sheet(wb,ws,'History');
  XLSX.writeFile(wb,'Feed_Plant_'+reportSafeName(sec.title)+'_'+reportSafeName(sec.selected)+'_'+reportFileStamp()+'.xlsx');showToast('History Excel exported');
}
function historyWhatsAppText(kind,from,to){
  const sec=reportHistoryData(kind,from,to),s0=kind==='material'?'📦 RAW MATERIAL HISTORY':kind==='feed'?'🌾 FEED UNIT HISTORY':'🛍 PP BAGS HISTORY';
  let s=s0+'\n'+sec.selected+'\n'+from+' to '+to+'\n\n';
  sec.rows.forEach(r=>{if(kind==='material')s+=r[0]+' | Received: '+reportDisplayCell(r[3])+' '+r[2]+' | Consumption: '+reportDisplayCell(r[4])+' '+r[2]+' | Transfer: '+reportDisplayCell(r[5])+' '+r[2]+' | Closing: '+(r[6]===''?'--':reportDisplayCell(r[6]))+' '+r[2]+'\n';
    else if(kind==='feed')s+=r[0]+' | Production: '+reportDisplayCell(r[2])+' | Dispatch: '+reportDisplayCell(r[3])+' | Closing: '+(r[4]===''?'--':reportDisplayCell(r[4]))+'\n';
    else s+=r[0]+' | Received: '+reportDisplayCell(r[2])+' | Issue: '+reportDisplayCell(r[3])+' | Damage: '+reportDisplayCell(r[4])+' | Closing: '+reportDisplayCell(r[5])+'\n';});
  return s.trim();
}
async function copyTextRobust(text){
  try{if(navigator.clipboard&&window.isSecureContext){await navigator.clipboard.writeText(text);return true}}catch(e){}
  const ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.left='-9999px';ta.style.top='0';ta.style.opacity='0';document.body.appendChild(ta);ta.focus();ta.select();ta.setSelectionRange(0,text.length);
  let ok=false;try{ok=document.execCommand('copy')}catch(e){}ta.remove();return ok;
}
function showWhatsAppCopyModal(text){
  showModal('📱 WhatsApp Message',`<div class="detail-section"><div class="small-note">Message ready. Tap Copy Message, then paste directly into WhatsApp.</div><textarea id="reportWhatsAppBox" readonly style="width:100%;min-height:260px;box-sizing:border-box;border:1px solid #dfe5ee;border-radius:10px;padding:10px;font:12px/1.5 inherit;resize:vertical;background:#fff">${esc(text)}</textarea><div style="display:flex;gap:8px;margin-top:9px"><button class="more-toggle" onclick="copyVisibleWhatsApp()">📋 Copy Message</button><button class="more-toggle" onclick="closeModal()">Close</button></div></div>`);
}
async function copyVisibleWhatsApp(){const ta=document.getElementById('reportWhatsAppBox');if(!ta)return;const ok=await copyTextRobust(ta.value);if(ok)showToast('WhatsApp message copied');else{ta.focus();ta.select();ta.setSelectionRange(0,ta.value.length);showToast('Tap and hold the message to copy');}}
async function copyHistoryWhatsApp(kind){const {from,to}=reportRange();if(!from||!to){showToast('No report dates available');return}const text=historyWhatsAppText(kind,from,to);if(!text){showToast('No history for selected range');return}const ok=await copyTextRobust(text);showToast(ok?'WhatsApp message copied':'Tap Copy Message in the message window');showWhatsAppCopyModal(text)}

function reportSectionData(section,from,to){
  switch(section){
    case 'raw':return {title:'Raw Material',headers:['Date','Material','Unit','Received','Consumption','Transfer','Closing'],rows:reportRawRows(from,to).map(r=>[r.Date,r.Material,r.Unit,r.Received,r.Consumption,r.Transfer,r.Closing===null?'':r.Closing])};
    case 'feed':return {title:'Feed Unit',headers:['Date','Product','Production','Dispatch','Closing'],rows:reportFeedRows(from,to).map(r=>[r.Date,r.Product,r.Production??'',r.Dispatch??'',r.Closing??''])};
    case 'bags':return {title:'PP Bags',headers:['Date','Product','Received','Issue','Damage','Closing'],rows:reportBagRows(from,to).map(r=>[r.Date,r.Product,r.Received,r.Issue,r.Damage,r.Closing])};
    case 'production':return {title:'Production',headers:['Date','Product','Actual Output','Standard Output','Output %','Process Loss %','Remarks'],rows:reportProductionRows(from,to).map(r=>[r.Date,r.Product,r.Actual_Output,r.Standard_Output,r.Output_Percentage,r.Process_Loss,r.Remarks])};
    case 'premix':return {title:'Premix Transfers',headers:['Date','Premix','Transfer KG'],rows:reportPremixRows(from,to).map(r=>[r.Date,r.Premix,r.Transfer_KG])};
    case 'mix':return {title:'Monthly Mix & Contribution',headers:['Month','Type','Item','Value MT','Contribution %'],rows:reportMixRows(from,to).map(r=>[r.Month,r.Type,r.Item,r.Value_MT,r.Percent])};
    case 'movements':return {title:'Raw Material Movements',headers:['Date','Material','Movement','Value','For Month','For Year'],rows:reportMovementRows(from,to).map(r=>[r.Date,r.Material,r.Movement,r.Value,r.For_Month,r.For_Year])};
    case 'spares':return {title:'Spare Parts',headers:['Category','Part Name','Size','Code','Stock','Unit','Reorder Level','Location'],rows:reportSpareRows().map(r=>[r.Category,r.Part_Name,r.Size,r.Code,r.Stock,r.Unit,r.Reorder_Level,r.Location])};
    case 'health':return {title:'Data Health',headers:['Metric','Value'],rows:reportHealthRows(from,to).map(r=>[r.Metric,r.Value])};
    default:return {title:'Complete Dashboard',headers:[],rows:[]};
  }
}
function reportCompleteSections(from,to){
  const sections=[];
  sections.push({title:'Management Summary',headers:['Metric','Value','Unit / Context'],rows:reportSummary(from,to)});
  ['raw','feed','bags','production','premix','mix','movements','spares','health'].forEach(k=>sections.push(reportSectionData(k,from,to)));
  return sections;
}
function reportFileStamp(){return (document.getElementById('reportFromDate')?.value||'')+'_'+(document.getElementById('reportToDate')?.value||'')}
function reportSafeName(s){return clean(s).replace(/[^a-z0-9_-]+/gi,'_').replace(/^_+|_+$/g,'')}
function reportPdfFallback(title,sections){
  const w=window.open('','_blank');if(!w){showToast('Popup blocked — allow popups for PDF');return;}
  const css=`<style>body{font-family:Arial,sans-serif;padding:24px;color:#202938}h1{font-size:22px}h2{font-size:16px;margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:6px}table{border-collapse:collapse;width:100%;margin:8px 0 20px;font-size:10px}th,td{border:1px solid #ddd;padding:5px;text-align:left}th{background:#f1f4f8}small{color:#667085}@media print{.page{break-before:page}}</style>`;
  w.document.write('<!doctype html><html><head><title>'+esc(title)+'</title>'+css+'</head><body><h1>'+esc(title)+'</h1><small>Generated: '+esc(new Date().toLocaleString('en-IN'))+'</small>');
  sections.forEach((sec,i)=>{w.document.write((i?'':'')+'<div class="page"><h2>'+esc(sec.title)+'</h2><table><thead><tr>'+sec.headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+sec.rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(reportDisplayCell(v))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>')});
  w.document.write('</body></html>');w.document.close();setTimeout(()=>w.print(),500);
}
function generateReportPDF(section){
  const {from,to}=reportRange();if(!from||!to){showToast('No report dates available');return}
  const sections=section==='complete'?reportCompleteSections(from,to):[reportSectionData(section,from,to)];
  const title=section==='complete'?'Feed Plant Complete Management Report':'Feed Plant '+(sections[0]?.title||'Report');
  if(!(window.jspdf&&window.jspdf.jsPDF)){reportPdfFallback(title,sections);return;}
  try{
    const {jsPDF}=window.jspdf;const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
    doc.setFontSize(16);doc.text(title,14,14);doc.setFontSize(9);doc.text('Period: '+from+' → '+to+'   Generated: '+new Date().toLocaleString('en-IN'),14,20);
    let y=25;
    sections.forEach((sec,i)=>{
      if(i>0){doc.addPage();y=14;}
      doc.setFontSize(12);doc.text(sec.title,14,y);y+=4;
      doc.autoTable({startY:y,head:[sec.headers],body:reportCleanRows(sec.rows),margin:{left:10,right:10},styles:{fontSize:7,cellPadding:2},headStyles:{fillColor:[39,58,86],textColor:255},alternateRowStyles:{fillColor:[248,250,252]},theme:'grid',didDrawPage:data=>{doc.setFontSize(7);doc.text('Feed Plant Report • '+from+' → '+to,10,202);}});
    });
    doc.save('Feed_Plant_'+reportSafeName(section==='complete'?'Complete_Report':sections[0].title)+'_'+reportFileStamp()+'.pdf');showToast('PDF generated');
  }catch(e){console.error(e);reportPdfFallback(title,sections)}
}
function exportReportExcel(section){
  const {from,to}=reportRange();if(!from||!to){showToast('No report dates available');return}
  const sections=section==='complete'?reportCompleteSections(from,to):[reportSectionData(section,from,to)];
  if(!(window.XLSX&&window.XLSX.utils)){showToast('Excel engine not loaded — use PDF/CSV fallback');return}
  const wb=XLSX.utils.book_new();
  sections.forEach((sec,i)=>{const aoa=[sec.headers,...sec.rows.map(r=>r.map(reportRound))];const ws=XLSX.utils.aoa_to_sheet(aoa);ws['!cols']=sec.headers.map(h=>({wch:Math.max(12,Math.min(28,String(h).length+5))}));XLSX.utils.book_append_sheet(wb,ws,clean(sec.title).slice(0,31)||('Report'+(i+1)));});
  XLSX.writeFile(wb,'Feed_Plant_'+reportSafeName(section==='complete'?'Complete_Report':sections[0].title)+'_'+reportFileStamp()+'.xlsx');showToast('Excel exported');
}
function reportWhatsAppText(section,from,to){
  const sum=reportSummary(from,to);let s='📊 FEED PLANT REPORT\n'+from+' to '+to+'\n\n';
  if(section==='complete'){
    s+='🌾 FEED UNIT\nProduction: '+reportFmt(sum[3][1])+' MT\nDispatch: '+reportFmt(sum[4][1])+' MT\n\n';
    s+='📦 RAW MATERIAL\nReceived: '+reportFmt(sum[0][1])+'\nConsumption: '+reportFmt(sum[1][1])+'\nTransfer: '+reportFmt(sum[2][1])+'\n\n';
    s+='🛍 PP BAGS\nReceived: '+reportFmt(sum[5][1])+'\nIssue: '+reportFmt(sum[6][1])+'\nDamage: '+reportFmt(sum[7][1])+'\n\n';
    s+='🏭 PRODUCTION\nActual Output: '+reportFmt(sum[8][1])+' Bags\n\n';
    s+='🧪 PREMIX TRANSFER\n'+reportFmt(sum[9][1])+' KG\n\n';
    const h=reportHealthRows(from,to);s+='⚠️ DATA HEALTH\nReorder: '+h[1].Value+'\nIssues: '+h[2].Value+'\nAbnormal Consumption: '+h[3].Value;
    return s;
  }
  const sec=reportSectionData(section,from,to);s+='📌 '+sec.title.toUpperCase()+'\n';
  sec.rows.slice(-25).forEach(r=>{s+=r.join(' | ')+'\n'});
  if(sec.rows.length>25)s+='\n… '+(sec.rows.length-25)+' more rows available in PDF/Excel.';
  return s;
}
async function copyReportWhatsApp(section){
  const {from,to}=reportRange();if(!from||!to){showToast('No report dates available');return}
  const text=reportWhatsAppText(section,from,to);
  const ok=await copyTextRobust(text);
  showToast(ok?'WhatsApp message copied':'Tap Copy Message in the message window');
  showWhatsAppCopyModal(text);
}

/* =====================================================
   START
===================================================== */
restoreCache();
refreshData();
loadSpareParts();

/* PWA */
let deferredPrompt=null;
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredPrompt=e;document.getElementById("installBtn").style.display="block"});
async function installPWA(){if(!deferredPrompt)return;deferredPrompt.prompt();await deferredPrompt.userChoice;deferredPrompt=null;document.getElementById("installBtn").style.display="none"}
if("serviceWorker" in navigator){window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.warn))}



/* UI-only grouping for Raw Material Movements. Existing calculations/API/data logic remain unchanged. */
function renderRawCategory(tab){
  const el=document.getElementById("rawCategoryList");
  if(!el)return;
  const mats=getMaterials();
  let rows;
  if(tab==="STOCK") rows=mats.map(m=>({m,v:num(getMaterial(m)?.closing)||0})).sort((a,b)=>(b.v>0?1:0)-(a.v>0?1:0)||b.v-a.v);
  else rows=mats.map(m=>({m,v:rawTotal(m,tab)})).sort((a,b)=>(b.v>0?1:0)-(a.v>0?1:0)||b.v-a.v);

  const rawRows=rows.filter(x=>! /PREMIX/i.test(clean(x.m)));
  const premixRows=rows.filter(x=>/PREMIX/i.test(clean(x.m)));
  const limit=rawMovementExpanded?Infinity:25;
  const rawVisible=rawRows.slice(0,limit);
  const premixVisible=premixRows.slice(0,limit);

  const renderGroup=(title,subtitle,list)=>{
    if(!list.length)return `<div class="raw-movement-group"><div class="raw-movement-group-title"><strong>${title}</strong><span>0 items</span></div><div class="empty" style="padding:8px 2px;font-size:9px">No data</div></div>`;
    const body=list.map(({m,v})=>{
      if(tab==="STOCK"){
        const x=getMaterial(m);
        return `<div class="feed-row raw-movement-row" onclick="openMaterialDetails('${jsq(m)}')"><div class="row-name">${esc(m)}</div><div class="row-right"><strong>${fmtMaterial(num(x?.closing)||0,m,x?.unit||"MT")}</strong><small>Tap for details</small></div></div>`;
      }
      const label=tab==="TRANSFER"?"Transfer / Bommakal":tab;
      return `<div class="feed-row raw-movement-row" onclick="openMaterialDetails('${jsq(m)}')"><div class="row-name">${esc(m)}</div><div class="row-right"><strong>${fmtMaterial(v,m,"MT")}</strong><small>${esc(label)} • details</small></div></div>`;
    }).join("");
    return `<div class="raw-movement-group"><div class="raw-movement-group-title"><strong>${title}</strong><span>${list.length} items</span></div>${body}</div>`;
  };

  let html='<div class="raw-movement-groups">';
  html+=renderGroup("🌾 Raw Materials","MT",rawVisible);
  html+=renderGroup("🧪 Premixes","KG",premixVisible);
  html+='</div>';

  const hidden=(rawRows.length>25?rawRows.length-25:0)+(premixRows.length>25?premixRows.length-25:0);
  if(hidden>0)html+=`<button class="more-toggle" onclick="toggleRawMovementMore()">${rawMovementExpanded?"Show less ↑":"More • "+hidden+" more ↓"}</button>`;
  el.innerHTML=html;
}

/* =====================================================
   FINAL PRODUCTION DATA FIX
   Display-only fix: use the latest production day,
   de-duplicate products, and include all products
   having Day Production in FEED_UNIT_DATA.
   API URL / API fetch / source data are unchanged.
===================================================== */
function __productionDateOf(r){
  return dateOnly(r?.report_date||r?.Report_Date||"");
}
function __latestDatedRows(rows){
  const arr=Array.isArray(rows)?rows:[];
  const dates=arr.map(__productionDateOf).filter(Boolean).sort();
  if(!dates.length)return arr;
  const latest=dates[dates.length-1];
  return arr.filter(r=>__productionDateOf(r)===latest);
}
function __uniqueProductRows(rows, productGetter){
  const map=new Map();
  (rows||[]).forEach(r=>{
    const p=clean(productGetter(r));
    if(!p)return;
    const key=normalize(p);
    const old=map.get(key);
    if(!old){map.set(key,{...r,product:p});return;}
    const oldActual=num(old.actual_output)||0;
    const newActual=num(r.actual_output)||0;
    /* Prefer the row carrying the larger actual output; if equal,
       prefer the later/complete row so duplicate API records never render twice. */
    if(newActual>oldActual){
      map.set(key,{...r,product:p});
    }else if(newActual===oldActual){
      const oldScore=["standard_output","output_percentage","process_loss","remarks"].reduce((n,k)=>n+(old[k]!==null&&old[k]!==undefined&&old[k]!==""?1:0),0);
      const newScore=["standard_output","output_percentage","process_loss","remarks"].reduce((n,k)=>n+(r[k]!==null&&r[k]!==undefined&&r[k]!==""?1:0),0);
      if(newScore>oldScore)map.set(key,{...r,product:p});
    }
  });
  return [...map.values()];
}
function __productionSourceForDisplay(){
  if(VIEW_DATE){
    const d=dateOnly(VIEW_DATE);
    const history=Array.isArray(DATA.productionHistory)?DATA.productionHistory:[];
    const direct=(Array.isArray(DATA.production)?DATA.production:[]).filter(r=>__productionDateOf(r)===d);
    const hist=history.filter(r=>__productionDateOf(r)===d);
    return hist.length?hist:direct;
  }
  return __latestDatedRows(Array.isArray(DATA.production)?DATA.production:[]);
}
function productionDisplayRows(){
  /* Production section uses ONLY PRODUCTION_DATA / production history.
     Feed Unit data is intentionally NOT merged here. Duplicate product
     records from the production API are collapsed to one row. */
  const source=__productionSourceForDisplay();
  return __uniqueProductRows(source,r=>r.product||r.Product).sort((a,b)=>{
    const av=num(a.actual_output)||0;
    const bv=num(b.actual_output)||0;
    return (bv>0)-(av>0) || bv-av || normalize(a.product).localeCompare(normalize(b.product));
  });
}
function renderProduction(){
  const rows=productionDisplayRows();
  const total=rows.reduce((sum,r)=>sum+(num(r.actual_output)||0),0);
  setText("productionTotalMain",fmtBags(total));

  const el=document.getElementById("productionList");
  if(!el)return;

  el.innerHTML=rows.map(r=>{
    const p=r.product||"--";
    const a=num(r.actual_output);
    const op=num(r.output_percentage);
    const loss=num(r.process_loss);
    const remarks=clean(r.remarks);

    return `<div class="production-row" onclick="openProductDetails('${jsq(p)}')">
      <div>
        <div class="row-name">${esc(p)}</div>
        <div class="prod-meta">
          Output ${op!==null?fmt(op)+"%":"--"} • Loss ${loss!==null?fmt(loss)+"%":"--"}${remarks?" • "+esc(remarks):""}
        </div>
      </div>
      <div class="row-right">
        <strong>${fmtBags(a)}</strong>
        <small>Standard ${fmtBags(r.standard_output)}</small>
      </div>
    </div>`;
  }).join("")||"<div class='empty'>No production data for this date</div>";
}

