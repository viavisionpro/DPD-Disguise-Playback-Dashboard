// Copyright (C) 2026 Vladimir Zakharov / viavision.pro
// SPDX-License-Identifier: GPL-3.0-only
(function(root) {
  'use strict';

  function endpoint(authority, port = 80) {
    const host = String(authority || '').trim();
    if (!host || /[\s/@?#\\]/.test(host) || host.includes('://'))
      throw new Error('Director must be a hostname or IP address, optionally with a port.');
    const url = new URL('http://' + host);
    if (url.pathname !== '/' || url.username || url.password || !url.hostname)
      throw new Error('Invalid Director address.');
    const explicitPort = host.startsWith('[') ? /\]:\d+$/.test(host) : /:\d+$/.test(host);
    const selectedPort=explicitPort?Number(host.match(/:(\d+)$/)[1]):Number(port);
    if(!Number.isInteger(selectedPort) || selectedPort<1 || selectedPort>65535)
      throw new Error('Director port must be between 1 and 65535.');
    if (!explicitPort) url.port = String(selectedPort);
    return url;
  }

  function transportExpression(settings) {
    if (String(settings.transport_expression || '').trim()) return settings.transport_expression.trim();
    const name = String(settings.transport || 'default');
    return /^[A-Za-z0-9_]+$/.test(name.trim()) ? 'transportmanager:' + name.trim()
      : 'transportmanager:"' + name.replace(/\\/g,'\\\\').replace(/"/g,'\\"') + '"';
  }

  function normaliseTransports(response) {
    const rows=response?.transports ?? response?.result?.transports;
    if(!Array.isArray(rows)) throw new Error('Designer did not return a transport list.');
    const seen=new Set(),list=[];
    for(const row of rows) {
      if(!row || typeof row.name!=='string' || !row.name.trim()) continue;
      const uid=String(row.uid ?? '').trim();
      let id=uid || 'name:'+row.name;
      if(/^(?:0x[\da-f]+|\d+)$/i.test(uid)) id=BigInt(uid).toString();
      if(seen.has(id)) continue;
      seen.add(id);list.push({id,uid,name:row.name,trackName:String(row.currentTrack?.name || '')});
    }
    return list;
  }

  function applyTransportSelection(config, list, selection) {
    const main=list.find(item=>item.id===selection?.main);
    if(!main) throw new Error('The selected main transport is no longer available.');
    const auxId=list.length===2?list.find(item=>item.id!==main.id).id:selection.aux;
    if(auxId===main.id) throw new Error('Main and secondary transports must be different.');
    const aux=auxId?list.find(item=>item.id===auxId):null;
    if(auxId && !aux) throw new Error('The selected secondary transport is no longer available.');
    for(const [role,transport] of [['main',main],['aux',aux]])
      Object.assign(config.timelines[role],{transport:transport?.name || '—',transport_expression:'',enabled:Boolean(transport)});
    return {main:main.id,aux:aux?.id || null};
  }

  function buildSubscriptions(config, p) {
    const updates = config.updates || {}, specs = [];
    const add = (key, object, property, setting, fallback) => {
      const frequency = Number(updates[setting] ?? fallback);
      if (typeof property !== 'string' || !property) throw new Error('Missing subscription expression: ' + key);
      if (!Number.isFinite(frequency) || frequency < 50) throw new Error('Invalid update frequency: ' + setting);
      specs.push({key, object, property, frequency});
    };
    add('output_state', 'domain:MappedMedia', p.OUTPUT_STATE_PROPERTY, 'outputs_ms', 100);
    add('media_schedule', 'domain:MappedMedia', p.MEDIA_SCHEDULE_PROPERTY, 'schedule_ms', 1000);
    const fields = [
      ['transport','TRANSPORT_STATE_PROPERTY','transport_ms',100],
      ['sections','SECTIONS_PROPERTY','sections_ms',1000],
      ['active_content','ACTIVE_GRAPHICAL_PROPERTY','active_layers_ms',100],
      ['active_brightness','ACTIVE_BRIGHTNESS_PROPERTY','brightness_ms',100],
      ['active_standard_video_details','ACTIVE_STANDARD_VIDEO_DETAILS_PROPERTY','video_details_ms',500],
      ['active_standard_video_frames','ACTIVE_STANDARD_VIDEO_FRAMES_PROPERTY','video_timing_ms',250],
      ['active_standard_video_elapsed','ACTIVE_STANDARD_VIDEO_ELAPSED_PROPERTY','video_timing_ms',250],
      ['active_standard_video_remaining','ACTIVE_STANDARD_VIDEO_REMAINING_PROPERTY','video_timing_ms',250],
      ['active_variable_video_details','ACTIVE_VARIABLE_VIDEO_DETAILS_PROPERTY','video_details_ms',500],
      ['active_variable_video_frames','ACTIVE_VARIABLE_VIDEO_FRAMES_PROPERTY','video_timing_ms',250],
      ['active_variable_video_elapsed','ACTIVE_VARIABLE_VIDEO_ELAPSED_PROPERTY','video_timing_ms',250],
      ['active_variable_video_remaining','ACTIVE_VARIABLE_VIDEO_REMAINING_PROPERTY','video_timing_ms',250]
    ];
    for (const role of ['main','aux']) {
      if(config.timelines[role].enabled===false) continue;
      const object = transportExpression(config.timelines[role]);
      for (const [key,prop,setting,ms] of fields) add(role+'.'+key, object, p[prop], setting, ms);
    }
    const samples = Math.max(1, Math.min(300, Math.trunc(Number(updates.fps_average_samples) || 60)));
    add('director_fps',p.DIRECTOR_FPS_OBJECT,`object.seriesAverage("Actual", ${samples})`,'fps_ms',1000);
    for (const [key,prop,setting] of [
      ['director_fps_raw','DIRECTOR_FPS_RAW_PROPERTY','fps_ms'],
      ['media_metadata','MEDIA_METADATA_PROPERTY','media_metadata_ms'],
      ['media_audio','MEDIA_AUDIO_PROPERTY','media_audio_ms'],
      ['media_versions','MEDIA_VERSIONS_PROPERTY',''],['media_files','MEDIA_FILES_PROPERTY',''],
      ['preview_brightness','PREVIEW_BRIGHTNESS_PROPERTY','preview_brightness_ms']
    ]) add(key,key==='director_fps_raw'?p.DIRECTOR_FPS_OBJECT:'domain:MappedMedia',p[prop],setting,1000);
    for (const role of ['main','aux']) {
      if(config.timelines[role].enabled===false) continue;
      const object=transportExpression(config.timelines[role]);
      add(role+'.graphical_schedule',object,p.GRAPHICAL_SCHEDULE_PROPERTY,'layers_ms',1000);
      add(role+'.graphical_preview_brightness',object,p.GRAPHICAL_PREVIEW_BRIGHTNESS_PROPERTY,'preview_brightness_ms',1000);
    }
    return specs;
  }

  const optionalKey=key=>/^(main|aux)\.layer_colours$/.test(key);
  function optionalSubscriptions(source,config) {
    const specs=typeof source==='function'?source(config):source;
    if(!Array.isArray(specs)) throw new Error('Optional subscriptions must be an array.');
    const seen=new Set();
    return specs.map(spec=>{
      if(!spec || typeof spec.key!=='string' || !optionalKey(spec.key) || seen.has(spec.key))
        throw new Error('Invalid or duplicate optional subscription key.');
      if(typeof spec.object!=='string' || !spec.object.trim() || typeof spec.property!=='string' || !spec.property.trim())
        throw new Error('Missing optional subscription expression: '+spec.key);
      if(typeof spec.frequency!=='number' || !Number.isFinite(spec.frequency) || spec.frequency<1000)
        throw new Error('Optional subscription frequency must be at least 1000 ms.');
      seen.add(spec.key);
      return {key:spec.key,object:spec.object,property:spec.property,frequency:spec.frequency};
    });
  }

  class NativeClient {
    constructor(config, properties, deps = {}) {
      this.config = JSON.parse(JSON.stringify(config));
      this.properties=properties;
      this.selectTransports=deps.selectTransports;
      this.Preferences=root.DPDPreferences||(typeof require==='function'?require('./preferences.js'):null);
      this.preferences=deps.preferences===true?new this.Preferences.SharedPreferences(this):deps.preferences||null;
      this.availableTransports=[];this.selection=null;this.selectionBusy=false;
      this.selectionSession=Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
      this.fetch = deps.fetch || root.fetch.bind(root);
      this.WebSocket = deps.WebSocket || root.WebSocket;
      this.location = deps.location || root.location;
      this.setTimeout = deps.setTimeout || root.setTimeout.bind(root);
      this.clearTimeout = deps.clearTimeout || root.clearTimeout.bind(root);
      this.now = deps.now || Date.now;
      const State = !deps.store && (root.DPDState || (typeof require==='function' ? require('./state.js') : null));
      this.State=State;
      this.store = deps.store || new State.DashboardStore(this.config);
      this.specs = buildSubscriptions(this.config, properties);
      this.optionalSource=null;this.optionalSpecs=[];
      this.optionalValues={};this.optionalErrors={};
      this.logs = [];
      this.socket = null;
      this.stopped = true;
      this.generation = 0;
      this.retryDelay = this.initialDelay();
      this.ids = new Map();
      this.early = new Map();
      this.annotationTracks = {};
      this.annotationBusy = false;
      this.requests = new Set();
    }

    initialDelay() { return Math.max(0.1, Number(this.config.designer.reconnect_initial_seconds || 1))*1000; }
    log(level, message, context) {
      let detail='';
      if (context!==undefined && context!==null) {try {detail=' '+JSON.stringify(context);}catch (_) {detail=' [unserializable context]';}}
      this.logs.push(`${new Date(this.now()).toISOString()} ${level} ${String(message)}${detail}`.slice(0,8000));
      if(this.logs.length>1000) this.logs.splice(0,this.logs.length-1000);
    }
    logTail(lines=250) { return this.logs.slice(-Math.max(1,Math.min(1000,lines))).join('\n'); }
    snapshot() { return this.store.snapshot(); }

    // Install once: specs or a synchronous factory(config) for current transport roles.
    // Expressions come from trusted internal builders; repeating the same source is a no-op.
    setOptionalSubscriptions(source) {
      if(this.optionalSource!==null && this.optionalSource===source) return;
      if(this.optionalSource!==null) throw new Error('Optional subscriptions are already installed.');
      const specs=optionalSubscriptions(source,this.config);
      this.optionalSource=source;
      this.optionalSpecs=specs;
      this.specs.push(...specs);
      if(!this.pending && this.socket?.readyState===1) this.subscribeNext();
    }

    optionalError(key,message) {
      delete this.optionalValues[key];
      if(this.optionalErrors[key]!==message) this.log('WARNING',message,key);
      this.optionalErrors[key]=message;
    }

    async json(url, timeout=4000, options={}) {
      const controller = new AbortController();
      this.requests.add(controller);
      const timer=this.setTimeout(()=>controller.abort(),timeout);
      try {
        const response=await this.fetch(String(url),{...options,cache:'no-store',signal:controller.signal});
        if(!response.ok) throw new Error('HTTP '+response.status+' '+url);
        const data=await response.json();
        if(data?.status && Number(data.status.code)!==0)
          throw new Error(data.status.message || 'Designer API error '+data.status.code);
        return data;
      } catch(error) {
        const message=(options.method||'GET')+' '+url+' — '+String(error);
        this.log('ERROR','Designer request failed',{method:options.method||'GET',url:String(url),error:String(error)});
        throw new Error(message);
      } finally {this.clearTimeout(timer);this.requests.delete(controller);}
    }

    async resolveDirector() {
      const settings=this.config.designer;
      const params=new URLSearchParams(this.location?.search || '');
      const provided=params.get('director');
      const pageHost=this.selectTransports && !provided ? (this.location.host || new URL(this.location.href).host) : '';
      const seed=endpoint(provided || pageHost || settings.director_host_override || settings.host || this.location.hostname,
        this.selectTransports ? Number(this.location.port)||80 : settings.port || 80);
      this.directorName=seed.hostname;
      let status;
      try {status=await this.json(seed.origin+'/api/session/status/session');}
      catch(error) {
        if(this.selectTransports || (!settings.director_host_override && settings.auto_discover_director!==false)) throw error;
        this.log('WARNING','Optional Director identity lookup failed',String(error));
        return seed;
      }
      const session=status.result || {}, hostname=String(session.director?.hostname || '').trim();
      this.directorName=hostname || seed.hostname;
      if((!this.selectTransports && (settings.director_host_override || settings.auto_discover_director===false)) || session.isRunningSolo || !hostname)
        return seed;
      const director=endpoint(hostname,Number(seed.port)||80);
      if(director.origin===seed.origin) return seed;
      try {await this.json(director.origin+'/api/session/status/project',2000);return director;}
      catch(error) {
        this.log('WARNING','Reported Director hostname is unreachable; using session endpoint',String(error));
        return seed;
      }
    }

    async start() {
      if(!this.stopped) return;
      this.stopped=false;
      await this.connect();
    }

    async connect() {
      if(this.stopped) return;
      const generation=++this.generation;
      this.optionalValues={};this.optionalErrors={};
      const current=()=>!this.stopped && generation===this.generation;
      this.store.set_connection(false,'connecting');
      try {
        const director=await this.resolveDirector();
        if(!current()) return;
        this.director=director;
        this.log('INFO','Designer connection context',{page:this.location.href,api:director.origin,preferences:'Notes API: DPD_Plugin_Settings'});
        this.store.seed_host=new URLSearchParams(this.location?.search||'').get('director') || this.config.designer.host;
        let projectData={};
        try {
          const project=await this.json(director.origin+'/api/session/status/project');
          if(!current()) return;
          projectData=project.result||{};this.projectData=projectData;
          this.store.update_project(projectData);
        } catch(error) {this.log('WARNING','Project information unavailable',String(error));}
        if(!current()) return;
        if(this.selectTransports) {
          this.store.set_connection(false,'detecting-transports',director.host);
          const response=await this.json(director.origin+'/api/session/transport/transports');
          if(!current()) return;
          const list=normaliseTransports(response);
          if(!list.length) throw new Error('No transports found in this project. Waiting for a transport.');
          this.availableTransports=list;
          let saved=null,decisionRevision=null;
          if(this.preferences){const record=await this.preferences.open(director,String(projectData.projectPath||''),this.location);saved=record.selection;decisionRevision=record.revision;if(!current())return;}
          this.selectionAbort=new AbortController();
          this.store.set_connection(false,'choose-transports',director.host);
          const selection=await this.selectTransports(list,{signal:this.selectionAbort.signal,
            key:director.origin+'|'+String(projectData.projectPath || 'unidentified-'+this.selectionSession),
            projectName:this.store.project?.name || '',saved,revision:decisionRevision,shared:Boolean(this.preferences),
            readSaved:this.preferences?async()=>{
              const [record,fresh]=await Promise.all([this.preferences.read(),this.json(director.origin+'/api/session/transport/transports')]);
              const signature=rows=>JSON.stringify(rows.map(t=>[t.id,t.name]).sort((a,b)=>a[0].localeCompare(b[0])));
              if(signature(normaliseTransports(fresh))!==signature(list)){const error=new Error('Transport list changed; refreshing selection.');error.topologyChanged=true;throw error;}
              return record;
            }:null});
          if(!current()) return;
          if(this.preferences){
            const fresh=normaliseTransports(await this.json(director.origin+'/api/session/transport/transports'));
            if(!current())return;
            const identities=rows=>JSON.stringify(rows.map(t=>[t.id,t.name]).sort((a,b)=>a[0].localeCompare(b[0])));
            if(identities(fresh)!==identities(list))throw Error('Transport list changed before confirmation. Refreshing selection.');
            const record=this.Preferences.selectionRecord(list,selection);
            const authoritative=await this.preferences.read();if(!current())return;
            if(JSON.stringify(record)!==JSON.stringify(authoritative.selection))await this.preferences.save(list,selection,selection.expectedRevision??decisionRevision);
            else this.preferences.record=authoritative;
            if(!current())return;
          }
          const chosen=applyTransportSelection(this.config,list,selection);this.selection=chosen;
          const signature=JSON.stringify([chosen,this.config.timelines.main.transport,this.config.timelines.aux.transport]);
          if(this.transportChoice && this.transportChoice!==signature && this.State) {
            this.store=new this.State.DashboardStore(this.config);
            this.store.update_project(projectData);
          }
          this.transportChoice=signature;
          this.log('INFO','Transports selected',{main:this.config.timelines.main.transport,aux:this.config.timelines.aux.enabled?this.config.timelines.aux.transport:null});
        }
        if(!current()) return;
        if(this.optionalSource!==null) this.optionalSpecs=optionalSubscriptions(
          typeof this.optionalSource==='function'?this.optionalSource:this.optionalSpecs,this.config);
        this.specs=[...buildSubscriptions(this.config,this.properties),...this.optionalSpecs];
        const socket=new this.WebSocket('ws://'+director.host+'/api/session/liveupdate');
        this.socket=socket;
        this.ids.clear(); this.early.clear(); this.pending=null; this.nextSpec=0;this.annotationTracks={};
        const openTimeout=Math.max(500,Number(this.config.designer.connect_timeout_seconds||5)*1000);
        this.openTimer=this.setTimeout(()=>{if(current())this.disconnect('Designer connection timed out');},openTimeout);
        socket.onopen=()=>{
          if(!current()) return;
          this.clearTimeout(this.openTimer);
          this.retryDelay=this.initialDelay();
          this.lastRx=this.now();
          this.store.set_connection(true,'live',director.host);
          this.store.set_director_identity(this.directorName,/^[\d.]+$/.test(director.hostname)?director.hostname:'');
          this.log('INFO','Live Update connected',director.host);
          this.subscribeNext();this.heartbeat(generation);
        };
        socket.onmessage=event=>{
          if(!current()) return;
          try {this.handleMessage(JSON.parse(event.data));}
          catch(error) {this.store.set_error(String(error));this.log('ERROR','Invalid Live Update message',String(error));}
        };
        socket.onerror=()=>{if(current())this.disconnect('Designer WebSocket connection failed');};
        socket.onclose=event=>{if(current())this.disconnect('Live Update closed ('+event.code+')');};
      } catch(error) {if(current())this.disconnect(String(error));}
    }

    subscribeNext() {
      this.clearTimeout(this.subscribeTimer);
      if(this.stopped || this.socket?.readyState!==1) return;
      this.pending=this.specs[this.nextSpec] || null;
      if(!this.pending) return;
      ++this.nextSpec;
      const spec=this.pending;
      this.socket.send(JSON.stringify({subscribe:{object:spec.object,properties:[spec.property],configuration:{updateFrequencyMs:spec.frequency}}}));
      this.subscribeTimer=this.setTimeout(()=>{
        if(optionalKey(spec.key)) this.optionalError(spec.key,'No subscription acknowledgement');
        else {
          this.store.set_stream_error(spec.key,'No subscription acknowledgement');
          this.log('WARNING','No subscription acknowledgement',spec.key);
        }
        this.subscribeNext();
      },Math.max(100,Number(this.config.designer.subscribe_timeout_seconds || 2)*1000));
    }

    handleMessage(data) {
      if(!data || typeof data!=='object' || Array.isArray(data)) throw new Error('Expected a Live Update object');
      const recognized=Array.isArray(data.subscriptions)||Array.isArray(data.valuesChanged)||Object.hasOwn(data,'error');
      if(!recognized) return;
      this.lastRx=this.now();this.store.touch();
      if(data.error!==undefined) {
        const error=String(data.error);
        if(optionalKey(this.pending?.key)) this.optionalError(this.pending.key,error);
        else if(!this.pending && this.optionalSource!==null) this.log('WARNING','Unassociated Live Update error',error);
        else {
          this.store.set_error(error);this.log('ERROR',error,this.pending?.key);
          if(this.pending) this.store.set_stream_error(this.pending.key,error);
        }
      }
      if(Array.isArray(data.subscriptions)) {
        for(const item of data.subscriptions) {
          if(!item || !Number.isInteger(item.id)) continue;
          let specs=this.specs.filter(s=>s.object===item.objectPath&&s.property===item.propertyPath);
          if(!specs.length) {
            const candidates=this.specs.filter(s=>s.property===item.propertyPath);
            if(candidates.length===1) specs=candidates;
          }
          if(!specs.length) continue;
          this.ids.set(item.id,specs.map(s=>s.key));
          if(this.early.has(item.id)) {
            for(const spec of specs) this.storeValue(spec.key,this.early.get(item.id));
            this.early.delete(item.id);
          }
        }
      }
      if(Array.isArray(data.valuesChanged)) {
        for(const item of data.valuesChanged) {
          if(!item || !Number.isInteger(item.id)) continue;
          const keys=this.ids.get(item.id);
          if(keys) {for(const key of keys) this.storeValue(key,item.value);}
          else if(this.early.size<500) this.early.set(item.id,item.value);
        }
        this.refreshAnnotations();
      }
      if(this.pending && (data.error!==undefined || [...this.ids.values()].flat().includes(this.pending.key))) this.subscribeNext();
    }

    storeValue(key, value) {
      const propertyError=item=>item && typeof item==='object' && !Array.isArray(item) && item.errorType;
      if(optionalKey(key)) {
        const pending=[value],errors=[];
        while(pending.length) {
          const item=pending.pop();
          if(propertyError(item)) errors.push(item);
          else if(item && typeof item==='object') for(const nested of Object.values(item)) pending.push(nested);
        }
        if(errors.length) this.optionalError(key,[...new Set(errors.map(item=>`${item.errorType}: ${item.message || 'Unknown property-path error'}`))].join(' | '));
        else {this.optionalValues[key]=value;delete this.optionalErrors[key];}
        return;
      }
      const errors=Array.isArray(value)?value.filter(propertyError):propertyError(value)?[value]:[];
      if(errors.length) {
        const clean=Array.isArray(value)?value.filter(item=>!propertyError(item)):null;
        if(clean?.length) this.store.update_value(key,clean);
        const message=[...new Set(errors.map(item=>`${item.errorType}: ${item.message || 'Unknown property-path error'}`))].join(' | ');
        this.store.set_stream_error(key,message);this.log('ERROR',message,key);
      } else this.store.update_value(key,value);
    }

    heartbeat(generation) {
      this.heartbeatTimer=this.setTimeout(()=>{
        if(this.stopped || generation!==this.generation) return;
        const stale=Math.max(1,Number(this.config.logic?.stale_after_seconds || 3))*1000;
        if(this.now()-this.lastRx>stale) {this.disconnect('Live Update heartbeat timed out');return;}
        try {
          // A valid unsubscribe action returns the full subscription list. Empty IDs
          // leave all subscriptions intact and verify a paused connection too.
          this.socket.send(JSON.stringify({unsubscribe:{ids:[]}}));
        } catch(error) {this.disconnect(String(error));return;}
        this.refreshAnnotations();this.refreshSelection();this.heartbeat(generation);
      },1000);
    }

    async refreshSelection() {
      if(!this.preferences||this.selectionBusy||!this.store.connected||this.stopped)return;
      this.selectionBusy=true;
      const generation=this.generation;
      try {
        const [record,response]=await Promise.all([this.preferences.read(),this.json(this.director.origin+'/api/session/transport/transports')]);
        if(this.stopped||generation!==this.generation)return;
        const list=normaliseTransports(response);this.availableTransports=list;
        const choice=this.Preferences.resolveSelection(list,record.selection);
        if(!choice||JSON.stringify(choice)!==JSON.stringify(this.selection))this.restart();
        else this.preferences.record=record;
      }catch(error){
        if(!this.stopped&&generation===this.generation){this.store.set_error('Transport settings sync: '+String(error));this.log('WARNING','Transport settings sync failed',String(error));}
      }finally{this.selectionBusy=false;}
    }

    async changeMain(id) {
      if(!this.preferences||this.stopped)throw Error('Shared transport selection is not ready.');
      const generation=this.generation,decisionRevision=this.preferences.record?.revision;
      const list=normaliseTransports(await this.json(this.director.origin+'/api/session/transport/transports'));
      if(this.stopped||generation!==this.generation)throw Error('Connection changed; try selecting the transport again.');
      if(!list.some(t=>t.id===id))throw Error('The selected transport is no longer available.');
      const aux=list.length===2?list.find(t=>t.id!==id):this.selection?.aux
        ?list.find(t=>t.id!==id&&t.id===this.selection.aux)||list.find(t=>t.id!==id&&t.id===this.selection.main)||list.find(t=>t.id!==id):null;
      await this.preferences.save(list,{main:id,aux:aux?.id||null},decisionRevision);
      if(!this.stopped&&generation===this.generation)this.restart();
    }

    async changeSecondary(id) {
      if(!this.preferences||this.stopped)throw Error('Shared transport selection is not ready.');
      const generation=this.generation,decisionRevision=this.preferences.record?.revision;
      const list=normaliseTransports(await this.json(this.director.origin+'/api/session/transport/transports'));
      if(this.stopped||generation!==this.generation)throw Error('Connection changed; try selecting again.');
      if(list.length<3||id===this.selection?.main||id&&!list.some(t=>t.id===id))throw Error('The secondary selection is no longer available.');
      await this.preferences.save(list,{main:this.selection.main,aux:id||null},decisionRevision);
      if(!this.stopped&&generation===this.generation)this.restart();
    }

    restart() {
      this.stop();
      if(this.State){this.store=new this.State.DashboardStore(this.config);if(this.projectData)this.store.update_project(this.projectData);}
      return this.start();
    }

    async refreshAnnotations() {
      if(this.annotationBusy || !this.store.connected || !this.director) return;
      const sources=this.config.logic?.section_label_priority || ['number'];
      if(this.config.logic?.section_metadata_enabled===false && !sources.some(s=>['note','cue','index'].includes(String(s).toLowerCase()))) return;
      this.annotationBusy=true;
      const generation=this.generation, origin=this.director.origin;
      const interval=Math.max(1,Number(this.config.updates?.annotations_seconds || 10))*1000;
      try {
        for(const role of ['main','aux']) {
          if(this.stopped || generation!==this.generation) return;
          if(this.config.timelines[role].enabled===false) continue;
          const identity=this.store.track_identities()[role], last=this.annotationTracks[role];
          if(!identity.name || identity.name==='NOT CONNECTED') continue;
          const key=JSON.stringify(identity);
          if(last?.key===key && this.now()-last.at<interval) continue;
          this.annotationTracks[role]={key,at:this.now()};
          const locator=identity.uid?'uid='+encodeURIComponent(identity.uid):'name='+encodeURIComponent(identity.name);
          try {
            const data=await this.json(origin+'/api/session/transport/annotations?'+locator);
            if(this.stopped || generation!==this.generation) return;
            this.store.update_annotations(role,data.result||{},identity);
          } catch(error) {
            if(!this.stopped && generation===this.generation && JSON.stringify(this.store.track_identities()[role])===key) {
              this.store.set_stream_error(role+'.annotations',String(error));this.log('WARNING','Annotations unavailable',String(error));
            }
          }
        }
      } finally {this.annotationBusy=false;}
    }

    clearConnection() {
      this.optionalValues={};this.optionalErrors={};
      for(const key of ['openTimer','subscribeTimer','heartbeatTimer','retryTimer']) {
        this.clearTimeout(this[key]);this[key]=null;
      }
      this.pending=null;
      this.selectionAbort?.abort();this.selectionAbort=null;
      for(const controller of this.requests) controller.abort();
      this.requests.clear();
      const socket=this.socket;this.socket=null;
      if(socket) {socket.onopen=socket.onmessage=socket.onerror=socket.onclose=null;socket.close();}
    }

    disconnect(error) {
      ++this.generation;
      this.clearConnection();
      this.store.set_connection(false,'reconnecting',this.director?.host || '',error);
      this.log('WARNING','Designer disconnected',error);
      if(this.stopped) return;
      const delay=this.retryDelay;
      this.retryDelay=Math.min(Math.max(this.initialDelay(),Number(this.config.designer.reconnect_max_seconds||15)*1000),delay*1.8);
      this.retryTimer=this.setTimeout(()=>this.connect(),delay);
    }

    stop() {
      this.stopped=true;++this.generation;this.clearConnection();
      this.store.set_connection(false,'stopped',this.director?.host || '');
    }
  }

  const api={NativeClient,endpoint,transportExpression,buildSubscriptions,normaliseTransports,applyTransportSelection};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.DPDDesigner=api;
})(typeof window!=='undefined'?window:globalThis);
