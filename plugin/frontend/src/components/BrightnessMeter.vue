<script setup>
import { computed } from 'vue';
import { brightnessView } from '../presenter.js';
const props=defineProps({item:{type:Object,required:true},compact:Boolean,summary:Boolean});
const level=computed(()=>brightnessView(props.item.brightness));
const title=computed(()=>!props.summary ? `Brightness: ${level.value.label}` : props.item.historySource==='active-exit' ? 'Last known layer brightness before leaving Active.' : props.item.brightnessSource==='FieldSequence.getSequencedValue' ? `Brightness from keyframes at ${props.item.brightnessReason==='sequenced-at-layer-start'?'layer':'media'} start (track beat ${props.item.brightnessSampleBeat}). Active uses the live value.` : `Start brightness is unknown: ${props.item.brightnessReason||'no data'}`);
</script>
<template><span class="brightness" :class="{'is-unknown':level.unknown}" :title="title" :aria-label="`Brightness: ${level.label}`"><svg v-if="!compact" class="sun" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4"/><path d="M1 10h3 M16 10h3 M10 1v3 M10 16v3 M4 4l2 2 M14 14l2 2 M16 4l-2 2 M6 14l-2 2"/></svg><span class="level-bar"><span class="level-fill" :style="{width:level.ratio*100+'%'}"></span></span><span class="brightness-value">{{level.label}}</span></span></template>
