
(function (root) {
  'use strict';
  const number = v => v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
  const safe = v => v === null || v === undefined || v === '' ? '—' : String(v);
  const pad = v => String(v).padStart(2,'0');
  const isSimple = () => typeof document!=='undefined'&&document.documentElement.dataset.view==='simple';
  function formatTimecode(value,fpsValue=25) {
    const raw=number(value); if(raw===null)return '—';
    const seconds=Math.max(0,raw), fps=Math.max(1,Math.round(number(fpsValue)||25));
    let whole=Math.floor(seconds), frames=Math.floor((seconds-whole)*fps+1e-6);
    if(frames>=fps){whole++;frames=0;}
    return [Math.floor(whole/3600),Math.floor(whole%3600/60),whole%60,frames].map(pad).join(':');
  }
  function brightnessView(value) {
    const raw=number(value);
    return raw===null ? {ratio:0,label:'—',unknown:true} : {ratio:Math.max(0,Math.min(1,raw)),label:`${Math.round(raw*100)}%`,unknown:false};
  }
  function outputView(outputs,connected=true) {
    const code=number(outputs?.code);
    const known=connected&&outputs?.available===true&&[0,1,2].includes(code);
    const states={0:['fade-down','FADE DOWN',true],1:['fade-up','FADE UP',false],2:['hold','HOLD',true]};
    const [state,label,blink]=known?states[code]:['unknown','NO DATA',false];
    return {state,label,blink};
  }
  function setOutputStatus(outputs,{connected=true,directorFps=null}={}) {
    const view=outputView(outputs,connected), node=document.getElementById('output-status');
    if(node.textContent!==view.label)node.textContent=view.label;
    node.dataset.state=view.state;
    node.classList.toggle('is-up',view.state==='fade-up');
    node.classList.toggle('is-alert',view.blink);
    node.classList.toggle('is-unknown',view.state==='unknown');
    node.title=view.state==='unknown'?(outputs?.error||'No confirmed Director output status'):'Director output status: '+view.label;
    const fps=connected?number(directorFps):null;
    set('director-fps',fps===null?'— FPS':`${fps.toFixed(1).replace(/\.0$/,'')} FPS`);
    document.getElementById('director-fps').title='Average actual Director FPS; sample window is shown in diagnostics';
  }
  const sun='<svg class="sun" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4"/><path d="M1 10h3 M16 10h3 M10 1v3 M10 16v3 M4 4l2 2 M14 14l2 2 M16 4l-2 2 M6 14l-2 2"/></svg>';
  const speaker='<svg class="speaker" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8a6 6 0 0 1 0 8M19 5a10 10 0 0 1 0 14"/></svg>';
  const audioPositions=['media-prefix','media-suffix','layer-meta','media-label','off'];
  function audioView(value) { return value===true?'present':value===false?'absent':'unknown'; }
  function audioIndicator(item,label=false) {
    if(audioView(item.hasAudio)!=='present')return null;
    const icon=create('span',`audio-indicator${label?' audio-tag':''}`);
    icon.innerHTML=speaker;
    if(label)icon.append(create('span','','AUDIO'));
    icon.setAttribute('role','img');
    icon.setAttribute('aria-label','Embedded audio track');
    icon.title='This file has embedded audio (VideoClip.hasAudio). The icon does not show mute, volume or output state.';
    return icon;
  }
  function create(tag,cls,text) { const el=document.createElement(tag); el.className=cls;if(text!==undefined){el.textContent=safe(text);el.title=safe(text);}return el; }
  function set(id,value) {const el=document.getElementById(id);if(el){el.textContent=safe(value);el.title=safe(value);} }
  function transport(node,timeline) {
    node.replaceChildren();
    if(isSimple()) {
      node.append(create('span','transport-label','Track:'),create('span','transport-name',timeline.trackName));
      node.title=`Transport: ${safe(timeline.transportName)} · Track: ${safe(timeline.trackName)}`;
      return;
    }
    const ident=create('div','transport-id');
    for(const [caption,key,cls] of [['Transport','transportName',''],['Track','trackName','track-line']]) {
      const line=create('div',`transport-line ${cls}`);
      line.append(create('span','transport-label',caption+':'),create('span','transport-name',timeline[key]));ident.append(line);
    }
    const cards=create('div','section-cards');
    for(const [isNext,section] of [[false,timeline.currentSection],[true,timeline.nextSection]]) {
      const card=create('div',`section-card${isNext?' is-next':''}`);
      const caption=create('div','section-caption');caption.append(create('div','',isNext?'Next':'Current'),create('div','','Section'));
      const fields=create('div','section-fields');
      for(const [label,key] of [['TC','tc'],['MIDI','midi'],['OSC','osc'],['NOTES','notes']]) {
        const field=create('div','section-field');field.dataset.field=key;
        const value=create('span','section-value',section?.[key]);
        if(key==='osc')value.title=`CUE tag for OSC: ${safe(section?.[key])}`;
        field.append(create('span','section-field-label',label),value);fields.append(field);
      }
      card.append(caption,fields);card.title=safe(section?.name);cards.append(card);
    }
    node.append(ident,cards);
  }
  function applyBrightness(element,value) {
    const view=brightnessView(value);
    element.classList.toggle('is-unknown',view.unknown);
    element.querySelector('.level-fill').style.width=`${view.ratio*100}%`;
    element.querySelector('.brightness-value').textContent=view.label;
    element.setAttribute('aria-label',`Brightness: ${view.label}`);
    element.title=`Brightness: ${view.label}`;
  }
  function field(label,value,cls,boxCls='') {
    const el=create('div',`field ${cls}`), caption=create('span','field-label',label);
    el.append(caption,create('span',`value-box ${boxCls}`,value));return el;
  }
  const rowKey=item=>{
    let value=[item.layerUid,item.layerId,item.layerName].find(v=>v!==null&&v!==undefined&&v!==''&&v!=='—')??'';
    try{if(/^(?:0x[\da-f]+|\d+)$/i.test(String(value)))value=BigInt(value).toString();}catch(_){}
    return JSON.stringify(String(value));
  };
  function layerRow(item,summary=false,audioPosition='media-suffix') {
    const row=create('div','layer-row'); row.dataset.layerId=safe(item.layerId);row.dataset.audio=audioView(item.hasAudio);
    row.dataset.rowKey=rowKey(item);
    const layer=create('div','field layer-field');
    const name=create('span',`layer-name${String(item.layerName||'').length>24?' is-long':''}`,item.layerName);
    const meta=create('div','layer-meta'); const brightness=create('div','brightness');
    brightness.innerHTML=sun+'<span class="level-bar"><span class="level-fill"></span></span><span class="brightness-value"></span>';
    applyBrightness(brightness,item.brightness);
    if(summary)brightness.title=item.historySource==='active-exit'
      ? 'Last known layer brightness before leaving Active.'
      : item.brightnessSource==='FieldSequence.getSequencedValue'
      ? `Brightness from keyframes at ${item.brightnessReason==='sequenced-at-layer-start'?'layer':'media'} start (track beat ${item.brightnessSampleBeat}). Active uses the live value.`
      : `Start brightness is unknown: ${item.brightnessReason||'no data'}`;
    meta.append(create('span','layer-type',safe(item.layerType).toUpperCase()));
    if(audioPosition==='layer-meta') {
      const slot=create('span','audio-slot');const icon=audioIndicator(item);if(icon)slot.append(icon);meta.append(slot);
    }
    meta.append(brightness);
    layer.append(create('span','field-label','LAYER'),name,meta);
    const media=field('MEDIA',item.mediaName,'media-field','media-box');
    const box=media.querySelector('.value-box'),mediaText=create('span','media-text',item.mediaName);
    box.replaceChildren();
    if(audioPosition==='media-prefix'||audioPosition==='media-suffix') {
      const slot=create('span','audio-slot');const icon=audioIndicator(item);if(icon)slot.append(icon);
      if(audioPosition==='media-prefix')box.append(slot,mediaText);else box.append(mediaText,slot);
    } else {
      box.append(mediaText);
      if(audioPosition==='media-label') {
        const icon=audioIndicator(item,true);
        if(icon) {

          if(isSimple())box.append(icon);else media.querySelector('.field-label').append(icon);
        }
      }
    }
    const version=typeof item.mediaVersion==='string'&&item.mediaVersion!=='0'&&item.mediaVersion.length<=32&&/^[0-9][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$/.test(item.mediaVersion)?item.mediaVersion:null;
    if(version) {
      const tag=create('span','media-version',`v.${version}`);
      tag.setAttribute('aria-label',`Media version ${version}`);
      tag.title=`Enabled media version: ${version}`;
      mediaText.after(tag);
    }
    const audioState=audioView(item.hasAudio);
    box.title=safe(item.mediaName)+(version?` · v.${version}`:'')+' · '+(audioState==='present'?'embedded audio is present':audioState==='absent'?'Designer reports hasAudio=false':'embedded audio is unknown');
    row.append(layer,media);
    if(!summary) {
      if(!isSimple())row.append(field('AT END POINT',item.endPoint,'endpoint-field'));
      row.append(field('TIME ELAPSED',formatTimecode(item.elapsed,item.fps),'elapsed-field','time-box'),field('TIME REMAINING',formatTimecode(item.remaining,item.fps),'remaining-field','time-box'));
    } else if(isSimple()) {
      const duration=field('DURATION',item.durationTimecode,'duration-field','time-box');
      duration.title=item.durationSource?'Clip duration from Designer: '+item.durationSource:'Media duration is not available';
      row.append(duration);
    }
    return row;
  }
  function renderRows(id,items,limit,summary=false,audioPosition='media-suffix') {
    const node=document.getElementById(id);if(!node)return;
    const rows=Array.isArray(items)?items.slice(0,limit):[];
    if(rows.length===0){node.replaceChildren(create('div','empty-state',summary?'—':'NO ACTIVE LAYERS'));return;}


    const existing=new Map(Array.from(node.children).filter(el=>el.classList.contains('layer-row')).map(el=>[el.dataset.rowKey,el]));
    const desired=rows.map(item=>{
      const fresh=layerRow(item,summary,audioPosition), row=existing.get(fresh.dataset.rowKey);
      if(!row)return fresh;
      existing.delete(fresh.dataset.rowKey);
      row.dataset.layerId=fresh.dataset.layerId;row.dataset.audio=fresh.dataset.audio;
      row.replaceChildren(...fresh.childNodes);
      return row;
    });
    desired.forEach((row,index)=>{if(node.children[index]!==row)node.insertBefore(row,node.children[index]||null);});
    const retained=new Set(desired);
    Array.from(node.children).forEach(row=>{if(!retained.has(row))row.remove();});
  }

  function setCountdown(seconds,layerName,{hasSource=true,live=false,blinkAtSeconds=10}={}) {
    const raw=number(seconds), node=document.getElementById('countdown');
    const value=raw===null?null:Math.max(0,raw), rounded=value===null?null:Math.ceil(value);
    node.textContent=!hasSource?'--:--':rounded===null?(live?'LIVE':'--:--'):`${pad(Math.floor(rounded/60))}:${pad(rounded%60)}`;
    node.classList.toggle('is-ending',hasSource&&value!==null&&value>0&&value<=blinkAtSeconds);
    set('countdown-source',hasSource?layerName:'NO ACTIVE MEDIA');
  }
  function render(view,{updateCountdown=true}={}) {
    root.DashboardMotion?.beforeRender(view);
    const main=view.main||{}, second=view.second||{};
    const audioPosition=audioPositions.includes(view.audioIndicatorPosition)?view.audioIndicatorPosition:'media-suffix';
    document.documentElement.dataset.audioPosition=audioPosition;
    set('project-name',view.projectName);set('footer-version',view.appVersion?`v${String(view.appVersion).replace(/^v/,'')}`:'v0.4.13');
    setOutputStatus(view.outputs,{connected:view.connected!==false,directorFps:view.directorFps});
    transport(document.getElementById('main-transport'),main);transport(document.getElementById('second-transport'),second);
    set('main-play-mode',main.playMode);set('second-play-mode',second.playMode);
    set('next-play-mode',main.playbackMode);
    const onAir=document.getElementById('on-air');onAir.classList.toggle('is-off',main.onAir!==true);onAir.textContent=main.onAir===true?'● ON AIR':main.onAir===null?'● NO DATA':'● OFF AIR';
    renderRows('previous-row',main.previous?[main.previous]:[],1,true,audioPosition);renderRows('next-row',main.next?[main.next]:[],1,true,audioPosition);
    renderRows('main-active-rows',main.active,3,false,audioPosition);renderRows('second-active-rows',second.active,1,false,audioPosition);
    root.DashboardMotion?.afterRender(view);
    const source=main.countdownSource;
    if(updateCountdown)setCountdown(main.countdownSeconds,source?.layerName,{hasSource:!!source,live:!!source&&number(main.countdownSeconds)===null});
  }

  function fromBridgeState(state) {


    const mapLayer=item=>item?{...item,layerId:item.layerUid||item.layerName,
      mediaUid:item.mediaUid??(item.mediaResource?.uid===undefined?null:String(item.mediaResource.uid))}:null;
    const mapSection=section=>({name:section?.label,tc:section?.tc??null,midi:section?.midi??null,osc:section?.osc??null,notes:section?.notes??null});
    const mapTimeline=t=>({transportName:t?.transportName,trackName:t?.trackName,trackUid:t?.trackUid,currentBeat:t?.currentBeat,activeMembership:t?.activeMembership,playMode:t?.playMode,playbackMode:t?.playbackMode,onAir:!!t?.playing&&!t?.holding,currentSection:mapSection(t?.currentSection),nextSection:mapSection(t?.nextSection??t?.next),previous:mapLayer(t?.previous),next:mapLayer(t?.next),active:(Array.isArray(t?.active)?t.active:[]).map(mapLayer),countdownSource:t?.countdownSource,countdownSeconds:t?.countdownSeconds});
    return {projectName:state.project?.name,appVersion:state.appVersion,outputs:state.outputs,directorFps:state.performance?.fps??null,audioIndicatorPosition:state.ui?.audio_indicator_position,nextActiveAnimation:state.ui?.next_active_animation,connected:state.status?.connected===true,main:mapTimeline(state.main),second:mapTimeline(state.aux),statusText:state.status?.connected?'API CONNECTED':'API NOT CONNECTED'};
  }
  function updateLayerBrightness(role,layerId,value) {
    const list=document.getElementById(role==='second'?'second-active-rows':'main-active-rows');
    const row=Array.from(list.children).find(el=>el.dataset.layerId===String(layerId));
    if(row)applyBrightness(row.querySelector('.brightness'),value);
  }
  function clock() {
    const now=new Date();set('clock-hours',pad(now.getHours()));set('clock-minutes',pad(now.getMinutes()));
    document.getElementById('clock-colon').classList.toggle('off',now.getSeconds()%2===1);
    const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
    set('clock-date',`${pad(now.getDate())}-${months[now.getMonth()]}-${now.getFullYear()}`);
  }
  function fit() {document.getElementById('canvas').style.transform=`translate(-50%,-50%) scale(${Math.min(root.innerWidth/1920,root.innerHeight/1080)})`;}
  const api={render,setCountdown,setOutputStatus,outputView,audioView,fromBridgeState,updateLayerBrightness,formatTimecode,brightnessView};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(typeof document!=='undefined') {root.DashboardUI=api;fit();root.addEventListener('resize',fit);clock();setInterval(clock,250);}
})(typeof window!=='undefined'?window:globalThis);
