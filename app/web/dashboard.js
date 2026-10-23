"use strict";


const dom = {};
let lastState = null;
let bridgeReachable = false;
let config = {
  browser_poll_ms: 100, blink_at_seconds: 10, default_fps: 25,
  countdown_sample_epsilon_seconds: 0.005,
  countdown_hard_resync_seconds: 1.5,
  countdown_seek_threshold_seconds: 0.75
};
let pollTimer = null;
let consecutiveErrors = 0;
let diagnosticsOpen = false;
let lastDiagnosticsAt = -Infinity;
let diagnosticsFetching = false;

function cacheDom() {
  ["canvas", "countdown", "countdown-source", "status-button", "status-dot",
   "status-text", "status-detail", "diagnostics", "diagnostics-values",
   "diagnostics-close", "diagnostics-link", "log-tail", "open-log-folder", "log-folder-result"].forEach(id => { dom[id] = document.getElementById(id); });
}
function text(element, value, title = true) {
  if (!element) return;
  const safe = value === null || value === undefined || value === "" ? "—" : String(value);
  element.textContent = safe;
  if (title) element.title = safe;
}
function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function freezeCountdown() {
  const now = performance.now();
  const value = countdownClock.valueAt(now);
  if (value !== null) {
    countdownClock.anchorRemaining = value;
    countdownClock.anchorAt = now;
    countdownClock.running = false;
    countdownClock.lastAction = "data-unavailable";
  }
}
function titleName(value) {
  const name = String(value || "");
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "—";
}


class CountdownClock {
  constructor() {
    this.clear();
  }

  clear() {
    this.sourceKey = "";
    this.anchorRemaining = null;
    this.anchorAt = 0;
    this.lastRaw = null;
    this.running = false;
    this.lastPosition = null;
    this.lastPositionAt = 0;
    this.lastAction = "empty";
  }

  valueAt(now) {
    if (this.anchorRemaining === null) return null;
    const elapsed = this.running ? Math.max(0, (now - this.anchorAt) / 1000) : 0;
    return Math.max(0, this.anchorRemaining - elapsed);
  }

  sync(sample, now, options = {}) {
    const raw = finite(sample.raw);
    const position = finite(sample.position);
    const hasSource = Boolean(sample.hasSource);
    const sourceKey = String(sample.sourceKey || "");
    const running = Boolean(sample.running);
    const epsilon = Math.max(0, finite(options.countdown_sample_epsilon_seconds) ?? 0.005);
    const hardResync = Math.max(0.1, finite(options.countdown_hard_resync_seconds) ?? 1.5);
    const seekThreshold = Math.max(0.1, finite(options.countdown_seek_threshold_seconds) ?? 0.75);

    if (!hasSource || raw === null) {
      this.clear();
      this.sourceKey = sourceKey;
      this.running = running;
      this.lastPosition = position;
      this.lastPositionAt = now;
      return null;
    }

    const current = this.valueAt(now);
    const sourceChanged = current === null || sourceKey !== this.sourceKey;
    const modeChanged = current !== null && running !== this.running;
    const rawChanged = this.lastRaw === null || Math.abs(raw - this.lastRaw) > epsilon;
    let seekDetected = false;

    if (!sourceChanged && this.lastPosition !== null && position !== null) {
      const wallDelta = Math.max(0, (now - this.lastPositionAt) / 1000);
      const expectedDelta = this.running ? wallDelta : 0;
      const positionDelta = position - this.lastPosition;
      seekDetected = Math.abs(positionDelta - expectedDelta) > seekThreshold;
    }

    let next = current;
    if (sourceChanged) {
      next = raw;
      this.lastAction = "source";
    } else if (modeChanged) {
      next = raw;
      this.lastAction = "mode";
    } else if (seekDetected) {
      next = raw;
      this.lastAction = "seek";
    } else if (rawChanged) {
      const error = raw - current;
      if (Math.abs(error) >= hardResync) {
        next = raw;
        this.lastAction = "hard-resync";
      } else if (raw < current) {

        next = raw;
        this.lastAction = "forward-correction";
      } else {

        next = current;
        this.lastAction = "jitter-rejected";
      }
    } else {

      this.lastAction = "same-sample";
    }

    if (next !== current || sourceChanged || modeChanged || seekDetected) {
      this.anchorRemaining = Math.max(0, next);
      this.anchorAt = now;
    }
    this.sourceKey = sourceKey;
    this.lastRaw = raw;
    this.running = running;
    this.lastPosition = position;
    this.lastPositionAt = now;
    return this.valueAt(now);
  }
}

const countdownClock = new CountdownClock();

function countdownSourceKey(source) {
  if (!source) return "";
  return [source.layerUid, source.layerName, source.mediaName, source.layerType]
    .map((value) => String(value || ""))
    .join("\u001f");
}

function projectedRemaining() {
  return lastState ? countdownClock.valueAt(performance.now()) : null;
}

function formatMinutesSeconds(value) {
  const seconds = finite(value);
  if (seconds === null) return "LIVE";
  if (seconds <= 0) return "00:00";
  const rounded = Math.ceil(seconds);
  const minutes = Math.floor(rounded / 60);
  return `${String(minutes).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}

function formatTimecode(value, fpsValue) {
  const raw = finite(value);
  if (raw === null) return "—";
  const seconds = Math.max(0, raw);
  const fps = Math.max(1, Math.round(finite(fpsValue) || config.default_fps || 25));
  let whole = Math.floor(seconds);
  let frames = Math.floor((seconds - whole) * fps + 1e-6);
  if (frames >= fps) {
    whole += 1;
    frames = 0;
  }
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  return [hours, minutes, secs, frames]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function renderCountdown() {
  if (!lastState) return;
  const source = lastState.main?.countdownSource;
  const connected = bridgeReachable && lastState.status?.connected === true;
  window.DashboardUI.setCountdown(projectedRemaining(),
    source ? `${source.timingApproximate ? "≈ " : ""}${source.layerName || "—"}` : "—",
    {hasSource: Boolean(source), live: Boolean(source) && finite(lastState.main?.countdownSeconds) === null,
     blinkAtSeconds: Number(config.blink_at_seconds ?? 10)});
  dom.countdown.classList.toggle("is-stale", !connected);
  if (!connected) dom.countdown.classList.remove("is-ending");
  dom["countdown-source"].title = source
    ? `${source.layerName || "—"}${connected ? "" : " · data not updating"}`
    : "No active video for countdown";
}

function renderStatus(status) {
  const connected = Boolean(status?.connected);
  const hardError = ["error", "dependency-error"].includes(status?.mode);
  const streamErrors = Object.entries(status?.streamErrors || {});
  const dataError = streamErrors.length > 0;
  const warning = (Boolean(status?.lastError) || dataError) && !hardError;
  dom["status-dot"].classList.toggle("connected", connected);
  dom["status-dot"].classList.toggle("error", hardError || warning || consecutiveErrors >= 3);
  const connectedLabel = status.mode === "demo"
    ? "DEMO"
    : (hardError ? "LIVE · ERROR" : (dataError ? "LIVE · DATA ERROR" : (warning ? "LIVE · WARNING" : "LIVE")));
  const offlineLabel = status?.stale ? "STALE" : status?.mode === "live" ? "OFFLINE" : status?.mode === "demo" ? "DEMO · NO DATA" : String(status?.mode || "OFFLINE").toUpperCase();
  text(dom["status-text"], connected ? connectedLabel : offlineLabel, false);
  const name = status?.directorName || status?.directorHost || status?.seedHost || "—";
  const host = status?.directorIp && status.directorIp !== name ? `${name} – ${status.directorIp}` : name;
  const firstStreamError = streamErrors[0];
  const detail = status?.stale ? `${host} · data not updating · PRESS D` : dataError
    ? `${host} · ${streamErrors.length} stream error(s) · ${firstStreamError[0]}: ${firstStreamError[1]?.message || "property error"} · PRESS D`
    : (status?.lastError
      ? `${host} · ${status.lastError}`
      : `${host} · ${status?.scheduleItems ?? 0} mapped media items`);
  text(dom["status-detail"], detail);
}

function renderState(state) {
  config = { ...config, ...(state.ui || {}) };
  const first = state.main || {};
  const source = first.countdownSource;
  const connected = state.status?.connected === true;
  bridgeReachable = true;
  if (connected) {
    countdownClock.sync({
      raw: first.countdownSeconds, hasSource: Boolean(source),
      sourceKey: countdownSourceKey(source),
      running: Boolean(first.playing) && !first.holding,
      position: first.currentSeconds
    }, performance.now(), config);
  } else {
    freezeCountdown();
  }
  lastState = state;
  const view = window.DashboardUI.fromBridgeState(state);
  for (const timeline of [view.main, view.second]) {
    timeline.transportName = titleName(timeline.transportName);
    timeline.trackName = titleName(timeline.trackName);
    if (!connected) timeline.onAir = null;
  }
  window.DashboardUI.render(view, {updateCountdown:false});
  document.getElementById("canvas").classList.toggle("data-stale", !connected);
  renderCountdown();
  renderStatus(state.status || {});
  if (diagnosticsOpen && performance.now() - lastDiagnosticsAt >= 1000) renderDiagnostics(state);
}

async function logClient(level, message, context = null) {
  try {
    await fetch("/api/client-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ level, message, context }),
      keepalive: true
    });
  } catch (_) {

  }
}

async function pollState() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(500, Number(config.browser_request_timeout_ms || 2000)));
  try {
    const response = await fetch("/api/state", { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    consecutiveErrors = 0;
    renderState(state);
  } catch (error) {
    consecutiveErrors += 1;
    bridgeReachable = false;
    freezeCountdown();
    window.DashboardMotion?.suspend();
    dom.canvas.classList.add("data-stale");
    const onAir = document.getElementById("on-air");
    onAir.classList.add("is-off");
    onAir.textContent = "● NO DATA";
    window.DashboardUI.setOutputStatus(null, {connected:false});
    renderCountdown();
    renderStatus({ connected: false, mode: "bridge-offline", lastError: String(error) });
    if (consecutiveErrors === 1 || consecutiveErrors % 20 === 0) {
      logClient("ERROR", "State polling failed", { error: String(error), attempts: consecutiveErrors });
    }
  } finally {
    clearTimeout(timeout);
    clearTimeout(pollTimer);
    pollTimer = setTimeout(pollState, Math.max(50, Number(config.browser_poll_ms || 100)));
  }
}

function diagnosticPair(term, description) {
  const dt = document.createElement("dt");
  dt.textContent = term;
  const dd = document.createElement("dd");
  dd.textContent = description === null || description === undefined || description === "" ? "—" : String(description);
  return [dt, dd];
}

async function renderDiagnostics(state = lastState) {
  if (!state || diagnosticsFetching) return;
  diagnosticsFetching = true;
  lastDiagnosticsAt = performance.now();
  const status = state.status || {};
  const values = [
    ["Dashboard", `v${state.appVersion || "0.4.13"}`], ["Project", state.project?.name],
    ["View", document.documentElement.dataset.view || "advanced"],
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
    ["ACTIVE entry / exit animation", window.DashboardMotion?.getMode()],
    ["Animation effective", window.DashboardMotion?.effectiveMode()],
    ["Animation capability", window.DashboardMotion?.diagnostics().webAnimations],
    ["System Reduce motion", window.DashboardMotion?.diagnostics().reducedMotion],
    ["Reduce motion override", window.DashboardMotion?.diagnostics().override],
    ["Animation availability", window.DashboardMotion?.diagnostics().reason],
    ["Animation counters", JSON.stringify(window.DashboardMotion?.diagnostics().counts)],
    ["Last skipped animation", window.DashboardMotion?.diagnostics().lastSkip],
    ["Last animation", window.DashboardMotion?.diagnostics().lastTransition],
    ["ACTIVE membership", JSON.stringify(state.main?.activeMembership)],
    ["Second ACTIVE membership", JSON.stringify(state.aux?.activeMembership)],
    ["Previous source", JSON.stringify(state.main?.previousSelection)],
    ["Active embedded audio", (state.main?.active||[]).map(row=>`${row.layerName}: ${row.hasAudio===true?'yes':row.hasAudio===false?'no':'unknown'}`).join("; ")],
    ["First transport", state.main?.transportName], ["First track", state.main?.trackName],
    ["First track media", state.main?.trackMediaItems],
    ["Countdown raw", finite(state.main?.countdownSeconds)],
    ["Countdown smoothed", finite(projectedRemaining())?.toFixed(3)],
    ["Countdown sync", countdownClock.lastAction],
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
  const dataScroll=dom["diagnostics-values"].scrollTop;
  dom["diagnostics-values"].replaceChildren(...values.flatMap(([term, value]) => diagnosticPair(term, value)));
  dom["diagnostics-values"].scrollTop=dataScroll;
  try {
    const response = await fetch("/api/log-tail?lines=250", { cache: "no-store", signal: AbortSignal.timeout(2000) });
    const log=dom["log-tail"], previousScroll=log.scrollTop;
    const followTail=log.scrollHeight-log.clientHeight-previousScroll<32;
    dom["log-tail"].textContent = response.ok ? await response.text() : `Could not load log: HTTP ${response.status}`;
    log.scrollTop=followTail?log.scrollHeight:previousScroll;
  } catch (error) {
    dom["log-tail"].textContent = `Could not load log: ${error}`;
  } finally {
    diagnosticsFetching = false;
  }
}

async function openLogFolder() {
  const button = dom["open-log-folder"], result = dom["log-folder-result"];
  button.disabled = true;
  result.textContent = "Opening…";
  try {
    const response = await fetch("/api/open-log-folder", {
      method: "POST", headers: {"X-DPD-Action": "open-log-folder"},
      signal: AbortSignal.timeout(5000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    result.textContent = "Log folder opened.";
  } catch (error) {
    result.textContent = `${error.message} · Folder: .private/logs`;
  } finally {
    button.disabled = false;
  }
}

function setDiagnostics(open) {
  diagnosticsOpen = open;
  dom.diagnostics.classList.toggle("open", open);
  dom.diagnostics.setAttribute("aria-hidden", open ? "false" : "true");
  if (open) {
    window.DashboardMotion?.refreshControls();
    lastDiagnosticsAt = -Infinity;
    renderDiagnostics();
    dom["diagnostics-close"].focus();
  } else dom["status-button"].focus();
}

function initialise() {
  cacheDom();
  dom["open-log-folder"].addEventListener("click", openLogFolder);
  setInterval(renderCountdown, 50);
  window.addEventListener("error", (event) => logClient("ERROR", event.message, {
    source: event.filename, line: event.lineno, column: event.colno
  }));
  window.addEventListener("unhandledrejection", (event) => logClient("ERROR", "Unhandled promise rejection", { reason: String(event.reason) }));
  document.addEventListener("keydown", (event) => {
    const editing=event.target.closest?.('input,textarea,select,[contenteditable="true"]');
    if (!editing && event.key.toLowerCase() === "d") setDiagnostics(!diagnosticsOpen);
    if (event.key === "Escape") setDiagnostics(false);
  });
  dom["status-button"].addEventListener("click", () => setDiagnostics(true));
  dom["diagnostics-link"]?.addEventListener("click", event => {
    event.preventDefault();
    setDiagnostics(true);
  });
  dom["diagnostics-close"].addEventListener("click", () => setDiagnostics(false));
  window.DashboardMotion?.setLogger((message,detail)=>logClient("INFO",message,detail));
  window.DashboardMotion?.setPreviewCallback(direction=>{
    setDiagnostics(false);
    requestAnimationFrame(()=>window.DashboardMotion.preview(direction));
  });
  pollState();
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { CountdownClock, formatMinutesSeconds };
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", initialise);
}
