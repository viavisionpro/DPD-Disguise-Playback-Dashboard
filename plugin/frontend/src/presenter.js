  const number = v => v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
  const safe = v => v === null || v === undefined || v === '' ? '—' : String(v);
  const pad = v => String(v).padStart(2,'0');

  function formatTimecode(value,fpsValue=25) {
    const raw=number(value); if(raw===null)return '—';
    const seconds=Math.max(0,raw), fps=Math.max(1,Math.round(number(fpsValue)||25));
    let whole=Math.floor(seconds), frames=Math.floor((seconds-whole)*fps+1e-6);
    if(frames>=fps){whole++;frames=0;}
    return [Math.floor(whole/3600),Math.floor(whole%3600/60),whole%60,frames].map(pad).join(':');
  }
  function brightnessView(value) {
    const raw=number(value);
    return raw===null ? {ratio:0,label:'—',unknown:true} : {ratio:Math.max(0,Math.min(1,raw)),label:`${Math.round(raw*100)}%`,unknown:false};
  }
  function outputView(outputs,connected=true) {
    const code=number(outputs?.code);
    const known=connected&&outputs?.available===true&&[0,1,2].includes(code);
    const states={0:['fade-down','FADE DOWN',true],1:['fade-up','FADE UP',false],2:['hold','HOLD',true]};
    const [state,label,blink]=known?states[code]:['unknown','NO DATA',false];
    return {state,label,blink};
  }

const normalizedUid = value => {
  if (value === null || value === undefined || value === '' || value === '—') return null;
  const text = String(value);
  try { return /^(?:0x[\da-f]+|\d+)$/i.test(text) ? BigInt(text).toString() : text; } catch (_) { return text; }
};
const layerKey = item => JSON.stringify(normalizedUid(item?.layerUid) ?? normalizedUid(item?.layerId) ?? item?.layerName ?? '');

  function mapBridge(state) {


    const mapLayer=item=>item?{...item,layerId:item.layerUid||item.layerName,
      mediaUid:item.mediaUid??(item.mediaResource?.uid===undefined?null:String(item.mediaResource.uid))}:null;
    const mapSection=section=>({name:section?.label,tc:section?.tc??null,midi:section?.midi??null,osc:section?.osc??null,notes:section?.notes??null});
    const mapTimeline=t=>({enabled:t?.enabled!==false,transportName:t?.transportName,trackName:t?.trackName,trackUid:t?.trackUid,currentBeat:t?.currentBeat,activeMembership:t?.activeMembership,playMode:t?.playMode,playbackMode:t?.playbackMode,onAir:state.status?.connected===true ? (typeof t?.stopped==='boolean' ? !t.stopped : !!(t?.playing||t?.holding)) : null,currentSection:mapSection(t?.currentSection),nextSection:mapSection(t?.nextSection??t?.next),previous:mapLayer(t?.previous),next:mapLayer(t?.next),active:(Array.isArray(t?.active)?t.active:[]).map(mapLayer),countdownSource:t?.countdownSource,countdownSeconds:t?.countdownSeconds});
    return {projectName:state.project?.name,appVersion:state.appVersion,outputs:state.outputs,directorFps:state.performance?.fps??null,audioIndicatorPosition:state.ui?.audio_indicator_position,nextActiveAnimation:state.ui?.next_active_animation,connected:state.status?.connected===true,main:mapTimeline(state.main),second:mapTimeline(state.aux),statusText:state.status?.connected?'API CONNECTED':'API NOT CONNECTED'};
  }

const mediaVersion = item => typeof item?.mediaVersion === 'string' && item.mediaVersion !== '0' && item.mediaVersion.length <= 32 && /^[0-9][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$/.test(item.mediaVersion) ? item.mediaVersion : null;
const audioView = value => value === true ? 'present' : value === false ? 'absent' : 'unknown';
export { safe, number, formatTimecode, brightnessView, outputView, mapBridge, layerKey, mediaVersion, audioView };
