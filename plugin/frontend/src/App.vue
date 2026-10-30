<script setup>
import {computed,ref,onMounted,onBeforeUnmount,watch,nextTick} from 'vue';
import DiagnosticsView from './components/DiagnosticsView.vue';
import CompactView from './components/CompactView.vue';
import FullView from './components/FullView.vue';
import TransportChooser from './components/TransportChooser.vue';
import {useDashboard,VERSION} from './useDashboard.js';
const props=defineProps({view:String,context:String});
const dashboard=useDashboard(props.view,props.context);
const {state,pending,countdown,clock,links,diagnosticsOpen}=dashboard;
let observer=null;
function measureCompact(){
 if(props.view!=='compact'||props.context!=='designer')return;
 const node=document.getElementById('canvas');if(!node)return;
 // Normal-flow children include the footer exactly once; no viewport padding.
 const contentHeight=Math.ceil([...node.children].reduce((sum,child)=>{
  const style=getComputedStyle(child);
  return style.display==='none'||['fixed','absolute'].includes(style.position)?sum:sum+child.getBoundingClientRect().height;
 },0));
 // Designer owns the saved native geometry. outer* are device dimensions in
 // the supplied r33 report, so they must never be subtracted from CSS viewport.
 if(window.DPDNative)window.DPDNative.windowFit={contentHeight,viewportHeight:innerHeight,
  approvedViewportHeight:contentHeight,
  initialMetadataHeight:Number(document.querySelector('meta[name="disguise-plugin-window-size"]')?.content.split(',')[1])||null,
  minimumMetadataHeight:Number(document.querySelector('meta[name="disguise-plugin-window-min-size"]')?.content.split(',')[1])||null,heightMatches:Math.abs(innerHeight-contentHeight)<=2,spareHeight:innerHeight-contentHeight,
  status:Math.abs(innerHeight-contentHeight)<=2?'At approved height':innerHeight<contentHeight?'Smaller viewport: content scrolls':'Intrinsic content; host viewport is taller'};

}
const size=ref({width:innerWidth,height:innerHeight});
const canvasStyle=computed(()=>props.view==='compact'?{}:{transform:`translate(-50%,-50%) scale(${Math.min(size.value.width/1920,size.value.height/1080)})`});
function resize(){size.value={width:innerWidth,height:innerHeight};measureCompact();}
watch(()=>state.value.aux?.enabled,async()=>{await nextTick();measureCompact();});
onMounted(()=>{window.addEventListener('resize',resize);if(props.view==='compact'){observer=new ResizeObserver(measureCompact);observer.observe(document.getElementById('canvas'));measureCompact();}});onBeforeUnmount(()=>{window.removeEventListener('resize',resize);observer?.disconnect();dashboard.dispose();});
</script>
<template><component :is="view==='compact'?CompactView:FullView" :state="state" :clock="clock" :countdown="countdown" :version="VERSION" :links="links" :canvas-style="canvasStyle" :view="view" @diagnostics="dashboard.openDiagnostics"><DiagnosticsView v-if="diagnosticsOpen" :bridge="dashboard.bridge" :variant="view==='compact'?'compact':'full'" :embedded="true"/></component><TransportChooser v-if="pending" :request="pending" :variant="view==='compact'?'compact':'full'"/></template>
