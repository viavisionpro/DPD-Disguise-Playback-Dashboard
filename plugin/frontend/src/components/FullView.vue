<script setup>
import {computed} from 'vue';
import {mapBridge,safe,outputView,number} from '../presenter.js';
import LayerRows from './LayerRows.vue';
import TransportHeading from './TransportHeading.vue';
import StatusFooter from './StatusFooter.vue';
const props=defineProps({state:{type:Object,default:()=>({})},clock:{type:Object,default:()=>({time:'--:--',date:'—'})},countdown:{type:Object,default:()=>({text:'--:--',source:'NO ACTIVE MEDIA'})},version:{type:String,default:'0.5.9'},links:{type:Object,default:()=>({})},animation:String,canvasStyle:Object,view:{type:String,default:'advanced'}});
defineEmits(['diagnostics']);
const display=computed(()=>mapBridge(props.state));
const main=computed(()=>display.value.main);
const second=computed(()=>display.value.second);
const output=computed(()=>outputView(props.state.outputs,props.state.status?.connected===true));
const fps=computed(()=>{const value=props.state.status?.connected?number(props.state.performance?.fps):null;return value===null?'— FPS':`${value.toFixed(1).replace(/\.0$/,'')} FPS`});
const audioPosition=computed(()=>['media-prefix','media-suffix','layer-meta','media-label','off'].includes(props.state.ui?.audio_indicator_position)?props.state.ui.audio_indicator_position:'media-suffix');
</script>
<template>
<template v-if="view==='simple'"><main id="canvas" :style="canvasStyle" :class="{'data-stale':countdown.stale || state.status?.stale}" class="dashboard simple-layout" aria-label="Disguise Playback Dashboard">
  <header class="header panel">
    <div class="project-group">
      <div class="branding-line">

        <svg class="brand-logo" viewBox="795 399 2508 1365" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="2">
          <g transform="matrix(2.533203,0,0,2.533203,743,346)">
          <path d="M255.5,22.117C364.598,22.862 426.425,79.746 434.897,87.063C504.638,147.294 515.444,246.575 515.845,255.477C516.879,278.43 534.776,399.51 439.308,487.29C431.327,494.629 387.778,534.672 319.557,550.762C281.241,559.799 274.7,558.694 144.5,558.663C22.924,558.633 22.178,558.905 21.679,557.436C21.372,556.533 21.503,24.302 21.61,23.527C21.986,20.785 23.836,22.286 255.5,22.117ZM357.343,265.104C343.443,265.104 332.159,276.389 332.159,290.289C332.159,304.189 343.443,315.473 357.343,315.473C371.243,315.473 382.528,304.189 382.528,290.289C382.528,276.389 371.243,265.104 357.343,265.104ZM318.929,291.203C318.954,289.53 318.694,289.561 317.17,288.818C189.886,226.764 190.325,226.141 179.224,220.837C176.044,219.317 177.096,231.36 177.096,232.5C177.1,359.43 176.909,360.377 178.345,360.463C178.427,360.468 271.268,315.033 318.929,291.203Z" fill="currentColor"/>
          <path d="M694.598,21.756C742.253,24.469 832.989,9.315 922.785,84.117C933.899,93.375 993.159,142.741 1006.1,244.588C1035.262,474.096 866.25,548.14 773.481,557.238C744.318,560.098 588.236,558.474 587.879,558.117C587.242,557.48 586.522,403.828 586.825,402.572C587.178,401.103 587.63,400.86 605.514,399.832C610.907,399.522 638.955,397.909 671.514,385.542C703.455,373.409 711.331,366.064 724.782,357.963C742.102,347.532 763.631,325.334 763.986,324.915C804.02,277.61 804.094,259.009 812.013,230.366C813.869,223.652 813.121,183.294 812.802,181.446C811.353,173.043 804.354,90.778 722.567,38.39C697.167,22.121 695.054,24.862 694.193,22.403L694.598,21.756Z" fill="currentColor"/>
          <path d="M536.044,337.477C538.355,323.561 537.763,314.429 537.765,308.5C537.78,270.341 539.465,229.012 514.594,166.462C494.989,117.157 463.849,86.908 463.497,86.502C438.531,57.763 390.041,30.223 369.638,24.183C358.471,20.878 376.385,21.974 394.504,22.012C597.764,22.435 597.914,19.76 631.548,25.136C739.192,42.34 807.659,136.246 790.638,230.534C785.204,260.638 767.185,287.115 765.417,289.437C754.959,303.173 755.739,306.243 730.09,328.024C657.384,389.767 570.298,379.289 567.765,380.896C566.28,381.839 566.217,409.969 566.211,412.5C566.079,471.929 567.821,555.859 566.382,557.403C564.87,559.026 380.536,557.584 370.503,558.185C370.254,558.2 360.615,558.777 368.193,556.085C376.59,553.103 414.42,536.399 443.273,511.248C509.254,453.733 528.637,394.043 536.044,337.477Z" fill="currentColor"/>
          </g>
        </svg>
        <div class="brand" aria-label="Disguise Playback Dashboard"><span class="brand-label">Disguise</span><strong>Playback Dashboard</strong></div>
      </div>
      <div id="project-name" class="project-name">{{safe(state.project?.name)}}</div>
    </div>
    <div class="output-group" aria-label="Director output status">
      <div class="output-state-group">
        <span class="output-label">OUTPUT</span>
        <span id="output-status" class="output-status" :class="{'is-up':output.state==='fade-up','is-alert':output.blink,'is-unknown':output.state==='unknown'}" :data-state="output.state" role="status">{{output.label}}</span>
      </div>
      <span id="director-fps" class="fps-status" title="Average actual Director FPS">{{fps}}</span>
    </div>
    <div class="clock-group">
      <div class="clock"><span id="clock-hours">{{clock.time?.split(':')[0]||'--'}}</span><span id="clock-colon">:</span><span id="clock-minutes">{{clock.time?.split(':')[1]||'--'}}</span></div>
      <div id="clock-date" class="clock-date">{{clock.date}}</div>
    </div>
    <div class="countdown-group">
      <div class="countdown-line"><span class="countdown-label">TIME<br>REMAINING</span><span id="countdown" class="countdown" :class="{'is-ending':countdown.ending &amp;&amp; !countdown.stale,'is-stale':countdown.stale}">{{countdown.text}}</span></div>
      <div id="countdown-source" class="countdown-source">{{countdown.source}}</div>
    </div>
  </header>
  <TransportHeading id="main-transport" class="transport" aria-label="Main track" :timeline="main" :simple="view==='simple'"/>
  <section class="simple-main panel" aria-label="Main track: Active and Next">
    <section id="main-active" class="simple-active-zone" aria-label="Active layers on the main track">
      <aside class="status-column">
        <span id="on-air" class="badge on-air" :class="{'is-off':!main.onAir}">{{main.onAir===null?'● NO DATA':main.onAir?'● ON AIR':'● OFF AIR'}}</span><span class="badge active-badge">ACTIVE</span>
        <div class="play-mode-group"><span class="field-label">PLAY MODE</span><span id="main-play-mode" class="play-mode">{{safe(main.playMode)}}</span></div>
      </aside>
      <div id="main-active-rows" class="rows active-rows"><LayerRows :items="main.active" :limit="3" :simple="view==='simple'" :audio-position="audioPosition"/></div>
    </section>
    <section class="simple-next-zone" aria-label="Next media">
      <aside class="status-column"><span class="badge next-badge">NEXT</span>
        <div class="play-mode-group" title="Selected transport mode"><span class="field-label">TRANSPORT MODE</span><span id="next-play-mode" class="play-mode">{{safe(main.playbackMode)}}</span></div>
      </aside>
      <div id="next-row" class="rows summary-rows"><LayerRows :items="main.next?[main.next]:[]" :limit="1" summary :simple="view==='simple'" :audio-position="audioPosition"/></div>
    </section>
  </section>
  <TransportHeading id="second-transport" class="transport" aria-label="Second track" :timeline="second" :simple="view==='simple'" v-if="second.enabled!==false"/>
  <section v-if="second.enabled!==false" class="simple-second-zone panel secondary-body" aria-label="Active layer on the second track">
    <aside class="status-column"><span class="badge active-badge">ACTIVE</span>
      <div class="play-mode-group"><span class="field-label">PLAY MODE</span><span id="second-play-mode" class="play-mode">{{safe(second.playMode)}}</span></div>
    </aside>
    <div id="second-active-rows" class="rows active-rows"><LayerRows :items="second.active" :limit="1" :simple="view==='simple'" :audio-position="audioPosition"/></div>
  </section>
  <StatusFooter :state="state" :version="version" :links="links" :view="view" @diagnostics="$emit('diagnostics')"/>

<slot/></main></template>
<template v-else><main id="canvas" :style="canvasStyle" :class="{'data-stale':countdown.stale || state.status?.stale}" class="dashboard" aria-label="Disguise Playback Dashboard">
  <header class="header panel">
    <div class="project-group">
      <div class="branding-line">

        <svg class="brand-logo" viewBox="795 399 2508 1365" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg" fill-rule="evenodd" clip-rule="evenodd" stroke-linejoin="round" stroke-miterlimit="2">
          <g transform="matrix(2.533203,0,0,2.533203,743,346)">
          <path d="M255.5,22.117C364.598,22.862 426.425,79.746 434.897,87.063C504.638,147.294 515.444,246.575 515.845,255.477C516.879,278.43 534.776,399.51 439.308,487.29C431.327,494.629 387.778,534.672 319.557,550.762C281.241,559.799 274.7,558.694 144.5,558.663C22.924,558.633 22.178,558.905 21.679,557.436C21.372,556.533 21.503,24.302 21.61,23.527C21.986,20.785 23.836,22.286 255.5,22.117ZM357.343,265.104C343.443,265.104 332.159,276.389 332.159,290.289C332.159,304.189 343.443,315.473 357.343,315.473C371.243,315.473 382.528,304.189 382.528,290.289C382.528,276.389 371.243,265.104 357.343,265.104ZM318.929,291.203C318.954,289.53 318.694,289.561 317.17,288.818C189.886,226.764 190.325,226.141 179.224,220.837C176.044,219.317 177.096,231.36 177.096,232.5C177.1,359.43 176.909,360.377 178.345,360.463C178.427,360.468 271.268,315.033 318.929,291.203Z" fill="currentColor"/>
          <path d="M694.598,21.756C742.253,24.469 832.989,9.315 922.785,84.117C933.899,93.375 993.159,142.741 1006.1,244.588C1035.262,474.096 866.25,548.14 773.481,557.238C744.318,560.098 588.236,558.474 587.879,558.117C587.242,557.48 586.522,403.828 586.825,402.572C587.178,401.103 587.63,400.86 605.514,399.832C610.907,399.522 638.955,397.909 671.514,385.542C703.455,373.409 711.331,366.064 724.782,357.963C742.102,347.532 763.631,325.334 763.986,324.915C804.02,277.61 804.094,259.009 812.013,230.366C813.869,223.652 813.121,183.294 812.802,181.446C811.353,173.043 804.354,90.778 722.567,38.39C697.167,22.121 695.054,24.862 694.193,22.403L694.598,21.756Z" fill="currentColor"/>
          <path d="M536.044,337.477C538.355,323.561 537.763,314.429 537.765,308.5C537.78,270.341 539.465,229.012 514.594,166.462C494.989,117.157 463.849,86.908 463.497,86.502C438.531,57.763 390.041,30.223 369.638,24.183C358.471,20.878 376.385,21.974 394.504,22.012C597.764,22.435 597.914,19.76 631.548,25.136C739.192,42.34 807.659,136.246 790.638,230.534C785.204,260.638 767.185,287.115 765.417,289.437C754.959,303.173 755.739,306.243 730.09,328.024C657.384,389.767 570.298,379.289 567.765,380.896C566.28,381.839 566.217,409.969 566.211,412.5C566.079,471.929 567.821,555.859 566.382,557.403C564.87,559.026 380.536,557.584 370.503,558.185C370.254,558.2 360.615,558.777 368.193,556.085C376.59,553.103 414.42,536.399 443.273,511.248C509.254,453.733 528.637,394.043 536.044,337.477Z" fill="currentColor"/>
          </g>
        </svg>
        <div class="brand" aria-label="Disguise Playback Dashboard"><span class="brand-label">Disguise</span><strong>Playback Dashboard</strong></div>
      </div>
      <div id="project-name" class="project-name">{{safe(state.project?.name)}}</div>
    </div>
    <div class="output-group" aria-label="Director output status">
      <div class="output-state-group">
        <span class="output-label">OUTPUT</span>
        <span id="output-status" class="output-status" :class="{'is-up':output.state==='fade-up','is-alert':output.blink,'is-unknown':output.state==='unknown'}" :data-state="output.state" role="status">{{output.label}}</span>
      </div>
      <span id="director-fps" class="fps-status" title="Average actual Director FPS">{{fps}}</span>
    </div>
    <div class="clock-group">
      <div class="clock"><span id="clock-hours">{{clock.time?.split(':')[0]||'--'}}</span><span id="clock-colon">:</span><span id="clock-minutes">{{clock.time?.split(':')[1]||'--'}}</span></div>
      <div id="clock-date" class="clock-date">{{clock.date}}</div>
    </div>
    <div class="countdown-group">
      <div class="countdown-line"><span class="countdown-label">TIME<br>REMAINING</span><span id="countdown" class="countdown" :class="{'is-ending':countdown.ending &amp;&amp; !countdown.stale,'is-stale':countdown.stale}">{{countdown.text}}</span></div>
      <div id="countdown-source" class="countdown-source">{{countdown.source}}</div>
    </div>
  </header>
  <TransportHeading id="main-transport" class="transport panel" aria-label="Main transport" :timeline="main" :simple="view==='simple'"/>
  <section class="summary-section previous panel" aria-label="Previous">
    <aside class="summary-status">PREVIOUS</aside><div id="previous-row" class="rows summary-rows"><LayerRows :items="main.previous?[main.previous]:[]" :limit="1" summary :simple="view==='simple'" :audio-position="audioPosition"/></div>
  </section>
  <section id="main-active" class="active-section primary panel" aria-label="Active layers on the main transport">
    <aside class="status-column"><span id="on-air" class="badge on-air" :class="{'is-off':!main.onAir}">{{main.onAir===null?'● NO DATA':main.onAir?'● ON AIR':'● OFF AIR'}}</span><span class="badge active-badge">ACTIVE</span><div class="play-mode-group"><span class="field-label">PLAY MODE</span><span id="main-play-mode" class="badge play-mode">{{safe(main.playMode)}}</span></div></aside>
    <div id="main-active-rows" class="rows active-rows"><LayerRows :items="main.active" :limit="3" :simple="view==='simple'" :audio-position="audioPosition"/></div>
  </section>
  <section class="summary-section next panel" aria-label="Next">
    <aside class="summary-status"><span class="badge next-badge">NEXT</span></aside><div id="next-row" class="rows summary-rows"><LayerRows :items="main.next?[main.next]:[]" :limit="1" summary :simple="view==='simple'" :audio-position="audioPosition"/></div>
  </section>

  <section v-if="second.enabled!==false" class="secondary panel" aria-label="Second transport">
    <TransportHeading id="second-transport" class="transport" :timeline="second" :simple="view==='simple'" v-if="second.enabled!==false"/>
    <div class="active-section secondary-body">
      <aside class="status-column"><span class="badge active-badge">ACTIVE</span><div class="play-mode-group"><span class="field-label">PLAY MODE</span><span id="second-play-mode" class="badge play-mode">{{safe(second.playMode)}}</span></div></aside>
      <div id="second-active-rows" class="rows active-rows"><LayerRows :items="second.active" :limit="1" :simple="view==='simple'" :audio-position="audioPosition"/></div>
    </div>
  </section>
  <StatusFooter :state="state" :version="version" :links="links" :view="view" @diagnostics="$emit('diagnostics')"/>

<slot/></main></template>
</template>
