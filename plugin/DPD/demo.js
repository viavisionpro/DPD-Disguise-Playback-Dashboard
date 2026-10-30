// Copyright (C) 2026 Vladimir Zakharov / viavision.pro
// SPDX-License-Identifier: GPL-3.0-only
(function(root) {
  'use strict';
  root.DPDDemo={start(client,data) {
    const store=client.store;
    for(const event of data.setup) store[event.op](...event.args);
    const schedule=data.setup.find(event=>event.op==='update_value'&&event.args[0]==='media_schedule').args[1];
    const started=performance.now();
    let timer;
    function tick() {
      const beat=((performance.now()-started)/1000+35)%110;
      const sectionIndex=beat<24?0:beat<54?1:beat<84?2:3;
      store.update_value('output_state',1);store.update_value('director_fps',60);store.update_value('director_fps_raw',60);
      const active=schedule.filter(item=>item.trackName==='training'&&item.effectiveStartBeat<=beat&&beat<item.effectiveEndBeat)
        .map(item=>({layerName:item.layerName,layerUid:item.layerUid,mediaName:item.mediaName,moduleType:'VariableVideoModule',layerType:'Video',
          atEndPoint:item.mediaName.toLowerCase().includes('loop')?0:2,elapsed:beat-item.effectiveStartBeat,
          remaining:item.effectiveEndBeat-beat,fps:25,brightness:1,blendMode:0}));
      store.update_value('main.transport',{transportName:'default',trackName:'training',trackUid:100,beat,trackSeconds:beat,
        sectionIndex,playing:true,holding:false,stopped:false,loopSection:sectionIndex===1,sectionPlayMode:sectionIndex!==1});
      store.update_value('main.sections',data.sections);store.update_value('main.active',active);
      store.update_value('main.active_brightness',active.map((item,index)=>({layerUid:item.layerUid,layerName:item.layerName,
        brightness:index===0?1:index===1?0.65+0.30*Math.sin(beat*0.20):0.30})));
      store.update_value('aux.transport',{transportName:'Second',trackName:'SECOND',trackUid:200,beat,trackSeconds:beat,
        sectionIndex:0,playing:true,holding:false,stopped:false,loopSection:true,sectionPlayMode:false});
      store.update_value('aux.sections',[{index:0,startBeat:0,endBeat:999999,startSec:0,endSec:999999}]);
      store.update_value('aux.active',data.aux);
      timer=setTimeout(tick,100);
    }
    tick();client.log('INFO','DEMO started; no connection to Designer');
    client.stop=()=>{clearTimeout(timer);store.set_connection(false,'stopped','DEMO-DIRECTOR');};
  }};
})(window);
