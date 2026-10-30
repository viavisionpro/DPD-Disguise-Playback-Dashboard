export function diagnosticRows(state,{view="advanced",motion,remaining=null,syncAction="empty",page="",api=""}={}){
 const status=state.status||{};
  const values = [
    ["Dashboard", `v${state.appVersion || "0.4.13"}`], ["Project", state.project?.name],
    ["View", view], ["Transport stopped", state.main?.stopped], ["Transport holding", state.main?.holding], ["Transport playing", state.main?.playing],
    ["Mode", status.mode],
    ["Connected", status.connected], ["Director", status.directorName || status.directorHost || status.seedHost], ["Director IP", status.directorIp],
    ["Last update", status.lastUpdate ? new Date(status.lastUpdate * 1000).toLocaleString() : "—"],
    ["Mapped items", status.scheduleItems],
    ["Outputs", state.outputs?.label], ["Output code", state.outputs?.code],
    ["Output source", state.outputs?.source], ["Output error", state.outputs?.error],
    ["Director FPS · averaged", state.performance?.fps],
    ["Director FPS · raw", state.performance?.rawFps],
    ["FPS average samples", state.performance?.averageSamples],
    ["FPS source", state.performance?.source],
    ["FPS raw min / max", `${state.performance?.rawStats?.min ?? "—"} / ${state.performance?.rawStats?.max ?? "—"}`],
    ["Next duration", state.main?.next?.durationTimecode],
    ["Duration source", state.main?.next?.durationSource],
    ["Next brightness", state.main?.next?.brightness],
    ["Next brightness source", state.main?.next?.brightnessSource],
    ["Next brightness beat", state.main?.next?.brightnessSampleBeat],
    ["Next brightness reason", state.main?.next?.brightnessReason],
    ["Next selection", state.main?.nextSelection?.reason],
    ["Next scheduled start beat", state.main?.nextSelection?.startBeat],
    ["Next candidate kind", state.main?.nextSelection?.kind],
    ["Next simultaneous layers", state.main?.nextSelection?.simultaneousLayers],
    ["Next tie break", state.main?.nextSelection?.tieBreak],
    ["Next stack index · top=0", state.main?.nextSelection?.stackIndex],
    ["Future graphical catalogue", state.main?.nextSelection?.catalogStatus],
    ["Future graphical layers", state.main?.nextSelection?.catalogLayers],
    ["Future catalogue complete", state.main?.nextSelection?.complete],
    ["Next embedded audio", state.main?.next?.hasAudio],
    ["Next audio source", state.main?.next?.audioSource],
    ["Audio indicator placement", state.ui?.audio_indicator_position||"media-suffix"],
    ["ACTIVE entry / exit animation", motion?.getMode()],
    ["Animation effective", motion?.effectiveMode()],
    ["Animation capability", motion?.diagnostics().webAnimations],
    ["System Reduce motion", motion?.diagnostics().reducedMotion],
    ["Reduce motion override", motion?.diagnostics().override],
    ["Animation availability", motion?.diagnostics().reason],
    ["Animation counters", JSON.stringify(motion?.diagnostics().counts)],
    ["Last skipped animation", motion?.diagnostics().lastSkip],
    ["Last animation", motion?.diagnostics().lastTransition],
    ["ACTIVE membership", JSON.stringify(state.main?.activeMembership)],
    ["Second ACTIVE membership", JSON.stringify(state.aux?.activeMembership)],
    ["Previous source", JSON.stringify(state.main?.previousSelection)],
    ["Active embedded audio", (state.main?.active||[]).map(row=>`${row.layerName}: ${row.hasAudio===true?'yes':row.hasAudio===false?'no':'unknown'}`).join("; ")],
    ["First transport", state.main?.transportName], ["First track", state.main?.trackName],
    ["First track media", state.main?.trackMediaItems],
    ["Countdown raw", state.main?.countdownSeconds],
    ["Countdown smoothed", remaining===null?'—':Number(remaining).toFixed(3)],
    ["Countdown sync", syncAction],
    ["Second transport", state.aux?.transportName], ["Second track", state.aux?.trackName],
    ["Second track media", state.aux?.trackMediaItems],
    ["Section metadata", "TC / MIDI / OSC = CUE tag / NOTES; at section break"],
    ["Main current metadata match", state.main?.currentSection?.metadataMatch],
    ["Main next metadata match", state.main?.nextSection?.metadataMatch],
    ["Brightness", (state.main?.active || []).map(row => `${row.layerName}: ${row.brightness ?? "unknown"}`).join("; ")],
    ["Last error", status.lastError || "—"]
  ];
  Object.entries(status.streams || {}).sort(([left], [right]) => left.localeCompare(right)).forEach(([name, stream]) => {
    const updated = stream?.lastUpdate ? new Date(stream.lastUpdate * 1000).toLocaleTimeString() : "—";
    values.push([
      `Stream ${name}`,
      stream?.error ? `ERROR · ${stream.error} · ${updated}` : `${stream?.items ?? 0} items · ${updated}`
    ]);
  });
 values.unshift(["Plugin page",page],["API endpoint",api],["Preferences","Designer Notes / DPD_Plugin_Settings"]);
 return values;
}
