import {ref,shallowRef,computed,nextTick,markRaw} from 'vue';
import {CountdownClock,formatMinutesSeconds} from './timing.js';
import {colourProbeScript,colourProbeTarget,colourSubscriptions,decorateColours} from './layer-colours.js';
import {mapBridge} from './presenter.js';
import {diagnosticRows} from './diagnostics-model.js';
import {saveLog,copyLog,AutoLog} from './log-export.js';
export const VERSION='0.5.10';
export function useDashboard(view,context){
 const fallback=new window.DPDState.DashboardStore({designer:{host:''},timelines:{main:{transport:'—',max_active_layers:3},aux:{transport:'—',max_active_layers:1}}});
 const state=shallowRef(fallback.snapshot()),pending=shallowRef(null),countdown=ref({text:'--:--',source:'NO ACTIVE MEDIA',stale:true}),clock=ref({time:'--:--',date:'—'}),notice=ref(''),diagnosticsOpen=ref(false),logStatus=ref({path:'',error:''});
 let colourProbeStarted=false,colourProbeAttempt=0,colourCapability={phase:'waiting',reason:'Waiting for a layer and track UID'};
 let client=null,disposed=false,rendering=false,timer=null,clockTimer=null;
 const startup=[],smooth=new CountdownClock(),requests=new Set();
 const links=Object.fromEntries(['advanced','simple','compact'].map(name=>{const url=new URL('views/'+name+'.html',document.baseURI);url.search=location.search;url.searchParams.delete('view');return [name,url.href];}));
 function log(level,message,detail){if(client)client.log(level,message,detail);else startup.push([level,message,detail]);}
 function logText(){return ['DPD Plugin '+VERSION,'Page: '+location.href,'Context: '+context+'; framed: '+(window.self!==window.top),'User agent: '+navigator.userAgent,'UI: '+JSON.stringify(uiMetrics()),client?.logTail(1000)||startup.map(row=>row.map(value=>typeof value==='string'?value:JSON.stringify(value)).join(' ')).join('\n')].join('\n')+'\n';}
 async function json(url,options={}){
  const abort=new AbortController();requests.add(abort);const timeout=setTimeout(()=>abort.abort(),5000);
  try{const response=await fetch(url,{...options,cache:'no-store',signal:abort.signal});if(!response.ok)throw Error('HTTP '+response.status);const data=await response.json();if(data?.status&&Number(data.status.code)!==0)throw Error(data.status.message||'Designer API error '+data.status.code);return data;}
  catch(error){const message=(options.method||'GET')+' '+url+' — '+String(error);log('ERROR','Request failed',message);throw Error(message);}
  finally{clearTimeout(timeout);requests.delete(abort);}
 }
 async function requestScript(script){
  const director=client?.director||window.DPDDesigner.endpoint(new URLSearchParams(location.search).get('director')||location.host,Number(location.port)||80);
  return client?client.json(director.origin+'/api/session/python/execute',5000,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script})}):json(director.origin+'/api/session/python/execute',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script})});
 }
 async function chooseTransports(list,choiceContext){
  const saved=window.DPDPreferences.resolveSelection(list,choiceContext.saved);
  if(saved)return {...saved,expectedRevision:choiceContext.revision};
  if(choiceContext.signal.aborted)throw new DOMException('Selection cancelled','AbortError');
  return new Promise((resolve,reject)=>{
   let ended=false,watch=null;
   const cleanup=()=>{ended=true;clearTimeout(watch);choiceContext.signal.removeEventListener('abort',abort);pending.value=null;};
   const abort=()=>{cleanup();reject(new DOMException('Selection cancelled','AbortError'));};
   const finish=selection=>{if(ended)return;cleanup();resolve(selection);};
   const model={list,error:'',submit(choice){finish({...choice,expectedRevision:choiceContext.revision});}};
   pending.value=model;choiceContext.signal.addEventListener('abort',abort,{once:true});
   async function refresh(){
    if(ended||!choiceContext.readSaved)return;
    try{const record=await choiceContext.readSaved();if(ended)return;const selection=window.DPDPreferences.resolveSelection(list,record.selection);if(selection){finish({...selection,expectedRevision:record.revision});return;}model.error='';}
    catch(error){if(ended)return;if(error.topologyChanged){cleanup();reject(error);return;}model.error=String(error.message||error);}
    if(!ended){pending.value={...model};watch=setTimeout(refresh,1000);}
   }
   watch=setTimeout(refresh,1000);
  });
 }
 function tickCountdown(){
  const current=state.value,first=current.main||{},source=first.countdownSource,remaining=smooth.valueAt(performance.now());
  countdown.value={text:source?remaining===null?'LIVE':formatMinutesSeconds(remaining):'--:--',source:source?(source.timingApproximate?'≈ ':'')+(source.layerName||'—'):'NO ACTIVE MEDIA',ending:remaining!==null&&remaining>0&&remaining<=(current.ui?.blink_at_seconds??10),stale:current.status?.connected!==true};
  const date=new Date(),pad=n=>String(n).padStart(2,'0');clock.value={time:pad(date.getHours())+':'+pad(date.getMinutes()),date:pad(date.getDate())+'-'+['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][date.getMonth()]+'-'+date.getFullYear()};
 }
 async function update(){
  if(disposed||rendering)return;rendering=true;
  try{
   let next=client?client.snapshot():fallback.snapshot();
   if(view==='compact'){startColours(next);next=decorateColours(next,client?.optionalValues,client?.optionalErrors);}next.appVersion=VERSION;next.aux={...next.aux,enabled:client?.config.timelines.aux.enabled!==false};
   if(next.aux.enabled===false)next.aux={...next.aux,active:[],transportName:'—',trackName:'NO SECOND TRANSPORT'};
   if(notice.value)next.status={...next.status,lastError:notice.value};
   if(logStatus.value.error&&!next.status.lastError)next.status={...next.status,lastError:logStatus.value.error};
   const first=next.main||{},source=first.countdownSource;
   if(next.status.connected){smooth.sync({raw:first.countdownSeconds,hasSource:!!source,sourceKey:source?[source.layerUid,source.layerName,source.mediaName,source.layerType].join('\u001f'):'',running:!!first.playing&&!first.holding,position:first.currentSeconds},performance.now(),next.ui||{});}
   else if(smooth.running){smooth.anchorRemaining=smooth.valueAt(performance.now());smooth.anchorAt=performance.now();smooth.running=false;smooth.lastAction='data-unavailable';}
   const display=mapBridge(next);window.DashboardMotion?.beforeRender(display);state.value=next;tickCountdown();await nextTick();window.DashboardMotion?.afterRender(display);
  }finally{rendering=false;}
 }
 async function startColours(current){
  if(colourProbeStarted||disposed||!client||!current.status?.connected||current.status.mode==='demo')return;
  const target=colourProbeTarget(current);if(!target)return;
  colourProbeStarted=true;colourCapability={phase:'checking',reason:'Checking exported getColour/getColourInfo RGBA once'};
  const owner=client,generation=owner.generation,attempt=++colourProbeAttempt;
  const obsolete=()=>{
   if(disposed||attempt!==colourProbeAttempt)return true;
   if(owner!==client||owner.generation!==generation||owner.stopped){colourProbeStarted=false;colourCapability={phase:'waiting',reason:'Connection changed during colour discovery; waiting for current data'};return true;}
   return false;
  };
  try{
   const response=await requestScript(colourProbeScript(target.layer,target.track));
   if(obsolete())return;
   const result=typeof response.returnValue==='string'?JSON.parse(response.returnValue):response.returnValue;
   if(!result||typeof result.supported!=='boolean')throw Error('Designer did not return colour capability information.');
   colourCapability={...result,phase:result.supported?'subscribed':'unavailable'};
   if(result.supported){const {member,method}=result;client.setOptionalSubscriptions(config=>colourSubscriptions(config,member,window.DPDDesigner.transportExpression,method));}
   log('INFO','Layer colour capability',colourCapability);
  }catch(error){if(obsolete())return;colourCapability={phase:'unavailable',reason:String(error.message||error)};log('WARNING','Optional layer colours unavailable',colourCapability.reason);}
 }
 function transportSelection(){return {list:client?.availableTransports||[],main:client?.selection?.main||'',aux:client?.selection?.aux||'',demo:client?.store.connection_mode==='demo'};}
 async function selectMain(id){if(!client||client.store.connection_mode==='demo')throw Error('Transport selection requires a Designer connection.');await client.changeMain(id);}
 async function selectSecondary(id){if(!client||client.store.connection_mode==='demo')throw Error('Transport selection requires a Designer connection.');await client.changeSecondary(id);}
 async function exportLog(target=window){if(context==='designer')throw Error('Log download is available only in the external browser. Compact writes its automatic log without opening windows.');return saveLog(logText(),{target});}
 function closeDiagnostics(){diagnosticsOpen.value=false;}
 // Designer r33.2.4 redirects even empty popups into the current plugin.
 // Never call window.open here: retain the data client and render a local panel.
 function openDiagnostics(){diagnosticsOpen.value=!diagnosticsOpen.value;}
 function uiMetrics(){
  const canvas=document.getElementById('canvas'),font=selector=>{const node=document.querySelector(selector);return node?getComputedStyle(node).fontSize:'—';};
  return [['Viewport',innerWidth+' x '+innerHeight],['Host outer size',outerWidth+' x '+outerHeight],['Content height',canvas?Math.ceil(canvas.getBoundingClientRect().height):'—'],['Intrinsic content height',window.DPDNative?.windowFit?.contentHeight??'—'],['Native window fit',JSON.stringify(window.DPDNative?.windowFit||{})],['Row font',font('.layer-name')],['Media font',font('.media-text')],['Timer font',font('#main-active-rows .time')],['Timer face',document.querySelector('.time')?getComputedStyle(document.querySelector('.time')).fontFamily:'—'],['Timer weight',document.querySelector('.time')?getComputedStyle(document.querySelector('.time')).fontWeight:'—'],['Font faces',JSON.stringify([...document.fonts].map(face=>({family:face.family,status:face.status,weight:face.weight})))],['Brand weight',document.querySelector('.brand-title')?getComputedStyle(document.querySelector('.brand-title')).fontWeight:'—'],['Clock font',font('.clock')],['Diagnostics host','Local Vue panel; no popup'],['Layer colours',colourCapability.phase],['Colour capability',colourCapability.reason],['Colour exported fields',JSON.stringify(colourCapability.fields||[])],['Colour stream errors',JSON.stringify(client?.optionalErrors||{})]];
 }
 const bridge={isAlive:()=>!disposed,snapshot:()=>({state:state.value,log:logText(),logStatus:logStatus.value,selection:transportSelection(),animation:window.DashboardMotion?.getMode()||'off',rows:diagnosticRows(state.value,{view,motion:window.DashboardMotion,remaining:smooth.valueAt(performance.now()),syncAction:smooth.lastAction,page:location.href,api:client?.director?.origin||'Not resolved'}).concat(uiMetrics())}),selectMain,selectSecondary,exportLog,copyLog:target=>copyLog(logText(),target),setAnimation:value=>window.DashboardMotion?.setMode(value),close:closeDiagnostics};
 const autoLog=new AutoLog({request:requestScript,text:logText,onStatus:value=>{logStatus.value=value;}});
 window.DPDAppBridge=bridge;
 // A stable public inspection API also helps collect reports from real hosts.
 window.DPDNative={get client(){return client;},getState:async()=>state.value,logTail:()=>logText(),getTransportSelection:transportSelection,selectMainTransport:selectMain,selectSecondaryTransport:selectSecondary,downloadLog:exportLog};
 async function start(){
  timer=setInterval(update,100);clockTimer=setInterval(tickCountdown,50);await update();
  try{
   const [config,properties]=await Promise.all(['config.json','properties.json'].map(name=>json(new URL('data/'+name,document.baseURI).href)));
   if(disposed)return;
   client=markRaw(new window.DPDDesigner.NativeClient(config,properties,{selectTransports:chooseTransports,preferences:true}));
   startup.forEach(args=>client.log(...args));client.log('INFO','DPD Vue '+VERSION+' starting',{page:location.href,context,framed:window.self!==window.top,userAgent:navigator.userAgent});
   if(new URLSearchParams(location.search).get('demo')==='1'||config.demo===true){const demo=await json(new URL('data/demo.json',document.baseURI).href);if(disposed)return;window.DPDDemo.start(client,demo);}else {if(context==='designer'&&view==='compact')autoLog.start();await client.start();}
  }catch(error){if(disposed)return;(client?.store||fallback).set_connection(false,'error','',String(error));log('ERROR','Plugin initialization failed',String(error));}
 }
 function keydown(event){if(event.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;if(event.key.toLowerCase()==='d'){event.preventDefault();openDiagnostics();}}
 function dispose(){if(disposed)return;disposed=true;clearInterval(timer);clearInterval(clockTimer);requests.forEach(request=>request.abort());requests.clear();autoLog.stop();client?.stop();window.DashboardMotion?.stopAll();closeDiagnostics();document.removeEventListener('keydown',keydown);}
 document.addEventListener('keydown',keydown);window.addEventListener('pagehide',dispose,{once:true});window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
 window.DashboardMotion?.setLogger((message,detail)=>log('INFO',message,detail));window.DPDNative.ready=start();
 return {state,pending,countdown,clock,links,openDiagnostics,closeDiagnostics,diagnosticsOpen,bridge,dispose};
}
