<script setup>
import {computed} from 'vue';
import {mapBridge,safe,outputView,number} from '../presenter.js';
import LayerRows from './LayerRows.vue';
import TransportHeading from './TransportHeading.vue';
import StatusFooter from './StatusFooter.vue';
const props=defineProps({state:{type:Object,default:()=>({})},clock:{type:Object,default:()=>({time:'--:--',date:'—'})},countdown:{type:Object,default:()=>({text:'--:--',source:'NO ACTIVE MEDIA'})},version:{type:String,default:'0.5.9'},links:{type:Object,default:()=>({})},animation:String,canvasStyle:Object,view:{type:String,default:'compact'}});
defineEmits(['diagnostics']);
const display=computed(()=>mapBridge(props.state));
const main=computed(()=>display.value.main);
const second=computed(()=>display.value.second);
const output=computed(()=>outputView(props.state.outputs,props.state.status?.connected===true));
const fps=computed(()=>{const value=props.state.status?.connected?number(props.state.performance?.fps):null;return value===null?'— FPS':`${value.toFixed(1).replace(/\.0$/,'')} FPS`});
const audioPosition=computed(()=>['media-prefix','media-suffix','layer-meta','media-label','off'].includes(props.state.ui?.audio_indicator_position)?props.state.ui.audio_indicator_position:'media-suffix');
</script>
<template>
<main id="canvas" :style="canvasStyle" :class="{'data-stale':countdown.stale || state.status?.stale}" class="dashboard" aria-label="DPD - Plugin">
<header class="compact-header"><div class="header-identity"><div class="brand"><img src="assets/icons/favicon.svg" alt=""><span class="brand-title" style="font-weight:400;font-synthesis:none">Disguise Playback Dashboard</span></div><TransportHeading id="main-transport" class="transport" :timeline="main" compact/></div><div class="clock"><span><span id="clock-hours">{{clock.time?.split(':')[0]||'--'}}</span><span id="clock-colon">:</span><span id="clock-minutes">{{clock.time?.split(':')[1]||'--'}}</span></span><span id="clock-date">{{clock.date}}</span></div><div class="countdown-group"><div class="countdown-line"><span class="caption">TIME<br>REMAINING</span><span id="countdown" :class="{'is-ending':countdown.ending &amp;&amp; !countdown.stale,'is-stale':countdown.stale}">{{countdown.text}}</span></div><div id="countdown-source">{{countdown.source}}</div></div></header>
<div class="column-headings"><span>Layer</span><span>Media</span><span class="endpoint-heading" aria-label="At end point"></span><span>Elapsed</span><span>Remaining</span></div>
<section id="main-active-rows" aria-label="Main active layers"><LayerRows :items="main.active" :limit="3" compact/></section><section id="next-row" aria-label="Next layer"><LayerRows :items="main.next?[main.next]:[]" :limit="1" summary compact/></section>
<section id="second-section" v-if="second.enabled!==false" aria-label="Secondary transport"><TransportHeading id="second-transport" class="transport secondary-heading" :timeline="second" compact v-if="second.enabled!==false"/><div id="second-active-rows"><LayerRows :items="second.active" :limit="1" compact/></div></section>
<StatusFooter :state="state" :version="version" :links="links" :view="view" compact @diagnostics="$emit('diagnostics')"/>

<slot/></main>
</template>
