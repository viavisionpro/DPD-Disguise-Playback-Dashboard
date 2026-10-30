import {createApp} from 'vue';
import App from './App.vue';
import DiagnosticsView from './components/DiagnosticsView.vue';
const embedded=window.self!==window.top;
const path=location.pathname.split('/').pop().replace(/\.html$/,'');
const explicit=['advanced','simple','compact','diagnostics'].includes(path)?path:null;
const host=window.DPDDiagnosticsHost;
const view=host?'diagnostics':explicit==='diagnostics'?'diagnostics':window.DPDLaunch.entryContext(location.search,{embedded})==='designer'?'compact':explicit==='simple'?'simple':window.DPDLaunch.entryView(location.search,{embedded})==='simple'?'simple':'advanced';
const context=host?'child':window.DPDLaunch.entryContext(location.search,{embedded});
document.documentElement.dataset.view=view;
document.title=view==='compact'?'DPD - Plugin':'Disguise Playback Dashboard - '+view.charAt(0).toUpperCase()+view.slice(1)+' - Plugin';
function style(name){const link=document.createElement('link');link.rel='stylesheet';link.href=name+'?v=0.5.9';document.head.append(link);return new Promise((resolve,reject)=>{link.onload=resolve;link.onerror=()=>reject(Error('Stylesheet failed: '+link.href));});}
const sheets=view==='diagnostics'?['diagnostics.css']:view==='compact'?['compact.css','setup.css','diagnostics.css']:['dashboard.css',...(view==='simple'?['simple.css']:[]),'setup.css'];
Promise.all(sheets.map(style)).then(()=>{const app=createApp(view==='diagnostics'?DiagnosticsView:App,{view,context,bridge:host?.bridge,variant:host?.variant||'compact'});app.config.errorHandler=error=>{console.error(error);const node=document.createElement('pre');node.setAttribute('role','alert');node.textContent='DPD UI error: '+String(error);document.body.append(node);};app.mount('#app');}).catch(error=>{document.getElementById('app').textContent=String(error);});
