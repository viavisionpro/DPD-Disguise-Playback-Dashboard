const finite=value=>value===null||value===undefined||value===''?null:Number.isFinite(Number(value))?Number(value):null;
export class CountdownClock {
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

export function formatMinutesSeconds(value) {
  const seconds = finite(value);
  if (seconds === null) return "LIVE";
  if (seconds <= 0) return "00:00";
  const rounded = Math.ceil(seconds);
  const minutes = Math.floor(rounded / 60);
  return `${String(minutes).padStart(2, "0")}:${String(rounded % 60).padStart(2, "0")}`;
}
