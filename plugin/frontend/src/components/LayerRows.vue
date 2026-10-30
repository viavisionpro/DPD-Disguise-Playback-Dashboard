<script setup>
import {computed} from 'vue';
import LayerRow from './LayerRow.vue';
import {layerKey} from '../presenter.js';
const props=defineProps({items:Array,limit:{type:Number,default:3},summary:Boolean,compact:Boolean,simple:Boolean,audioPosition:String});
const rows=computed(()=>(Array.isArray(props.items)?props.items:[]).slice(0,props.limit));
</script>
<template><LayerRow v-for="item in rows" :key="layerKey(item)" :item="item" :summary="summary" :compact="compact" :simple="simple" :audio-position="audioPosition"/><div v-if="!rows.length" class="empty-state">{{summary?(compact?'Next —':'—'):'NO ACTIVE LAYERS'}}</div></template>
