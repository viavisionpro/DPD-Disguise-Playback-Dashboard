<script setup>
import { computed } from 'vue';
import {safe, formatTimecode, layerKey, mediaVersion, audioView} from '../presenter.js';
import AudioIcon from './AudioIcon.vue';
import BrightnessMeter from './BrightnessMeter.vue';
const props=defineProps({item:{type:Object,required:true},summary:Boolean,compact:Boolean,simple:Boolean,audioPosition:{type:String,default:'media-suffix'}});
const endpoint=computed(()=>['Ping-Pong','Loop','Pause'].includes(props.item.endPoint)?props.item.endPoint:'—');
const version=computed(()=>mediaVersion(props.item));
const ending=computed(()=>props.item.remaining!==null && Number(props.item.remaining)>0 && Number(props.item.remaining)<=10);
const mediaTitle=computed(()=>safe(props.item.mediaName)+(version.value?` · v.${version.value}`:'')+' · '+(props.item.hasAudio===true?'embedded audio is present':props.item.hasAudio===false?'Designer reports hasAudio=false':'embedded audio is unknown'));
</script>
<template>
<div class="layer-row" :data-row-key="layerKey(item)" :data-layer-id="safe(item.layerUid ?? item.layerId ?? item.layerName)" :data-audio="audioView(item.hasAudio)">
  <template v-if="compact">
    <div class="identity"><div class="layer-field"><span class="layer-colour" :class="{'is-unknown':!item.ruleColour}" :style="item.ruleColour?{backgroundColor:item.ruleColour}:{}" :title="item.ruleColour?'Layer Colour Rules: '+item.ruleColour:'Layer rule colour unavailable'" role="img" :aria-label="item.ruleColour?'Layer rule colour':'Layer rule colour unavailable'"></span><span v-if="summary" class="next-label">Next</span><span class="layer-name" :title="safe(item.layerName)">{{safe(item.layerName)}}</span><span v-if="item.timingApproximate" class="timing-approx" title="Approximate timing derived from layer bounds" aria-label="Approximate timing">≈</span><BrightnessMeter :item="item" compact :summary="summary"/></div><div class="media-field value-box" :title="mediaTitle"><span class="media-text">{{safe(item.mediaName)}}</span><span v-if="version" class="media-version" :aria-label="`Media version ${version}`">v.{{version}}</span><AudioIcon v-if="item.hasAudio===true"/></div></div>
    <span class="compact-endpoint" title="At end point">{{endpoint}}</span>
    <div v-if="summary" class="duration-field time" :title="item.durationSource?'Clip duration from Designer: '+item.durationSource:'Media duration is not available'"><span class="caption">Duration</span><span>{{safe(item.durationTimecode)}}</span></div>
    <template v-else><span class="elapsed-field time">{{formatTimecode(item.elapsed,item.fps)}}</span><span class="remaining-field time" :class="{'is-ending':ending}">{{formatTimecode(item.remaining,item.fps)}}</span></template>
  </template>
  <template v-else>
    <div class="field layer-field"><span class="field-label">LAYER</span><span class="layer-name" :class="{'is-long':String(item.layerName||'').length>24}" :title="safe(item.layerName)">{{safe(item.layerName)}}</span><div class="layer-meta"><span class="layer-type">{{safe(item.layerType).toUpperCase()}}</span><span v-if="audioPosition==='layer-meta'" class="audio-slot"><AudioIcon v-if="item.hasAudio===true"/></span><BrightnessMeter :item="item" :summary="summary"/></div></div>
    <div class="field media-field"><span class="field-label">MEDIA<AudioIcon v-if="audioPosition==='media-label' && !simple && item.hasAudio===true" label class="audio-tag"/></span><span class="value-box media-box" :title="mediaTitle"><span v-if="audioPosition==='media-prefix'" class="audio-slot"><AudioIcon v-if="item.hasAudio===true"/></span><span class="media-text">{{safe(item.mediaName)}}</span><span v-if="version" class="media-version" :aria-label="`Media version ${version}`" :title="`Enabled media version: ${version}`">v.{{version}}</span><span v-if="audioPosition==='media-suffix'" class="audio-slot"><AudioIcon v-if="item.hasAudio===true"/></span><AudioIcon v-if="audioPosition==='media-label' && simple && item.hasAudio===true" label class="audio-tag"/></span></div>
    <template v-if="!summary"><div v-if="!simple" class="field endpoint-field"><span class="field-label">AT END POINT</span><span class="value-box">{{safe(item.endPoint)}}</span></div><div class="field elapsed-field"><span class="field-label">TIME ELAPSED</span><span class="value-box time-box">{{formatTimecode(item.elapsed,item.fps)}}</span></div><div class="field remaining-field"><span class="field-label">TIME REMAINING</span><span class="value-box time-box">{{formatTimecode(item.remaining,item.fps)}}</span></div></template>
    <div v-else-if="simple" class="field duration-field" :title="item.durationSource?'Clip duration from Designer: '+item.durationSource:'Media duration is not available'"><span class="field-label">DURATION</span><span class="value-box time-box">{{safe(item.durationTimecode)}}</span></div>
  </template>
</div>
</template>
