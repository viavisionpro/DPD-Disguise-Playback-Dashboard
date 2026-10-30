// Connection parameters are not a native-host identity: Designer's web UI
// forwards director to iframe-hosted plugins too.
(function(root){
 'use strict';
 function entryContext(search,context={}){
  if(context.embedded)return 'browser';
  return new URLSearchParams(search||'').has('director')?'designer':'browser';
 }
 function entryView(search,context={}){
  if(entryContext(search,context)==='designer')return 'compact';
  return new URLSearchParams(search||'').get('view')==='simple'?'simple':'advanced';
 }
 const api={entryContext,entryView};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.DPDLaunch=api;
})(typeof window!=='undefined'?window:globalThis);
