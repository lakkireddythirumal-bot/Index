/* =====================================================
   WORKING GOOGLE APPS SCRIPT URL — KEEP UNCHANGED • UI REFINEMENT
===================================================== */
const API_URL="https://iqxprkmainafqjodpfdk.supabase.co";
const SUPABASE_URL=API_URL;
const SUPABASE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxeHBya21haW5hZnFqb2RwZmRrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTEyMDQ4MTgsImV4cCI6MjEwNjc4MDgxOH0.RMYxXCnpdsz25SC6uzN6yjykUf1InbmxE9s2wXJDHc8";
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

/* =====================================================
   DATA CONTROL / REVIEW LAYER
   Raw source is never deleted. Decisions are stored locally and applied
   consistently to calculations and dashboard views.
===================================================== */
const DATA_CONTROL_KEY="plant_data_control_v1";
let DATA_CONTROL={materials:{},products:{},records:{}};
let DC_RAW_DATA={stock:[],stockHistory:[],production:[],productionHistory:[],bags:[],bagsHistory:[],feedUnitData:[],feedUnitTotals:[],productionTrend:[]};
let DC_REMOTE_LOADED=false,DC_REMOTE_SAVE=Promise.resolve();
function dcNormalizeSettings(raw){return {materials:raw&&raw.materials||{},products:raw&&raw.products||{},records:raw&&raw.records||{}}}
function loadDataControl(){try{DATA_CONTROL=dcNormalizeSettings(JSON.parse(localStorage.getItem(DATA_CONTROL_KEY)||"{}"))}catch(e){DATA_CONTROL={materials:{},products:{},records:{}}}}
function saveDataControl(){
  const snapshot={...DATA_CONTROL,updatedAt:new Date().toISOString()};
  try{localStorage.setItem(DATA_CONTROL_KEY,JSON.stringify(snapshot))}catch(e){}
  DC_REMOTE_SAVE=DC_REMOTE_SAVE.catch(()=>{}).then(async()=>{
    const res=await fetch(SUPABASE_URL+"/rest/v1/dashboard_data_control?on_conflict=id",{method:"POST",headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id:"site",settings:snapshot,updated_at:snapshot.updatedAt})});
    if(!res.ok)throw Error("Supabase Data Control save failed: "+res.status);
  }).catch(e=>{console.warn("Data Control cloud save failed; local copy retained",e);try{dcToast("Cloud save failed — check connection","error")}catch(_){}});
}
async function dcLoadSupabase(){
  if(DC_REMOTE_LOADED)return;
  try{
    const res=await fetch(SUPABASE_URL+"/rest/v1/dashboard_data_control?id=eq.site&select=settings&limit=1",{headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY},cache:"no-store"});
    if(!res.ok)throw Error("Supabase Data Control load failed: "+res.status);
    const rows=await res.json();
    if(rows.length&&rows[0].settings&&typeof rows[0].settings==="object"){
      DATA_CONTROL=dcNormalizeSettings(rows[0].settings);
      try{localStorage.setItem(DATA_CONTROL_KEY,JSON.stringify({...DATA_CONTROL,updatedAt:rows[0].settings.updatedAt||""}))}catch(e){}
    }else{
      const snapshot={...DATA_CONTROL,updatedAt:new Date().toISOString()};
      const save=await fetch(SUPABASE_URL+"/rest/v1/dashboard_data_control?on_conflict=id",{method:"POST",headers:{"apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY,"Content-Type":"application/json","Prefer":"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({id:"site",settings:snapshot,updated_at:snapshot.updatedAt})});
      if(!save.ok)throw Error("Supabase initial Data Control save failed: "+save.status);
    }
    DC_REMOTE_LOADED=true;
  }catch(e){console.warn("Data Control cloud load failed; using local settings",e)}
}
loadDataControl();
function dcKey(v){return normalize(v).replace(/[^A-Z0-9._-]+/g,"_")}
function dcMaterialState(name){return DATA_CONTROL.materials[dcKey(name)]||{status:"ACTIVE",reason:"",updatedAt:""}}
function dcProductState(name){return DATA_CONTROL.products[dcKey(name)]||{status:"ACTIVE",reason:"",updatedAt:""}}
function dcSourceName(t,fallback="stock_data"){return clean(t&&t._dcSource||fallback)}
function dcRecordKey(material,t){
  const source=dcSourceName(t,"stock_data");
  if(t&&t.id!==undefined&&t.id!==null&&clean(t.id)!=="")return "SRC|"+source+"|"+clean(t.id);
  return dcKey([source,material,dateOnly(rowDate(t)),tType(t),tVal(t),clean(t.for_day),clean(t.for_month),clean(t.for_year)].join("|"));
}
function dcRecordState(material,t){return DATA_CONTROL.records[dcRecordKey(material,t)]||null}
function dcRefreshUI(message, tone="success"){
  // Render the control-center state first so the clicked button updates immediately.
  try{renderDataControl();}catch(e){console.warn("Data control refresh failed",e)}
  try{renderDcReviewOverlay();}catch(e){}
  try{renderDcReportIfOpen();}catch(e){}
  if(message) dcToast(message,tone);
  // Dashboard calculations refresh after the control UI has visibly updated.
  setTimeout(()=>{try{invalidatePerfCache(); renderDashboard();}catch(e){console.warn("Dashboard refresh failed",e)}},0);
}
function dcToast(message,tone="success"){
  const el=document.getElementById("dcToast"); if(!el)return;
  el.textContent=message; el.className="dc-toast show "+tone;
  clearTimeout(dcToast._timer); dcToast._timer=setTimeout(()=>el.classList.remove("show"),2200);
}
function closeDcReview(){
  const overlay=document.getElementById("dcReviewOverlay");
  if(!overlay)return;
  overlay.classList.remove("show"); overlay.setAttribute("aria-hidden","true");
}
function dcReviewOverlayOutside(e){if(e.target&&e.target.id==="dcReviewOverlay")closeDcReview()}

function dcSetMaterial(name,status,reason){
  const k=dcKey(name), now=new Date().toISOString(), base={status,reason:clean(reason),updatedAt:now};
  if(status==="HIDDEN"){const rows=dcMaterialActivity(name);base.activityAck=rows.map(t=>dateOnly(rowDate(t))).filter(Boolean).sort().pop()||"";}
  DATA_CONTROL.materials[k]=base; saveDataControl(); invalidatePerfCache(); dcRefreshUI(`${name}: ${status==="HIDDEN"?"Hidden":"Active"}`);
}
function dcSetProduct(name,status,reason){
  const k=dcKey(name), now=new Date().toISOString(), base={status,reason:clean(reason),updatedAt:now};
  if(status==="HIDDEN"){const rows=[...(DATA.production||[]),...(DATA.productionHistory||[]),...(DATA.feedUnitData||[]),...(DATA.bags||[]),...(DATA.bagsHistory||[])].filter(r=>normalize(r.product||r.Product)===normalize(name));base.activityAck=rows.map(r=>dateOnly(r.Report_Date||r.report_date||r.date)).filter(Boolean).sort().pop()||"";}
  DATA_CONTROL.products[k]=base; saveDataControl(); invalidatePerfCache(); dcRefreshUI(`${name}: ${status==="HIDDEN"?"Hidden":"Active"}`);
}
function dcSetRecord(material,t,status,reason){
  const k=dcRecordKey(material,t); DATA_CONTROL.records[k]={status,reason:clean(reason),updatedAt:new Date().toISOString()}; saveDataControl(); invalidatePerfCache(); dcRefreshUI(`${material}: ${status==="EXCLUDED"?"Record excluded":"Record restored"}`);
}
function dcReviewExcludedRecord(material,t,keep){
  const k=dcRecordKey(material,t), old=DATA_CONTROL.records[k]||{};
  DATA_CONTROL.records[k]={...old,status:keep?"EXCLUDED":"KEPT",reason:keep?"Reviewed — keep excluded":"Reconciliation changed — restored",updatedAt:new Date().toISOString(),reviewAck:keep?dcLatestRawReconciliation(material).status+"|"+dcLatestRawReconciliation(material).date:""};
  saveDataControl(); invalidatePerfCache(); dcRefreshUI();
}
function dcReviewHiddenMaterial(material,keep){
  const rows=dcMaterialActivity(material), latest=rows.map(t=>dateOnly(rowDate(t))).filter(Boolean).sort().pop()||"";
  if(keep){const k=dcKey(material),st=dcMaterialState(material); DATA_CONTROL.materials[k]={...st,status:"HIDDEN",reason:"Activity reviewed — keep hidden",updatedAt:new Date().toISOString(),activityAck:latest}; saveDataControl(); invalidatePerfCache(); dcRefreshUI(`${material}: kept hidden`); }
  else dcSetMaterial(material,"ACTIVE","Activity detected — reviewed");
}
function dcReviewHiddenProduct(product,keep){
  const rows=[...(DATA.production||[]),...(DATA.productionHistory||[]),...(DATA.feedUnitData||[]),...(DATA.bags||[]),...(DATA.bagsHistory||[])].filter(r=>normalize(r.product||r.Product)===normalize(product));
  const latest=rows.map(r=>dateOnly(r.Report_Date||r.report_date||r.date)).filter(Boolean).sort().pop()||"";
  if(keep){const k=dcKey(product),st=dcProductState(product); DATA_CONTROL.products[k]={...st,status:"HIDDEN",reason:"Activity reviewed — keep hidden",updatedAt:new Date().toISOString(),activityAck:latest}; saveDataControl(); invalidatePerfCache(); dcRefreshUI(`${product}: kept hidden`); }
  else dcSetProduct(product,"ACTIVE","Activity detected — reviewed");
}
function dcIsExcluded(material,t){const s=dcRecordState(material,t);return s&&s.status==="EXCLUDED"}
function dcIsHiddenMaterial(name){return dcMaterialState(name).status==="HIDDEN"}
function dcIsHiddenProduct(name){return dcProductState(name).status==="HIDDEN"}
function dcRawTransactions(material){
  const item=(DC_RAW_DATA.stock||[]).find(x=>normalize(x.material)===normalize(material));
  return item&&Array.isArray(item.transactions)?item.transactions:[];
}
function dcApprovedTransactions(material){return dcRawTransactions(material).filter(t=>!dcIsExcluded(material,t))}
function dcAllMaterialNames(){return [...new Set((DC_RAW_DATA.stock||[]).map(x=>clean(x.material)).filter(Boolean))]}
function dcProductSourceRows(){
 const prod=DC_RAW_DATA.productionHistory&&DC_RAW_DATA.productionHistory.length?DC_RAW_DATA.productionHistory:DC_RAW_DATA.production||[];
 const bags=DC_RAW_DATA.bagsHistory&&DC_RAW_DATA.bagsHistory.length?DC_RAW_DATA.bagsHistory:DC_RAW_DATA.bags||[];
 return [
 ...prod.map(r=>({...r,_dcSource:"production_data"})),
 ...bags.map(r=>({...r,_dcSource:"pp_bags_data"})),
 ...(DC_RAW_DATA.feedUnitData||[]).map(r=>({...r,_dcSource:"feed_unit_data"})),
 ...(DC_RAW_DATA.feedUnitTotals||[]).map(r=>({...r,_dcSource:"feed_unit_totals"}))
 ];
}
function dcAllProductNames(){return [...new Set(dcProductSourceRows().map(r=>clean(r.product||r.Product)).filter(Boolean))]}
function dcDuplicateGroups(){
 const groups=[];
 const latestByMaterial=new Map();
 (DC_RAW_DATA.stock||[]).forEach(item=>{
  const name=clean(item.material); if(!name)return;
  const dates=(item.transactions||[]).map(t=>dateOnly(rowDate(t))).filter(Boolean).sort();
  if(dates.length)latestByMaterial.set(dcKey(name),dates[dates.length-1]);
 });
 (DC_RAW_DATA.stock||[]).forEach(item=>{
  const name=clean(item.material); if(!name)return;
  const latest=latestByMaterial.get(dcKey(name)); if(!latest)return;
  const rows=(item.transactions||[]).filter(t=>dateOnly(rowDate(t))===latest).map(t=>({...t,_dcSource:"stock_data"})).filter(t=>tType(t));
  if(!rows.length)return;
  const byActivity=new Map();
  rows.forEach(r=>{const a=tType(r);if(!byActivity.has(a))byActivity.set(a,[]);byActivity.get(a).push(r)});
  const repeated=[...byActivity.entries()].filter(([_,rs])=>rs.length>=2);
  if(!repeated.length)return;
  const recordCount=Math.max(...repeated.map(([_,rs])=>rs.length));
  const candidateRecords=[];
  for(let n=1;n<=recordCount;n++){
   const recordRows=[];
   repeated.forEach(([activity,rs])=>{
    rs.sort((a,b)=>String(a.imported_at||"").localeCompare(String(b.imported_at||""))||String(a.id||"").localeCompare(String(b.id||"")));
    if(rs[n-1])recordRows.push(rs[n-1]);
   });
   if(recordRows.length>=2)candidateRecords.push({n,rows:recordRows.sort((a,b)=>tType(a).localeCompare(tType(b)))});
  }
  /* Only show a duplicate set when at least two records share at least two activities. */
  if(candidateRecords.length<2)return;
  const sharedActivities=candidateRecords.reduce((set,r)=>new Set([...set].filter(a=>r.rows.some(x=>tType(x)===a))),new Set(candidateRecords[0].rows.map(tType)));
  if(sharedActivities.size<2)return;
  candidateRecords.forEach(({n,rows})=>{
   const commonRows=rows.filter(r=>sharedActivities.has(tType(r)));
   if(commonRows.length<2)return;
   const rowSignature=commonRows.map(r=>[tType(r),tVal(r),clean(r.for_day),clean(r.for_month),clean(r.for_year)].join(":")).sort().join(";");
   const stableKey="DUPGROUP|M|"+dcKey(name)+"|"+latest+"|R"+n+"|"+dcKey(rowSignature);
   const marker=DATA_CONTROL.records[stableKey];
   const groupKey="M|"+dcKey(name)+"|"+latest+"|"+n+"|"+[...sharedActivities].sort().map(dcKey).join(",");
   groups.push({kind:"material",name,date:latest,activity:"Stock transactions",groupKey,stableKey,recordNumber:n,rows:commonRows,excluded:!!(marker&&marker.status==="EXCLUDED")});
  });
 });
 /* Product sources are checked only on their latest date; exact duplicate rows are grouped consistently. */
 const productRows=new Map();
 dcProductSourceRows().forEach(r=>{
  const name=clean(r.product||r.Product),date=dateOnly(r.report_date||r.Report_Date||r.date||r.DATE),source=dcSourceName(r,"production_data");
  if(!name||!date)return;
  const key="P|"+source+"|"+dcKey(name);
  if(!productRows.has(key))productRows.set(key,{source,name,rows:[]});
  productRows.get(key).rows.push({...r,_dcSource:source,_dcDate:date});
 });
 productRows.forEach(g=>{
  const latest=g.rows.map(r=>r._dcDate).sort().pop();
  const latestRows=g.rows.filter(r=>r._dcDate===latest);
  const sigs=new Map();
  latestRows.forEach(r=>{
   const sig=Object.keys(r).filter(k=>!["id","_dcSource","_dcRecordLabel","imported_at","created_at","updated_at","_dcDate"].includes(k)).sort().map(k=>k+":"+String(r[k]??"")).join("|");
   if(!sigs.has(sig))sigs.set(sig,[]);
   sigs.get(sig).push(r);
  });
  sigs.forEach((rs,sig)=>{
   if(rs.length<2)return;
   const stableKey="DUPGROUP|P|"+g.source+"|"+dcKey(g.name)+"|"+latest+"|"+dcKey(sig);
   const marker=DATA_CONTROL.records[stableKey];
   rs.forEach((row,i)=>groups.push({kind:"product",name:g.name,date:latest,activity:g.source,groupKey:stableKey+"|record|"+(i+1),stableKey,recordNumber:i+1,rows:[row],excluded:!!(marker&&marker.status==="EXCLUDED")}));
  });
 });
 return groups.sort((a,b)=>b.date.localeCompare(a.date)||a.name.localeCompare(b.name)||(a.recordNumber||0)-(b.recordNumber||0));
}
function dcDuplicateGroupStatus(g){
 const states=g.rows.map(r=>!!dcIsExcluded(g.name,{...r,_dcSource:r._dcSource||(g.kind==="material"?"stock_data":g.activity)}));
 return states.every(Boolean)?"EXCLUDED":states.some(Boolean)?"MIXED":"KEPT";
}
function dcSetDuplicateGroupEncoded(encoded,status){
 try{
  const g=JSON.parse(decodeURIComponent(encoded));
  const stamp=new Date().toISOString();
  if(g.stableKey){
   if(status==="EXCLUDED")DATA_CONTROL.records[g.stableKey]={status,reason:"Duplicate group manually excluded",updatedAt:stamp};
   else delete DATA_CONTROL.records[g.stableKey];
  }
  g.rows.forEach(row=>{
   const tagged={...row,_dcSource:row._dcSource||(g.kind==="material"?"stock_data":g.activity)};
   DATA_CONTROL.records[dcRecordKey(g.name,tagged)]={status,reason:status==="EXCLUDED"?"Duplicate group manually excluded":"Duplicate group manually restored",updatedAt:stamp};
  });
  saveDataControl();invalidatePerfCache();dcRefreshUI(g.name+": "+(status==="EXCLUDED"?"whole group excluded":"whole group restored"));
 }catch(e){console.warn("Unable to update duplicate group",e);dcToast("Could not update this group","error")}
}
function dcDuplicateRowSummary(g,r){
 if(g.kind==="material")return {label:tType(r)||"Transaction",values:[["Value",fmt(tVal(r))],["Day",fmt(r.for_day)],["Month",fmt(r.for_month)],["Year",fmt(r.for_year)]]};
 const fields=[["Output",r.actual_output??r.production_day_mt??r.Production_Day_MT??r.output??r.quantity??r.value],["Dispatch",r.dispatch_day_mt??r.Dispatch_Day_MT??r.dispatch]];
 return {label:clean(r.product||r.Product)||g.activity,values:fields.filter(x=>x[1]!==undefined&&x[1]!==null&&x[1]!=="").map(x=>[x[0],fmt(x[1])])};
}
function dcDuplicateGroupCard(g){
 const status=dcDuplicateGroupStatus(g),excluded=status==="EXCLUDED";
 const details=g.rows.map(r=>{
  const d=dcDuplicateRowSummary(g,r);
  return `<div style="padding:8px 10px;border-top:1px solid var(--border,#ddd)"><strong>${esc(d.label)}</strong><div class="small-note">${d.values.map(v=>esc(v[0])+": "+esc(v[1])).join(" • ")||"Record details unavailable"}</div></div>`;
 }).join("");
 const title="Record "+(g.recordNumber||1);
 return `<article style="padding:12px;border:1px solid var(--border,#ddd);border-radius:12px;margin:12px 0;opacity:${excluded?".75":"1"}"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><strong>${esc(g.name)} — ${esc(title)}</strong><div class="small-note">${esc(g.date)} • ${g.rows.length} records • ${esc(g.activity||"Stock transactions")}</div></div><button class="dc-toggle-btn ${excluded?"unhide":""}" onclick="dcSetDuplicateGroupEncoded('${encodeURIComponent(JSON.stringify(g))}','${excluded?"KEPT":"EXCLUDED"}')">${excluded?"Restore group":"Exclude group"}</button></div><div class="small-note" style="margin-top:6px">${status==="MIXED"?"Partially excluded — action applies to the whole group":excluded?"Entire group excluded from calculations":"All values included in calculations"}</div><div style="margin-top:8px;border:1px solid var(--border,#ddd);border-radius:8px;overflow:hidden">${details}</div></article>`;
}
function renderDcDuplicateGroups(){
 const groups=dcDuplicateGroups();
 const active=groups.filter(g=>!g.excluded);
 const excluded=groups.filter(g=>g.excluded);
 const empty=`<div class="small-note">No duplicate groups detected for the latest date.</div>`;
 return `<section class="dc-list-section"><div class="dc-section-head"><div><span class="dc-section-icon">🔁</span><div><h3>Duplicate records</h3><small>${active.length} active group(s) • latest date only</small></div></div></div>${active.length?active.map(g=>dcDuplicateGroupCard(g)).join(""):empty}${excluded.length?`<div class="dc-section-head" style="margin-top:18px"><div><span class="dc-section-icon">🚫</span><div><h3>Excluded duplicate groups</h3><small>${excluded.length} excluded group(s) • will not return to active list</small></div></div></div>${excluded.map(g=>dcDuplicateGroupCard(g)).join("")}`:''}</section>`;
}
function dcMaterialActivity(material){
  const rows=dcRawTransactions(material);
  return rows.filter(t=>{
    const ty=tType(t),v=tVal(t);
    return v>0 && !["OPENING STOCK","CL. STOCK"].includes(ty);
  });
}
function dcLatestRawReconciliation(material){
  const rows=dcRawTransactions(material); if(!rows.length)return {status:"NO DATA",message:"No transaction history available."};
  const dates=rows.map(t=>dateOnly(rowDate(t))).filter(Boolean).sort(); const latest=dates[dates.length-1]||"";
  const dayRows=latest?rows.filter(t=>dateOnly(rowDate(t))===latest):rows;
  let opening=null,closing=null,add=0,out=0,cons=0,otherActivity=0;
  dayRows.forEach(t=>{
    const ty=tType(t),v=tVal(t); if(ty==="OPENING STOCK")opening=v; else if(ty==="CL. STOCK")closing=v;
    else if(isConsumptionMovement(ty)){cons+=v;otherActivity+=v}
    else if(ty==="PURCHASE"||ty==="RECEIVED"||ty==="GAIN"||ty.includes("TRANSFER FROM")){add+=v;otherActivity+=v}
    else if(ty.includes("TRANSFER TO")||ty.includes("SALE")||ty.includes("SHORTAGE")||ty==="DAMAGE"||ty==="ISSUE"||ty.includes("RETURN TO")){out+=v;otherActivity+=v}
  });
  if(opening===null&&closing===null)return {status:"NO DATA",date:latest};
  const unexplained=cons>0 && opening<=0 && add<=0;
  const calculated=(opening||0)+add-out-(closing===null?0:closing);
  const diff=calculated-cons;
  const match=closing!==null && Math.abs(diff)<=0.01;
  return {status:match?"MATCH":"MISMATCH",date:latest,opening:opening||0,closing,add,out,cons,otherActivity,calculated,diff,unexplained};
}
function dcReviewItems(){
  const items=[];
  dcAllMaterialNames().forEach(m=>{
    const st=dcMaterialState(m), rec=dcLatestRawReconciliation(m), activity=dcMaterialActivity(m);
    if(st.status==="HIDDEN" && activity.length){
      const hiddenDate=dateOnly(st.updatedAt);
      const fresh=activity.filter(t=>{const d=dateOnly(rowDate(t));return (!hiddenDate||!d||d>=hiddenDate) && (!st.activityAck || !d || d>st.activityAck);});
      if(fresh.length){const latest=fresh.map(t=>dateOnly(rowDate(t))).filter(Boolean).sort().pop()||""; items.push({id:"hidden|"+dcKey(m)+"|"+latest,type:"HIDDEN_ACTIVITY",level:"warning",item:m,reason:"Hidden material has new recorded activity",detail:`Latest activity: ${latest||"--"}`});}
    }
    if(rec.unexplained){
      const sig=dcKey([m,rec.date,rec.cons,rec.opening,rec.add,rec.closing].join("|"));
      const prior=DATA_CONTROL.materials[dcKey(m)];
      if(!(prior&&prior.unexplainedSignature===sig&&prior.unexplainedDecision==="EXCLUDED")) items.push({id:"unexplained|"+sig,type:"UNEXPLAINED_CONSUMPTION",level:"critical",item:m,reason:"Consumption exists without opening/receipt/transfer support",detail:`Consumption ${fmt(rec.cons)} • Opening ${fmt(rec.opening)} • Additions ${fmt(rec.add)}`});
    }
    dcRawTransactions(m).forEach(t=>{
      const rs=dcRecordState(m,t); if(rs&&rs.status==="EXCLUDED"){
        const rec2=dcLatestRawReconciliation(m);
        const ack=rs.reviewAck||""; const sig=rec2.status+"|"+rec2.date; if(rec2.status==="MATCH" && ack!==sig) items.push({id:"excluded-pass|"+dcRecordKey(m,t)+"|"+sig,type:"EXCLUDED_RECONCILIATION",level:"warning",item:m,record:t,reason:"Previously excluded record is now in a reconciled/matching activity state",detail:`Reconciliation ${rec2.date||"latest"} = MATCH`});
      }
    });
  });
  dcAllMaterialNames().forEach(m=>{
    const rows=dcRawTransactions(m), dates=rows.map(t=>dateOnly(rowDate(t))).filter(Boolean).sort(), latest=dates[dates.length-1]||"";
    const seen=new Map();
    rows.forEach((t,idx)=>{
      if(latest && dateOnly(rowDate(t))!==latest)return;
      const key=[dateOnly(rowDate(t)),tType(t),tVal(t),clean(t.for_day),clean(t.for_month),clean(t.for_year)].join("|");
      if(!key||key.replace(/\|/g,"")==="")return;
      const prior=seen.get(key);
      if(prior!==undefined){
        const a=dcRecordState(m,t), b=dcRecordState(m,rows[prior]);
        if(!(a&&a.status==="EXCLUDED") && !(b&&b.status==="EXCLUDED")) items.push({id:"duplicate|"+dcKey(m)+"|"+dcKey(key),type:"DUPLICATE_RECORD",level:"warning",item:m,record:t,index:idx,reason:"Identical transaction signature appears more than once",detail:`${tType(t)||"Movement"} • ${dateOnly(rowDate(t))||"--"} • Qty ${fmt(tVal(t))}`});
      }else seen.set(key,idx);
    });
  });
  dcAllProductNames().forEach(product=>{
    if(!dcIsHiddenProduct(product))return;
    const rows=[...(DATA.production||[]),...(DATA.productionHistory||[]),...(DATA.feedUnitData||[]),...(DATA.bags||[]),...(DATA.bagsHistory||[])].filter(r=>normalize(r.product||r.Product)===normalize(product));
    const hiddenDate=dateOnly(dcProductState(product).updatedAt);
    const stp=dcProductState(product); const fresh=rows.filter(r=>{const d=dateOnly(r.Report_Date||r.report_date||r.date);return (!hiddenDate||!d||d>=hiddenDate) && (!stp.activityAck || !d || d>stp.activityAck);});
    const active=fresh.some(r=>Object.entries(r).some(([k,v])=>!/(product|report_date|date)/i.test(k)&&num(v)!==null&&num(v)!==0));
    if(active)items.push({id:"hidden-product|"+dcKey(product)+"|"+hiddenDate,type:"HIDDEN_PRODUCT_ACTIVITY",level:"warning",item:product,reason:"Hidden product has new recorded activity",detail:`${fresh.length} new source record(s) detected`});
  });
  return items.filter((x,i,a)=>a.findIndex(y=>y.id===x.id)===i);
}
function dcApplyUnexplainedDecisionByMaterial(material,action){
  const item={item:material};
  dcApplyUnexplainedDecision(item,action);
}
function dcApplyUnexplainedDecision(item,action){
  const m=item.item, rec=dcLatestRawReconciliation(m), sig=dcKey([m,rec.date,rec.cons,rec.opening,rec.add,rec.closing].join("|"));
  const rows=dcRawTransactions(m);
  if(rec.date){
    rows.forEach(t=>{
      if(dateOnly(rowDate(t))!==rec.date)return;
      const ty=tType(t);
      if(!isConsumptionMovement(ty))return;
      const k=dcRecordKey(m,t);
      DATA_CONTROL.records[k]={status:action==="EXCLUDED"?"EXCLUDED":"KEPT",reason:action==="EXCLUDED"?"Unexplained consumption — excluded by manager":"Unexplained consumption — reviewed and kept",updatedAt:new Date().toISOString(),reviewAck:action==="EXCLUDED"?"":""};
    });
  }
  const st=dcMaterialState(m); st.unexplainedSignature=sig; st.unexplainedDecision=action; DATA_CONTROL.materials[dcKey(m)]=st; saveDataControl(); invalidatePerfCache(); dcRefreshUI(`${m}: ${action==="EXCLUDED"?"unexplained consumption excluded":"consumption kept"}`);
}
function dcSetRecordByIndex(material,index,status,reason){const rows=dcRawTransactions(material);const t=rows[index];if(t)dcSetRecord(material,t,status,reason);}
function openDataControlPage(){
  const page=document.getElementById("dataControlPage");
  if(!page)return;
  page.classList.add("show");
  page.setAttribute("aria-hidden","false");
  document.body.classList.add("dc-page-open");
  try{renderDataControl();}catch(e){console.warn("Data control page render failed",e)}
}
function closeDataControlPage(){
  const page=document.getElementById("dataControlPage");
  if(!page)return;
  page.classList.remove("show");
  page.setAttribute("aria-hidden","true");
  closeDcReview();
  document.body.classList.remove("dc-page-open");
}

function renderDcReviewOverlay(){
  const overlay=document.getElementById("dcReviewOverlay"), content=document.getElementById("dcReviewContent"), subtitle=document.getElementById("dcReviewSubtitle");
  if(!overlay||!content)return;
  const items=dcReviewItems();
  if(subtitle) subtitle.textContent=items.length?`${items.length} item${items.length===1?"":"s"} need manager review`:"No new review items detected";
  if(!items.length){
    content.innerHTML=`<div class="dc-review-empty"><div class="dc-review-empty-icon">✓</div><h4>Everything is reviewed</h4><p>No new hidden-item activity, unexplained consumption, duplicate or changed reconciliation decision needs attention.</p><button type="button" class="dc-primary-action" onclick="closeDcReview()">Done</button></div>`;
    return;
  }
  content.innerHTML=`<div class="dc-review-list">${items.map((x,i)=>`<article class="dc-review-item ${x.level}">
    <div class="dc-review-top"><span class="dc-badge">${esc(x.type.replace(/_/g," "))}</span><strong>${esc(x.item)}</strong></div>
    <div class="dc-review-reason">${esc(x.reason)}</div>
    <div class="dc-review-detail">${esc(x.detail||"")}</div>
    <div class="dc-actions">${x.type==="HIDDEN_ACTIVITY"?`<button type="button" onclick="dcReviewHiddenMaterial('${jsq(x.item)}',false)">Unhide</button><button type="button" onclick="dcReviewHiddenMaterial('${jsq(x.item)}',true)">Keep Hidden</button>`:x.type==="HIDDEN_PRODUCT_ACTIVITY"?`<button type="button" onclick="dcReviewHiddenProduct('${jsq(x.item)}',false)">Unhide</button><button type="button" onclick="dcReviewHiddenProduct('${jsq(x.item)}',true)">Keep Hidden</button>`:x.type==="UNEXPLAINED_CONSUMPTION"?`<button type="button" onclick="dcApplyUnexplainedDecisionByMaterial('${jsq(x.item)}','EXCLUDED')">Exclude</button><button type="button" onclick="dcApplyUnexplainedDecisionByMaterial('${jsq(x.item)}','KEPT')">Keep</button>`:x.type==="DUPLICATE_RECORD"?`<button type="button" onclick="dcSetRecordByIndex('${jsq(x.item)}',${Number(x.index)||0},'EXCLUDED','Duplicate — excluded by manager')">Exclude Duplicate</button><button type="button" onclick="dcSetRecordByIndex('${jsq(x.item)}',${Number(x.index)||0},'KEPT','Duplicate reviewed — keep')">Keep</button>`:`<button type="button" onclick="dcReviewExcludedRecord('${jsq(x.item)}',${JSON.stringify(x.record||{}).replace(/</g,"\u003c")},false)">Restore</button><button type="button" onclick="dcReviewExcludedRecord('${jsq(x.item)}',${JSON.stringify(x.record||{}).replace(/</g,"\u003c")},true)">Keep Excluded</button>`}</div>
  </article>`).join("")}</div>`;
}
function dcReviewModal(){
  const overlay=document.getElementById("dcReviewOverlay");
  if(!overlay)return;
  overlay.classList.add("show"); overlay.setAttribute("aria-hidden","false");
  renderDcReviewOverlay();
}

function dcReportOverlayOutside(e){if(e.target&&e.target.id==="dcReportOverlay")closeDcReport()}
function closeDcReport(){const o=document.getElementById("dcReportOverlay");if(!o)return;o.classList.remove("show");o.setAttribute("aria-hidden","true")}
let DC_REPORT_STATE=null;
function dcItemReport(kind,name){
  DC_REPORT_STATE={kind,name};
  renderDcReport();
  const o=document.getElementById("dcReportOverlay"); if(!o)return;
  o.classList.add("show");o.setAttribute("aria-hidden","false");
}
function renderDcReportIfOpen(){const o=document.getElementById("dcReportOverlay");if(o&&o.classList.contains("show"))renderDcReport()}
function dcReportRow(label,value,cls=""){return `<div class="dc-report-kv ${cls}"><span>${esc(label)}</span><strong>${esc(value==null||value===""?"--":String(value))}</strong></div>`}
function dcReportStatusBadge(status){const s=String(status||"ACTIVE");const c=s==="HIDDEN"?"hidden":s==="EXCLUDED"?"excluded":s==="MISMATCH"?"danger":s==="MATCH"?"match":"active";return `<span class="dc-report-status ${c}">${esc(s)}</span>`}
function dcReportRecordsTable(name,raw){
  if(!raw.length)return `<div class="dc-report-empty">No source records found.</div>`;
  return `<div class="dc-report-table-wrap"><table class="dc-report-table"><thead><tr><th>Date</th><th>Activity</th><th>Qty</th><th>Status</th><th></th></tr></thead><tbody>${raw.map((t,i)=>{const ex=dcIsExcluded(name,t);return `<tr class="${ex?'is-excluded':''}"><td>${esc(dateOnly(rowDate(t))||"--")}</td><td>${esc(tType(t)||"Movement")}</td><td>${esc(fmt(tVal(t)))}</td><td>${ex?'<span class="mini-status excluded">EXCLUDED</span>':'<span class="mini-status approved">APPROVED</span>'}</td><td><button class="dc-mini-btn" onclick="dcSetRecordByIndex('${jsq(name)}',${i},'${ex?'KEPT':'EXCLUDED'}','Manager report action')">${ex?'Restore':'Exclude'}</button></td></tr>`}).join("")}</tbody></table></div>`
}
function renderDcReport(){
  const body=document.getElementById("dcReportContent"),title=document.getElementById("dcReportTitle"),sub=document.getElementById("dcReportSubtitle");
  if(!body||!DC_REPORT_STATE)return;
  const {kind,name}=DC_REPORT_STATE, isMat=kind==="material", st=isMat?dcMaterialState(name):dcProductState(name);
  if(title)title.textContent=name;
  if(sub)sub.textContent=isMat?"Material control, reconciliation and transaction history":"Product control and activity history";
  if(isMat){
    const raw=dcRawTransactions(name),approved=dcApprovedTransactions(name),rec=dcLatestRawReconciliation(name);
    const totalCons=approved.filter(t=>isConsumptionMovement(tType(t))).reduce((a,t)=>a+tVal(t),0);
    body.innerHTML=`<div class="dc-report-summary"><div class="dc-report-summary-main"><div class="dc-report-eyebrow">CONTROL STATUS</div><div>${dcReportStatusBadge(st.status)}</div><p>${esc(st.reason||"No manager decision recorded.")}</p></div><div class="dc-report-summary-actions"><button class="dc-report-action primary" onclick="dcAction('material','${jsq(name)}')">${st.status==='HIDDEN'?'Unhide Material':'Hide Material'}</button><button class="dc-report-action" onclick="closeDcReport();dcReviewModal()">🔔 Review</button></div></div>
      <div class="dc-report-grid"><section class="dc-report-section"><div class="dc-report-section-head"><span>🔎</span><div><h4>Latest Reconciliation</h4><small>${esc(rec.date||"No date")}</small></div></div><div class="dc-report-kv-grid">${dcReportRow("Result",rec.status)}${dcReportRow("Opening",fmt(rec.opening))}${dcReportRow("Additions",fmt(rec.add))}${dcReportRow("Other Out",fmt(rec.out))}${dcReportRow("Consumption",fmt(rec.cons))}${dcReportRow("Closing",fmt(rec.closing))}${dcReportRow("Difference",fmt(rec.diff))}${dcReportRow("Unexplained",rec.unexplained?"YES":"NO",rec.unexplained?"danger":"")}</div></section><section class="dc-report-section"><div class="dc-report-section-head"><span>📊</span><div><h4>Data Summary</h4><small>Current control state</small></div></div><div class="dc-report-kv-grid">${dcReportRow("Raw records",raw.length)}${dcReportRow("Approved records",approved.length)}${dcReportRow("Excluded records",raw.length-approved.length)}${dcReportRow("Approved consumption",fmt(totalCons))}${dcReportRow("Last decision",st.updatedAt?new Date(st.updatedAt).toLocaleString("en-IN"):"--")}</div></section></div>
      <section class="dc-report-section"><div class="dc-report-section-head"><span>📋</span><div><h4>Source Records</h4><small>Every record and its current decision</small></div></div>${dcReportRecordsTable(name,raw)}</section>`;
  }else{
    const rows=[...(DATA.production||[]),...(DATA.productionHistory||[]),...(DATA.feedUnitData||[]),...(DATA.bags||[]),...(DATA.bagsHistory||[])].filter(r=>normalize(r.product||r.Product)===normalize(name));
    const activeRows=rows.filter(r=>Object.entries(r).some(([k,v])=>!/(product|report_date|date)/i.test(k)&&num(v)!==null&&num(v)!==0));
    body.innerHTML=`<div class="dc-report-summary"><div class="dc-report-summary-main"><div class="dc-report-eyebrow">CONTROL STATUS</div><div>${dcReportStatusBadge(st.status)}</div><p>${esc(st.reason||"No manager decision recorded.")}</p></div><div class="dc-report-summary-actions"><button class="dc-report-action primary" onclick="dcAction('product','${jsq(name)}')">${st.status==='HIDDEN'?'Unhide Product':'Hide Product'}</button><button class="dc-report-action" onclick="closeDcReport();dcReviewModal()">🔔 Review</button></div></div><div class="dc-report-grid"><section class="dc-report-section"><div class="dc-report-section-head"><span>📊</span><div><h4>Activity Summary</h4><small>Detected product records</small></div></div><div class="dc-report-kv-grid">${dcReportRow("Total source records",rows.length)}${dcReportRow("Records with activity",activeRows.length)}${dcReportRow("Last decision",st.updatedAt?new Date(st.updatedAt).toLocaleString("en-IN"):"--")}${dcReportRow("Activity acknowledgement",st.activityAck||"--")}</div></section></div><section class="dc-report-section"><div class="dc-report-section-head"><span>📋</span><div><h4>Product Activity</h4><small>Latest source rows</small></div></div><div class="dc-report-table-wrap"><table class="dc-report-table"><thead><tr><th>Date</th><th>Product</th><th>Output</th><th>Dispatch</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(dateOnly(r.Report_Date||r.report_date||r.date)||"--")}</td><td>${esc(r.Product||r.product||name)}</td><td>${esc(fmt(feedField(r,"Production_Day_MT")))}</td><td>${esc(fmt(feedField(r,"Dispatch_Day_MT")))}</td></tr>`).join("")||`<tr><td colspan="4">No records found.</td></tr>`}</tbody></table></div></section>`;
  }
}

function dcAction(kind,name){
  const hidden=(kind==="material"?dcMaterialState(name):dcProductState(name)).status==="HIDDEN";
  const action=hidden?"ACTIVE":"HIDDEN";
  if(kind==="material")dcSetMaterial(name,action,hidden?"Restored to active":"Manually hidden by manager"); else dcSetProduct(name,action,hidden?"Restored to active":"Manually hidden by manager");
}
let DC_LIST_FILTER="ALL";
function dcSetListFilter(filter){
  DC_LIST_FILTER=filter||"ALL";
  renderDataControl();
}
function renderDataControl(){
  const el=document.getElementById("dataControlContent"); if(!el)return;
  const ms=dcAllMaterialNames(), ps=dcAllProductNames(), review=dcReviewItems();
  const hiddenM=ms.filter(m=>dcIsHiddenMaterial(m)).length, hiddenP=ps.filter(p=>dcIsHiddenProduct(p)).length;
  const activeM=ms.length-hiddenM, activeP=ps.length-hiddenP;
  const filter=DC_LIST_FILTER;
  el.innerHTML=`
    <div class="dc-overview-head">
      <div><h3>Control overview</h3><p>Manage what appears in the dashboard without deleting source data.</p></div>
      <button class="dc-refresh-btn" onclick="renderDataControl()">↻ Refresh</button>
    </div>
    <div class="dc-stats dc-stats-v2">
      <button class="dc-stat-card ${filter==='REVIEW'?'selected':''}" onclick="dcReviewModal()"><span class="dc-stat-icon review">🔔</span><b>${review.length}</b><span>Review Required</span></button>
      <button class="dc-stat-card ${filter==='ACTIVE_MATERIALS'?'selected':''}" onclick="dcSetListFilter('ACTIVE_MATERIALS')"><span class="dc-stat-icon active">●</span><b>${activeM}</b><span>Active Materials</span></button>
      <button class="dc-stat-card ${filter==='HIDDEN_MATERIALS'?'selected':''}" onclick="dcSetListFilter('HIDDEN_MATERIALS')"><span class="dc-stat-icon hidden">◉</span><b>${hiddenM}</b><span>Hidden Materials</span></button>
      <button class="dc-stat-card ${filter==='ACTIVE_PRODUCTS'?'selected':''}" onclick="dcSetListFilter('ACTIVE_PRODUCTS')"><span class="dc-stat-icon active">●</span><b>${activeP}</b><span>Active Products</span></button>
      <button class="dc-stat-card ${filter==='HIDDEN_PRODUCTS'?'selected':''}" onclick="dcSetListFilter('HIDDEN_PRODUCTS')"><span class="dc-stat-icon hidden">◉</span><b>${hiddenP}</b><span>Hidden Products</span></button>
    </div>
    <div class="dc-toolbar dc-toolbar-v2">
      <div class="dc-search-wrap"><span>⌕</span><input id="dcSearch" placeholder="Search material or product" oninput="renderDataControlLists()"></div>
      <button class="dc-review-btn" onclick="dcReviewModal()">🔔 Review <span>${review.length}</span></button>
      <button class="dc-clear-btn" onclick="dcSetListFilter('ALL')">Show All</button>
    </div>
    <div class="dc-filter-line"><span>Showing:</span><strong id="dcFilterLabel">All materials & products</strong><span class="dc-filter-count" id="dcFilterCount"></span></div>
    <div id="dcLists"></div>`;
  renderDataControlLists();
}
function renderDataControlLists(){
  const el=document.getElementById("dcLists"); if(!el)return;
  const q=normalize(document.getElementById("dcSearch")?.value||"");
  let ms=dcAllMaterialNames().filter(m=>!q||normalize(m).includes(q));
  let ps=dcAllProductNames().filter(p=>!q||normalize(p).includes(q));
  const filter=DC_LIST_FILTER;
  if(filter==='ACTIVE_MATERIALS') ms=ms.filter(m=>!dcIsHiddenMaterial(m)), ps=[];
  else if(filter==='HIDDEN_MATERIALS') ms=ms.filter(m=>dcIsHiddenMaterial(m)), ps=[];
  else if(filter==='ACTIVE_PRODUCTS') ms=[], ps=ps.filter(p=>!dcIsHiddenProduct(p));
  else if(filter==='HIDDEN_PRODUCTS') ms=[], ps=ps.filter(p=>dcIsHiddenProduct(p));
  const materialHtml=ms.slice(0,120).map(m=>{const s=dcMaterialState(m),hidden=s.status==='HIDDEN';return `<div class="dc-item dc-item-v2"><div class="dc-item-main"><span class="dc-status-dot ${hidden?'hidden':'active'}"></span><div><strong title="${esc(m)}">${esc(m)}</strong><small>${hidden?'HIDDEN':'ACTIVE'}${s.reason?' • '+esc(s.reason):''}</small></div></div><div class="dc-item-actions"><button class="dc-report-btn" onclick="dcItemReport('material','${jsq(m)}')">Report</button><button class="dc-toggle-btn ${hidden?'unhide':''}" onclick="dcAction('material','${jsq(m)}')">${hidden?'Unhide':'Hide'}</button></div></div>`}).join("");
  const productHtml=ps.slice(0,120).map(p=>{const s=dcProductState(p),hidden=s.status==='HIDDEN';return `<div class="dc-item dc-item-v2"><div class="dc-item-main"><span class="dc-status-dot ${hidden?'hidden':'active'}"></span><div><strong title="${esc(p)}">${esc(p)}</strong><small>${hidden?'HIDDEN':'ACTIVE'}${s.reason?' • '+esc(s.reason):''}</small></div></div><div class="dc-item-actions"><button class="dc-report-btn" onclick="dcItemReport('product','${jsq(p)}')">Report</button><button class="dc-toggle-btn ${hidden?'unhide':''}" onclick="dcAction('product','${jsq(p)}')">${hidden?'Unhide':'Hide'}</button></div></div>`}).join("");
  const total=ms.length+ps.length;
  const labels={ALL:'All materials & products',ACTIVE_MATERIALS:'Active materials',HIDDEN_MATERIALS:'Hidden materials',ACTIVE_PRODUCTS:'Active products',HIDDEN_PRODUCTS:'Hidden products'};
  const label=document.getElementById('dcFilterLabel'), count=document.getElementById('dcFilterCount');
  if(label)label.textContent=labels[filter]||labels.ALL;
  if(count)count.textContent=`${total} item${total===1?'':'s'}`;
  const materialSection=ms.length?`<section class="dc-list-section"><div class="dc-section-head"><div><span class="dc-section-icon">📦</span><div><h3>Materials</h3><small>${ms.length} shown</small></div></div></div>${materialHtml}</section>`:(filter.includes('MATERIALS')?`<section class="dc-list-section"><div class="dc-empty-list">No materials match this filter.</div></section>`:'');
  const productSection=ps.length?`<section class="dc-list-section"><div class="dc-section-head"><div><span class="dc-section-icon">🌾</span><div><h3>Products</h3><small>${ps.length} shown</small></div></div></div>${productHtml}</section>`:(filter.includes('PRODUCTS')?`<section class="dc-list-section"><div class="dc-empty-list">No products match this filter.</div></section>`:'');
  el.innerHTML=`<div class="dc-list-grid">${materialSection}${productSection}</div>${renderDcDuplicateGroups()}`;
}

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
  const selectedDay=effectiveViewDate();
  const cacheKey=[normalize(material),tab,selectedDay||"ALL"].join("|");
  if(PERF_CACHE.rawTotals.has(cacheKey))return PERF_CACHE.rawTotals.get(cacheKey);
  const total=transactions(material).reduce((sum,t)=>{
    if(selectedDay && dateOnly(rowDate(t))!==selectedDay)return sum;
    const ty=tType(t);
    let matches=false;
    if(tab==="CONSUMPTION")matches=isConsumptionMovement(ty);
    else if(tab==="PURCHASE")matches=ty==="PURCHASE" || ty==="RECEIVED";
    else if(tab==="TRANSFER")matches=ty==="TRANSFER" || ty.includes("TRANSFER FROM") || ty.includes("TRANSFER TO");
    else if(tab==="GAIN")matches=ty==="GAIN";
    else if(tab==="SHORTAGE")matches=ty.includes("SHORTAGE");
    else if(tab==="SALE")matches=ty.includes("SALE");
    else matches=ty===tab;
    return matches?sum+tVal(t):sum;
  },0);
  PERF_CACHE.rawTotals.set(cacheKey,total);
  return total;
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
const DASHBOARD_CACHE_DB="feed_manager_dashboard_cache";
const DASHBOARD_CACHE_STORE="snapshots";
const DASHBOARD_CACHE_FULL_SYNC_MS=24*60*60*1000;
const DASHBOARD_CACHE_RECENT_DAYS=7;
function dashboardCacheRequest(mode,operation,value){
  return new Promise((resolve,reject)=>{
    if(!("indexedDB" in window)){reject(new Error("IndexedDB unavailable"));return;}
    const request=indexedDB.open(DASHBOARD_CACHE_DB,1);
    request.onerror=()=>reject(request.error||new Error("Unable to open dashboard cache"));
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(DASHBOARD_CACHE_STORE))db.createObjectStore(DASHBOARD_CACHE_STORE,{keyPath:"key"});
    };
    request.onsuccess=()=>{
      const db=request.result;
      let tx;
      try{
        tx=db.transaction(DASHBOARD_CACHE_STORE,mode);
        const store=tx.objectStore(DASHBOARD_CACHE_STORE);
        const req=operation==="get"?store.get("latest"):store.put(value);
        req.onsuccess=()=>resolve(req.result||null);
        req.onerror=()=>reject(req.error||new Error("Dashboard cache request failed"));
        tx.oncomplete=()=>db.close();
        tx.onerror=()=>{db.close();reject(tx.error||new Error("Dashboard cache transaction failed"));};
        tx.onabort=()=>{db.close();reject(tx.error||new Error("Dashboard cache transaction aborted"));};
      }catch(error){db.close();reject(error);}
    };
  });
}
async function saveCache(payload,rawTables=null,fullSyncAt=null){
  try{
    await dashboardCacheRequest("readwrite","put",{key:"latest",savedAt:Date.now(),fullSyncAt:fullSyncAt||Date.now(),payload,rawTables});
  }catch(error){console.warn("Dashboard cache save skipped",error);}
}
async function cachedData(){
  try{return await dashboardCacheRequest("readonly","get");}
  catch(error){console.warn("Dashboard cache read skipped",error);return null;}
}
function applyData(apiData,fromCache=false){
  DC_RAW_DATA={
    stock:Array.isArray(apiData.stock)?apiData.stock:[],stockHistory:Array.isArray(apiData.stock_history)?apiData.stock_history:[],
    production:Array.isArray(apiData.production)?apiData.production:[],productionHistory:Array.isArray(apiData.production_history)?apiData.production_history:[],
    bags:Array.isArray(apiData.pp_bags)?apiData.pp_bags:[],bagsHistory:Array.isArray(apiData.pp_bags_history)?apiData.pp_bags_history:[],
    feedUnitData:Array.isArray(apiData.feedUnitData)?apiData.feedUnitData:[],feedUnitTotals:Array.isArray(apiData.feedUnitTotals)?apiData.feedUnitTotals:[],
    productionTrend:Array.isArray(apiData.productionTrend)?apiData.productionTrend:[]
  };
  const filterStock=rows=>(Array.isArray(rows)?rows:[]).filter(r=>!dcIsExcluded(clean(r.material),{...r,_dcSource:"stock_data"}));
  const filterProducts=(rows,source,field="product")=>(Array.isArray(rows)?rows:[]).filter(r=>!dcIsExcluded(clean(r[field]||r.Product||r.product),{...r,_dcSource:source}));
  DATA={
    stock:DC_RAW_DATA.stock.map(item=>({...item,transactions:(item.transactions||[]).filter(t=>!dcIsExcluded(item.material,{...t,_dcSource:"stock_data"}))})),
    stockHistory:filterStock(DC_RAW_DATA.stockHistory),
    production:filterProducts(DC_RAW_DATA.production,"production_data"),productionHistory:filterProducts(DC_RAW_DATA.productionHistory,"production_data"),
    bags:filterProducts(DC_RAW_DATA.bags,"pp_bags_data"),bagsHistory:filterProducts(DC_RAW_DATA.bagsHistory,"pp_bags_data"),
    feedUnitData:filterProducts(DC_RAW_DATA.feedUnitData,"feed_unit_data","Product"),feedUnitTotals:filterProducts(DC_RAW_DATA.feedUnitTotals,"feed_unit_totals","Product"),
    productionTrend:(DC_RAW_DATA.productionHistory.length?DC_RAW_DATA.productionHistory:DC_RAW_DATA.production).filter(r=>!dcIsExcluded(clean(r.product||r.Product),{...r,_dcSource:"production_data"})).slice().sort((a,b)=>String(a.report_date||"").localeCompare(String(b.report_date||""))).map(r=>({report_date:r.report_date||r.Report_Date||r.date,actual_output:r.actual_output})),usage:apiData.usage&&typeof apiData.usage==="object"?apiData.usage:{},
    reorder_items:Array.isArray(apiData.reorder_items)?apiData.reorder_items:[],consumption:apiData.consumption??null,
    efficiency:apiData.efficiency??null,processLoss:apiData.processLoss??null,report_date:apiData.report_date??null
  };
  invalidatePerfCache();
  if(DATA.report_date)setText("reportDate",VIEW_DATE||DATA.report_date);
  renderDashboard();
  try{renderDataControl();}catch(e){console.warn("Data control render skipped",e)}
}
async function restoreCache(){
  const cached=await cachedData();
  if(!cached||!cached.payload||!cached.savedAt)return false;
  await dcLoadSupabase();
  applyData(cached.payload,true);
  const savedAt=new Date(cached.savedAt);
  setConnection(false,"Saved data • refreshing");
  setText("lastUpdated","Cached "+savedAt.toLocaleString("en-IN",{dateStyle:"short",timeStyle:"short"}));
  return true;
}
function setConnection(ok,text){
  const dot=document.getElementById("statusDot");
  if(dot)dot.classList.toggle("off",!ok);
  setText("connectionStatus",text);
}

/* =====================================================
   SUPABASE LOAD — SAME WORKING DASHBOARD DATA SHAPE
   Only the source/API layer is replaced. All existing UI,
   calculations, filters and render logic remain unchanged.
===================================================== */
function sbClean(v){
  const s=String(v??"").trim();
  return s.replace(/^=+/,"").trim();
}
function sbNormalizeRow(r,kind){
  const x={...(r||{})},sources={stock:"stock_data",production:"production_data",bags:"pp_bags_data",feed:"feed_unit_data",totals:"feed_unit_totals"};
  x._dcSource=sources[kind]||kind;
  if(kind==="stock"){x.material=sbClean(x.material);x.transaction=sbClean(x.transaction)}
  if(kind==="production"||kind==="bags")x.product=sbClean(x.product);
  if(kind==="feed")x.product=sbClean(x.product);
  if(kind==="totals")x.type=sbClean(x.type);
  return x;
}
async function supabaseRows(table,attempt=0,fromDate=null){
  const rows=[];
  const pageSize=1000;
  for(let offset=0;;offset+=pageSize){
    const qs=new URLSearchParams({select:"*",order:fromDate?"report_date.asc,id.asc":"id.asc",limit:String(pageSize),offset:String(offset),apikey:SUPABASE_KEY});
    if(fromDate)qs.set("report_date","gte."+fromDate);
    const res=await fetch(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${qs.toString()}`,{method:"GET",cache:"no-store",credentials:"omit"});
    if(!res.ok){
      const body=await res.text().catch(()=>"");
      throw new Error(`Supabase ${table}: HTTP ${res.status}${body?" • "+body.slice(0,180):""}`);
    }
    const batch=await res.json();
    if(!Array.isArray(batch))throw new Error(`Supabase ${table}: invalid response`);
    rows.push(...batch);
    if(batch.length<pageSize)break;
  }
  return rows;
}
function sbDateOffset(days){
  const d=new Date();
  d.setDate(d.getDate()-days);
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-");
}
function sbMergeRecentRows(previous,fresh,cutoff){
  const retained=(Array.isArray(previous)?previous:[]).filter(r=>{
    const d=dateOnly(r.report_date||r.Report_Date||r.date);
    return !d||d<cutoff;
  });
  return retained.concat(Array.isArray(fresh)?fresh:[]);
}
function sbLatestDate(rows){
  return rows.map(r=>dateOnly(r.report_date||r.Report_Date||r.date)).filter(Boolean).sort().pop()||"";
}
function sbLatestByDate(rows,date){return rows.filter(r=>dateOnly(r.report_date||r.Report_Date||r.date)===date)}
function sbBuildStock(rows){
  const all=rows.map(r=>sbNormalizeRow(r,"stock"));
  const latest=sbLatestDate(all);
  const grouped=new Map();
  all.filter(r=>dateOnly(r.report_date)===latest).forEach(r=>{
    const k=normalize(r.material);
    if(!k)return;
    if(!grouped.has(k))grouped.set(k,{material:r.material,transactions:[]});
  });
  // Keep the complete dated transaction history inside the same material objects,
  // matching the structure expected by the existing working site.
  all.forEach(r=>{
    const k=normalize(r.material); if(!k)return;
    if(!grouped.has(k))grouped.set(k,{material:r.material,transactions:[]});
    grouped.get(k).transactions.push(r);
  });
  return {current:[...grouped.values()],history:all};
}
function sbBuildLatestProducts(rows,kind){
  const all=rows.map(r=>sbNormalizeRow(r,kind));
  const latest=sbLatestDate(all);
  return {current:sbLatestByDate(all,latest),history:all};
}
async function loadDashboard(attempt=0,forceFull=false){
  try{
    const cached=await cachedData();
    const lastFullSyncAt=cached&&(cached.fullSyncAt||cached.savedAt)?(cached.fullSyncAt||cached.savedAt):0;
    const fullSyncAge=lastFullSyncAt?Date.now()-lastFullSyncAt:Infinity;
    const hasRawHistory=!!(cached&&cached.rawTables&&Array.isArray(cached.rawTables.stock)&&Array.isArray(cached.rawTables.production)&&Array.isArray(cached.rawTables.bags)&&Array.isArray(cached.rawTables.feed)&&Array.isArray(cached.rawTables.totals));
    const canIncrement=!forceFull&&cached&&cached.payload&&hasRawHistory&&fullSyncAge<DASHBOARD_CACHE_FULL_SYNC_MS;
    const cutoff=sbDateOffset(DASHBOARD_CACHE_RECENT_DAYS);
    const fromDate=canIncrement?cutoff:null;
    await dcLoadSupabase();
    const [stockFresh,productionFresh,bagsFresh,feedFresh,totalsFresh]=await Promise.all([
      supabaseRows("stock_data",attempt,fromDate),
      supabaseRows("production_data",attempt,fromDate),
      supabaseRows("pp_bags_data",attempt,fromDate),
      supabaseRows("feed_unit_data",attempt,fromDate),
      supabaseRows("feed_unit_totals",attempt,fromDate)
    ]);
    const prior=cached&&cached.rawTables?cached.rawTables:{};
    const rawTables=canIncrement?{
      stock:sbMergeRecentRows(prior.stock,stockFresh,cutoff),
      production:sbMergeRecentRows(prior.production,productionFresh,cutoff),
      bags:sbMergeRecentRows(prior.bags,bagsFresh,cutoff),
      feed:sbMergeRecentRows(prior.feed,feedFresh,cutoff),
      totals:sbMergeRecentRows(prior.totals,totalsFresh,cutoff)
    }:{stock:stockFresh,production:productionFresh,bags:bagsFresh,feed:feedFresh,totals:totalsFresh};
    const stockRaw=rawTables.stock;
    const productionRaw=rawTables.production;
    const bagsRaw=rawTables.bags;
    const feedRaw=rawTables.feed;
    const totalsRaw=rawTables.totals;

    const stock=sbBuildStock(stockRaw);
    const production=sbBuildLatestProducts(productionRaw,"production");
    const bags=sbBuildLatestProducts(bagsRaw,"bags");
    const feedUnitData=feedRaw.map(r=>sbNormalizeRow(r,"feed"));
    const feedUnitTotals=totalsRaw.map(r=>sbNormalizeRow(r,"totals"));
    const report_date=[sbLatestDate(stockRaw),sbLatestDate(productionRaw),sbLatestDate(bagsRaw),sbLatestDate(feedRaw),sbLatestDate(totalsRaw)].filter(Boolean).sort().pop()||null;

    const apiData={
      status:"success",
      report_date,
      stock:stock.current,
      stock_history:stock.history,
      production:production.current,
      production_history:production.history,
      pp_bags:bags.current,
      pp_bags_history:bags.history,
      feedUnitData,
      feedUnitTotals,
      productionTrend:production.history.slice().sort((a,b)=>String(a.report_date).localeCompare(String(b.report_date))).map(r=>({report_date:r.report_date,actual_output:r.actual_output})),
      usage:{},
      reorder_items:[],
      consumption:null,
      efficiency:null,
      processLoss:null
    };

    applyData(apiData,false);
    const nextFullSyncAt=canIncrement?lastFullSyncAt:Date.now();
    await saveCache(apiData,rawTables,nextFullSyncAt);
    return apiData;
  }catch(error){
    if(attempt<1){await new Promise(r=>setTimeout(r,800));return loadDashboard(attempt+1,forceFull)}
    const e=new Error(error&&error.message?error.message:"Supabase API load failed");
    e.code="API_NETWORK";
    throw e;
  }
}

let refreshing=false;
async function refreshData(forceFull=false){
  if(refreshing)return;
  refreshing=true;
  setConnection(true,forceFull?"Full refresh...":"Connecting...");
  try{
    await loadDashboard(0,forceFull);
    setConnection(true,"Live");
    const tm=Date.now();setText("lastUpdated","Updated "+new Date(tm).toLocaleString("en-IN",{dateStyle:"short",timeStyle:"short"}));
  }catch(e){
    console.error(e);
    const has=!!(DATA.stock?.length||DATA.stockHistory?.length||DATA.production?.length||DATA.productionHistory?.length||DATA.bags?.length||DATA.feedUnitData?.length||DATA.feedUnitTotals?.length);
    let msg="Unable to refresh";
    if(e&&e.code==="DASHBOARD_PROCESSING")msg="Data received • dashboard processing error";
    else if(e&&e.code==="API_TIMEOUT")msg="API timeout • showing saved data";
    else if(e&&e.code==="API_NETWORK")msg="API connection issue • showing saved data";
    else if(e&&e.code==="API_RESPONSE")msg="API response error • showing saved data";
    setConnection(false,has?"Offline • showing saved data":msg);
    if(!has){
      const list=document.getElementById("stockList");
      if(list)list.innerHTML="<div class='error-box'>❌ Unable to load dashboard data.</div>";
    }
  }finally{refreshing=false}
}

function manualRefresh(){refreshData(true)}

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
    else if(isConsumptionMovement(ty)) recorded+=v;
    // Keep existing transaction names and classify only clear inbound/outbound movements.
    else if(ty==="PURCHASE"||ty==="RECEIVED"||ty==="GAIN"||ty.includes("TRANSFER FROM")) add+=v;
    else if(ty.includes("TRANSFER TO")||ty.includes("SALE")||ty.includes("SHORTAGE")||ty==="DAMAGE"||ty==="ISSUE"||ty.includes("RETURN TO")) otherOut+=v;
  });
  if(opening===null||closing===null)return {status:"NO DATA",message:"Opening/closing pair is not available for the latest transaction date.",date:latest};
  const calculated=opening+add-otherOut-closing;
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
    const rows=transactions(m).filter(t=>isConsumptionMovement(tType(t)));
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
function isConsumptionMovement(ty){return dqIsConsumption(ty)}
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
  // Reuse the computed month until data or Data Control changes.
  if(PERF_CACHE.monthlyRM.has(m))return PERF_CACHE.monthlyRM.get(m);
  // Use the same approved/active dataset as the main RM calculations.
  // Hidden materials and explicitly excluded records must never appear in
  // Monthly Mix & Contribution. Keep the latest dated MTD row per material.
  const latest=new Map();
  allMixMaterialTransactions().forEach(({material,t})=>{
    if(dcIsHiddenMaterial(material) || dcIsExcluded(material,t))return;
    const d=rowDate(t);
    if(monthKey(d)!==m || !isConsumptionMovement(tType(t)))return;
    const day=dateOnly(d)||"";
    const key=normalize(material);
    const prior=latest.get(key);
    if(!prior || day>=prior.day)latest.set(key,{material,t,day});
  });

  const result=[...latest.values()].map(({material,t})=>{
    const monthly=num(t.for_month??t.For_Month??t.monthly_consumption??t.Monthly_Consumption);
    const value=monthly!==null
      ? materialValueInMT(Math.abs(monthly),material)
      : materialValueInMT(tVal(t),material);
    return {name:material,value};
  }).filter(x=>x.value>0).sort((a,b)=>b.value-a.value);
  PERF_CACHE.monthlyRM.set(m,result);
  return result;
}
function monthlyFeedMix(m,key){
  const cacheKey=[m,key].join("|");
  if(PERF_CACHE.monthlyFeed.has(cacheKey))return PERF_CACHE.monthlyFeed.get(cacheKey);
  const rows=uniqueDatedProductRows((DATA.feedUnitData||[]).filter(r=>monthKey(r.report_date||r.Report_Date)===m),r=>r.Product||r.product,r=>r.report_date||r.Report_Date);
  const latest=new Map(), byProduct=new Map();
  rows.forEach((r,i)=>{
    const p=clean(r.Product||r.product); if(!p)return;
    const k=normalize(p);
    const d=dateOnly(r.report_date||r.Report_Date)||"";
    const current=latest.get(k);
    if(!current || d>=current.__mixDate)latest.set(k,{...r,__mixDate:d,__mixIndex:i});
    if(!byProduct.has(k))byProduct.set(k,[]);
    byProduct.get(k).push(r);
  });
  const result=[];
  latest.forEach(r=>{
    const p=r.Product||r.product||"";
    let value=feedField(r,key);
    if(value===null){
      value=(byProduct.get(normalize(p))||[]).reduce((a,x)=>a+(key.includes("Production")?(num(x.Production_Day_MT??x.production_day_mt??x.Production??x.production)||0):(num(x.Dispatch_Day_MT??x.dispatch_day_mt??x.Dispatch??x.dispatch)||0)),0);
    }
    value=feedValueInMT(value,p);
    if(value>0)result.push({name:p,value});
  });
  result.sort((a,b)=>b.value-a.value);
  PERF_CACHE.monthlyFeed.set(cacheKey,result);
  return result;
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
  const selected=effectiveViewDate();
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
    if(kind==="consumption")return isConsumptionMovement(type);
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
  refreshRMHistoryTable();
}
function refreshRMHistoryTable(){
  const m=document.getElementById("rmHistoryMaterial")?.value||"",from=document.getElementById("rmHistoryFrom")?.value||"",to=document.getElementById("rmHistoryTo")?.value||"",el=document.getElementById("rmHistoryTable");
  if(!el)return;
  if(from&&to&&from>to){el.innerHTML='<div class="history-empty">From Date must be before To Date.</div>';return}
  const unit=materialUnit(m,getMaterial(m)?.unit||"MT");
  const rows=rmHistoryTransactions(m).filter(t=>inHistoryRange(dateOnly(rowDate(t)),from,to));
  const byDate=new Map();
  rows.forEach(t=>{const d=dateOnly(rowDate(t));if(!d)return;if(!byDate.has(d))byDate.set(d,[]);byDate.get(d).push(t)});
  const dates=[...byDate.keys()].sort();
  if(!dates.length){el.innerHTML='<div class="history-empty">No history available for selected date range.</div>';return}
  el.innerHTML=`<div class="history-range-note">${esc(from)} → ${esc(to)} • ${dates.length} days</div><div class="history-table"><table><thead><tr><th>Date</th><th>Received</th><th>Consumption</th><th>Transfer</th><th>Closing</th></tr></thead><tbody>${dates.map(d=>{const day=byDate.get(d);const received=rmHistoryValue(day,"received"),consumption=rmHistoryValue(day,"consumption"),transfer=rmHistoryValue(day,"transfer"),closing=rmHistoryClosing(day);return `<tr><td>${esc(d)}</td><td>${fmt(received)} ${esc(unit)}</td><td>${fmt(consumption)} ${esc(unit)}</td><td>${fmt(transfer)} ${esc(unit)}</td><td>${closing===null?"--":fmt(closing)+" "+esc(unit)}</td></tr>`}).join("")}</tbody></table></div>`;
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
  refreshFeedHistoryTable();
}
function refreshFeedHistoryTable(){
  const p=document.getElementById("feedHistoryProduct")?.value||"",from=document.getElementById("feedHistoryFrom")?.value||"",to=document.getElementById("feedHistoryTo")?.value||"",el=document.getElementById("feedHistoryTable");if(!el)return;
  if(from&&to&&from>to){el.innerHTML='<div class="history-empty">From Date must be before To Date.</div>';return}
  const rows=feedHistoryRows(p),byDate=new Map();
  rows.forEach(r=>{const d=dateOnly(r.Report_Date||r.report_date||r.date);if(!inHistoryRange(d,from,to))return;if(!byDate.has(d))byDate.set(d,[]);byDate.get(d).push(r)});
  const dates=[...byDate.keys()].sort();
  if(!dates.length){el.innerHTML='<div class="history-empty">No history available for selected date range.</div>';return}
  el.innerHTML=`<div class="history-range-note">${esc(from)} → ${esc(to)} • ${dates.length} days</div><div class="history-table"><table><thead><tr><th>Date</th><th>Production</th><th>Dispatch</th><th>Closing</th></tr></thead><tbody>${dates.map(d=>{const rr=byDate.get(d),r=rr[rr.length-1];const prod=feedHistoryValue(r,["Production_Day_MT","production_day_mt","Production_Day","production_day","Production","production"]),disp=feedHistoryValue(r,["Dispatch_Day_MT","dispatch_day_mt","Dispatch_Day","dispatch_day","Dispatch","dispatch"]),close=feedHistoryValue(r,["Closing_Day_MT","closing_day_mt","Closing_Day","closing_day","Closing","closing"]);return `<tr><td>${esc(d)}</td><td>${prod===null?"--":fmtFeed(prod,p)}</td><td>${disp===null?"--":fmtFeed(disp,p)}</td><td>${close===null?"--":fmtFeed(close,p)}</td></tr>`}).join("")}</tbody></table></div>`;
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
  refreshBagsHistoryTable();
}
function refreshBagsHistoryTable(){
  const p=document.getElementById("bagsHistoryProduct")?.value||"",from=document.getElementById("bagsHistoryFrom")?.value||"",to=document.getElementById("bagsHistoryTo")?.value||"",el=document.getElementById("bagsHistoryTable");if(!el)return;
  if(from&&to&&from>to){el.innerHTML='<div class="history-empty">From Date must be before To Date.</div>';return}
  const rows=bagsHistoryRows(p),byDate=new Map();
  rows.forEach(r=>{const d=dateOnly(r.report_date||r.Report_Date||r.date||r.DATE);if(!inHistoryRange(d,from,to))return;if(!byDate.has(d))byDate.set(d,[]);byDate.get(d).push(r)});
  const dates=[...byDate.keys()].sort();
  if(!dates.length){el.innerHTML='<div class="history-empty">No history available for selected date range.</div>';return}
  el.innerHTML=`<div class="history-range-note">${esc(from)} → ${esc(to)} • ${dates.length} days</div><div class="history-table"><table><thead><tr><th>Date</th><th>Received</th><th>Issue</th><th>Damage</th><th>Closing</th></tr></thead><tbody>${dates.map(d=>{const rr=byDate.get(d),r=rr[rr.length-1],v=k=>num(r[k]);return `<tr><td>${esc(d)}</td><td>${v("received")===null?"--":fmt(v("received"))}</td><td>${v("issue")===null?"--":fmt(v("issue"))}</td><td>${v("damage")===null?"--":fmt(v("damage"))}</td><td>${v("closing")===null?"--":fmt(v("closing"))}</td></tr>`}).join("")}</tbody></table></div>`;
}


/* =====================================================
   DATA ACCURACY & RECONCILIATION CENTER
   Read-only checks over existing loaded data. Does not
   modify source rows or replace existing calculations.
===================================================== */
function dacValue(row,keys){
  for(const key of keys){
    const v=row?.[key];
    if(v===null||v===undefined||String(v).trim()==="")continue;
    const n=Number(v);
    if(Number.isFinite(n))return n;
  }
  return null;
}
function dacLatestDate(rows){
  return (Array.isArray(rows)?rows:[]).map(r=>dateOnly(r.report_date||r.Report_Date||r.date||r.DATE)).filter(Boolean).sort().pop()||"";
}
function dacStockItems(targetDate){
  return getMaterials().map(material=>{
    const rows=transactions(material).filter(t=>dateOnly(rowDate(t))===targetDate);
    if(!rows.length)return {name:material,date:targetDate,status:"NO DATA",message:"No stock transactions for this date."};
    let opening=null,closing=null,inflow=0,outflow=0,recorded=0,invalid=false;const unclassified=[];
    rows.forEach(t=>{
      const type=tType(t);
      const value=dacValue(t,["for_day","value","quantity","qty"]);
      if(type==="OPENING STOCK"){if(value===null)invalid=true;else opening=value;}
      else if(type==="CL. STOCK"||type.startsWith("CL. STOCK ")){if(value===null)invalid=true;else closing=value;}
      else if(isConsumptionMovement(type)){if(value===null)invalid=true;else recorded+=Math.abs(value);}
      else if(type==="PURCHASE"||type==="RECEIVED"||type==="GAIN"||type.includes("TRANSFER FROM")){if(value===null)invalid=true;else inflow+=Math.abs(value);}
      else if(type.includes("TRANSFER TO")||type.includes("SALE")||type.includes("SHORTAGE")||type==="DAMAGE"||type==="ISSUE"||type.includes("RETURN TO")){if(value===null)invalid=true;else outflow+=Math.abs(value);}
      else if(type)unclassified.push(type);
    });
    if(unclassified.length)return {name:material,date:targetDate,status:"NO DATA",message:"Unclassified movement type(s): "+[...new Set(unclassified)].join(", ")+". Confirm whether each is inward or outward before reconciling."};
    if(invalid)return {name:material,date:targetDate,status:"NO DATA",message:"One or more relevant transaction quantities are missing."};
    if(opening===null||closing===null)return {name:material,date:targetDate,status:"NO DATA",message:"Opening stock or closing stock is missing."};
    const calculated=opening+inflow-outflow-closing;
    const diff=calculated-recorded;
    return {name:material,date:targetDate,status:Math.abs(diff)<=0.01?"MATCH":"MISMATCH",opening,inflow,outflow,recorded,closing,calculated,diff,message:Math.abs(diff)<=0.01?"Calculated consumption agrees with recorded consumption.":"Calculated consumption differs from recorded consumption."};
  });
}
function dacFeedItems(targetDate){
  const rows=(Array.isArray(DATA.feedUnitData)?DATA.feedUnitData:[]).filter(r=>dateOnly(r.Report_Date||r.report_date||r.date||r.DATE)===targetDate&&!dcIsHiddenProduct(clean(r.Product||r.product)));
  return latestUniqueRows(rows,r=>r.Product||r.product).map(r=>{
    const product=clean(r.Product||r.product);
    const opening=dacValue(r,["Opening_Day_MT","opening_day_mt","Opening_Day","opening_day","Opening","opening"]);
    const production=dacValue(r,["Production_Day_MT","production_day_mt","Production_Day","production_day","Production","production"]);
    const transfer=dacValue(r,["Transfer_Day_MT","transfer_day_mt","Transfer_Day","transfer_day","Transfer","transfer"]);
    const dispatch=dacValue(r,["Dispatch_Day_MT","dispatch_day_mt","Dispatch_Day","dispatch_day","Dispatch","dispatch"]);
    const closing=dacValue(r,["Closing_Day_MT","closing_day_mt","Closing_Day","closing_day","Closing","closing"]);
    if(opening===null||closing===null||production===null||dispatch===null)return {name:product,date:targetDate,status:"NO DATA",message:"Opening, production, dispatch, or closing value is missing."};
    const calc=opening+production+(transfer||0)-dispatch;
    const diff=closing-calc;
    return {name:product,date:targetDate,status:Math.abs(diff)<=0.01?"MATCH":"MISMATCH",opening,production,transfer:transfer||0,dispatch,closing,calculated:calc,diff,message:Math.abs(diff)<=0.01?"Feed balance agrees.":"Feed balance does not agree."};
  });
}
function dacBagItems(targetDate){
  const rows=(Array.isArray(DATA.bagsHistory)?DATA.bagsHistory:[]).filter(r=>dateOnly(r.report_date||r.Report_Date||r.date)===targetDate&&!dcIsHiddenProduct(clean(r.product||r.Product)));
  return latestUniqueRows(rows,r=>r.product||r.Product||"PP Bags").map(r=>{
    const product=clean(r.product||r.Product||"PP Bags");
    const opening=dacValue(r,["opening","Opening"]),received=dacValue(r,["received","Received"]),issue=dacValue(r,["issue","Issue"]),damage=dacValue(r,["damage","Damage"]),closing=dacValue(r,["closing","Closing"]);
    if(opening===null||closing===null||received===null||issue===null||damage===null)return {name:product,date:targetDate,status:"NO DATA",message:"One or more PP-bag balance fields are missing."};
    const calc=opening+received-issue-damage,diff=closing-calc;
    return {name:product,date:targetDate,status:Math.abs(diff)<=0.01?"MATCH":"MISMATCH",opening,received,issue,damage,closing,calculated:calc,diff,message:Math.abs(diff)<=0.01?"PP-bag balance agrees.":"PP-bag balance does not agree."};
  });
}
function dacProductionItems(targetDate){
  const rows=(Array.isArray(DATA.productionHistory)?DATA.productionHistory:[]).filter(r=>dateOnly(r.report_date||r.Report_Date||r.date)===targetDate&&!dcIsHiddenProduct(clean(r.product||r.Product)));
  const seen=new Set();
  return rows.filter(r=>{const key=normalize(r.product||r.Product);if(!key||seen.has(key))return false;seen.add(key);return true;}).map(r=>{
    const product=clean(r.product||r.Product);
    const standard=dacValue(r,["standard_output","Standard_Output"]),actual=dacValue(r,["actual_output","Actual_Output"]),reported=dacValue(r,["output_percentage","Output_Percentage"]);
    if(standard===0&&actual===0&&reported===null)return {name:product,date:targetDate,status:"N/A",message:"No standard or actual output recorded; percentage check is not applicable."};
    if(standard===null||actual===null||reported===null)return {name:product,date:targetDate,status:"NO DATA",message:"Standard output, actual output, or reported output percentage is missing."};
    if(standard<=0||actual<0||reported<0)return {name:product,date:targetDate,status:"MISMATCH",message:"Invalid negative output or non-positive standard output.",standard,actual,reported};
    const calculated=actual/standard*100,diff=reported-calculated;
    return {name:product,date:targetDate,status:Math.abs(diff)<=0.5?"MATCH":"MISMATCH",standard,actual,reported,calculated,diff,message:Math.abs(diff)<=0.5?"Reported output percentage agrees with actual ÷ standard.":"Reported output percentage differs from actual ÷ standard."};
  });
}
function dacCount(items){const a=(Array.isArray(items)?items:[]).filter(x=>x.status!=="N/A");return {total:a.length,match:a.filter(x=>x.status==="MATCH").length,mismatch:a.filter(x=>x.status==="MISMATCH").length,noData:a.filter(x=>x.status==="NO DATA").length};}
function dacStatusLabel(status){const cls=status==="LATEST"||status==="MATCH"?"good":status==="MISMATCH"?"bad":"muted";return "<span class=\"dac-pill "+cls+"\">"+esc(status)+"</span>";}
function dataAccuracySnapshot(){
  const selected=VIEW_DATE?dateOnly(VIEW_DATE):"";
  const stockDate=selected||dacLatestDate(DATA.stockHistory)||dacLatestDate(DATA.stock);
  const productionDate=selected||dacLatestDate(DATA.productionHistory)||dacLatestDate(DATA.production);
  const bagsDate=selected||dacLatestDate(DATA.bagsHistory)||dacLatestDate(DATA.bags);
  const feedDate=selected||dacLatestDate(DATA.feedUnitData);
  const stock=dacStockItems(stockDate),feed=dacFeedItems(feedDate),bags=dacBagItems(bagsDate),production=dacProductionItems(productionDate);
  const groups=[
    {key:"stock",label:"Raw material stock",date:stockDate,items:stock,description:"Opening + inward − outward − closing compared with recorded consumption."},
    {key:"feed",label:"Feed-unit balance",date:feedDate,items:feed,description:"Opening + production + transfer − dispatch compared with closing."},
    {key:"bags",label:"PP-bag balance",date:bagsDate,items:bags,description:"Opening + received − issue − damage compared with closing."},
    {key:"production",label:"Production output %",date:productionDate,items:production,description:"Reported output percentage compared with actual output ÷ standard output."}
  ];
  const totals=groups.reduce((a,g)=>{const c=dacCount(g.items);a.total+=c.total;a.match+=c.match;a.mismatch+=c.mismatch;a.noData+=c.noData;return a;},{total:0,match:0,mismatch:0,noData:0});
  const sources=[
    {name:"Raw material stock",date:dacLatestDate(DATA.stockHistory)},
    {name:"Production",date:dacLatestDate(DATA.productionHistory)},
    {name:"PP bags",date:dacLatestDate(DATA.bagsHistory)},
    {name:"Feed unit",date:dacLatestDate(DATA.feedUnitData)},
    {name:"Feed-unit totals",date:dacLatestDate(DATA.feedUnitTotals)}
  ];
  const newest=sources.map(x=>x.date).filter(Boolean).sort().pop()||"";
  sources.forEach(x=>x.status=!x.date?"NO DATA":x.date===newest?"LATEST":"OLDER");
  return {groups,totals,sources,newest,selectedDate:selected};
}
function renderDataAccuracyCenter(){
  const card=document.getElementById("dataAccuracyCard");
  if(!card)return;
  try{
    const snap=dataAccuracySnapshot(),t=snap.totals;
    setText("dacSubtitle",(snap.selectedDate?"Selected date: "+snap.selectedDate:"Latest available records")+" • Read-only checks; source data is not changed");
    setText("dacTotal",String(t.total));setText("dacMatch",String(t.match));setText("dacMismatch",String(t.mismatch));setText("dacNoData",String(t.noData));
    const overall=document.getElementById("dacOverall");
    if(overall){overall.className="dac-overall "+(t.mismatch?"bad":t.noData?"warn":"good");overall.textContent=t.mismatch?(t.mismatch+" mismatch(es) need review"+(t.noData?" • "+t.noData+" check(s) have missing data":"")+"."):t.noData?(t.noData+" check(s) could not be verified because data is missing."):t.total?"All available checks match.":"No records available to check.";}
    const list=document.getElementById("dacCheckList");
    if(list)list.innerHTML=snap.groups.map(g=>{const c=dacCount(g.items);const state=c.mismatch?"bad":c.noData?"warn":"good";return "<button type=\"button\" class=\"dac-check-row\" onclick=\"openDataAccuracyDetails('"+g.key+"')\"><span class=\"dac-check-icon "+state+"\">"+(c.mismatch?"!":c.noData?"?":"✓")+"</span><span class=\"dac-check-copy\"><strong>"+esc(g.label)+"</strong><small>"+esc(g.description)+"</small><em>"+esc(g.date||"No report date")+" • "+c.total+" item(s)</em></span><span class=\"dac-check-counts\"><b>"+c.match+" match</b><b class=\""+(c.mismatch?"text-bad":"")+"\">"+c.mismatch+" mismatch</b><b>"+c.noData+" no data</b></span><span class=\"dac-chevron\">›</span></button>";}).join("")||"<div class='empty'>No records available to check.</div>";
    const fresh=document.getElementById("dacFreshness");
    if(fresh)fresh.innerHTML=snap.sources.map(x=>"<div class=\"dac-fresh-row\"><span>"+esc(x.name)+"</span><strong>"+esc(x.date||"No date")+"</strong>"+dacStatusLabel(x.status==="LATEST"?"LATEST":x.status==="OLDER"?"OLDER":"NO DATA")+"</div>").join("");
  }catch(error){
    console.warn("Data accuracy center could not render",error);
    setText("dacSubtitle","Unable to run checks; existing dashboard remains available.");
    const overall=document.getElementById("dacOverall");
    if(overall){overall.className="dac-overall warn";overall.textContent="Checks could not complete. Open the browser console or retry.";}
  }
}
function openDataHealthDetails(){
  const snap=dataAccuracySnapshot(),t=snap.totals;
  const mismatch=t.mismatch||0, missing=t.noData||0;
  const status=mismatch?'bad':missing?'warn':'good';
  const html=`<div class="dac-modal-intro">Data health runs automatically in the background. Only issues are added to Attention Required; this view shows the diagnostic details. Source data is not edited.</div>
    <div class="dac-stats">
      <div class="dac-stat"><span>Checks</span><strong>${t.total}</strong></div>
      <div class="dac-stat dac-good"><span>Match</span><strong>${t.match}</strong></div>
      <div class="dac-stat dac-bad"><span>Mismatch</span><strong>${mismatch}</strong></div>
      <div class="dac-stat dac-muted"><span>No data</span><strong>${missing}</strong></div>
    </div>
    <div class="dac-overall ${status}">${mismatch?mismatch+' mismatch(es) need review.':missing?missing+' check(s) could not be verified because data is missing.':'All available checks match.'}</div>
    <div class="dac-check-list">${snap.groups.map(g=>{const c=dacCount(g.items),state=c.mismatch?'bad':c.noData?'warn':'good';return `<button type="button" class="dac-check-row" onclick="openDataAccuracyDetails('${g.key}')"><span class="dac-check-icon ${state}">${c.mismatch?'!':c.noData?'?':'✓'}</span><span class="dac-check-copy"><strong>${esc(g.label)}</strong><small>${esc(g.description)}</small><em>${esc(g.date||'No report date')} • ${c.total} item(s)</em></span><span class="dac-check-counts"><b>${c.match} match</b><b class="${c.mismatch?'text-bad':''}">${c.mismatch} mismatch</b><b>${c.noData} no data</b></span><span class="dac-chevron">›</span></button>`}).join('')}</div>
    <div class="dac-freshness-head"><strong>Source freshness</strong><span>Latest report date per section</span></div>
    <div class="dac-freshness-list">${snap.sources.map(x=>`<div class="dac-fresh-row"><span>${esc(x.name)}</span><strong>${esc(x.date||'No date')}</strong>${dacStatusLabel(x.status==='LATEST'?'LATEST':x.status==='OLDER'?'OLDER':'NO DATA')}</div>`).join('')}</div>`;
  showModal('Data Health & Reconciliation',html);
}
function openDataAccuracyDetails(kind){
  const snap=dataAccuracySnapshot(),group=snap.groups.find(g=>g.key===kind);
  if(!group)return;
  const rows=group.items;
  const columns=kind==="stock"?[["opening","Opening"],["inflow","Inward"],["outflow","Outward"],["recorded","Recorded consumption"],["calculated","Calculated consumption"],["closing","Closing"],["diff","Difference"]]
    :kind==="feed"?[["opening","Opening"],["production","Production"],["transfer","Transfer"],["dispatch","Dispatch"],["calculated","Calculated closing"],["closing","Actual closing"],["diff","Difference"]]
    :kind==="bags"?[["opening","Opening"],["received","Received"],["issue","Issue"],["damage","Damage"],["calculated","Calculated closing"],["closing","Actual closing"],["diff","Difference"]]
    :[["standard","Standard"],["actual","Actual"],["calculated","Calculated %"],["reported","Reported %"],["diff","Difference"]];
  const html="<div class=\"dac-modal-intro\">"+esc(group.description)+"<br>Report date: <strong>"+esc(group.date||"No date")+"</strong>. These checks are diagnostic only; no source data is edited.</div><div class=\"dac-table-wrap\"><table class=\"dac-table\"><thead><tr><th>Item</th><th>Status</th>"+columns.map(c=>"<th>"+esc(c[1])+"</th>").join("")+"<th>Notes</th></tr></thead><tbody>"+(rows.map(r=>"<tr><td>"+esc(r.name)+"</td><td>"+dacStatusLabel(r.status)+"</td>"+columns.map(c=>"<td>"+(r[c[0]]===null||r[c[0]]===undefined?"—":esc(fmt(r[c[0]])))+"</td>").join("")+"<td>"+esc(r.message||"")+"</td></tr>").join("")||"<tr><td colspan=\""+(columns.length+3)+"\">No records available for this date.</td></tr>")+"</tbody></table></div>";
  showModal("Data Accuracy • "+group.label,html);
}

function renderDashboard(){
  initReportCenter();
  renderSmartHeader();
  renderAttentionRequired();
  renderDataAccuracyCenter();
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


function attentionReorderMaterials(){
  return getMaterials().map(m=>{
    const x=getMaterial(m), c=num(x?.closing)||0, avg=avgConsumption(m), s=stockStatus(c,avg);
    return {m,c,avg,s,unit:materialUnit(m,x?.unit||"MT")};
  }).filter(x=>x.s.status==="REORDER");
}
function attentionReorderRawMaterials(){
  return attentionReorderMaterials().filter(x=>!isPremixMaterial(x.m));
}
function attentionReorderPremixes(){
  return attentionReorderMaterials().filter(x=>isPremixMaterial(x.m));
}
function attentionUnder3Materials(){
  return getMaterials().map(m=>{
    const x=getMaterial(m), c=num(x?.closing)||0, avg=avgConsumption(m), s=stockStatus(c,avg);
    return {m,c,avg,s,unit:materialUnit(m,x?.unit||"MT")};
  }).filter(x=>x.s.cover!==null && x.s.cover<3 && x.s.status!=="REORDER");
}
function attentionAbnormalConsumption(){
  return abnormalConsumptionItems();
}
function attentionIncreasedBagDamage(){
  const selected=selectedBags();
  const dates=allAvailableDates().slice().sort();
  const selectedDate=selectedDateForIntelligence();
  if(!selected.length)return [];
  let prev=null;
  if(selectedDate){
    const idx=dates.indexOf(dateOnly(selectedDate));
    prev=idx>0?dates[idx-1]:null;
  }
  if(!prev){
    return selected.filter(r=>(num(r.damage)||0)>0).map(r=>({product:r.product||"PP Bags",damage:num(r.damage)||0,previous:null}));
  }
  const yesterday=new Map();
  (Array.isArray(DATA.bagsHistory)?DATA.bagsHistory:[])
    .filter(r=>dateOnly(r.report_date||r.Report_Date||r.date||r.DATE)===prev)
    .forEach(r=>yesterday.set(normalize(r.product||"PP Bags"),num(r.damage)||0));
  return selected.map(r=>{
    const product=r.product||"PP Bags", damage=num(r.damage)||0, previous=yesterday.get(normalize(product))||0;
    return {product,damage,previous};
  }).filter(x=>x.damage>x.previous);
}
function attentionPendingSpareOrders(){
  const rows=Array.isArray(SPARE_DATA.SPARE_ORDERS)?SPARE_DATA.SPARE_ORDERS:[];
  return rows.filter(r=>{
    const st=normalize(spareVal(r,['STATUS','Status','ORDER_STATUS','Order_Status']));
    return /PENDING|OPEN|PROCESS/.test(st);
  });
}
function attentionProductionIssues(){
  return selectedProduction().filter(r=>{
    const op=num(r.output_percentage);
    return op!==null && Number.isFinite(op) && op<95;
  });
}
function spareOrderDisplayName(r){
  return clean(spareVal(r,['PART_NAME','Part_Name','PART','Part','ITEM','Item','MATERIAL','Material','NAME','Name','DESCRIPTION','Description']))||"Spare Part";
}
function openAttentionFiltered(kind){
  if(kind==="reorderRaw" || kind==="reorderPremix" || kind==="reorder"){
    const rows=kind==="reorderPremix"?attentionReorderPremixes():kind==="reorderRaw"?attentionReorderRawMaterials():attentionReorderMaterials();
    const isRaw=kind!=="reorderPremix";
    const title=kind==="reorderPremix"?"🔴 Premixes below reorder level":"🔴 Raw Materials below reorder level";
    const empty=kind==="reorderPremix"?"No premixes below reorder level.":"No raw materials below reorder level.";
    if(isRaw){
      const html=`<div class="detail-section">
        <h3>${title} • ${rows.length}</h3>
        <div style="display:flex;gap:8px;margin:10px 0;align-items:center">
          <button type="button" class="secondary-btn" onclick="toggleAllReorderMaterials(true)">Select All</button>
          <button type="button" class="secondary-btn" onclick="toggleAllReorderMaterials(false)">Clear</button>
          <span id="reorderSelectedCount" style="margin-left:auto;font-size:12px;opacity:.75">0 selected</span>
        </div>
        <div id="reorderMaterialSelectList">
          ${rows.map((x,i)=>`<label style="display:flex;gap:10px;align-items:center;padding:10px 4px;border-bottom:1px solid rgba(127,127,127,.16);cursor:pointer">
            <input type="checkbox" class="reorder-material-check" value="${esc(x.m)}" onchange="updateReorderSelectedCount()">
            <span style="flex:1"><span class="row-name">${esc(x.m)}</span><span class="prod-meta">Stock ${fmt(x.c)} ${esc(x.unit)} • Avg ${fmt(x.avg)} ${esc(x.unit)}/day</span></span>
            <span class="row-right"><strong>${x.s.cover===null?"--":fmt(x.s.cover)+" d"}</strong><small>Reorder</small></span>
          </label>`).join("")||`<div class='empty'>${empty}</div>`}
        </div>
        ${rows.length?`<button type="button" class="primary-btn" style="width:100%;margin-top:14px" onclick="sendRawMaterialRequirementWhatsApp()">📲 Send</button>`:""}
      </div>`;
      showModal(title,html); return;
    }
    const html=`<div class="detail-section"><h3>${title} • ${rows.length}</h3>${rows.map(x=>`<div class="feed-row" onclick="closeModal();openMaterialDetails('${jsq(x.m)}')"><div><div class="row-name">${esc(x.m)}</div><div class="prod-meta">Stock ${fmt(x.c)} ${esc(x.unit)} • Avg ${fmt(x.avg)} ${esc(x.unit)}/day</div></div><div class="row-right"><strong>${x.s.cover===null?"--":fmt(x.s.cover)+" d"}</strong><small>Reorder</small></div></div>`).join("")||`<div class='empty'>${empty}</div>`}</div>`;
    showModal(title,html); return;
  }
  if(kind==="under3"){
    const rows=attentionUnder3Materials().sort((a,b)=>a.s.cover-b.s.cover);
    const html=`<div class="detail-section"><h3>🟡 Stock coverage below 3 days • ${rows.length}</h3>${rows.map(x=>`<div class="feed-row" onclick="closeModal();openMaterialDetails('${jsq(x.m)}')"><div><div class="row-name">${esc(x.m)}</div><div class="prod-meta">Stock ${fmt(x.c)} ${esc(x.unit)} • Avg ${fmt(x.avg)} ${esc(x.unit)}/day</div></div><div class="row-right"><strong>${fmt(x.s.cover)} d</strong><small>&lt; 3 days</small></div></div>`).join("")||"<div class='empty'>No materials below 3 days coverage.</div>"}</div>`;
    showModal("🟡 Low Coverage",html); return;
  }
  if(kind==="abnormal"){
    const rows=attentionAbnormalConsumption();
    const html=`<div class="detail-section"><h3>🔴 Abnormal consumption • ${rows.length}</h3>${rows.map(x=>`<div class="feed-row" onclick="closeModal();openMaterialDetails('${jsq(x.material)}')"><div><div class="row-name">${esc(x.material)}</div><div class="prod-meta">${esc(x.direction==="LOW"?"Below":"Above")} average • ${fmt(x.current)} vs ${fmt(x.avg)}</div></div><div class="row-right"><strong>${fmt(Math.abs(x.ratio*100-100))}%</strong><small>${esc(x.date||"Latest")}</small></div></div>`).join("")||"<div class='empty'>No abnormal consumption found.</div>"}</div>`;
    showModal("🔴 Abnormal Consumption",html); return;
  }
  if(kind==="bags"){
    const rows=attentionIncreasedBagDamage();
    const html=`<div class="detail-section"><h3>🟡 PP bag damages increased • ${rows.length}</h3>${rows.map(x=>`<div class="feed-row" onclick="closeModal();openBagProduct('${jsq(x.product)}')"><div><div class="row-name">${esc(x.product)}</div><div class="prod-meta">Previous damage ${fmt(x.previous)} • Current ${fmt(x.damage)}</div></div><div class="row-right"><strong>+${fmt(x.damage-x.previous)}</strong><small>Damage increase</small></div></div>`).join("")||"<div class='empty'>No PP bag damage increase found.</div>"}</div>`;
    showModal("🟡 PP Bag Damage",html); return;
  }
  if(kind==="spares"){
    const rows=attentionPendingSpareOrders();
    const html=`<div class="detail-section"><h3>🔵 Spare parts pending order • ${rows.length}</h3>${rows.map(r=>`<div class="feed-row" onclick="goSpareParts();closeModal()"><div><div class="row-name">${esc(spareOrderDisplayName(r))}</div><div class="prod-meta">Status: ${esc(spareVal(r,['STATUS','Status','ORDER_STATUS','Order_Status'])||"--")}</div></div><div class="row-right"><strong>Pending</strong><small>Open Spare Parts</small></div></div>`).join("")||"<div class='empty'>No pending spare orders.</div>"}</div>`;
    showModal("🔵 Pending Spare Orders",html); return;
  }
  if(kind==="production"){
    const rows=attentionProductionIssues();
    const html=`<div class="detail-section"><h3>🟡 Production output below 95% • ${rows.length}</h3>${rows.map(r=>{const p=r.product||"--",op=num(r.output_percentage);return `<div class="feed-row" onclick="closeModal();openProductDetails('${jsq(p)}')"><div><div class="row-name">${esc(p)}</div><div class="prod-meta">Output ${fmt(op)}%</div></div><div class="row-right"><strong>${fmt(op)}%</strong><small>Below 95%</small></div></div>`}).join("")||"<div class='empty'>No valid production records below 95%.</div>"}</div>`;
    showModal("🟡 Production Output",html); return;
  }
}
function updateReorderSelectedCount(){
  const checks=[...document.querySelectorAll('.reorder-material-check')];
  const n=checks.filter(c=>c.checked).length;
  const el=document.getElementById('reorderSelectedCount');
  if(el)el.textContent=`${n} selected`;
}
function toggleAllReorderMaterials(state){
  document.querySelectorAll('.reorder-material-check').forEach(c=>c.checked=!!state);
  updateReorderSelectedCount();
}
function sendRawMaterialRequirementWhatsApp(){
  const names=[...document.querySelectorAll('.reorder-material-check:checked')].map(c=>c.value).filter(Boolean);
  if(!names.length){
    alert('Please select at least one raw material.');
    return;
  }
  const message=['Dear Sir','Raw material requirement up to now',...names].join('\n');
  const url='https://wa.me/?text='+encodeURIComponent(message);
  window.open(url,'_blank');
}

function attentionSummaryItems(){
  const reorderRows=attentionReorderMaterials();
  const reorderRawRows=attentionReorderRawMaterials();
  const reorderPremixRows=attentionReorderPremixes();
  const under3Rows=attentionUnder3Materials();
  const abnormalRows=attentionAbnormalConsumption();
  const bagRows=attentionIncreasedBagDamage();
  const spareRows=attentionPendingSpareOrders();
  const productionRows=attentionProductionIssues();
  const items=[];
  items.push({icon:reorderRawRows.length?'🔴':'🟢',level:reorderRawRows.length?'critical':'clear',count:reorderRawRows.length,text:`${reorderRawRows.length} Raw Materials below reorder level`,reason:reorderRawRows.length?"Immediate replenishment recommended":"No raw material is below its reorder level",action:"openAttentionFiltered('reorderRaw')"});
  items.push({icon:reorderPremixRows.length?'🔴':'🟢',level:reorderPremixRows.length?'critical':'clear',count:reorderPremixRows.length,text:`${reorderPremixRows.length} Premixes below reorder level`,reason:reorderPremixRows.length?"Immediate premix replenishment recommended":"No premix is below its reorder level",action:"openAttentionFiltered('reorderPremix')"});
  items.push({icon:under3Rows.length?'🟡':'🟢',level:under3Rows.length?'warning':'clear',count:under3Rows.length,text:`${under3Rows.length} materials with < 3 days cover`,reason:under3Rows.length?"Coverage is low but not yet at reorder level":"No additional low-coverage materials",action:"openAttentionFiltered('under3')"});
  items.push({icon:abnormalRows.length?'🔴':'🟢',level:abnormalRows.length?'critical':'clear',count:abnormalRows.length,text:`${abnormalRows.length} abnormal consumption`,reason:abnormalRows.length?"Consumption is outside the normal pattern":"Consumption is within the monitored range",action:"openAttentionFiltered('abnormal')"});
  items.push({icon:bagRows.length?'🟡':'🟢',level:bagRows.length?'warning':'clear',count:bagRows.length,text:`${bagRows.length} PP bag damage increases`,reason:bagRows.length?"Damage is higher than the previous available day":"No increase in recorded damage",action:"openAttentionFiltered('bags')"});
  items.push({icon:spareRows.length?'🔵':'🟢',level:spareRows.length?'info':'clear',count:spareRows.length,text:`${spareRows.length} spare orders pending`,reason:spareRows.length?"Open / pending spare orders need follow-up":"No pending spare orders",action:"openAttentionFiltered('spares')"});
  items.push({icon:productionRows.length?'🟡':'🟢',level:productionRows.length?'warning':'clear',count:productionRows.length,text:productionRows.length?`${productionRows.length} production outputs below 95%`:'Production output normal',reason:productionRows.length?"Output percentage is below the 95% threshold":"All selected production records are ≥ 95%",action:"openAttentionFiltered('production')"});
  // Data quality checks run in the background and surface here only when review is needed.
  const health=dataAccuracySnapshot();
  const healthMismatch=health.totals.mismatch||0, healthMissing=health.totals.noData||0;
  const healthIssues=healthMismatch+healthMissing;
  items.push({icon:healthMismatch?'⚠️':healthMissing?'🟠':'🟢',level:healthMismatch?'critical':healthMissing?'warning':'clear',count:healthIssues,text:healthIssues?`Data health: ${healthMismatch} mismatch • ${healthMissing} missing`:'Data health checks passed',reason:healthMismatch?'Reconciliation differences need review':healthMissing?'Some checks cannot be verified because source data is missing':'All available reconciliation checks match',action:"openDataHealthDetails()"});
  // Data-control review state is intentionally kept out of the main Attention count.
  // Review decisions are browser-local (localStorage), so including them here makes
  // the same Supabase data show different Attention counts in Safari vs Incognito.
  // The full Data Control review remains available from its own UI.
  const dcReviews=[];
  items.push({icon:'🟢',level:'clear',count:0,text:"Data control clear",reason:"No data-control review item included in the main attention count",action:"dcReviewModal()"});
  return items;
}

function attentionTotalCount(items){
  return items.reduce((sum,x)=>sum+(Number(x.count)||0),0);
}
function openAttentionOverview(){
  const items=attentionSummaryItems().filter(x=>x.level!=="clear");
  if(!items.length){
    showModal("✓ Attention Required",`<div class="attention-overview-clear"><div class="attention-clear-mark">✓</div><h3>Everything is under control</h3><p>No active attention items were detected for the selected date.</p></div>`);
    return;
  }
  const total=attentionTotalCount(items);
  const critical=items.filter(x=>x.level==="critical").reduce((n,x)=>n+(Number(x.count)||0),0);
  const warning=items.filter(x=>x.level==="warning").reduce((n,x)=>n+(Number(x.count)||0),0);
  const html=`<div class="attention-overview">
    <div class="attention-overview-stats"><div><strong>${total}</strong><small>Total items</small></div><div class="critical"><strong>${critical}</strong><small>Critical</small></div><div class="warning"><strong>${warning}</strong><small>Warning</small></div></div>
    <div class="attention-overview-list">${items.map(x=>{const cls=x.level;return `<button type="button" class="attention-overview-row ${cls}" onclick="${x.action}"><span class="attention-overview-icon">${x.icon}</span><span><strong>${esc(x.text)}</strong><small>${esc(x.reason||"Open affected items")}</small></span><b>›</b></button>`}).join("")}</div>
  </div>`;
  showModal("⚠️ Attention Required",html);
}
function renderAttentionRequired(){
  const card=document.getElementById("attentionRequiredCard");
  const list=document.getElementById("attentionList");
  const count=document.getElementById("attentionCount");
  const status=document.getElementById("attentionStatus");
  const meta=document.getElementById("attentionMeta");
  if(!card||!list)return;
  const items=attentionSummaryItems();
  const active=items.filter(x=>x.level!=="clear");
  const total=attentionTotalCount(active);
  const critical=active.filter(x=>x.level==="critical").reduce((n,x)=>n+(Number(x.count)||0),0);
  const warning=active.filter(x=>x.level==="warning").reduce((n,x)=>n+(Number(x.count)||0),0);
  if(count){count.textContent=String(total);count.className="attention-count"+(critical?" critical":total?" warning":" clear")}
  if(status){status.textContent=critical?"ACTION NEEDED":total?"CHECK":"ALL CLEAR";status.className="attention-status"+(critical?" critical":total?" warning":" clear")}
  if(meta){meta.textContent=total?`${critical} critical • ${warning} warning`:`No active issues for ${selectedDateForIntelligence()||"latest data"}`}
  card.classList.toggle("has-critical",critical>0);
  card.classList.toggle("has-warning",critical===0&&total>0);
  card.classList.toggle("is-clear",total===0);
  list.innerHTML=active.length?active.map(x=>{
    const cls=x.level==="critical"?"critical":x.level==="warning"?"warning":"info";
    return `<button type="button" class="attention-summary-row ${cls}" onclick="${x.action}">
      <span class="attention-summary-icon">${x.icon}</span>
      <span class="attention-summary-copy"><strong>${esc(x.text)}</strong><small>${esc(x.reason||"Click to view affected items")}</small></span>
      <span class="attention-summary-arrow">›</span>
    </button>`;
  }).join(""): `<div class="attention-inline-clear"><span>✓</span><div><strong>No action required</strong><small>All monitored areas are currently within limits.</small></div></div>`;
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
  const namedConsumption=rows.filter(t=>isConsumptionMovement(tType(t))).reduce((a,t)=>a+tVal(t),0);
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
  const r=selectedProduction().find(x=>normalize(x.product||x.Product)===normalize(product));
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
  const fr=latestUniqueRows(selectedFeedRows().filter(x=>normalize(x.Product||x.product)===normalize(product)),x=>x.Product||x.product).slice(-1)[0];
  if(fr){
    html+=`<div class="detail-section"><h3>🌾 Feed Unit Details</h3>${detail("Opening Day",fmtFeed(fr.Opening_Day_MT??fr.opening_day_mt??fr.Opening_Day??fr.opening_day??fr.Opening??fr.opening,product))}${detail("Production Day",fmtFeed(fr.Production_Day_MT??fr.production_day_mt??fr.Production_Day??fr.production_day??fr.Production??fr.production,product))}${detail("Dispatch Day",fmtFeed(fr.Dispatch_Day_MT??fr.dispatch_day_mt??fr.Dispatch_Day??fr.dispatch_day??fr.Dispatch??fr.dispatch,product))}${detail("Transfer Day",fmtFeed(fr.Transfer_Day_MT??fr.transfer_day_mt??fr.Transfer_Day??fr.transfer_day??fr.Transfer??fr.transfer,product))}${detail("Closing Day",fmtFeed(fr.Closing_Day_MT??fr.closing_day_mt??fr.Closing_Day??fr.closing_day??fr.Closing??fr.closing,product))}${detail("Production Month",fmtFeed(fr.Production_Month_MT??fr.production_month_mt??fr.Production_Month??fr.production_month,product))}${detail("Dispatch Month",fmtFeed(fr.Dispatch_Month_MT??fr.dispatch_month_mt??fr.Dispatch_Month??fr.dispatch_month,product))}</div>`;
  }
  showModal(product,html);
}
function openPPBagDetails(){showModal("PP Bags",selectedBags().map(r=>`<div class="detail-section"><h3>${esc(r.product||"PP Bags")}</h3>${detail("Opening",fmt(r.opening))}${detail("Received",fmt(r.received))}${detail("Issue",fmt(r.issue))}${detail("Damage",fmt(r.damage))}${detail("Closing",fmt(r.closing))}</div>`).join("")||"<div class='empty'>No PP Bag data</div>")}
function openBagProduct(product){
  const r=latestUniqueRows(selectedBags().filter(x=>normalize(x.product||"PP Bags")===normalize(product)),x=>x.product||"PP Bags").slice(-1)[0];
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
  const r=latestUniqueRows(rows,x=>x.Product||x.product).slice(-1)[0];
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
  const ctx=c.getContext("2d"),dpr=window.devicePixelRatio||1,w=c.clientWidth||320,h=170;
  c.width=w*dpr;c.height=h*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
  const vals=(Array.isArray(series)?series:[]).map(v=>v===null||v===undefined||v===""?null:num(v));
  const valid=vals.filter(v=>v!==null);
  if(!valid.length){ctx.fillStyle="#888";ctx.font="12px sans-serif";ctx.fillText("No trend data for this period",12,76);return}
  const max=Math.max(...valid,0),min=Math.min(...valid,0),range=max-min||1,pad={l:36,r:10,t:14,b:30};
  ctx.strokeStyle="#e7e8ea";ctx.lineWidth=1;
  for(let i=0;i<4;i++){const y=pad.t+(h-pad.t-pad.b)*i/3;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(w-pad.r,y);ctx.stroke();
    const value=max-(max-min)*i/3;ctx.fillStyle="#777";ctx.font="9px sans-serif";ctx.textAlign="right";ctx.fillText(Number(value.toFixed(1)).toString(),pad.l-5,y+3);}
  const xAt=i=>pad.l+(w-pad.l-pad.r)*(vals.length===1?.5:i/(vals.length-1));
  const yAt=v=>pad.t+(h-pad.t-pad.b)*(1-(v-min)/range);
  ctx.strokeStyle="#315efb";ctx.lineWidth=2;ctx.beginPath();let drawing=false;
  vals.forEach((v,i)=>{if(v===null){drawing=false;return}const x=xAt(i),y=yAt(v);if(!drawing){ctx.moveTo(x,y);drawing=true}else ctx.lineTo(x,y);});
  ctx.stroke();
  vals.forEach((v,i)=>{if(v===null)return;ctx.fillStyle="#315efb";ctx.beginPath();ctx.arc(xAt(i),yAt(v),2.5,0,Math.PI*2);ctx.fill()});
  ctx.fillStyle="#777";ctx.font="9px sans-serif";ctx.textAlign="center";
  const step=Math.max(1,Math.ceil(labels.length/5));
  labels.forEach((l,i)=>{if(i%step===0||i===labels.length-1){const raw=String(l);const label=/^\d{4}-\d{2}-\d{2}$/.test(raw)?raw.slice(5).replace("-","/"):raw.slice(-8);ctx.fillText(label,xAt(i),h-8)}});
}
function usageLabels(){const n=Math.max(...Object.values(DATA.usage).map(a=>Array.isArray(a)?a.length:0),0);return Array.from({length:n},(_,i)=>"D"+(i+1))}
let TREND_RANGE="30";
function trendISODate(d){return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-")}
function trendDateBounds(){
  const today=new Date(),end=trendISODate(today);
  if(TREND_RANGE==="custom"){
    const from=document.getElementById("trendFromDate")?.value||"";
    const to=document.getElementById("trendToDate")?.value||"";
    return {from,to,valid:!!from&&!!to&&from<=to};
  }
  if(TREND_RANGE==="month")return {from:trendISODate(new Date(today.getFullYear(),today.getMonth(),1)),to:end,valid:true};
  const days=Math.max(1,Number(TREND_RANGE)||30),start=new Date(today.getFullYear(),today.getMonth(),today.getDate());
  start.setDate(start.getDate()-days+1);
  return {from:trendISODate(start),to:end,valid:true};
}
function trendDateInRange(value){
  const d=dateOnly(value),range=trendDateBounds();
  return !!d&&range.valid&&d>=range.from&&d<=range.to;
}
function setTrendRange(value){
  TREND_RANGE=["7","30","90","month","custom"].includes(String(value))?String(value):"30";
  const custom=document.getElementById("trendCustomDates");
  if(custom)custom.hidden=TREND_RANGE!=="custom";
  if(TREND_RANGE==="custom"){
    const today=trendISODate(new Date());
    const from=document.getElementById("trendFromDate"),to=document.getElementById("trendToDate");
    if(to&&!to.value)to.value=today;
    if(from&&!from.value){const d=new Date();d.setDate(d.getDate()-29);from.value=trendISODate(d);}
  }
  renderTrends();
}
function setTrendCustomDates(){if(TREND_RANGE==="custom"&&trendDateBounds().valid)renderTrends()}
function updateTrendRangeLabel(){
  const range=trendDateBounds(),label=document.getElementById("trendRangeLabel");
  if(label){const names={"7":"Last 7 days","30":"Last 30 days","90":"Last 3 months","month":"Calendar month","custom":"Custom range"};
    label.textContent=range.valid?names[TREND_RANGE]+": "+range.from+" → "+range.to:"Choose a valid start and end date";}
  setText("dateTrends",range.valid?"Trend period: "+range.from+" → "+range.to:"Trend period: select valid dates");
}
function drawMaterialChart(material){
  const map={};
  transactions(material).forEach(t=>{
    const type=tType(t);
    if(!isConsumptionMovement(type))return;
    const d=rowDate(t);if(!trendDateInRange(d))return;
    map[d]=(map[d]||0)+tVal(t);
  });
  const labels=Object.keys(map).sort();chart("materialChart",labels,labels.map(d=>map[d]));
}
function productionTrendData(){return DATA.productionTrend.map(x=>typeof x==="object"?num(x.actual_output??x.actual??x.value):num(x)).filter(v=>v!==null)}


function trendFromTransactions(type){
  const map={};
  getMaterials().forEach(m=>transactions(m).forEach(t=>{
    if(tType(t)!==type)return;
    const d=rowDate(t);if(!trendDateInRange(d))return;
    map[d]=(map[d]||0)+tVal(t);
  }));
  const labels=Object.keys(map).sort();return {labels,values:labels.map(k=>map[k])}
}
function trendClosing(){
  const byMaterialDate={};
  getMaterials().forEach(m=>transactions(m).forEach(t=>{
    const d=rowDate(t);if(!d||!trendDateInRange(d)||tType(t)!=="CL. STOCK")return;
    byMaterialDate[d+"|"+normalize(m)]={date:d,material:m,value:num(t.for_day)};
  }));
  const map={};
  Object.values(byMaterialDate).forEach(x=>{if(x.value===null)return;map[x.date]=(map[x.date]||0)+x.value});
  const labels=Object.keys(map).sort();return {labels,values:labels.map(k=>map[k])}
}





/* =====================================================
   NAVIGATION
===================================================== */
function switchDashboardView(view){
  const allowed=new Set(["home","stock","production","bags","spares","reports"]);
  if(!allowed.has(view))view="home";
  document.querySelectorAll(".dashboard-view").forEach(el=>{
    const active=el.dataset.dashboardView===view;
    el.classList.toggle("active",active);
    el.hidden=!active;
  });
  document.querySelectorAll(".bottom-nav .nav-item").forEach(el=>{
    const active=el.dataset.view===view;
    el.classList.toggle("active",active);
    if(active)el.setAttribute("aria-current","page");else el.removeAttribute("aria-current");
  });
  if(view==="spares")loadSpareParts(false);
  if(view==="reports")requestAnimationFrame(()=>{try{drawTrends()}catch(e){console.warn("Trend redraw skipped",e)}});
  window.scrollTo({top:0,behavior:"smooth"});
}
function goHome(){switchDashboardView("home")}
function goSpareParts(){switchDashboardView("spares")}
function goTrend(){switchDashboardView("reports")}


/* =====================================================
   DATE VIEW — COMPLETE DASHBOARD DATE FILTER
===================================================== */
let VIEW_DATE=null;
function effectiveViewDate(){
  return dateOnly(VIEW_DATE || DATA.report_date || "");
}

/* =====================================================
   PERFORMANCE MEMOIZATION — invalidated when data/date changes
===================================================== */
const PERF_CACHE={
  viewStock:null, historyStock:new Map(), materials:null, materialMap:null,
  transactions:new Map(), production:null, bags:null, feedRows:null, latestFeed:null,
  avgConsumption:new Map(), availableDates:null, rawTotals:new Map(), monthlyRM:new Map(), monthlyFeed:new Map()
};
function invalidatePerfCache(){
  PERF_CACHE.viewStock=null;
  PERF_CACHE.historyStock.clear();
  PERF_CACHE.materials=null;
  PERF_CACHE.materialMap=null;
  PERF_CACHE.transactions.clear();
  PERF_CACHE.production=null;
  PERF_CACHE.bags=null;
  PERF_CACHE.feedRows=null;
  PERF_CACHE.latestFeed=null;
  PERF_CACHE.avgConsumption.clear();
  PERF_CACHE.availableDates=null;
  PERF_CACHE.rawTotals.clear();
  PERF_CACHE.monthlyRM.clear();
  PERF_CACHE.monthlyFeed.clear();
}
function historyStockRowsForDate(date){
  const d=dateOnly(date);
  if(!d)return [];
  if(PERF_CACHE.historyStock.has(d))return PERF_CACHE.historyStock.get(d);
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
  const result=[...grouped.values()].map(g=>{
    const base=current.get(normalize(g.material))||{};
    const closingRows=g.transactions.filter(t=>tType(t)==="CL. STOCK");
    const latestClosing=closingRows.length?closingRows[closingRows.length-1]:null;
    return {...base,material:g.material,transactions:g.transactions,closing:latestClosing?tVal(latestClosing):null};
  });
  PERF_CACHE.historyStock.set(d,result);
  return result;
}
function viewStockRows(){
  if(PERF_CACHE.viewStock)return PERF_CACHE.viewStock;
  if(VIEW_DATE){
    PERF_CACHE.viewStock=historyStockRowsForDate(VIEW_DATE);
    return PERF_CACHE.viewStock;
  }
  const latestDate=latestStockDataDate();
  PERF_CACHE.viewStock=(DATA.stock||[]).map(x=>{
    const tx=Array.isArray(x.transactions)?x.transactions:[];
    // Supabase rows are ordered by id, not report date. Never use the last
    // transaction as the latest closing; explicitly select the latest report date.
    const closingRows=tx.filter(t=>tType(t)==="CL. STOCK" && (!latestDate || dateOnly(rowDate(t))===latestDate));
    const latestClosing=closingRows.length?closingRows[closingRows.length-1]:null;
    return {...x,transactions:tx,closing:latestClosing?tVal(latestClosing):num(x.closing)};
  }).filter(x=>x.material);
  return PERF_CACHE.viewStock;
}
function getMaterials(){
  if(PERF_CACHE.materials)return PERF_CACHE.materials;
  PERF_CACHE.materials=[...new Set(viewStockRows().map(x=>clean(x.material)).filter(Boolean))].filter(m=>!dcIsHiddenMaterial(m));
  return PERF_CACHE.materials;
}
function getMaterial(material){
  if(!PERF_CACHE.materialMap){
    PERF_CACHE.materialMap=new Map(viewStockRows().map(x=>[normalize(x.material),x]));
  }
  return PERF_CACHE.materialMap.get(normalize(material))||null;
}
function transactions(material){
  const key=normalize(material);
  if(PERF_CACHE.transactions.has(key))return PERF_CACHE.transactions.get(key);
  const x=getMaterial(material);
  const raw=x&&Array.isArray(x.transactions)?x.transactions:[];
  const result=raw.filter(t=>!dcIsExcluded(material,t));
  PERF_CACHE.transactions.set(key,result);
  return result;
}
function selectedProduction(){
  if(PERF_CACHE.production)return PERF_CACHE.production;
  if(!effectiveViewDate()){PERF_CACHE.production=__uniqueProductRows((Array.isArray(DATA.production)?DATA.production:[]).filter(r=>!dcIsHiddenProduct(r.product||r.Product)),r=>r.product||r.Product);return PERF_CACHE.production;}
  const d=dateOnly(VIEW_DATE);
  const history=Array.isArray(DATA.productionHistory)?DATA.productionHistory:[];
  PERF_CACHE.production=__uniqueProductRows(history.filter(r=>dateOnly(r.report_date||r.Report_Date)===d&&!dcIsHiddenProduct(r.product||r.Product)),r=>r.product||r.Product);
  return PERF_CACHE.production;
}
function selectedBags(){
  if(PERF_CACHE.bags)return PERF_CACHE.bags;
  if(!effectiveViewDate()){PERF_CACHE.bags=latestUniqueRows((Array.isArray(DATA.bags)?DATA.bags:[]).filter(r=>!dcIsHiddenProduct(r.product)),r=>r.product||"PP Bags");return PERF_CACHE.bags;}
  const d=effectiveViewDate();
  const history=Array.isArray(DATA.bagsHistory)?DATA.bagsHistory:[];
  PERF_CACHE.bags=latestUniqueRows(history.filter(r=>dateOnly(r.report_date||r.Report_Date)===d&&!dcIsHiddenProduct(r.product)),r=>r.product||"PP Bags");
  return PERF_CACHE.bags;
}
function selectedFeedRows(){
  if(PERF_CACHE.feedRows)return PERF_CACHE.feedRows;
  const rows=Array.isArray(DATA.feedUnitData)?DATA.feedUnitData:[];
  const d=effectiveViewDate();
  const dateRows=d?rows.filter(r=>dateOnly(r.Report_Date||r.report_date||r.date||r.DATE)===d):rows;
  PERF_CACHE.feedRows=uniqueDatedProductRows(dateRows.filter(r=>!dcIsHiddenProduct(clean(r.Product||r.product))),r=>r.Product||r.product,r=>r.Report_Date||r.report_date||r.date||r.DATE);
  return PERF_CACHE.feedRows;
}
function uniqueDatedProductRows(rows,productGetter,dateGetter){
  const latest=new Map();
  (Array.isArray(rows)?rows:[]).forEach(r=>{
    const p=clean(productGetter(r));if(!p)return;
    const d=dateOnly(dateGetter(r))||"NO_DATE";
    latest.set(d+"|"+normalize(p),r); // One summary row per product/date; last source row wins deterministically.
  });
  return [...latest.values()];
}
function latestUniqueRows(rows,productGetter,dateGetter){
  const latest=new Map();
  (Array.isArray(rows)?rows:[]).forEach(r=>{
    const p=clean(productGetter(r));if(!p)return;
    const key=normalize(p),d=dateGetter?dateOnly(dateGetter(r)):"";
    const prior=latest.get(key),priorDate=prior&&dateGetter?dateOnly(dateGetter(prior)):"";
    if(!prior || !dateGetter || d>=priorDate)latest.set(key,r);
  });
  return [...latest.values()];
}
function latestFeedRows(){
  if(PERF_CACHE.latestFeed)return PERF_CACHE.latestFeed;
  PERF_CACHE.latestFeed=latestUniqueRows(
    selectedFeedRows().filter(r=>!dcIsHiddenProduct(clean(r.Product||r.product))),
    r=>r.Product||r.product,
    r=>r.Report_Date||r.report_date||r.date||r.DATE
  );
  return PERF_CACHE.latestFeed;
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
  const key=normalize(material);
  if(PERF_CACHE.avgConsumption.has(key))return PERF_CACHE.avgConsumption.get(key);
  const history=Array.isArray(DATA.stockHistory)?DATA.stockHistory:[];
  const dated=new Map();
  history.forEach(t=>{
    if(normalize(t.material)!==key || !isConsumptionMovement(tType(t)))return;
    const d=dateOnly(rowDate(t));
    const v=num(t.for_day);
    if(!d || v===null || v<=0)return;
    dated.set(d,(dated.get(d)||0)+v);
  });
  if(!dated.size){PERF_CACHE.avgConsumption.set(key,0);return 0;}
  const availableDates=[...dated.keys()].sort();
  let anchor=dateOnly(VIEW_DATE);
  if(!anchor)anchor=availableDates[availableDates.length-1];
  const anchorTime=new Date(anchor+"T00:00:00").getTime();
  const startTime=anchorTime-29*86400000;
  let total=0,count=0;
  dated.forEach((v,d)=>{
    const tm=new Date(d+"T00:00:00").getTime();
    if(tm>=startTime&&tm<=anchorTime&&v>0){total+=v;count++;}
  });
  const result=count?total/count:0;
  PERF_CACHE.avgConsumption.set(key,result);
  return result;
}

/* =====================================================
   KPI CONTEXT — TODAY / YESTERDAY / 7-DAY AVG / LAST MONTH
   Uses only the small date slices needed for comparison and
   reuses the historical data already loaded by the dashboard.
===================================================== */
function cmpAnchorDate(){return dateOnly(effectiveViewDate()||DATA.report_date||"");}
function cmpDateShift(d,days){const x=new Date(d+"T00:00:00");x.setDate(x.getDate()+days);return x.toISOString().slice(0,10);}
function cmpMonthStart(d){return d.slice(0,7)+"-01";}
function cmpPrevMonth(d){const x=new Date(d+"T00:00:00");x.setDate(1);x.setMonth(x.getMonth()-1);return x.toISOString().slice(0,7);}
function cmpPrevMonthLastDate(rows,d){
  const pm=cmpPrevMonth(d); const dates=rows.map(r=>dateOnly(r.report_date||r.Report_Date||r.date)).filter(x=>x&&x.slice(0,7)===pm).sort();
  return dates.length?dates[dates.length-1]:"";
}
function cmpPct(a,b){return a===null||b===null||b===0?null:((a-b)/Math.abs(b))*100;}
function cmpLine(value,avg){
  const pct=cmpPct(value,avg);
  if(pct===null)return {text:"Compare",cls:"neutral"};
  const arrow=pct>0.05?"↑":pct<-0.05?"↓":"•";
  const cls=pct>0.05?"up":pct<-0.05?"down":"neutral";
  return {text:`${arrow} ${Math.abs(pct)<0.05?"0.0":fmt(Math.abs(pct))}% vs 7-day avg`,cls};
}
function cmpDailyFromMap(map,anchor){
  const vals=[];
  for(let i=1;i<=7;i++){
    const d=cmpDateShift(anchor,-i),v=map.get(d);
    if(v!==undefined&&v!==null&&Number.isFinite(v))vals.push(v);
  }
  const avg=vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
  return {yesterday:map.get(cmpDateShift(anchor,-1))??null,avg};
}
function cmpFeedDailyMap(key){
  const map=new Map();
  uniqueDatedProductRows(DATA.feedUnitData||[],r=>r.Product||r.product,r=>r.report_date||r.Report_Date||r.date||r.DATE).forEach(r=>{
    const d=dateOnly(r.report_date||r.Report_Date||r.date||r.DATE);if(!d)return;
    const p=clean(r.Product||r.product);if(!p||dcIsHiddenProduct(p))return;
    const v=feedValueInMT(feedField(r,key),p);
    if(v!==null&&v>=0)map.set(d,(map.get(d)||0)+v);
  });
  return map;
}
function cmpFeedClosingMap(){
  const map=new Map();
  uniqueDatedProductRows(DATA.feedUnitData||[],r=>r.Product||r.product,r=>r.report_date||r.Report_Date||r.date||r.DATE).forEach(r=>{
    const d=dateOnly(r.report_date||r.Report_Date||r.date||r.DATE);if(!d)return;
    const p=clean(r.Product||r.product);if(!p||dcIsHiddenProduct(p))return;
    const v=num(r.Closing_Day_MT??r.closing_day_mt??r.Closing_Day??r.closing_day??r.Closing??r.closing);
    if(v!==null&&v>=0)map.set(d,(map.get(d)||0)+feedValueInMT(v,p));
  });
  return map;
}
function cmpStockMovementMap(types){
  const set=new Set(types.map(normalize)),map=new Map();
  (DATA.stockHistory||[]).forEach(t=>{
    const m=clean(t.material);if(!m||dcIsHiddenMaterial(m))return;
    const ty=tType(t);if(![...set].some(x=>x==="CONSUMPTION"?isConsumptionMovement(ty):(ty===x||ty.includes(x))))return;
    const d=dateOnly(rowDate(t));if(!d)return;
    const v=materialValueInMT(tVal(t),m);if(v===null||v<0)return;
    map.set(d,(map.get(d)||0)+v);
  });
  return map;
}
function cmpStockClosingMap(){
  const map=new Map();
  (DATA.stockHistory||[]).forEach(t=>{
    const m=clean(t.material);if(!m||dcIsHiddenMaterial(m)||tType(t)!=="CL. STOCK")return;
    const d=dateOnly(rowDate(t));if(!d)return;
    const v=materialValueInMT(tVal(t),m);if(v===null||v<0)return;
    map.set(d,(map.get(d)||0)+v);
  });
  return map;
}
function cmpLastMonthFromFeedTotals(field,anchor){
  const rows=(DATA.feedUnitTotals||[]).filter(r=>dateOnly(r.report_date||r.Report_Date||r.date||r.DATE));
  const d=cmpPrevMonthLastDate(rows,anchor);if(!d)return null;
  const row=rows.filter(r=>dateOnly(r.report_date||r.Report_Date||r.date||r.DATE)===d).sort((a,b)=>String(a.imported_at||"").localeCompare(String(b.imported_at||""))).pop();
  const v=num(row?.[field]);return v!==null&&v>=0?v:null;
}
function cmpLastMonthFromStock(fieldTypes,field,anchor){
  const rows=(DATA.stockHistory||[]).filter(t=>fieldTypes.some(x=>x==="CONSUMPTION"?isConsumptionMovement(tType(t)):tType(t)===x));
  const d=cmpPrevMonthLastDate(rows,anchor);if(!d)return null;
  let total=0,found=false;
  rows.filter(t=>dateOnly(rowDate(t))===d).forEach(t=>{
    const m=clean(t.material);if(!m||dcIsHiddenMaterial(m))return;
    const raw=num(t[field]);if(raw!==null&&raw>=0){total+=materialValueInMT(raw,m);found=true;}
  });
  return found?total:null;
}
function cmpLastMonthClosing(map,anchor){
  const rows=[...map.entries()].filter(([d])=>d.slice(0,7)===cmpPrevMonth(anchor)).sort((a,b)=>a[0].localeCompare(b[0]));
  return rows.length?rows[rows.length-1][1]:null;
}
function cmpPayload(kind){
  const anchor=cmpAnchorDate(); if(!anchor)return null;
  let today=null,lastMonth=null,map=null,unit="";
  if(kind==="production"){
    map=cmpFeedDailyMap("Production_Day_MT"); today=map.get(anchor)??null;lastMonth=cmpLastMonthFromFeedTotals("production_month_mt",anchor);unit="MT";
  }else if(kind==="dispatch"){
    map=cmpFeedDailyMap("Dispatch_Day_MT"); today=map.get(anchor)??null;lastMonth=cmpLastMonthFromFeedTotals("dispatch_month_mt",anchor);unit="MT";
  }else if(kind==="received"){
    map=cmpStockMovementMap(["PURCHASE","RECEIVED","TRANSFER FROM"]);today=map.get(anchor)??null;lastMonth=cmpLastMonthFromStock(["PURCHASE","RECEIVED","TRANSFER FROM"],"for_month",anchor);unit="MT";
  }else if(kind==="consumption"){
    map=cmpStockMovementMap(["CONSUMPTION"]);today=map.get(anchor)??null;lastMonth=cmpLastMonthFromStock(["CONSUMPTION"],"for_month",anchor);unit="MT";
  }else if(kind==="rmClosing"){
    map=cmpStockClosingMap();today=map.get(anchor)??null;lastMonth=cmpLastMonthClosing(map,anchor);unit="MT";
  }else if(kind==="feedClosing"){
    map=cmpFeedClosingMap();today=map.get(anchor)??null;lastMonth=cmpLastMonthClosing(map,anchor);unit="MT";
  }else if(kind==="productionBags"){
    map=new Map();(DATA.productionHistory||[]).forEach(r=>{const d=dateOnly(r.report_date||r.Report_Date||r.date);const v=num(r.actual_output);if(d&&v!==null&&v>=0)map.set(d,(map.get(d)||0)+v)});today=map.get(anchor)??null;lastMonth=cmpLastMonthClosing(map,anchor);unit="Bags";
  }
  if(!map||today===null)return {today,lastMonth,unit,yesterday:null,avg:null,pct:null};
  const d=cmpDailyFromMap(map,anchor);return {today,lastMonth,unit,yesterday:d.yesterday,avg:d.avg,pct:cmpPct(today,d.avg)};
}
function fmtCmp(v,unit){return v===null||v===undefined?"—":unit==="MT"?fmtMT(v):fmtBags(v);}
function openComparison(kind){
  const c=cmpPayload(kind);if(!c)return;
  const labels={production:"🏭 Production",dispatch:"🚚 Dispatch",received:"📥 RM Received",consumption:"📤 RM Consumption",rmClosing:"📦 RM Closing",feedClosing:"🌾 Feed Closing",productionBags:"🏭 Production Output"};
  const delta=c.pct===null?"—":`${c.pct>=0?"↑":"↓"} ${fmt(Math.abs(c.pct))}% vs 7-day avg`;
  showModal(labels[kind]||"Comparison",`<div class="compare-summary"><strong>${fmtCmp(c.today,c.unit)}</strong><span>${esc(delta)}</span></div><div class="compare-grid"><div><small>Today</small><b>${fmtCmp(c.today,c.unit)}</b></div><div><small>Yesterday</small><b>${fmtCmp(c.yesterday,c.unit)}</b></div><div><small>7-Day Avg</small><b>${fmtCmp(c.avg,c.unit)}</b></div><div><small>Last Month</small><b>${fmtCmp(c.lastMonth,c.unit)}</b></div></div><div class="compare-note">Last Month uses the previous calendar month's direct total/end value; no daily month average is calculated.</div>`);
}
function renderComparisonLine(id,kind){
  const el=document.getElementById(id);if(!el)return;
  const c=cmpPayload(kind);if(!c||c.today===null||c.avg===null){el.textContent="Compare";el.className="quick-context neutral";return;}
  const line=cmpLine(c.today,c.avg);el.textContent=line.text;el.className=`quick-context ${line.cls}`;
}

function renderQuick(){
  const pd=latestTotal("Production_Day_MT"),pm=latestTotal("Production_Month_MT");
  const dd=latestTotal("Dispatch_Day_MT"),dm=latestTotal("Dispatch_Month_MT");
  setText("qProdDay",fmtMT(pd));setText("qProdMonth",fmtMT(pm));setText("qDispDay",fmtMT(dd));setText("qDispMonth",fmtMT(dm));
  let received=0,cons=0,closing=0;
  const quickDate=effectiveViewDate()||latestStockDataDate();
  viewStockRows().forEach(x=>{
    const material=x.material||"";
    if(x.closing!==null)closing+=materialValueInMT(x.closing,material);
    (x.transactions||[]).filter(t=>!quickDate || dateOnly(rowDate(t))===quickDate).forEach(t=>{
      const ty=tType(t),v=materialValueInMT(tVal(t),material);
      if(ty==="PURCHASE"||ty==="RECEIVED"||ty.includes("TRANSFER FROM"))received+=v;
      if(isConsumptionMovement(ty))cons+=v;
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
  renderComparisonLine("ctxProdDay","production");
  renderComparisonLine("ctxDispDay","dispatch");
  renderComparisonLine("ctxReceived","received");
  renderComparisonLine("ctxConsumption","consumption");
  renderComparisonLine("ctxClosing","rmClosing");
  renderComparisonLine("ctxFeedClosing","feedClosing");
  renderComparisonLine("ctxProductionMain","productionBags");

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
  if(!el)return;
  const uniqueRows=latestUniqueRows(rows,r=>r.product||"PP Bags");
  const sorted=uniqueRows.slice().sort((a,b)=>(num(b.closing)||0)-(num(a.closing)||0));
  el.innerHTML=sorted.map(r=>{
    const p=r.product||"PP Bags";
    const opening=num(r.opening)||0, received=num(r.received)||0, issue=num(r.issue)||0, damage=num(r.damage)||0, closing=num(r.closing)||0;
    const rec=ppBagReconciliation(p);
    const status=rec.status==="MISMATCH"?"CHECK":(damage>0?"DAMAGE":"OK");
    const statusCls=status.toLowerCase();
    const statusIcon=status==="CHECK"?"⚠":(status==="DAMAGE"?"🟠":"✓");
    return `<div class="pp-item pp-status-${statusCls}" role="button" tabindex="0" onclick="openBagProduct('${jsq(p)}')" onkeydown="if(event.key==='Enter'||event.key===' ')openBagProduct('${jsq(p)}')">
      <div class="pp-card-head"><p title="${esc(p)}">${esc(p)}</p><span class="pp-status ${statusCls}" title="${status}">${statusIcon}</span></div>
      <div class="pp-metrics">
        <span><b>Open</b><strong>${fmt(opening)}</strong></span>
        <span><b>Recv</b><strong>${fmt(received)}</strong></span>
        <span><b>Issue</b><strong>${fmt(issue)}</strong></span>
        <span><b>Damage</b><strong>${fmt(damage)}</strong></span>
        <span class="pp-closing"><b>Close</b><strong>${fmt(closing)}</strong></span>
      </div>
    </div>`;
  }).join("")||"<div class='empty'>No PP Bag data for this date</div>";
}
function renderStock(){
  const list=document.getElementById("stockList"),premixList=document.getElementById("premixStockList"),mats=getMaterials();
  const renderRows=(rows)=>rows.slice().sort((a,b)=>{const av=num(getMaterial(a)?.closing)||0,bv=num(getMaterial(b)?.closing)||0;return (bv>0)-(av>0)||bv-av;}).map(m=>{
    const x=getMaterial(m),closing=num(x?.closing)||0,avg=avgConsumption(m),st=stockStatus(closing,avg),unit=materialUnit(m,x?.unit||"MT");
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
function weightedOutputPercentage(rows){
  const source=Array.isArray(rows)?rows:[];
  let actualTotal=0,standardTotal=0;
  source.forEach(r=>{
    const actual=num(r.actual_output??r.Actual_Output),standard=num(r.standard_output??r.Standard_Output);
    if(actual!==null&&standard!==null&&actual>=0&&standard>0){actualTotal+=actual;standardTotal+=standard;}
  });
  if(standardTotal>0)return actualTotal/standardTotal*100;
  const reported=source.map(r=>num(r.output_percentage??r.Output_Percentage)).filter(v=>v!==null);
  return reported.length?reported.reduce((a,b)=>a+b,0)/reported.length:null;
}
function dailyControlMetrics(){
  const reorder=getMaterials().filter(m=>stockStatus(num(getMaterial(m)?.closing)||0,avgConsumption(m)).status==="REORDER").length;
  const mismatches=reconciliationItems().filter(x=>x.r.status==="MISMATCH").length;
  const abnormal=abnormalConsumptionItems().length;
  const rows=selectedProduction(),outs=rows.map(r=>num(r.output_percentage)).filter(v=>v!==null),losses=rows.map(r=>num(r.process_loss)).filter(v=>v!==null);
  const premix=premixBommakalTransfers().reduce((a,r)=>a+r.value,0)/1000;
  const damage=selectedBags().reduce((a,r)=>a+(num(r.damage)||0),0);
  return {reorder,mismatches,abnormal,efficiency:weightedOutputPercentage(rows),loss:losses.length?losses.reduce((a,b)=>a+b,0)/losses.length:null,premix,damage};
}
function currentViewKey(){return VIEW_DATE?dateOnly(VIEW_DATE):dateOnly(DATA.report_date)||"latest"}
function allAvailableDates(){return getAvailableDates()}
function feedRowsForDate(d){
  return uniqueDatedProductRows((DATA.feedUnitData||[]).filter(r=>dateOnly(r.Report_Date||r.report_date)===dateOnly(d)),r=>r.Product||r.product,r=>r.Report_Date||r.report_date);
}
function dateFeedMetrics(d){
  const rows=feedRowsForDate(d);
  return {
    production:rows.reduce((a,r)=>a+feedValueInMT(feedField(r,"Production_Day_MT"),r.Product||r.product),0),
    dispatch:rows.reduce((a,r)=>a+feedValueInMT(feedField(r,"Dispatch_Day_MT"),r.Product||r.product),0),
    closing:rows.reduce((a,r)=>a+feedValueInMT(num(r.Closing_Day_MT??r.closing_day_mt??r.Closing_Day??r.closing_day??r.Closing??r.closing),r.Product||r.product),0),
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
  DATA.production.forEach(r=>{
    const op=num(r.output_percentage);
    if(op!==null&&op<95){
      items.push({level:"warning",title:r.product||"Production",msg:`Output ${fmt(op)}% • below 95% target`,action:`openProductionDetails('${jsq(r.product||"")}')`});
    }
  });
  getMaterials().forEach(m=>{
    const closing=num(getMaterial(m)?.closing);
    if(closing!==null&&closing<0){
      items.push({level:"critical",title:m,msg:`Negative closing stock: ${fmt(closing)} ${materialUnit(m,getMaterial(m)?.unit||"MT")}`,action:`openMaterialDetails('${jsq(m)}')`});
    }
  });
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
  invalidatePerfCache();
  closeModal();
  renderDashboard();
  renderTrends();
  showToast(VIEW_DATE?`Dashboard set to ${VIEW_DATE}`:"Dashboard set to latest");
}
function getAvailableDates(){
  if(PERF_CACHE.availableDates)return PERF_CACHE.availableDates;
  const s=new Set();
  (DATA.stockHistory||[]).forEach(t=>{const d=dateOnly(rowDate(t));if(d)s.add(d)});
  (DATA.stock||[]).forEach(x=>(x.transactions||[]).forEach(t=>{const d=dateOnly(rowDate(t));if(d)s.add(d)}));
  (DATA.production||[]).forEach(r=>{const d=dateOnly(r.report_date||r.Report_Date);if(d)s.add(d)});
  (DATA.bags||[]).forEach(r=>{const d=dateOnly(r.report_date||r.Report_Date);if(d)s.add(d)});
  (DATA.feedUnitData||[]).forEach(r=>{const d=dateOnly(r.Report_Date||r.report_date);if(d)s.add(d)});
  if(DATA.report_date)s.add(dateOnly(DATA.report_date));
  PERF_CACHE.availableDates=[...s].filter(Boolean).sort().reverse();
  return PERF_CACHE.availableDates;
}
function openDateSelector(){
  const dates=getAvailableDates();
  const buttons=(VIEW_DATE?`<button class="date-btn" onclick="setViewDate(null)"><strong>Latest / Today</strong><small>Return to latest dashboard</small></button>`:"")+dates.map(d=>`<button class="date-btn" onclick="setViewDate('${jsq(d)}')"><strong>${esc(d)}</strong><small>${d===dateOnly(DATA.report_date)?"Latest API date":"View complete dashboard →"}</small></button>`).join("");
  showModal("Date Selector",`<div class="detail-section"><h3>📅 Dashboard Date</h3><div class="small-note">Selecting a date now changes the entire dashboard, not just the summary popup.</div><div class="date-list">${buttons||"<div class='empty'>No dated records available.</div>"}</div></div>`);
}




function renderTrendAlerts(){
  const root=document.getElementById("trendAlerts");if(!root)return;
  // Feed production is measured in MT; PRODUCTION_DATA actual_output is bag count.
  // Keep volume trends and production-quality percentages on their correct sources.
  const byDate={};
  (Array.isArray(DATA.feedUnitData)?DATA.feedUnitData:[]).filter(r=>!dcIsHiddenProduct(r.product||r.Product)).forEach(r=>{
    const d=dateOnly(r.report_date||r.Report_Date||r.date);if(!d||!trendDateInRange(d))return;
    const value=feedField(r,"Production_Day_MT");if(value===null)return;
    const x=byDate[d]||(byDate[d]={production:0,productionCount:0,outputSum:0,outputCount:0,lossSum:0,lossCount:0});
    x.production+=feedValueInMT(value,r.Product||r.product);x.productionCount++;
  });
  const qualityRows=(Array.isArray(DATA.productionHistory)&&DATA.productionHistory.length?DATA.productionHistory:DATA.production||[]).filter(r=>!dcIsHiddenProduct(r.product||r.Product));
  qualityRows.forEach(r=>{
    const d=dateOnly(r.report_date||r.Report_Date||r.date);if(!d||!trendDateInRange(d))return;
    const x=byDate[d]||(byDate[d]={production:0,productionCount:0,outputSum:0,outputCount:0,lossSum:0,lossCount:0});
    const o=num(r.output_percentage??r.outputPercent),l=num(r.process_loss??r.processLoss);
    if(o!==null){x.outputSum+=o;x.outputCount++;}
    if(l!==null){x.lossSum+=l;x.lossCount++;}
  });
  const dates=Object.keys(byDate).sort();
  const alerts=[];
  dates.forEach((d,i)=>{
    const cur=byDate[d];
    if(i<5)return;
    const prev=dates.slice(Math.max(0,i-7),i).map(k=>byDate[k]);
    if(prev.length<5)return;
    const prodVals=prev.filter(x=>x.productionCount).map(x=>x.production);
    const outputVals=prev.filter(x=>x.outputCount).map(x=>x.outputSum/x.outputCount);
    const lossVals=prev.filter(x=>x.lossCount).map(x=>x.lossSum/x.lossCount);
    const prodAvg=prodVals.length?prodVals.reduce((a,b)=>a+b,0)/prodVals.length:null;
    const outputAvg=outputVals.length?outputVals.reduce((a,b)=>a+b,0)/outputVals.length:null;
    const lossAvg=lossVals.length?lossVals.reduce((a,b)=>a+b,0)/lossVals.length:null;
    if(cur.productionCount&&prodAvg>0&&cur.production<prodAvg*0.7)alerts.push({date:d,type:"warning",title:"Production dropped",detail:cur.production.toLocaleString("en-IN",{maximumFractionDigits:1})+" MT vs recent average "+prodAvg.toLocaleString("en-IN",{maximumFractionDigits:1})+" MT"});
    if(cur.outputCount&&outputAvg!==null&&(outputAvg-(cur.outputSum/cur.outputCount))>=3)alerts.push({date:d,type:"warning",title:"Output % fell",detail:(cur.outputSum/cur.outputCount).toFixed(1)+"% vs recent average "+outputAvg.toFixed(1)+"%"});
    if(cur.lossCount&&lossAvg!==null&&((cur.lossSum/cur.lossCount)-lossAvg)>=1)alerts.push({date:d,type:"danger",title:"Process loss increased",detail:(cur.lossSum/cur.lossCount).toFixed(2)+"% vs recent average "+lossAvg.toFixed(2)+"%"});
  });
  const recent=alerts.slice(-4).reverse();
  if(!dates.length){root.innerHTML='<div class="trend-alert-empty">No dated production history in the selected period.</div>';return;}
  if(!recent.length){root.innerHTML='<div class="trend-alert-empty"><strong>✓ No unusual production pattern detected</strong><span>Checks require at least 5 earlier dated records. This is an early-warning indicator, not a quality guarantee.</span></div>';return;}
  root.innerHTML='<div class="trend-alert-head"><strong>⚠ Trend Alerts</strong><span>Latest unusual changes</span></div><div class="trend-alert-list">'+recent.map(x=>'<div class="trend-alert-item '+x.type+'"><div><strong>'+esc(x.title)+'</strong><small>'+esc(x.date)+'</small></div><span>'+esc(x.detail)+'</span></div>').join("")+'</div><div class="trend-alert-foot">Volume compares feed-unit MT; output and process-loss percentages use production records. At least 5 earlier available dates required.</div>';
}

/* Trend charts use historical rows; the dashboard's selected date remains independent. */
function renderTrendOverview(){
  const feedRows=(Array.isArray(DATA.feedUnitData)?DATA.feedUnitData:[]).filter(r=>!dcIsHiddenProduct(clean(r.Product||r.product)));
  const qualityRows=(Array.isArray(DATA.productionHistory)&&DATA.productionHistory.length?DATA.productionHistory:DATA.production||[]).filter(r=>!dcIsHiddenProduct(r.product||r.Product));
  const range=trendDateBounds();
  const rowDateValue=r=>dateOnly(r.Report_Date||r.report_date||r.date||r.DATE);
  const selectedFeed=feedRows.filter(r=>{const d=rowDateValue(r);return d&&range.valid&&d>=range.from&&d<=range.to&&feedField(r,"Production_Day_MT")!==null;});
  const dates=[...new Set(selectedFeed.map(rowDateValue).filter(Boolean))].sort();
  const sum=selectedFeed.reduce((a,r)=>a+feedValueInMT(feedField(r,"Production_Day_MT"),r.Product||r.product),0);
  const selectedQuality=qualityRows.filter(r=>{const d=rowDateValue(r);return d&&range.valid&&d>=range.from&&d<=range.to;});
  const outputs=selectedQuality.map(r=>num(r.output_percentage??r.outputPercent)).filter(v=>v!==null);
  const losses=selectedQuality.map(r=>num(r.process_loss??r.processLoss)).filter(v=>v!==null);
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
  const fmtMetric=v=>v===null||v===undefined?"--":Number(v).toLocaleString("en-IN",{maximumFractionDigits:1});
  setText("trendKpiProduction",dates.length?fmtMetric(sum)+" MT":"--");
  setText("trendKpiProductionNote",dates.length?dates.length+" dated Feed Unit production days • "+dates[0]+" to "+dates[dates.length-1]:"No Feed Unit production data in this period");
  const outputAvg=avg(outputs),lossAvg=avg(losses);
  setText("trendKpiOutput",outputAvg===null?"--":fmtMetric(outputAvg)+"%");
  setText("trendKpiOutputNote",outputs.length?outputs.length+" reported output values":"No output percentage values");
  setText("trendKpiLoss",lossAvg===null?"--":fmtMetric(lossAvg)+"%");
  setText("trendKpiLossNote",losses.length?losses.length+" reported loss values":"No process loss values");
  const compare=document.getElementById("trendKpiCompare"),note=document.getElementById("trendKpiCompareNote");
  if(compare)compare.textContent="--";
  if(note)note.textContent="Needs both months' Feed Unit data";
  if(!dates.length||!compare||!note)return;
  const latest=dates[dates.length-1],latestDate=new Date(latest+"T12:00:00");
  const year=latestDate.getFullYear(),month=latestDate.getMonth(),day=latestDate.getDate();
  const currentStart=year+"-"+String(month+1).padStart(2,"0")+"-01";
  const prevLastDay=new Date(year,month,0).getDate(),compareDay=Math.min(day,prevLastDay);
  const prevStartDate=new Date(year,month-1,1);
  const prevStart=prevStartDate.getFullYear()+"-"+String(prevStartDate.getMonth()+1).padStart(2,"0")+"-01";
  const prevEnd=prevStartDate.getFullYear()+"-"+String(prevStartDate.getMonth()+1).padStart(2,"0")+"-"+String(compareDay).padStart(2,"0");
  const prodValue=r=>feedValueInMT(feedField(r,"Production_Day_MT"),r.Product||r.product);
  const currRows=feedRows.filter(r=>{const d=rowDateValue(r);return d&&d>=currentStart&&d<=latest&&feedField(r,"Production_Day_MT")!==null;});
  const prevRows=feedRows.filter(r=>{const d=rowDateValue(r);return d&&d>=prevStart&&d<=prevEnd&&feedField(r,"Production_Day_MT")!==null;});
  const currDates=new Set(currRows.map(rowDateValue)),prevDates=new Set(prevRows.map(rowDateValue));
  const currentTotal=currRows.reduce((a,r)=>a+prodValue(r),0),previousTotal=prevRows.reduce((a,r)=>a+prodValue(r),0);
  const currentLabel=latestDate.toLocaleDateString("en-IN",{month:"short",year:"numeric"});
  const previousLabel=prevStartDate.toLocaleDateString("en-IN",{month:"short",year:"numeric"});
  if(!currDates.size||!prevDates.size||currDates.size<Math.min(compareDay,3)||prevDates.size<Math.min(compareDay,3)){
    note.textContent=currentLabel+" vs "+previousLabel+" • not enough comparable Feed Unit daily history";return;
  }
  if(previousTotal===0){note.textContent=currentLabel+" vs "+previousLabel+" • previous total is zero; percentage change unavailable";return;}
  const change=(currentTotal-previousTotal)/previousTotal*100;
  compare.textContent=(change>0?"+":"")+fmtMetric(change)+"%";
  compare.classList.toggle("is-positive",change>0);compare.classList.toggle("is-negative",change<0);
  note.textContent=currentLabel+" MTD vs "+previousLabel+" same "+compareDay+" calendar days • "+fmtMetric(currentTotal)+" vs "+fmtMetric(previousTotal)+" MT";
}
function renderTrends(){
  updateTrendRangeLabel();
  renderTrendAlerts();
  renderTrendOverview();
  const sel=document.getElementById("materialSelect"),mats=getMaterials();
  if(sel)sel.innerHTML=mats.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join("");
  if(mats.length)drawMaterialChart(sel?.value||mats[0]);
  // Production chart uses FEED UNIT tonnes; PRODUCTION_DATA actual_output is bag-count data.
  const feedProductionRows=uniqueDatedProductRows((Array.isArray(DATA.feedUnitData)?DATA.feedUnitData:[]).filter(r=>!dcIsHiddenProduct(clean(r.Product||r.product))),r=>r.Product||r.product,r=>r.Report_Date||r.report_date||r.date||r.DATE);
  const byDate={};
  feedProductionRows.forEach(r=>{
    const d=dateOnly(r.Report_Date||r.report_date||r.date||r.DATE);if(!trendDateInRange(d))return;
    const rawProduction=feedField(r,"Production_Day_MT");if(rawProduction===null)return;
    const production=feedValueInMT(rawProduction,r.Product||r.product);
    const item=byDate[d]||(byDate[d]={production:0,productionCount:0});item.production+=production;item.productionCount++;
  });
  const qualityRows=(Array.isArray(DATA.productionHistory)&&DATA.productionHistory.length?DATA.productionHistory:DATA.production||[]).filter(r=>!dcIsHiddenProduct(r.product||r.Product));
  const qualityByDate={};
  qualityRows.forEach(r=>{
    const d=dateOnly(r.report_date||r.Report_Date||r.date);if(!trendDateInRange(d))return;
    const item=qualityByDate[d]||(qualityByDate[d]={outputSum:0,outputCount:0,lossSum:0,lossCount:0});
    const output=num(r.output_percentage??r.outputPercent);if(output!==null){item.outputSum+=output;item.outputCount++;}
    const loss=num(r.process_loss??r.processLoss);if(loss!==null){item.lossSum+=loss;item.lossCount++;}
  });
  const dates=Object.keys(byDate).sort(),qualityDates=Object.keys(qualityByDate).sort();
  chart("productionChart",dates,dates.map(d=>byDate[d].productionCount?byDate[d].production:null));
  chart("outputChart",qualityDates,qualityDates.map(d=>qualityByDate[d].outputCount?qualityByDate[d].outputSum/qualityByDate[d].outputCount:null));
  chart("lossChart",qualityDates,qualityDates.map(d=>qualityByDate[d].lossCount?qualityByDate[d].lossSum/qualityByDate[d].lossCount:null));
  const purchase=trendFromTransactions("PURCHASE");chart("purchaseChart",purchase.labels,purchase.values);
  const closing=trendClosing();chart("closingChart",closing.labels,closing.values);
  const feed=feedTrend();chart("feedChart",feed.labels,feed.values);
  const bags=bagTrend();chart("bagChart",bags.labels,bags.values);
  const wrap=document.getElementById("trendWrapper"),dots=document.getElementById("trendDots");
  if(wrap&&dots){dots.innerHTML=[...wrap.children].map((_,i)=>`<div class="dot ${i===0?"active":""}"></div>`).join("");
    wrap.onscroll=function(){const i=Math.round(this.scrollLeft/Math.max(1,this.clientWidth));[...dots.children].forEach((d,j)=>d.classList.toggle("active",i===j))};}
}
function feedTrend(){
  const rows=uniqueDatedProductRows((Array.isArray(DATA.feedUnitData)?DATA.feedUnitData:[]).filter(r=>!dcIsHiddenProduct(clean(r.Product||r.product))),r=>r.Product||r.product,r=>r.Report_Date||r.report_date||r.date||r.DATE);
  const map={};
  rows.forEach(r=>{
    const d=dateOnly(r.Report_Date||r.report_date||r.date||r.DATE);if(!trendDateInRange(d))return;
    const item=map[d]||(map[d]={production:0,productionCount:0,dispatch:0,dispatchCount:0});
    const production=feedField(r,"Production_Day_MT"),dispatch=feedField(r,"Dispatch_Day_MT");
    if(production!==null){item.production+=feedValueInMT(production,r.Product||r.product);item.productionCount++;}
    if(dispatch!==null){item.dispatch+=feedValueInMT(dispatch,r.Product||r.product);item.dispatchCount++;}
  });
  const labels=Object.keys(map).sort();
  return {labels,values:labels.map(d=>map[d].productionCount&&map[d].dispatchCount?map[d].production-map[d].dispatch:null)};
}
function bagTrend(){
  const rows=(Array.isArray(DATA.bagsHistory)&&DATA.bagsHistory.length?DATA.bagsHistory:DATA.bags||[]).filter(r=>!dcIsHiddenProduct(r.product||r.Product));
  const map={};
  rows.forEach(r=>{
    const d=dateOnly(r.report_date||r.Report_Date||r.date);if(!trendDateInRange(d))return;
    const item=map[d]||(map[d]={issue:0,issueCount:0,damage:0,damageCount:0});
    const issue=num(r.issue??r.Issue),damage=num(r.damage??r.Damage);
    if(issue!==null){item.issue+=issue;item.issueCount++;}
    if(damage!==null){item.damage+=damage;item.damageCount++;}
  });
  const labels=Object.keys(map).sort();
  return {labels,values:labels.map(d=>(map[d].issueCount||map[d].damageCount)?(map[d].issueCount?map[d].issue:0)+(map[d].damageCount?map[d].damage:0):null)};
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
let spareStockExpanded=false;

function spareVal(row, keys){
  for(const k of keys){ if(row && row[k]!==undefined && row[k]!==null && row[k]!=="") return row[k]; }
  return "";
}
function spareText(v){return clean(v);}
function setSpareTab(btn,tab){
  document.querySelectorAll('.spare-tabs button').forEach(x=>x.classList.remove('active'));
  if(btn)btn.classList.add('active');
  spareTab=tab;
  spareStockExpanded=false;
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
    const showAll = spareStockExpanded || !!q;
    const visible = showAll ? filtered : filtered.slice(0,2);
    const cards = visible.map(r=>{
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
    const more = filtered.length > 2 && !q ? `<button class="spare-view-more-btn" onclick="toggleSpareStock()">${spareStockExpanded?'⌃ Show less':'⌄ View details • '+(filtered.length-2)+' more'}</button>` : '';
    el.innerHTML=cards+more;
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
function toggleSpareStock(){
  spareStockExpanded=!spareStockExpanded;
  renderSpareParts(document.getElementById('spareSearch')?.value||'');
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
   RECORDS INTELLIGENCE — READ-ONLY ADDITION INSIDE SPARES
   Reads the signed-in user's saved maintenance/order records.
   Does not change records.html or write to any source table.
===================================================== */
let spareRecordsClient=null;
function getSpareRecordsClient(){
  if(spareRecordsClient)return spareRecordsClient;
  if(!window.supabase||!window.supabase.createClient)return null;
  spareRecordsClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
  return spareRecordsClient;
}
function insightDate(row,kind){
  return String(kind==='maintenance'?(row.activity_date||row.created_at||''):(row.order_date||row.created_at||'')).slice(0,10);
}
function insightIssueKey(row){
  const machine=String(row.machine||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const desc=String(row.work_description||'').toLowerCase()
    .replace(/\b\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\b/g,' ')
    .replace(/\b\d+(?:\.\d+)?\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');
  if(!desc||desc.length<8||/^(maintenance|work done|routine check|ok|completed)$/.test(desc))return '';
  return machine+' | '+desc;
}
function insightOrderLabel(row){
  return String(row.item||row.vendor||row.category||'Spare part order').trim();
}
function renderSpareRecordInsights(maintenance,orders){
  const host=document.getElementById('spareRecordInsightBody');if(!host)return;
  const machineNames=new Set(maintenance.map(r=>String(r.machine||'').trim()).filter(x=>x&&x.toLowerCase()!=='needs review'));
  const issueMap=new Map();
  maintenance.forEach(r=>{const key=insightIssueKey(r);if(!key)return;const current=issueMap.get(key)||{key,machine:String(r.machine||'Unknown'),description:String(r.work_description||''),count:0,lastDate:''};current.count++;const d=insightDate(r,'maintenance');if(d>current.lastDate)current.lastDate=d;issueMap.set(key,current);});
  const repeats=[...issueMap.values()].filter(x=>x.count>1).sort((a,b)=>b.count-a.count||b.lastDate.localeCompare(a.lastDate)).slice(0,5);
  const statusMap={};orders.forEach(r=>{const s=String(r.status||'Unknown').trim()||'Unknown';statusMap[s]=(statusMap[s]||0)+1;});
  const pending=orders.filter(r=>/pending|ordered|confirmed|partially received/i.test(String(r.status||''))).length;
  const recentM=[...maintenance].sort((a,b)=>insightDate(b,'maintenance').localeCompare(insightDate(a,'maintenance'))).slice(0,4);
  const recentO=[...orders].sort((a,b)=>insightDate(b,'order').localeCompare(insightDate(a,'order'))).slice(0,4);
  const metric=(label,value,sub,target)=>'<button type="button" class="spare-insight-metric" aria-label="View '+esc(label)+' details" onclick="focusSpareInsight(\''+target+'\')"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(sub)+'</small><em>Tap to view details ↗</em></button>';
  const repeatHtml=repeats.length?repeats.map(x=>'<div class="spare-insight-row"><div><strong>'+esc(x.machine||'Unknown machine')+'</strong><small>'+esc(x.description)+'</small></div><span class="spare-insight-count">'+x.count+'×</span></div>').join(''):'<div class="spare-insight-empty">No exact repeated maintenance descriptions detected in the loaded records.</div>';
  const orderHtml=recentO.length?recentO.map(r=>'<div class="spare-insight-row"><div><strong>'+esc(insightOrderLabel(r))+'</strong><small>'+esc([r.quantity?'Qty '+r.quantity:'',r.vendor||'',insightDate(r,'order')].filter(Boolean).join(' · '))+'</small></div><span class="spare-insight-status">'+esc(r.status||'Status not set')+'</span></div>').join(''):'<div class="spare-insight-empty">No saved spare-parts orders found.</div>';
  const maintenanceHtml=recentM.length?recentM.map(r=>'<div class="spare-insight-row"><div><strong>'+esc(r.machine||'Machine not set')+'</strong><small>'+esc(r.work_description||'')+'</small></div><span class="spare-insight-status">'+esc(insightDate(r,'maintenance'))+'</span></div>').join(''):'<div class="spare-insight-empty">No saved maintenance records found.</div>';
  host.innerHTML='<div class="spare-insight-metrics">'+metric('Maintenance records',maintenance.length,'Saved history','recent-maintenance')+metric('Machines recorded',machineNames.size,'Distinct machine names','recent-maintenance')+metric('Spare orders',orders.length,'Saved order items','recent-orders')+metric('Repeat patterns',repeats.length,'Exact description matches','repeat-maintenance')+'</div>'+
    '<div class="spare-insight-columns"><div class="spare-insight-block" id="spareInsight-repeat-maintenance"><h3>🔁 Repeated maintenance</h3>'+repeatHtml+'</div><div class="spare-insight-block" id="spareInsight-recent-orders"><h3>📦 Recent spare orders</h3>'+orderHtml+'</div><div class="spare-insight-block" id="spareInsight-recent-maintenance"><h3>🛠 Recent maintenance</h3>'+maintenanceHtml+'</div><div class="spare-insight-block" id="spareInsight-order-status"><h3>📍 Order status summary</h3><div class="spare-insight-statuses">'+(Object.keys(statusMap).length?Object.entries(statusMap).map(([s,n])=>'<span>'+esc(s)+': <strong>'+n+'</strong></span>').join(''):'<span>No order statuses recorded</span>')+'</div><small class="spare-insight-foot">Status counts reflect saved records; verify order status in Records when needed.</small></div></div>';
}
function focusSpareInsight(section){
  const ids={'repeat-maintenance':'spareInsight-repeat-maintenance','recent-orders':'spareInsight-recent-orders','recent-maintenance':'spareInsight-recent-maintenance','order-status':'spareInsight-order-status'};
  const target=document.getElementById(ids[section]||'');
  if(!target)return;
  target.scrollIntoView({behavior:'smooth',block:'center'});
  target.classList.remove('spare-insight-focus');
  void target.offsetWidth;
  target.classList.add('spare-insight-focus');
  window.setTimeout(()=>target.classList.remove('spare-insight-focus'),1600);
}
function toggleSpareRecordInsights(){
  const panel=document.getElementById('spareRecordInsights');
  const btn=document.getElementById('spareInsightsViewBtn');
  if(!panel||!btn)return;
  const opening=panel.hidden;
  panel.hidden=!opening;
  btn.setAttribute('aria-expanded',String(opening));
  btn.innerHTML=opening?'✕ Hide Insights':'👁 View Insights';
  if(opening)loadSpareRecordInsights(false);
}
async function loadSpareRecordInsights(showMessage=false){
  const host=document.getElementById('spareRecordInsightBody');if(!host)return;
  host.innerHTML='<div class="empty">Loading saved maintenance and order insights...</div>';
  try{
    const client=getSpareRecordsClient();
    if(!client){host.innerHTML='<div class="spare-insight-empty">Could not load the records service. <a href="./records.html">Open Records</a>.</div>';return;}
    const {data:sessionData,error:sessionError}=await client.auth.getSession();
    if(sessionError)throw sessionError;
    const session=sessionData&&sessionData.session;
    if(!session||!session.user){host.innerHTML='<div class="spare-insight-empty">Sign in to <a href="./records.html">Records</a> once on this browser, then return here and tap Update. Your records stay private to your account.</div>';return;}
    const uid=session.user.id;
    const [m,o]=await Promise.all([
      client.from('maintenance_log').select('activity_date,machine,line,work_description,maintenance_type,activity_category,status,created_at').eq('user_id',uid).order('activity_date',{ascending:false}).limit(1000),
      client.from('plant_order_history').select('order_date,item,quantity,vendor,category,status,notes,message,created_at').eq('user_id',uid).order('order_date',{ascending:false}).limit(1000)
    ]);
    if(m.error)throw m.error;if(o.error)throw o.error;
    renderSpareRecordInsights(m.data||[],o.data||[]);
    if(showMessage)showToast('Maintenance & order insights updated');
  }catch(error){
    console.error('Records insights:',error);
    host.innerHTML='<div class="spare-insight-empty">Could not load saved Records data. Open Records and confirm you are signed in, then tap Update. <small>'+esc(error.message||'Connection error')+'</small></div>';
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
let reportActiveView='';
function initReportCenter(){
  const all=reportAllDates();
  const f=document.getElementById('reportFromDate'),t=document.getElementById('reportToDate');
  if(all.length){
    if(f&&!f.value)f.value=all[Math.max(0,all.length-7)];
    if(t&&!t.value)t.value=all[all.length-1];
  }
  f?.addEventListener('change',()=>{if(reportActiveView)refreshReportPreview()});
  t?.addEventListener('change',()=>{if(reportActiveView)refreshReportPreview()});
}
function resetReportDates(){
  const all=reportAllDates();const f=document.getElementById('reportFromDate'),t=document.getElementById('reportToDate');
  if(f)f.value=all[Math.max(0,all.length-7)]||'';if(t)t.value=all[all.length-1]||'';
  if(reportActiveView)refreshReportPreview();
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
    else if(isConsumptionMovement(ty))r.Consumption+=v;
    else if(ty.includes('TRANSFER'))r.Transfer+=v;
    if(ty==='CL. STOCK')r.Closing=v;
  });
  if(!map.size){
    (DATA.stock||[]).forEach(x=>(x.transactions||[]).forEach(t=>{
      const d=reportDate(rowDate(t)),m=clean(x.material||t.material);if(!m||!reportInRange(d,from,to))return;
      const k=key(d,m);if(!map.has(k))map.set(k,{Date:d,Material:m,Unit:materialUnit(m),Received:0,Consumption:0,Transfer:0,Closing:null});
      const r=map.get(k),ty=tType(t),v=tVal(t);if(ty==='PURCHASE'||ty==='RECEIVED')r.Received+=v;else if(isConsumptionMovement(ty))r.Consumption+=v;else if(ty.includes('TRANSFER'))r.Transfer+=v;if(ty==='CL. STOCK')r.Closing=v;
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
/* =====================================================
   REPORT LIBRARIES — LOAD ONLY WHEN A USER EXPORTS
===================================================== */
const REPORT_LIBRARY_URLS={
  jspdf:"https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
  autotable:"https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.4/dist/jspdf.plugin.autotable.min.js",
  xlsx:"https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"
};
const REPORT_LIBRARY_PROMISES={};
function loadReportScript(name){
  const ready= name==="jspdf" ? !!(window.jspdf&&window.jspdf.jsPDF)
    : name==="autotable" ? !!(window.jspdf&&window.jspdf.jsPDF&&window.jspdf.jsPDF.API&&window.jspdf.jsPDF.API.autoTable)
    : !!(window.XLSX&&window.XLSX.utils);
  if(ready)return Promise.resolve();
  if(REPORT_LIBRARY_PROMISES[name])return REPORT_LIBRARY_PROMISES[name];
  REPORT_LIBRARY_PROMISES[name]=new Promise((resolve,reject)=>{
    const script=document.createElement("script");
    script.src=REPORT_LIBRARY_URLS[name];
    script.async=true;
    script.onload=()=>resolve();
    script.onerror=()=>{delete REPORT_LIBRARY_PROMISES[name];reject(new Error("Could not load "+name));};
    document.head.appendChild(script);
  });
  return REPORT_LIBRARY_PROMISES[name];
}
function ensureReportLibraries(kind){
  if(kind==="xlsx")return loadReportScript("xlsx");
  return loadReportScript("jspdf").then(()=>loadReportScript("autotable"));
}

function generateHistoryReportPDF(kind){
  const {from,to}=reportRange();if(!from||!to){showToast('No report dates available');return}
  const sec=reportHistoryData(kind,from,to);if(!sec.rows.length){showToast('No history for selected range');return}
  const title=sec.title+' • '+sec.selected;
  if(!(window.jspdf&&window.jspdf.jsPDF&&window.jspdf.jsPDF.API&&window.jspdf.jsPDF.API.autoTable)){
    ensureReportLibraries('pdf').then(()=>generateHistoryReportPDF(kind)).catch(e=>{console.error(e);reportPdfFallback(title,[sec]);});
    return;
  }
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
  if(!(window.XLSX&&window.XLSX.utils)){
    ensureReportLibraries('xlsx').then(()=>exportHistoryReportExcel(kind)).catch(e=>{console.error(e);showToast('Could not load Excel engine');});
    return;
  }
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

function openReportView(kind){
  reportActiveView=kind;
  const panel=document.getElementById('reportViewPanel');
  if(!panel)return;
  panel.hidden=false;
  const titles={
    complete:['📕 Complete Dashboard Report','Management summary for the selected date range'],
    material:['📦 Raw Material — Material-wise','Select a material to view its history'],
    feed:['🌾 Feed Unit — Product-wise','Select a product to view its history'],
    bags:['🛍 PP Bags — Product-wise','Select a PP bag product to view its history'],
    production:['🏭 Production — Product-wise','Production records for the selected date range'],
    premix:['🧪 Premix','Premix transfer records for the selected date range'],
    mix:['📊 Monthly Mix & Contribution','Monthly mix and contribution for the selected range'],
    movements:['📋 RM Movements','Raw material stock movement records'],
    spares:['🔧 Spare Parts','Current spare parts stock and reorder data'],
    health:['⚠️ Data Health','Reorder, reconciliation and data-quality checks']
  };
  const title=document.getElementById('reportViewTitle'),sub=document.getElementById('reportViewSubtitle'),controls=document.getElementById('reportViewControls');
  if(title)title.textContent=titles[kind]?.[0]||'Report View';
  if(sub)sub.textContent=titles[kind]?.[1]||'';
  if(controls){
    if(kind==='material') controls.innerHTML='<label>Material<select id="reportHistoryMaterial" onchange="refreshReportPreview()"></select></label>';
    else if(kind==='feed') controls.innerHTML='<label>Product<select id="reportHistoryFeedProduct" onchange="refreshReportPreview()"></select></label>';
    else if(kind==='bags') controls.innerHTML='<label>PP Bag Product<select id="reportHistoryBagProduct" onchange="refreshReportPreview()"></select></label>';
    else controls.innerHTML='';
  }
  if(['material','feed','bags'].includes(kind))refreshReportHistorySelectors();
  refreshReportPreview();
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function closeReportView(){
  reportActiveView='';
  const panel=document.getElementById('reportViewPanel');
  if(panel)panel.hidden=true;
}
function refreshReportPreview(){
  const table=document.getElementById('reportPreviewTable'),meta=document.getElementById('reportPreviewMeta');
  if(!table||!reportActiveView)return;
  const {from,to}=reportRange();
  if(!from||!to){table.innerHTML='<div class="empty">No report dates available.</div>';if(meta)meta.textContent='';return;}
  let sec;
  if(reportActiveView==='complete'){
    const summary=reportSummary(from,to);
    sec={title:'Management Summary',headers:['Metric','Value','Unit / Context'],rows:summary};
  }else if(['material','feed','bags'].includes(reportActiveView)){
    sec=reportHistoryData(reportActiveView,from,to);
  }else{
    sec=reportSectionData(reportActiveView,from,to);
  }
  const rows=sec.rows||[];
  if(meta)meta.innerHTML=`<span>${esc(from)} → ${esc(to)}${sec.selected?' • '+esc(sec.selected):''}</span><b>${rows.length.toLocaleString('en-IN')} records</b>`;
  if(!rows.length){table.innerHTML='<div class="history-empty">No data available for the selected date range.</div>';return;}
  const maxRows=500,visible=rows.slice(0,maxRows);
  table.innerHTML=`<table><thead><tr>${sec.headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${visible.map(r=>`<tr>${r.map(v=>`<td>${esc(reportDisplayCell(v))}</td>`).join('')}</tr>`).join('')}</tbody></table>${rows.length>maxRows?`<div class="report-preview-more">Showing first ${maxRows.toLocaleString('en-IN')} of ${rows.length.toLocaleString('en-IN')} records. Download Excel/PDF for the complete report.</div>`:''}`;
}

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
  if(!(window.jspdf&&window.jspdf.jsPDF&&window.jspdf.jsPDF.API&&window.jspdf.jsPDF.API.autoTable)){
    ensureReportLibraries('pdf').then(()=>generateReportPDF(section)).catch(e=>{console.error(e);reportPdfFallback(title,sections);});
    return;
  }
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
  if(!(window.XLSX&&window.XLSX.utils)){
    ensureReportLibraries('xlsx').then(()=>exportReportExcel(section)).catch(e=>{console.error(e);showToast('Could not load Excel engine');});
    return;
  }
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
   PLANT AI — DATA INTELLIGENCE LAYER
   Uses the dashboard data already loaded in the browser.
   No API/source changes and no external credentials required.
===================================================== */
function plantAIJSON(){
  const m=plantAIMetrics();
  const safe=(v)=>v==null?null:Number.isFinite(Number(v))?Number(v):v;
  const materials=m.stockRows.slice(0,200).map(x=>({
    name:x.material||x.name||'', closing:safe(x.closing), unit:x.unit||'MT', avgDay:safe(x.avg), coverDays:safe(x.cover), status:x.status||'OK'
  }));
  const attention=m.attention.slice(0,100).map(x=>({level:x.level||'info',text:x.text||'',reason:x.reason||'',count:safe(x.count)||0}));
  const productionRows=m.prodRows.slice(0,100).map(r=>({
    product:r.product||r.Product||r.name||'', output:safe(r.output_percentage??r.outputPercent??r.output_percentage_value),
    actual:safe(r.actual??r.actualOutput??r.output), target:safe(r.target??r.targetOutput)
  }));
  const productionAvg=m.avgOutput==null?null:Number(m.avgOutput);
  return {
    date:m.date,
    summary:{productionMT:safe(m.production),dispatchMT:safe(m.dispatch),dispatchProductionPct:m.production>0?safe(m.dispatch/m.production*100):null,averageOutputPct:productionAvg},
    attention,
    rawMaterials:{totalStock:safe(m.stockTotal),items:materials},
    production:{records:productionRows,count:m.products||0},
    flags:{critical:m.critical,warning:m.warning,lowStock:materials.filter(x=>x.status!=='OK').length},
    generatedAt:new Date().toISOString()
  };
}
function plantAIContext(intent){
  const d=plantAIJSON();
  if(intent==='materials')return {date:d.date,rawMaterials:d.rawMaterials,attention:d.attention.filter(x=>/stock|reorder|material|premix/i.test(x.text+' '+x.reason))};
  if(intent==='production')return {date:d.date,summary:d.summary,production:d.production,attention:d.attention.filter(x=>/production|output|pellet|downtime|machine/i.test(x.text+' '+x.reason)),rawMaterials:{items:d.rawMaterials.items.filter(x=>x.status!=='OK')}};
  if(intent==='consumption')return {date:d.date,rawMaterials:d.rawMaterials,attention:d.attention.filter(x=>/consumption|usage|variance/i.test(x.text+' '+x.reason)),summary:d.summary};
  if(intent==='dispatch')return {date:d.date,summary:d.summary,attention:d.attention.filter(x=>/dispatch|stock/i.test(x.text+' '+x.reason))};
  return d;
}
function plantAIMetrics(){
  const date=selectedDateForIntelligence()||dateOnly(DATA.report_date)||"Latest";
  const attention=attentionSummaryItems().filter(x=>x.level!=="clear");
  const critical=attention.filter(x=>x.level==="critical").reduce((n,x)=>n+(Number(x.count)||0),0);
  const warning=attention.filter(x=>x.level==="warning").reduce((n,x)=>n+(Number(x.count)||0),0);
  const stockRows=viewStockRows();
  const stockTotal=stockRows.reduce((n,x)=>n+materialValueInMT(x.closing,x.material),0);
  const lowStock=stockRows.filter(x=>x.status&&x.status!=='OK').sort((a,b)=>(Number(a.cover??999)-Number(b.cover??999)));
  const prodRows=selectedProduction();
  const outputs=prodRows.map(r=>num(r.output_percentage??r.outputPercent??r.output_percentage_value)).filter(v=>v!==null);
  const avgOutput=weightedOutputPercentage(prodRows);
  const feedRows=selectedFeedRows();
  const production=feedRows.reduce((n,r)=>n+feedValueInMT(feedField(r,"Production_Day_MT"),r.Product||r.product),0);
  const dispatch=feedRows.reduce((n,r)=>n+feedValueInMT(feedField(r,"Dispatch_Day_MT"),r.Product||r.product),0);
  const products=feedRows.length;
  return {date,attention,critical,warning,stockRows,stockTotal,lowStock,prodRows,avgOutput,feedRows,production,dispatch,products};
}
function plantAIIntent(q){
  const s=plantAINormalizeQuestion(q);
  if(!s)return {intent:'status',confidence:0.5};
  const rules=[
    ['materials',/(raw material|\brm\b|stock|inventory|maize|rice|soy|premix|material|reorder|cover|shortage|closing stock)/],
    ['production',/(production|output|pellet|tonnage|tph|produce|manufactur|yield|efficiency|machine output)/],
    ['consumption',/(consumption|consume|usage|used|variance|abnormal consumption|actual vs standard)/],
    ['dispatch',/(dispatch|sale|sales|delivery|outward|despatch)/],
    ['maintenance',/(maintenance|breakdown|motor|vfd|equipment|repair|downtime|trip|machine fault)/],
    ['quality',/(quality|qms|rejection|bag damage|damage|complaint)/],
    ['status',/(attention|alert|warning|critical|problem|issue|today|risk|urgent|health|condition|status|overall|plant|what should i|what needs)/]
  ];
  let best={intent:'status',score:0};
  rules.forEach(([intent,re])=>{const hits=(s.match(re)||[]).length;if(hits>best.score)best={intent,score:hits};});
  return {intent:best.intent,confidence:Math.min(.99,.55+best.score*.14)};
}
function plantAIAnswer(kind){
  const m=plantAIMetrics();
  let title="Plant status", intro="", findings=[], actions=[];
  if(kind==="status"){
    title="What needs my attention today?";
    intro=m.critical?`There are ${m.critical} critical item${m.critical===1?"":"s"} requiring attention.`:m.warning?`There are ${m.warning} warning item${m.warning===1?"":"s"} to review.`:"No active critical or warning conditions were detected in the monitored dashboard data.";
    m.attention.slice(0,7).forEach(x=>findings.push({level:x.level,title:x.text,body:x.reason}));
    if(m.lowStock.length)actions.push("Review the lowest stock-cover materials first.");
    if(m.critical)actions.push("Open Attention Required and clear critical items before lower-priority checks.");
  }else if(kind==="production"){
    title="Production analysis";
    if(m.production>0)findings.push({level:"info",title:`Current production: ${fmt(m.production)} MT`,body:`${m.products||0} feed product record(s) are available for ${m.date}.`});
    if(m.avgOutput!==null)findings.push({level:m.avgOutput<95?"warning":"good",title:`Average recorded output: ${fmt(m.avgOutput)}%`,body:m.avgOutput<95?"Output is below the 95% monitoring threshold used by Attention Required.":"Average output is at or above the monitored 95% threshold."});
    const prodAlert=m.attention.find(x=>/production output/i.test(x.text));
    if(prodAlert)findings.push({level:prodAlert.level,title:prodAlert.text,body:prodAlert.reason});
    if(m.dispatch>0&&m.production>0){const ratio=m.dispatch/m.production*100;findings.push({level:ratio>100?"warning":"info",title:`Dispatch / production: ${fmt(ratio)}%`,body:ratio>100?"Dispatch exceeds today's recorded production; verify dates and opening/previous stock movement.":"Dispatch is within today's recorded production volume."});}
    actions=["Check affected production records and Attention Required alerts.","If output is low, review machine load, downtime, steam/feed rate and raw-material availability before changing settings."];
  }else if(kind==="materials"){
    title="Raw-material analysis";
    if(!m.lowStock.length)findings.push({level:"good",title:"No low-stock materials found",body:"Current stock coverage does not show a material requiring attention."});
    m.lowStock.slice(0,8).forEach(x=>findings.push({level:x.status==="REORDER"?"critical":"warning",title:x.material,body:`Closing ${fmt(x.closing)} ${x.unit||"MT"} • Cover ${x.cover==null?"--":fmt(x.cover)+" days"} • Avg ${fmt(x.avg||0)} ${x.unit||"MT"}/day`}));
    actions=["Review the lowest-cover material first.","Confirm purchase/transfer timing before stock reaches the reorder level."];
  }else if(kind==="consumption"){
    title="Consumption analysis";
    const abnormal=m.attention.find(x=>/abnormal consumption/i.test(x.text));
    if(abnormal)findings.push({level:"critical",title:abnormal.text,body:abnormal.reason});
    else findings.push({level:"good",title:"No abnormal-consumption alert",body:"Current monitored consumption is within the configured alert range."});
    const rmTotal=monthlyRMConsumption(MIX_MONTH||mixDefaultMonth()).reduce((a,r)=>a+r.value,0);
    findings.push({level:"info",title:`Monthly RM consumption: ${fmt(rmTotal)} MT`,body:`Based on the currently selected month (${monthLabel(MIX_MONTH||mixDefaultMonth())}).`});
    actions=["Compare affected material consumption with production output and transaction history for the same dates."];
  }else if(kind==="dispatch"){
    title="Dispatch analysis";
    if(m.dispatch>0)findings.push({level:m.production>0&&m.dispatch>m.production?"warning":"info",title:`Current dispatch: ${fmt(m.dispatch)} MT`,body:`${m.products||0} feed product record(s) are available for ${m.date}.`});
    if(m.production>0){const ratio=m.dispatch/m.production*100;findings.push({level:ratio>100?"warning":"good",title:`Dispatch / production: ${fmt(ratio)}%`,body:ratio>100?"Dispatch exceeds today's recorded production; verify opening stock, previous stock and date alignment.":"Dispatch is within today's recorded production volume."});}
    actions=["Review dispatch and feed closing details if the quantity looks unusual."];
  }else if(kind==="maintenance"){
    title="Maintenance signals";
    const items=m.attention.filter(x=>/maintenance|breakdown|motor|vfd|equipment|downtime|machine/i.test(x.text+' '+x.reason));
    if(items.length)items.slice(0,6).forEach(x=>findings.push({level:x.level,title:x.text,body:x.reason}));
    else findings.push({level:"good",title:"No maintenance alert detected",body:"The current Attention Required data has no matching maintenance/equipment alert."});
    actions=["Verify machine condition, downtime and recent trips for any output-related anomaly."];
  }else if(kind==="quality"){
    title="Quality signals";
    const items=m.attention.filter(x=>/quality|damage|rejection|complaint/i.test(x.text+' '+x.reason));
    if(items.length)items.slice(0,6).forEach(x=>findings.push({level:x.level,title:x.text,body:x.reason}));
    else findings.push({level:"good",title:"No quality alert detected",body:"No matching quality-related alert is present in the loaded dashboard data."});
    actions=["Review the underlying quality record before taking corrective action."];
  }
  if(!findings.length)findings.push({level:"info",title:"Not enough matching data",body:"The dashboard has no matching records for this question and selected date."});
  return {title,intro,findings,actions,date:m.date,context:plantAIContext(kind)};
}
function plantAIExplain(question,a){
  const q=plantAINormalizeQuestion(question);
  if(/why|reason|cause|because|problem|issue/.test(q)){
    const negatives=a.findings.filter(f=>['critical','warning'].includes(f.level));
    if(negatives.length)return `Main signal: ${negatives.slice(0,3).map(f=>f.title).join('; ')}. These are indicators, not proof of root cause; verify the underlying operational records.`;
    return 'No strong negative signal was detected in the currently loaded data, so a specific root cause cannot be established from the dashboard alone.';
  }
  if(/compare|vs|versus|trend|yesterday|average/.test(q))return 'Comparison is based only on the periods/records currently loaded in the dashboard; verify the selected date range before using it for a management decision.';
  return '';
}
function plantAIAnswerNatural(question){
  const q=String(question||'').trim();
  const route=plantAIIntent(q);
  const base=plantAIAnswer(route.intent);
  const explanation=plantAIExplain(q,base);
  base.intro=(q?`I analysed the loaded plant data for: “${q}”. `:'')+base.intro+(explanation?' '+explanation:'');
  base.confidence=route.confidence;
  base.intent=route.intent;
  base.context=plantAIContext(route.intent);
  return base;
}
function plantAIConfidenceLabel(c){return c>=.82?'High':c>=.68?'Medium':'Low';}
function renderPlantAI(kind="status"){
  const box=document.getElementById("plantAIAnswer");if(!box)return;
  const a=plantAIAnswer(kind);
  box.innerHTML=`<div class="plant-ai-answer"><div class="plant-ai-meta"><span>Confidence: ${plantAIConfidenceLabel(.9)}</span><span>Source: dashboard data</span></div><h4>${esc(a.title)}</h4><p>${esc(a.intro)}</p>${a.findings.map(f=>`<div class="plant-ai-finding"><span class="ai-dot ${f.level}"></span><div><strong>${esc(f.title)}</strong><p>${esc(f.body)}</p></div></div>`).join("")}${a.actions.length?`<div class="plant-ai-answer" style="background:#f7f9fc;margin-top:10px"><strong style="font-size:11px">Suggested checks</strong>${a.actions.map(x=>`<p>• ${esc(x)}</p>`).join("")}</div>`:""}<div class="plant-ai-note">Analysis date: ${esc(a.date)} • Verify operational conditions before taking plant action.</div></div>`;
}
function plantAINormalizeQuestion(q){return String(q||'').toLowerCase().replace(/[^a-z0-9%\.\s-]/g,' ').replace(/\s+/g,' ').trim();}
function askPlantAI(){const input=document.getElementById('plantAIQuestion');const q=input?input.value.trim():'';if(!q){showToast('Type a question first');if(input)input.focus();return;}renderPlantAIQuestion(q);}
function renderPlantAIQuestion(question){
  const box=document.getElementById('plantAIAnswer');if(!box)return;
  box.innerHTML='<div class="plant-ai-thinking"><span class="plant-ai-spinner"></span> Analysing plant data…</div>';
  setTimeout(()=>{
    const a=plantAIAnswerNatural(question);
    const contextSize=JSON.stringify(a.context||{}).length;
    box.innerHTML=`<div class="plant-ai-answer"><div class="plant-ai-meta"><span>Confidence: ${plantAIConfidenceLabel(a.confidence)}</span><span>Focus: ${esc(a.intent)}</span><span>Data used: ${contextSize>0?Math.round(contextSize/1024)+' KB':'--'}</span></div><h4>${esc(a.title)}</h4><p>${esc(a.intro)}</p>${a.findings.map(f=>`<div class="plant-ai-finding"><span class="ai-dot ${f.level}"></span><div><strong>${esc(f.title)}</strong><p>${esc(f.body)}</p></div></div>`).join('')}${a.actions.length?`<div class="plant-ai-answer" style="background:#f7f9fc;margin-top:10px"><strong style="font-size:11px">Suggested checks</strong>${a.actions.map(x=>`<p>• ${esc(x)}</p>`).join('')}</div>`:''}<details class="plant-ai-data"><summary>View AI data context</summary><pre>${esc(JSON.stringify(a.context,null,2))}</pre></details><div class="plant-ai-note">Analysis date: ${esc(a.date)} • Uses only relevant data already loaded in this dashboard. Verify operational conditions before taking plant action.</div></div>`;
  },80);
}
function setPlantAIQuestion(q){const input=document.getElementById('plantAIQuestion');if(input){input.value=q;input.focus();}}
function openPlantAI(){
  const html=`<div class="plant-ai-hero"><div class="plant-ai-status"><span></span>Plant Intelligence Engine</div><h3>🤖 Plant AI</h3><p>Ask about production, raw materials, consumption, dispatch, maintenance, quality or plant status. The engine builds a focused JSON context and analyses only relevant loaded data.</p><div class="plant-ai-ask"><input id="plantAIQuestion" type="text" autocomplete="off" placeholder="Ask anything… e.g. Why is production low today?" onkeydown="if(event.key==='Enter')askPlantAI()"><button onclick="askPlantAI()">Ask</button></div><div class="plant-ai-suggestions"><span>Try:</span><button onclick="setPlantAIQuestion('Why is production low today?')">Why is production low?</button><button onclick="setPlantAIQuestion('Which raw material needs attention?')">Which RM needs attention?</button><button onclick="setPlantAIQuestion('Is consumption normal?')">Is consumption normal?</button><button onclick="setPlantAIQuestion('What maintenance issues need attention?')">Maintenance issues?</button></div><div class="plant-ai-actions"><button class="plant-ai-action" onclick="renderPlantAI('status')">What needs attention today?<small>Critical & warning conditions</small></button><button class="plant-ai-action" onclick="renderPlantAI('production')">Analyse production<small>Output, dispatch & signals</small></button><button class="plant-ai-action" onclick="renderPlantAI('materials')">Analyse raw materials<small>Stock cover & reorder</small></button><button class="plant-ai-action" onclick="renderPlantAI('consumption')">Analyse consumption<small>Usage & anomaly signals</small></button><button class="plant-ai-action" onclick="renderPlantAI('maintenance')">Analyse maintenance<small>Equipment & downtime alerts</small></button><button class="plant-ai-action" onclick="renderPlantAI('quality')">Analyse quality<small>Damage & quality alerts</small></button></div></div><div id="plantAIAnswer"></div>`;
  showModal("🤖 Plant AI",html);renderPlantAI("status");
}

/* =====================================================
   COMPACT DASHBOARD VIEWS — UI ONLY
   Reuses existing sections and handlers; no data/API logic changes.
===================================================== */
function setupDashboardViews(){
  const container=document.querySelector(".container");
  if(!container||container.dataset.viewsReady==="1")return;
  const nav=container.querySelector(".bottom-nav");
  const anchor=container.querySelector(".date-strip");
  if(!nav||!anchor)return;
  const getCard=id=>document.getElementById(id)?.closest(".card");
  const quick=[...container.querySelectorAll(":scope > .card")].find(el=>(el.querySelector(".card-title h2")?.textContent||"").includes("Management Quick View"));
  const desktop=container.querySelector(":scope > .desktop-grid");
  const reorder=desktop?.children?.[0]||null;
  const production=desktop?.children?.[1]||null;
  const sections={
    home:[document.getElementById("attentionRequiredCard"),quick],
    stock:[document.getElementById("premixTransferCard"),reorder,getCard("rawCategoryList")],
    production:[production,getCard("feedUnitList"),document.getElementById("monthlyMixSection")],
    bags:[getCard("bagGrid")],
    spares:[document.getElementById("sparePartsSection")],
    reports:[document.getElementById("reportCenterSection"),document.getElementById("trendsSection")]
  };
  const views={};
  Object.keys(sections).forEach(name=>{
    const view=document.createElement("div");
    view.className="dashboard-view"+(name==="home"?" active":"");
    view.dataset.dashboardView=name;
    view.hidden=name!=="home";
    view.setAttribute("aria-label",name.charAt(0).toUpperCase()+name.slice(1)+" dashboard");
    views[name]=view;
  });
  anchor.after(...Object.values(views));
  Object.entries(sections).forEach(([name,nodes])=>{
    nodes.forEach(node=>{if(node&&node!==nav)views[name].appendChild(node)});
  });
  if(desktop)desktop.remove();
  container.dataset.viewsReady="1";
  nav.querySelectorAll(".nav-item").forEach(el=>{
    el.setAttribute("role","button");
    el.setAttribute("tabindex","0");
    el.setAttribute("aria-label",el.textContent.trim());
    el.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){event.preventDefault();switchDashboardView(el.dataset.view)}
    });
  });
  switchDashboardView("home");
}

/* =====================================================
   START
===================================================== */
setupDashboardViews();
restoreCache().catch(error=>console.warn("Dashboard cache restore skipped",error)).finally(()=>refreshData());
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

