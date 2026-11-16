import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";
const SUPABASE_URL=Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC_KEY=Deno.env.get("VAPID_PUBLIC_KEY")??"";
const VAPID_PRIVATE_KEY=Deno.env.get("VAPID_PRIVATE_KEY")??"";
const VAPID_SUBJECT=Deno.env.get("VAPID_SUBJECT")??"mailto:admin@example.com";
const PUSH_WEBHOOK_SECRET=Deno.env.get("PUSH_WEBHOOK_SECRET")??"";
const PUSH_DEVICE_ENROLLMENT_TOKEN=Deno.env.get("PUSH_DEVICE_ENROLLMENT_TOKEN")??"";
const supabase=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const allowedOrigins=new Set(["https://lakkireddythirumal-bot.github.io","https://lakkireddythirumal-bot.github.io:443"]);
function corsHeaders(origin:string|null){const ok=!!origin&&(allowedOrigins.has(origin)||/^https?:\/\/localhost(:\d+)?$/.test(origin));return{"Access-Control-Allow-Origin":ok?origin!:"https://lakkireddythirumal-bot.github.io","Access-Control-Allow-Headers":"authorization, content-type","Access-Control-Allow-Methods":"GET, POST, OPTIONS","Vary":"Origin"};}
function json(data:unknown,status=200,origin:string|null=null){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders(origin),"Content-Type":"application/json"}});}
function bearer(req:Request){return(req.headers.get("authorization")??"").replace(/^Bearer\s+/i,"");}
function equal(a:string,b:string){if(!a||!b||a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
function configure(){if(!VAPID_PUBLIC_KEY||!VAPID_PRIVATE_KEY)throw new Error("VAPID keys are not configured");webpush.setVapidDetails(VAPID_SUBJECT,VAPID_PUBLIC_KEY,VAPID_PRIVATE_KEY);}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get("origin");if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders(origin)});
 const url=new URL(req.url);
 if(req.method==="GET"&&url.searchParams.get("action")==="public-key"){if(!VAPID_PUBLIC_KEY)return json({error:"Push is not configured yet"},503,origin);return json({publicKey:VAPID_PUBLIC_KEY},200,origin);}
 if(req.method!=="POST")return json({error:"Method not allowed"},405,origin);
 let body:Record<string,unknown>;try{body=await req.json();}catch{return json({error:"Invalid JSON"},400,origin);}
 const deviceAuthorized=!!PUSH_DEVICE_ENROLLMENT_TOKEN&&equal(bearer(req),PUSH_DEVICE_ENROLLMENT_TOKEN);
 if(body.action==="subscribe"||body.action==="unsubscribe"){
  if(!deviceAuthorized)return json({error:"Device enrollment is not authorized"},401,origin);
  if(body.action==="subscribe"){
   const sub=body.subscription as {endpoint?:string}|undefined;
   if(!sub?.endpoint||!sub.endpoint.startsWith("https://"))return json({error:"Invalid push subscription"},400,origin);
   const{error}=await supabase.from("push_subscriptions").upsert({endpoint:sub.endpoint,subscription:sub,device_label:typeof body.device_label==="string"?body.device_label.slice(0,80):"Feed Plant Dashboard",enabled:true,last_seen_at:new Date().toISOString()},{onConflict:"endpoint"});
   if(error)return json({error:"Could not save device subscription"},500,origin);return json({ok:true},200,origin);
  }
  const endpoint=typeof body.endpoint==="string"?body.endpoint:"";if(!endpoint)return json({error:"Missing endpoint"},400,origin);
  const{error}=await supabase.from("push_subscriptions").update({enabled:false}).eq("endpoint",endpoint);
  if(error)return json({error:"Could not disable subscription"},500,origin);return json({ok:true},200,origin);
 }
 const deviceAlert=body.action==="system_alert"&&deviceAuthorized;
 const n8nNotify=body.action==="notify"&&!!PUSH_WEBHOOK_SECRET&&equal(bearer(req),PUSH_WEBHOOK_SECRET);
 if(!deviceAlert&&!n8nNotify)return json({error:"Not authorized"},401,origin);
 if(deviceAlert){body.event="system_alert";body.alert_key=String(body.alert_key??"dashboard-error").slice(0,120);body.message=String(body.message??"Dashboard sync or data error detected.").slice(0,180);}
 if(!["daily_mis_ready","system_alert"].includes(String(body.event)))return json({error:"Unsupported event"},400,origin);
 if(body.event==="daily_mis_ready"&&body.status!=="success")return json({error:"MIS-ready event must have success status"},400,origin);
 const type=String(body.event),date=String(body.report_date??"unknown"),run=String(body.workflow_run_id??crypto.randomUUID());
 const dedupe=type==="daily_mis_ready"?`daily_mis_ready:${date}`:`system_alert:${String(body.alert_key??run)}`;
 const{data:inserted,error:insertError}=await supabase.from("push_notification_events").insert({dedupe_key:dedupe,event_type:type,payload:body}).select("id").maybeSingle();
 if(insertError?.code==="23505")return json({ok:true,duplicate:true},200,origin);
 if(insertError||!inserted)return json({error:"Could not record notification event"},500,origin);
 try{configure();}catch(e){await supabase.from("push_notification_events").delete().eq("id",inserted.id);return json({error:e instanceof Error?e.message:"Push config error"},503,origin);}
 const title=type==="daily_mis_ready"?"Daily MIS Ready":"Feed Plant System Alert";
 const message=type==="daily_mis_ready"?`MIS report for ${date} has been imported successfully.`:String(body.message??"Dashboard sync or data error detected.").slice(0,180);
 const payload=JSON.stringify({title,body:message,tag:dedupe,url:"/Index/",data:{event:type,report_date:date}});
 const{data:subs,error:readError}=await supabase.from("push_subscriptions").select("id,subscription").eq("enabled",true);
 if(readError)return json({error:"Could not load device subscriptions"},500,origin);
 let sent=0,failed=0;
 for(const row of subs??[]){try{await webpush.sendNotification(row.subscription,payload,{TTL:43200});sent++;}catch(e){failed++;const status=(e as {statusCode?:number})?.statusCode;if(status===404||status===410)await supabase.from("push_subscriptions").update({enabled:false}).eq("id",row.id);}}
 await supabase.from("push_notification_events").update({sent_count:sent,failed_count:failed}).eq("id",inserted.id);
 return json({ok:true,sent,failed,no_devices:(subs??[]).length===0},200,origin);
});