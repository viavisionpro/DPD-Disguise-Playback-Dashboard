
(function (root) {
  'use strict';
  const storageKey='disguise.dashboard.nextActiveMotion', overrideKey='disguise.dashboard.allowReducedMotion';
  const variants=['off','fade','lift','accent','transfer'];
  const descriptions={
    off:'No effects: rows appear and disappear immediately.',
    fade:'Fade: incoming rows fade in; outgoing rows fade out.',
    lift:'Lift: incoming rows rise slightly; outgoing rows move up and fade out.',
    accent:'Accent: incoming rows briefly glow; outgoing rows fade out.',
    transfer:'Transfer: the Next name moves to Active; the last outgoing name moves to Previous. Other rows fade in and out.'
  };
  const uid=value=>{
    if(value===null||value===undefined||value===''||value==='—')return null;
    const text=String(value);
    try{return /^(?:0x[\da-f]+|\d+)$/i.test(text)?BigInt(text).toString():text;}catch(_){return text;}
  };

  const rowKey=item=>JSON.stringify(uid(item?.layerUid)??uid(item?.layerId)??item?.layerName??'');
  const matches=(left,right)=>!!left&&!!right&&rowKey(left)===rowKey(right);
  class LifecycleTracker {
    constructor(){this.reset();}
    reset(){this.timelines=new Map();this.didReset=true;this.resetRoles=new Set(['main','second']);}
    observe(view) {
      this.didReset=false;
      this.resetRoles=new Set();
      if(view.connected===false){this.reset();return [];}
      const events=[];
      for(const role of ['main','second']) {
        const timeline=view[role]||{};
        const context=JSON.stringify([view.projectName??'',timeline.transportName??'',uid(timeline.trackUid)??timeline.trackName??'']);
        const old=this.timelines.get(role), membership=timeline.activeMembership;
        if(membership?.authoritative===true&&membership.available!==true) {
          this.timelines.delete(role);if(old){this.didReset=true;this.resetRoles.add(role);}continue;
        }
        const rows=Array.isArray(timeline.active)?timeline.active.slice(0,role==='main'?3:1):[];
        const current=new Map(rows.map(item=>[rowKey(item),item]));
        if(old&&old.context===context) {
          for(const [key,item] of old.rows)if(!current.has(key))events.push({direction:'exit',role,key,item});
          for(const [key,item] of current)if(!old.rows.has(key))events.push({direction:'enter',role,key,item});
        } else {this.didReset=true;this.resetRoles.add(role);}
        this.timelines.set(role,{context,rows:current});
      }
      return events;
    }
  }
  const tracker=new LifecycleTracker(),running=new Set(),ghosts=new Set();
  const counts={enter:0,exit:0,appliedEnter:0,appliedExit:0,skipped:0};
  let mode='lift',configured=false,allowReduced=false,reducedMotion=null,queued=[];
  let previewCallback=null,logger=null,lastTransition='—',lastSkip='—',lastNext=null;
  let oldPositions=new Map();
  const listId=role=>role==='second'?'second-active-rows':'main-active-rows';
  function log(message,detail){if(logger)logger(message,detail);}
  function stopAll(){running.forEach(animation=>animation.cancel());ghosts.forEach(node=>node.remove());running.clear();ghosts.clear();}
  function stopRole(role) {
    for(const animation of running)if(animation.effect?.target?.dataset.motionRole===role)animation.cancel();
    for(const node of ghosts)if(node.dataset.motionRole===role){node.remove();ghosts.delete(node);}
  }
  function effectiveMode(){return reducedMotion?.matches&&!allowReduced?'off':mode;}
  function disabledReason(){
    if(reducedMotion?.matches&&!allowReduced)return 'System Reduce motion is enabled; effects are disabled.';
    if(mode==='off')return 'Off is selected.';
    if(typeof Element!=='undefined'&&typeof Element.prototype.animate!=='function')return 'This browser does not support the Web Animations API.';
    return '';
  }
  function syncControls() {
    if(typeof document==='undefined')return;
    const select=document.getElementById('handoff-animation'),description=document.getElementById('handoff-description');
    if(select)select.value=mode;
    if(description)description.textContent=descriptions[mode]+' '+disabledReason();
    const override=document.getElementById('handoff-reduced-override');if(override)override.checked=allowReduced;
    for(const name of ['handoff-preview','handoff-preview-exit']) {
      const button=document.getElementById(name);if(button)button.disabled=!!disabledReason();
    }
    const status=document.getElementById('handoff-runtime');
    if(status)status.textContent=`Mode: ${effectiveMode()} · Entries: ${counts.appliedEnter}/${counts.enter} · Exits: ${counts.appliedExit}/${counts.exit} · ${lastTransition}`;
  }
  function configure(value) {
    if(configured)return;
    configured=true;mode=variants.includes(value)?value:'lift';
    try {
      const saved=root.localStorage.getItem(storageKey);if(variants.includes(saved))mode=saved;
      allowReduced=root.localStorage.getItem(overrideKey)==='true';
    } catch(_){ }
    syncControls();
  }
  function setMode(value,{persist=true}={}) {
    if(!variants.includes(value))return;
    configured=true;mode=value;stopAll();
    if(persist)try{root.localStorage.setItem(storageKey,mode);}catch(_){}
    syncControls();log('UI animation setting',{selected:mode,effective:effectiveMode(),reason:disabledReason()});
  }
  function setReducedOverride(value,{persist=true}={}) {
    allowReduced=!!value;stopAll();
    if(persist)try{root.localStorage.setItem(overrideKey,String(allowReduced));}catch(_){}
    syncControls();log('UI animation Reduce motion override',{allowed:allowReduced,effective:effectiveMode()});
  }
  function geometry(element) {
    if(!element)return null;
    const r=element.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};
  }
  function cssNumber(name,fallback){const value=parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));return Number.isFinite(value)?value:fallback;}
  function run(element,frames,duration,{delay=0,direction='enter',onFinish=null}={}) {
    if(typeof element?.animate!=='function')return null;
    try {
      const animation=element.animate(frames,{duration,delay,easing:'cubic-bezier(.2,.65,.3,1)',fill:'backwards'});
      animation.id='dashboard-handoff-'+direction;running.add(animation);
      animation.finished.catch(()=>{}).finally(()=>{running.delete(animation);if(onFinish)onFinish();});
      return animation;
    } catch(error){lastSkip='Web Animations: '+error.message;log('UI animation failed',{error:lastSkip});return null;}
  }
  function positionGhost(node,rect) {
    const canvas=document.getElementById('canvas'),c=geometry(canvas),scale=document.documentElement.dataset.view==='compact'?1:c.width/1920;
    if(!rect||scale<=0)return false;
    Object.assign(node.style,{position:'absolute',left:`${(rect.x-c.x)/scale}px`,top:`${(rect.y-c.y)/scale}px`,
      width:`${rect.width/scale}px`,height:`${rect.height/scale}px`,margin:'0',transform:'none'});
    node.setAttribute('aria-hidden','true');node.inert=true;canvas.append(node);ghosts.add(node);return true;
  }
  function removeGhost(node){node.remove();ghosts.delete(node);}
  function cloneRow(row) {
    if(!row)return null;
    const clone=row.cloneNode(true),style=getComputedStyle(row);
    for(const property of ['--font-factor','--accent','--media-fill','--media-text'])
      clone.style.setProperty(property,style.getPropertyValue(property));
    const children=row.querySelectorAll('.layer-name,.layer-type,.value-box,.brightness-value,.field-label');
    const copies=clone.querySelectorAll('.layer-name,.layer-type,.value-box,.brightness-value,.field-label');
    children.forEach((child,index)=>{
      const css=getComputedStyle(child);
      for(const property of ['font-size','line-height','color','background'])copies[index].style.setProperty(property,css.getPropertyValue(property));
    });
    return clone;
  }
  function transferLabel(text,from,to,duration,direction) {
    if(!from||!to)return;
    const canvas=document.getElementById('canvas'),c=geometry(canvas),scale=document.documentElement.dataset.view==='compact'?1:c.width/1920;
    const label=document.createElement('span');label.className='handoff-ghost motion-label';label.textContent=text;
    label.dataset.motionRole='main';
    label.dataset.direction=direction;
    if(!positionGhost(label,{...from,width:Math.min(from.width,to.width),height:Math.max(from.height,to.height)}))return;
    run(label,[{transform:'translate(0,0)',opacity:.95},
      {transform:`translate(${(to.x-from.x)/scale}px,${(to.y-from.y)/scale}px)`,opacity:.75,offset:.72},
      {transform:`translate(${(to.x-from.x)/scale}px,${(to.y-from.y)/scale}px)`,opacity:0}],duration,
      {direction,onFinish:()=>removeGhost(label)});
  }
  function animateEnter(row,event,{preview=false,delay=0}={}) {
    if(!row)return false;
    const selected=effectiveMode(),duration=Math.max(240,Math.min(1400,cssNumber('--handoff-duration',640)));
    const offset=cssNumber('--handoff-offset',16),color=getComputedStyle(document.documentElement).getPropertyValue('--handoff-accent').trim()||'rgba(255,163,53,.85)';
    const shadow=getComputedStyle(row).boxShadow;
    let frames;
    if(selected==='fade')frames=[{opacity:0},{opacity:1}];
    else if(selected==='lift')frames=[{transform:`translateY(${offset}px)`,opacity:0},{transform:'translateY(0)',opacity:1}];
    else frames=[{opacity:0,boxShadow:`inset 0 0 0 2px ${color},0 0 22px rgba(255,163,53,.2)`},
      {opacity:1,boxShadow:`inset 0 0 0 2px ${color},0 0 22px rgba(255,163,53,.2)`,offset:.35},
      {opacity:1,boxShadow:shadow}];
    row.getAnimations().filter(a=>a.id.startsWith('dashboard-handoff')).forEach(a=>a.cancel());
    const token=String(performance.now());row.dataset.handoffToken=token;row.dataset.handoffVariant=selected;row.dataset.motionDirection='enter';row.dataset.motionRole=event.role;
    if(preview)row.dataset.handoffPreview='true';
    const animation=run(row,frames,duration,{delay,onFinish:()=>{
      if(row.dataset.handoffToken===token){delete row.dataset.handoffToken;delete row.dataset.handoffVariant;delete row.dataset.handoffPreview;delete row.dataset.motionDirection;}
    }});
    if(selected==='transfer'&&event.source)transferLabel(event.item.layerName,event.source,geometry(row.querySelector('.layer-name')),duration,'enter');
    return !!animation;
  }
  function animateExit(event,{preview=false}={}) {
    const ghost=event.clone;if(!ghost||!event.rect)return false;
    ghost.classList.add('motion-exit');
    delete ghost.dataset.rowKey;delete ghost.dataset.handoffToken;delete ghost.dataset.handoffVariant;
    ghost.dataset.motionDirection='exit';ghost.dataset.handoffVariant=effectiveMode();
    ghost.dataset.motionRole=event.role;
    if(preview)ghost.dataset.handoffPreview='true';

    if(!positionGhost(ghost,event.rect))return false;
    const offset=cssNumber('--handoff-offset',16),duration=exitDuration();
    const frames=effectiveMode()==='lift'
      ? [{transform:'translateY(0)',opacity:1},{transform:`translateY(-${offset}px)`,opacity:0}]
      : [{opacity:1},{opacity:0}];
    const animation=run(ghost,frames,duration,{direction:'exit',onFinish:()=>removeGhost(ghost)});
    if(effectiveMode()==='transfer'&&event.role==='main'&&event.toPrevious)
      transferLabel(event.item.layerName,event.nameRect,geometry(document.querySelector('#previous-row .layer-name')),
        cssNumber('--handoff-duration',640),'exit');
    return !!animation;
  }
  function exitDuration(){return Math.max(100,Math.min(220,cssNumber('--handoff-exit-duration',180)));}
  function record(event,applied,preview=false) {
    if(!preview){counts[event.direction]++;if(applied)counts[event.direction==='enter'?'appliedEnter':'appliedExit']++;else counts.skipped++;}
    lastTransition=`${preview?'Preview · ':''}${event.role} · ${event.direction==='enter'?'→ ACTIVE':'ACTIVE →'} · ${event.item.layerName||'—'} · ${effectiveMode()}`;
    if(!applied)lastSkip=disabledReason()||'The row is not in the DOM.';
    log('UI ACTIVE '+event.direction,{role:event.role,layerUid:event.item.layerUid,layer:event.item.layerName,
      variant:mode,effective:effectiveMode(),applied,preview,reason:applied?'':lastSkip});syncControls();
  }
  function beforeRender(view) {
    configure(view.nextActiveAnimation);
    const events=tracker.observe(view);
    if(view.connected===false)stopAll();else tracker.resetRoles.forEach(stopRole);
    oldPositions=new Map();
    for(const role of ['main','second'])for(const row of document.getElementById(listId(role))?.children||[])
      if(row.dataset.rowKey)oldPositions.set(role+row.dataset.rowKey,geometry(row));
    queued=events.map(event=>{
      const old=Array.from(document.getElementById(listId(event.role))?.children||[]).find(row=>row.dataset.rowKey===event.key);
      return {...event,clone:event.direction==='exit'?cloneRow(old):null,rect:geometry(old),
        nameRect:geometry(old?.querySelector('.layer-name')),
        source:event.role==='main'&&matches(lastNext?.item,event.item)?lastNext.rect:null,
        toPrevious:matches(view.main?.previous,event.item)};
    });
  }
  function afterRender(view) {
    if(queued.length&&!disabledReason()) {
      const canvas=geometry(document.getElementById('canvas')),scale=document.documentElement.dataset.view==='compact'?1:canvas.width/1920;
      for(const role of ['main','second'])for(const row of document.getElementById(listId(role))?.children||[]) {
        const old=oldPositions.get(role+row.dataset.rowKey),r=geometry(row);
        if(!old||row.dataset.motionDirection==='enter'||queued.some(e=>e.direction==='enter'&&e.role===role&&e.key===row.dataset.rowKey))continue;
        const dy=(old.y-r.y)/scale;
        if(Math.abs(dy)>1) {
          row.getAnimations().filter(a=>a.id==='dashboard-handoff-reflow').forEach(a=>a.cancel());
          row.dataset.motionRole=role;
          run(row,[{transform:`translateY(${dy}px)`},{transform:'translateY(0)'}],220,
            {direction:'reflow',delay:exitDuration()});
        }
      }
    }
    for(const event of queued) {
      let applied=false;
      if(!disabledReason()) {
        if(event.direction==='exit')applied=animateExit(event);
        else {
          const row=Array.from(document.getElementById(listId(event.role))?.children||[]).find(row=>row.dataset.rowKey===event.key),r=geometry(row);
          const replacing=queued.some(old=>old.direction==='exit'&&old.role===event.role&&old.rect&&r&&Math.abs(old.rect.y-r.y)<24);
          applied=animateEnter(row,event,{delay:replacing?exitDuration():0});
        }
      }
      record(event,applied);
    }
    queued=[];lastNext={item:view.main?.next,rect:geometry(document.querySelector('#next-row .layer-name'))};
  }
  function preview(direction='enter') {
    if(disabledReason()){lastSkip=disabledReason();syncControls();return false;}
    const row=document.querySelector('#main-active-rows .layer-row');if(!row){lastSkip='No Active row is available for preview.';syncControls();return false;}
    const name=row.querySelector('.layer-name')?.textContent;
    const event={direction,role:'main',item:{layerName:name},clone:cloneRow(row),rect:geometry(row),nameRect:geometry(row.querySelector('.layer-name')),
      source:geometry(document.querySelector('#next-row .layer-name')),toPrevious:false};
    let applied;
    if(direction==='exit') {
      applied=animateExit(event,{preview:true});

      if(applied)run(row,[{opacity:0},{opacity:0,offset:.6},{opacity:1}],exitDuration()+200,{direction:'preview'});
    } else applied=animateEnter(row,event,{preview:true});
    record(event,applied,true);return applied;
  }
  function initialise() {
    reducedMotion=root.matchMedia?.('(prefers-reduced-motion: reduce)')||null;
    reducedMotion?.addEventListener?.('change',()=>{stopAll();syncControls();log('UI Reduce motion changed',{reduced:reducedMotion.matches,effective:effectiveMode()});});
    document.getElementById('handoff-animation')?.addEventListener('change',event=>setMode(event.target.value));
    document.getElementById('handoff-reduced-override')?.addEventListener('change',event=>setReducedOverride(event.target.checked));
    for(const [name,direction] of [['handoff-preview','enter'],['handoff-preview-exit','exit']])
      document.getElementById(name)?.addEventListener('click',()=>{if(previewCallback)previewCallback(direction);else preview(direction);});
    root.addEventListener('storage',event=>{
      if(event.key===storageKey)setMode(variants.includes(event.newValue)?event.newValue:'lift',{persist:false});
      if(event.key===overrideKey)setReducedOverride(event.newValue==='true',{persist:false});
    });syncControls();
  }
  const api={LifecycleTracker,HandoffTracker:LifecycleTracker,matches,rowKey,beforeRender,afterRender,preview,setMode,setReducedOverride,
    getMode:()=>mode,effectiveMode,stopAll,refreshControls:syncControls,setPreviewCallback:callback=>{previewCallback=callback;},setLogger:callback=>{logger=callback;},
    suspend:()=>{stopAll();tracker.reset();queued=[];lastNext=null;},
    diagnostics:()=>({selected:mode,effective:effectiveMode(),reducedMotion:!!reducedMotion?.matches,override:allowReduced,
      webAnimations:typeof Element!=='undefined'&&typeof Element.prototype.animate==='function',reason:disabledReason()||'Enabled',
      lastTransition,lastSkip,counts:{...counts},running:running.size})};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof document!=='undefined'){root.DashboardMotion=api;document.addEventListener('DOMContentLoaded',initialise);}
})(typeof window!=='undefined'?window:globalThis);
