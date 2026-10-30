// Copyright (C) 2026 Vladimir Zakharov / viavision.pro
// SPDX-License-Identifier: GPL-3.0-only
(function(root){
 'use strict';
 const pythonJsonExpression=typeof module!=='undefined'&&module.exports?require('./python-data.js').jsonExpression:root.DPDPython.jsonExpression;
 function selectionRecord(list,choice){
  const main=list.find(t=>t.id===choice?.main),aux=choice?.aux?list.find(t=>t.id===choice.aux):null;
  if(!main||choice?.aux&&!aux||aux?.id===main.id)throw Error('Selected transport is no longer available.');
  const identity=t=>t?{id:t.id,name:t.name}:null;
  return {main:identity(main),aux:identity(aux)};
 }
 function resolveSelection(list,saved){
  if(list.length===1)return {main:list[0].id,aux:null};
  if(!saved||!list.length)return null;
  const matches=record=>record&&list.find(t=>t.id===record.id&&t.name===record.name);
  const main=matches(saved.main),aux=matches(saved.aux);
  if(!main||saved.aux&&!aux||main.id===aux?.id)return null;
  return {main:main.id,aux:list.length===2?list.find(t=>t.id!==main.id).id:aux?.id||null};
 }
 const NOTE_NAME='DPD_Plugin_Settings';
 function persistenceScript(payload){
  // A named Designer resource is the shared authority. No generated file URL.
  // Execute is used only for initialization/conditional changes, never polling.
  return `import json, uuid\npayload = ${pythonJsonExpression(payload)}\nnote = resourceManager.loadOrCreate(Path("objects/note/${NOTE_NAME}.apx"), Note)\nexisting = json.loads(note.text) if note.text.strip() else None\nif payload.get('initialize') and isinstance(existing, dict) and existing.get('schema') == 1:\n    return existing\nif not payload.get('initialize') and isinstance(existing, dict) and existing.get('revision') != payload.get('expectedRevision'):\n    return {'conflict': True, 'record': existing}\nrecord = {'schema': 1, 'project': payload['project'], 'selection': payload.get('selection'), 'revision': uuid.uuid4().hex}\nprevious = note.text\nmarkDirty(note)\ntry:\n    note.text = json.dumps(record, ensure_ascii=True)\n    note.save()\nexcept:\n    note.text = previous\n    raise\nreturn record`;
 }
 class SharedPreferences{
  constructor(client){this.client=client;this.record=null;}
  async open(director,project){
   this.project=project||'';
   this.url=new URL('/api/session/note?name='+encodeURIComponent(NOTE_NAME),director.origin);
   this.record=await this.write(null,true);
   return this.record;
  }
  async read(){
   const response=await this.client.json(this.url.href);
   const raw=response?.result?.text;
   if(typeof raw!=='string')throw Error('Designer Notes API did not return DPD settings text.');
   let record;
   try{record=JSON.parse(raw);}catch(_){throw Error('DPD settings Note contains invalid JSON. See project Notes / '+NOTE_NAME+'.');}
   if(!record||record.schema!==1||typeof record.revision!=='string')throw Error('Invalid DPD settings Note: '+NOTE_NAME);
   return record;
  }
  async write(selection,initialize=false,expectedRevision=null){
   const response=await this.client.json(this.client.director.origin+'/api/session/python/execute',4000,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:persistenceScript({project:this.project,selection,initialize,expectedRevision})})
   });
   let record=response.returnValue;
   if(typeof record==='string')record=JSON.parse(record);
   if(record?.conflict){this.record=record.record;throw Error('Shared transport choice changed in another window. Please try again.');}
   if(!record||record.schema!==1||!record.revision)throw Error('Designer did not confirm saving DPD preferences.');
   this.record=record;return record;
  }
  async save(list,selection,expectedRevision){return this.write(selectionRecord(list,selection),false,expectedRevision);}
 }
 const api={NOTE_NAME,selectionRecord,resolveSelection,persistenceScript,SharedPreferences};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DPDPreferences=api;
})(typeof window!=='undefined'?window:globalThis);
