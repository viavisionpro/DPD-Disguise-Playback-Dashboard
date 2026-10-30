import {pythonJsonExpression,pythonBuiltins} from './python-data.js';
// Optional decoration only. No playback state or timing is modified here.
function uid(value){
 const text=String(value?.uid??value??'');
 try{return /^(?:0x[\da-f]+|\d+)$/i.test(text)?BigInt(text).toString():null;}catch(_){return null;}
}
export function colourCss(value){
 if(!Array.isArray(value)||value.length!==4||value.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0||v>1))return null;
 return `rgba(${value.slice(0,3).map(v=>Math.round(v*255)).join(', ')}, ${value[3]})`;
}
export function decorateColours(snapshot,values={},errors={}){
 const result={...snapshot};
 for(const role of ['main','aux']){
  const timeline=snapshot[role]||{},payload=values[role+'.layer_colours'],colours=new Map(),track=uid(timeline.trackUid);
  if(!errors[role+'.layer_colours']&&track&&uid(payload?.trackResource)===track&&Array.isArray(payload.layers)){
   for(const row of payload.layers){const key=uid(row?.layerResource),colour=colourCss(row?.rgba);if(key)colours.set(key,colours.has(key)&&colours.get(key)!==colour?null:colour);}
  }
  const decorate=item=>item?{...item,ruleColour:colours.get(uid(item.layerUid))||null}:item;
  result[role]={...timeline,active:(timeline.active||[]).map(decorate),next:decorate(timeline.next)};
 }
 return result;
}
export function colourSubscriptions(config,member,transportExpression,method='getColour'){
 if(typeof member!=='string'||member!==''&&!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(member))throw Error('Invalid discovered colour member.');
 if(typeof transportExpression!=='function')throw Error('Transport expression builder is required.');
 if(!['getColour','getColourInfo'].includes(method))throw Error('Invalid discovered colour method.');
 const colour=member?'info.'+member:'info';
 const property='{"trackResource": object.track, "layers": [{"layerResource": l, "rgba": [float(c.r), float(c.g), float(c.b), float(c.a)]} for parent in ([] if object.track is None else object.track.layers) for l in parent.getLeafLayers() if l.isGraphical() for rules in [object.track.layerColourRuleSet or state.layerColourRuleSet] if rules is not None for info in [rules.'+method+'(l)] for c in ['+colour+']]}';
 return ['main','aux'].filter(role=>config.timelines[role].enabled!==false).map(role=>({key:role+'.layer_colours',object:transportExpression(config.timelines[role]),property,frequency:1000}));
}
export function colourProbeTarget(snapshot){
 for(const role of ['main','aux']){const timeline=snapshot[role],track=uid(timeline?.trackUid);if(!track)continue;const item=[...(timeline.active||[]),timeline.next].find(item=>uid(item?.layerUid));if(item)return {layer:uid(item.layerUid),track};}
 return null;
}
export function colourProbeScript(layerUid,trackUid){
 const layer=uid(layerUid),track=uid(trackUid);if(!layer||!track)throw Error('Colour discovery requires layer and track UIDs.');
 const payload=pythonJsonExpression({purpose:'dpd-layer-colour-probe',layer,track});
 return `${pythonBuiltins}import json, math
payload = ${payload}
layer = UidManager.get().getResource(long(payload['layer']))
track = UidManager.get().getResource(long(payload['track']))
if layer is None or track is None:
    return {'supported': False, 'reason': 'Layer or track no longer exists'}
rules = track.layerColourRuleSet or state.layerColourRuleSet
if rules is None:
    return {'supported': False, 'reason': 'No layer colour ruleset assigned; reopen after assigning one'}
method = next((name for name in ('getColour', 'getColourInfo') if callable(getattr(rules, name, None))), None)
if method is None:
    return {'supported': False, 'reason': 'No exported colour getter on this Designer'}
info = getattr(rules, method)(layer)
def rgba(value):
    try:
        channels = [getattr(value, key) for key in ('r', 'g', 'b', 'a')]
        if any(isinstance(v, bool) for v in channels):
            return None
        result = [float(v) for v in channels]
        if all(not math.isnan(v) and not math.isinf(v) and 0 <= v <= 1 for v in result):
            return result
    except Exception:
        pass
    return None
if rgba(info) is not None:
    return {'supported': True, 'method': method, 'member': '', 'fields': [], 'reason': method + ': direct normalized RGBA export'}
fields = [name for name in dir(info) if not name.startswith('_')][:64]
candidates = []
exports = []
for name in fields:
    try:
        value = getattr(info, name)
        channels = rgba(value)
        exports.append({'name': name, 'type': type(value).__name__, 'callable': callable(value), 'rgba': channels})
        if channels is not None:
            candidates.append(name)
    except Exception:
        pass
if len(candidates) == 1:
    return {'supported': True, 'method': method, 'member': candidates[0], 'fields': fields, 'exports': exports, 'reason': method + ': unique normalized RGBA export'}
return {'supported': False, 'fields': fields, 'exports': exports, 'candidates': candidates, 'reason': 'LayerColourInfo RGB export is unavailable or ambiguous'}`;
}
