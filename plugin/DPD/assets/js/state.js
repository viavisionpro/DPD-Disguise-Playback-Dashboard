/* Copyright (C) 2026 Vladimir Zakharov / viavision.pro
 * SPDX-License-Identifier: GPL-3.0-only
 * Native browser port of DPD 0.4.13 DashboardStore (app/server.py).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DPDState = api;
}(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const APP_VERSION = '0.4.13';
  const MAX_FLOAT_SENTINEL = 1e300;
  const OUTPUT_STATE_PROPERTY = 'LocalState.directorState().output';
  const OUTPUT_STATES = {0: ['fade-down', 'FADE DOWN'], 1: ['fade-up', 'FADE UP'], 2: ['hold', 'HOLD']};
  const DIRECTOR_FPS_OBJECT = 'subsystem:MonitoringManager.findLocalMonitor("fps")';
  const DIRECTOR_FPS_RAW_PROPERTY = 'float(object.seriesAverage("Actual", 1))';
  const ROLES = ['main', 'aux'];
  const VIDEO_FIELDS = [
    'active_standard_video_details', 'active_standard_video_frames', 'active_standard_video_elapsed',
    'active_standard_video_remaining', 'active_standard_video_tsec', 'active_variable_video_details',
    'active_variable_video_frames', 'active_variable_video_elapsed', 'active_variable_video_remaining',
    'active_variable_video_tsec'
  ];
  const dict = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const get = (value, key, fallback = null) => value != null && Object.prototype.hasOwnProperty.call(value, key) ? value[key] : fallback;
  const has = (value, key) => value != null && Object.prototype.hasOwnProperty.call(value, key);
  // Python considers empty collections false; JavaScript does not.
  const truth = value => Array.isArray(value) ? value.length > 0 : dict(value) ? Object.keys(value).length > 0 : Boolean(value);
  const or = (...values) => values.find(truth) ?? values[values.length - 1];
  const clone = value => Array.isArray(value) ? value.map(clone) : dict(value) ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)])) : value;
  const equal = (left, right) => {
    if (left === right) return true;
    if ((typeof left === 'boolean' && typeof right === 'number') || (typeof left === 'number' && typeof right === 'boolean')) return Number(left) === Number(right);
    if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((v, i) => equal(v, right[i]));
    if (dict(left) && dict(right)) return Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(k => has(right, k) && equal(left[k], right[k]));
    return false;
  };
  const strip = value => value.replace(/^[\u0009-\u000d \u001c-\u001f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d \u001c-\u001f\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '');
  const str = value => value === null || value === undefined ? 'None' : value === true ? 'True' : value === false ? 'False' : typeof value === 'object' ? repr(value) : Number.isNaN(value) ? 'nan' : value === Infinity ? 'inf' : value === -Infinity ? '-inf' : String(value);
  const wall = () => Date.now() / 1000;
  const monotonic = () => typeof performance !== 'undefined' ? performance.now() / 1000 : wall();
  const DECIMAL_ZEROES = [48,1632,1776,1984,2406,2534,2662,2790,2918,3046,3174,3302,3430,3558,3664,3792,3872,4160,4240,6112,6160,6470,6608,6784,6800,6992,7088,7232,7248,42528,43216,43264,43472,43504,43600,44016,65296,66720,68912,69734,69872,69942,70096,70384,70736,70864,71248,71360,71472,71904,72016,72784,73040,73120,92768,93008,120782,120792,120802,120812,120822,123200,123632,125264,130032];
  const decimal_text = value => Array.from(value, ch => {
    const code = ch.codePointAt(0);
    const zero = code > 127 ? DECIMAL_ZEROES.find(start => start <= code && code < start + 10) : undefined;
    return zero === undefined ? ch : String(code - zero);
  }).join('').replace(/^[\u0009-\u000d \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d \u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g, '');
  function as_float(value, fallback = null) {
    if (value === null || value === undefined || typeof value === 'object') return fallback;
    if (typeof value === 'string') {
      value = decimal_text(value);
      if (!/^[+-]?(?:(?:[0-9](?:_?[0-9])*)(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/.test(value)) return fallback;
      value = value.replace(/_/g, '');
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }
  function integer(value, fallback = null) {
    if (typeof value === 'string') {
      value = decimal_text(value);
      if (!/^[+-]?[0-9](?:_?[0-9])*$/.test(value)) return fallback;
      value = value.replace(/_/g, '');
    }
    const number = as_float(value);
    return number === null ? fallback : Math.trunc(number);
  }
  function repr(value) {
    if (value === null || typeof value === 'boolean') return str(value);
    if (typeof value === 'string') {
      const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
      return quote + Array.from(value, ch => {
        if (ch === '\\' || ch === quote) return '\\' + ch;
        if (ch === '\n') return '\\n';
        if (ch === '\r') return '\\r';
        if (ch === '\t') return '\\t';
        if (ch !== ' ' && /[\p{C}\p{Z}]/u.test(ch)) {
          const code = ch.codePointAt(0);
          return (code <= 255 ? '\\x' : code <= 65535 ? '\\u' : '\\U') + code.toString(16).padStart(code <= 255 ? 2 : code <= 65535 ? 4 : 8, '0');
        }
        return ch;
      }).join('') + quote;
    }
    if (Array.isArray(value)) return '[' + value.map(repr).join(', ') + ']';
    if (dict(value)) return '{' + Object.entries(value).map(([key, item]) => repr(key) + ': ' + repr(item)).join(', ') + '}';
    return str(value);
  }
  function uid_text(value) { return value === null || value === undefined ? '' : str(value); }
  function uid_key(value) {
    if (dict(value)) value = get(value, 'uid');
    const text = strip(uid_text(value)).toLowerCase();
    const numeric = decimal_text(text);
    if (!text) return '';
    // Match int(text, 0), including large decimal/hex IDs without Number rounding.
    if (!/^[+-]?(?:0x_?[\da-f](?:_?[\da-f])*|0o_?[0-7](?:_?[0-7])*|0b_?[01](?:_?[01])*|[1-9](?:_?\d)*|0(?:_?0)*)$/i.test(numeric)) return text;
    try {
      const negative = numeric[0] === '-';
      const digits = numeric.replace(/^[+-]/, '').replace(/_/g, '');
      return (BigInt(digits) * (negative ? BigInt(-1) : BigInt(1))).toString();
    } catch (_) { return text; }
  }
  function resource_uid(resource) { return dict(resource) ? uid_text(get(resource, 'uid')) : ''; }
  function resource_path(resource) {
    if (typeof resource === 'string') return resource;
    if (!dict(resource)) return '';
    const path = get(resource, 'path', '');
    if (typeof path === 'string') return path;
    if (dict(path)) for (const key of ['path', 'value', 'filename', 'relativePath']) if (typeof get(path, key) === 'string') return path[key];
    return '';
  }
  function resource_name(resource) {
    const path = resource_path(resource);
    if (!path) return '';
    const name = path.replace(/\\/g, '/').split('/').pop();
    return name.toLowerCase().endsWith('.apx') ? name.slice(0, -4) : name;
  }
  function resource_type(resource) { return dict(resource) ? strip(str(or(get(resource, 'type'), ''))).split('.').pop() : ''; }
  function module_label(value) {
    let raw = strip(dict(value) ? resource_type(value) : str(or(value, ''))).split('.').pop();
    const match = raw.match(/([A-Za-z0-9_]+Module)/);
    if (match) raw = match[1];
    if (raw.endsWith('Module')) raw = raw.slice(0, -6);
    const labels = {VariableVideo: 'Video', VariableVideoTransition: 'Video', Video: 'Video', VideoMove: 'Video', VideoTransition: 'Video', SockPuppetVideo: 'Video', DepthVideo: 'Depth Video', TestPattern: 'Test Pattern', RenderStream: 'RenderStream', RenderStreamLocal: 'RenderStream', StageRender: 'Stage Render', RGBColour: 'RGB Colour', TimecodeReadout: 'Timecode'};
    return get(labels, raw) || raw.replace(/([a-z0-9])([A-Z])/g, '$1 $2') || 'Content';
  }
  function end_point_label(value) { return get({0: 'Loop', 1: 'Ping-Pong', 2: 'Pause'}, integer(value)); }
  function is_still_media_name(name) {
    const parts = str(or(name, '')).split('/').filter(part => part && part !== '.');
    const base = parts.length ? parts[parts.length - 1] : '';
    const dot = base.lastIndexOf('.');
    return dot > 0 && ['.bmp', '.dpx', '.exr', '.gif', '.jpeg', '.jpg', '.png', '.psd', '.tga', '.tif', '.tiff'].includes(base.slice(dot).toLowerCase());
  }
  function split_property_errors(value) {
    const errors = [];
    const error = item => str(item.errorType) + ': ' + str(or(get(item, 'message'), 'Unknown property-path error'));
    if (Array.isArray(value)) {
      const valid = [];
      for (const item of value) if (dict(item) && truth(get(item, 'errorType'))) errors.push(error(item)); else valid.push(item);
      return [valid, errors];
    }
    return dict(value) && truth(get(value, 'errorType')) ? [null, [error(value)]] : [value, []];
  }
  function clean_media_name(item) {
    const explicit = strip(str(or(get(item, 'mediaName'), '')));
    return explicit || resource_name(or(get(item, 'mediaResource'), get(item, 'resource'))) || '—';
  }
  function transport_expression(config) {
    const override = strip(str(get(config, 'transport_expression', '')));
    if (override) return override;
    const name = str(get(config, 'transport', 'default'));
    const cleaned = strip(name);
    return /^[A-Za-z0-9_]+$/.test(cleaned) ? 'transportmanager:' + cleaned : 'transportmanager:"' + name.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  function fps_average_samples(config) {
    const value = integer(get(get(config, 'updates', {}), 'fps_average_samples', 60));
    return value === null ? 60 : Math.max(1, Math.min(300, value));
  }
  function director_fps_property(config) { return 'object.seriesAverage("Actual", ' + fps_average_samples(config) + ')'; }
  function blank_history() { return {context: null, rows: null, previous: null, sequence: 0}; }
  function empty_role() {
    const role = {transport: {}, sections: [], graphical_schedule: {}, graphical_preview_brightness: {}, content_layers: [], active_content: [], active_membership: {}, active_brightness: [], active: [], annotations: {}};
    for (const field of VIDEO_FIELDS) role[field] = [];
    return role;
  }
  const compare = (a, b) => {
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return a.length - b.length;
  };
  // Python casefold also matches ligatures, Greek variants and Cherokee names.
  const CASE_FOLD = {"µ":"μ","ß":"ss","ŉ":"ʼn","ſ":"s","ǰ":"ǰ","ͅ":"ι","ΐ":"ΐ","ΰ":"ΰ","ς":"σ","ϐ":"β","ϑ":"θ","ϕ":"φ","ϖ":"π","ϰ":"κ","ϱ":"ρ","ϵ":"ε","և":"եւ","ᏸ":"Ᏸ","ᏹ":"Ᏹ","ᏺ":"Ᏺ","ᏻ":"Ᏻ","ᏼ":"Ᏼ","ᏽ":"Ᏽ","ᲀ":"в","ᲁ":"д","ᲂ":"о","ᲃ":"с","ᲄ":"т","ᲅ":"т","ᲆ":"ъ","ᲇ":"ѣ","ᲈ":"ꙋ","ẖ":"ẖ","ẗ":"ẗ","ẘ":"ẘ","ẙ":"ẙ","ẚ":"aʾ","ẛ":"ṡ","ὐ":"ὐ","ὒ":"ὒ","ὔ":"ὔ","ὖ":"ὖ","ᾀ":"ἀι","ᾁ":"ἁι","ᾂ":"ἂι","ᾃ":"ἃι","ᾄ":"ἄι","ᾅ":"ἅι","ᾆ":"ἆι","ᾇ":"ἇι","ᾐ":"ἠι","ᾑ":"ἡι","ᾒ":"ἢι","ᾓ":"ἣι","ᾔ":"ἤι","ᾕ":"ἥι","ᾖ":"ἦι","ᾗ":"ἧι","ᾠ":"ὠι","ᾡ":"ὡι","ᾢ":"ὢι","ᾣ":"ὣι","ᾤ":"ὤι","ᾥ":"ὥι","ᾦ":"ὦι","ᾧ":"ὧι","ᾲ":"ὰι","ᾳ":"αι","ᾴ":"άι","ᾶ":"ᾶ","ᾷ":"ᾶι","ι":"ι","ῂ":"ὴι","ῃ":"ηι","ῄ":"ήι","ῆ":"ῆ","ῇ":"ῆι","ῒ":"ῒ","ΐ":"ΐ","ῖ":"ῖ","ῗ":"ῗ","ῢ":"ῢ","ΰ":"ΰ","ῤ":"ῤ","ῦ":"ῦ","ῧ":"ῧ","ῲ":"ὼι","ῳ":"ωι","ῴ":"ώι","ῶ":"ῶ","ῷ":"ῶι","ꭰ":"Ꭰ","ꭱ":"Ꭱ","ꭲ":"Ꭲ","ꭳ":"Ꭳ","ꭴ":"Ꭴ","ꭵ":"Ꭵ","ꭶ":"Ꭶ","ꭷ":"Ꭷ","ꭸ":"Ꭸ","ꭹ":"Ꭹ","ꭺ":"Ꭺ","ꭻ":"Ꭻ","ꭼ":"Ꭼ","ꭽ":"Ꭽ","ꭾ":"Ꭾ","ꭿ":"Ꭿ","ꮀ":"Ꮀ","ꮁ":"Ꮁ","ꮂ":"Ꮂ","ꮃ":"Ꮃ","ꮄ":"Ꮄ","ꮅ":"Ꮅ","ꮆ":"Ꮆ","ꮇ":"Ꮇ","ꮈ":"Ꮈ","ꮉ":"Ꮉ","ꮊ":"Ꮊ","ꮋ":"Ꮋ","ꮌ":"Ꮌ","ꮍ":"Ꮍ","ꮎ":"Ꮎ","ꮏ":"Ꮏ","ꮐ":"Ꮐ","ꮑ":"Ꮑ","ꮒ":"Ꮒ","ꮓ":"Ꮓ","ꮔ":"Ꮔ","ꮕ":"Ꮕ","ꮖ":"Ꮖ","ꮗ":"Ꮗ","ꮘ":"Ꮘ","ꮙ":"Ꮙ","ꮚ":"Ꮚ","ꮛ":"Ꮛ","ꮜ":"Ꮜ","ꮝ":"Ꮝ","ꮞ":"Ꮞ","ꮟ":"Ꮟ","ꮠ":"Ꮠ","ꮡ":"Ꮡ","ꮢ":"Ꮢ","ꮣ":"Ꮣ","ꮤ":"Ꮤ","ꮥ":"Ꮥ","ꮦ":"Ꮦ","ꮧ":"Ꮧ","ꮨ":"Ꮨ","ꮩ":"Ꮩ","ꮪ":"Ꮪ","ꮫ":"Ꮫ","ꮬ":"Ꮬ","ꮭ":"Ꮭ","ꮮ":"Ꮮ","ꮯ":"Ꮯ","ꮰ":"Ꮰ","ꮱ":"Ꮱ","ꮲ":"Ꮲ","ꮳ":"Ꮳ","ꮴ":"Ꮴ","ꮵ":"Ꮵ","ꮶ":"Ꮶ","ꮷ":"Ꮷ","ꮸ":"Ꮸ","ꮹ":"Ꮹ","ꮺ":"Ꮺ","ꮻ":"Ꮻ","ꮼ":"Ꮼ","ꮽ":"Ꮽ","ꮾ":"Ꮾ","ꮿ":"Ꮿ","ﬀ":"ff","ﬁ":"fi","ﬂ":"fl","ﬃ":"ffi","ﬄ":"ffl","ﬅ":"st","ﬆ":"st","ﬓ":"մն","ﬔ":"մե","ﬕ":"մի","ﬖ":"վն","ﬗ":"մխ"};
  const fold = value => Array.from(value.toLowerCase(), ch => get(CASE_FOLD, ch, ch)).join('');
  class DashboardStore {
    constructor(config) {
      this.config = config;
      this.connected = false;
      this.connection_mode = 'starting';
      this.seed_host = str(get(config.designer, 'host', '127.0.0.1'));
      this.director_host = '';
      this.director_name = '';
      this.director_ip = '';
      this.last_update_monotonic = 0;
      this.last_update_wall = null;
      this.last_error = '';
      this.last_error_wall = null;
      this.connection_attempt = 0;
      this.stream_status = {};
      this.stream_errors = {};
      this.output_code = null;
      this.director_fps = null;
      this.director_fps_raw = null;
      this.fps_raw_stats = {count: 0, min: null, max: null};
      this.media_metadata_by_uid = {};
      this.media_audio_by_uid = {};
      this.media_versions_by_uid = {};
      this.media_files_by_uid = {};
      this.preview_brightness = [];
      this.last_snapshot_log_monotonic = 0;
      this.active_history = {main: blank_history(), aux: blank_history()};
      this.project = {name: strip(str(or(get(get(config, 'ui', {}), 'project_name'), ''))), path: '', version: {}};
      this.media_schedule = [];
      this.roles = {main: empty_role(), aux: empty_role()};
    }
    set_connection(connected, mode, host = '', error = '') {
      if (!connected || !this.connected || (host && host !== this.director_host)) {
        this.director_ip = '';
        this.director_name = '';
        for (const role of ROLES) {
          this.active_history[role].rows = null;
          if (host && this.director_host && host !== this.director_host) this.active_history[role].previous = null;
          this.roles[role].active_membership = {};
          this.roles[role].active_content = [];
          delete this.stream_status[role + '.active_content'];
        }
        this.output_code = null;
        this.director_fps = null;
        this.director_fps_raw = null;
        this.fps_raw_stats = {count: 0, min: null, max: null};
        this.media_metadata_by_uid = {};
        this.media_audio_by_uid = {};
        this.media_versions_by_uid = {};
        this.media_files_by_uid = {};
        this.preview_brightness = [];
        for (const role of ROLES) for (const field of ['graphical_schedule', 'graphical_preview_brightness']) {
          this.roles[role][field] = {};
          delete this.stream_status[role + '.' + field];
          if (connected) delete this.stream_errors[role + '.' + field];
        }
        for (const key of ['output_state', 'director_fps', 'director_fps_raw', 'media_metadata', 'media_audio', 'media_versions', 'media_files', 'preview_brightness']) {
          delete this.stream_status[key];
          if (connected) delete this.stream_errors[key];
        }
      }
      this.connected = connected;
      this.connection_mode = mode;
      if (host) this.director_host = host;
      this.last_error = error;
      this.last_error_wall = error ? wall() : null;
      if (connected) this.touch();
    }
    set_director_identity(name, address) {
      this.director_name = str(or(name, this.director_host));
      this.director_ip = canonical_ip(address);
    }
    touch() { this.last_update_monotonic = monotonic(); this.last_update_wall = wall(); }
    update_value(key, value) {
      delete this.stream_errors[key];
      if (key === 'output_state') {
        if (typeof value !== 'number' || !has(OUTPUT_STATES, value)) {
          this.output_code = null;
          this.set_stream_error(key, 'Unknown LocalState.output value: ' + repr(value));
          return;
        }
        this.output_code = Math.trunc(value);
      } else if (key === 'director_fps' || key === 'director_fps_raw') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
          this[key] = null;
          this.set_stream_error(key, 'Invalid Director FPS value: ' + repr(value));
          return;
        }
        this[key] = value;
        if (key === 'director_fps_raw') {
          const stats = this.fps_raw_stats;
          stats.count += 1;
          stats.min = stats.min !== null ? Math.min(stats.min, value) : value;
          stats.max = stats.max !== null ? Math.max(stats.max, value) : value;
        }
      } else if (['media_metadata', 'media_audio', 'media_versions', 'media_files'].includes(key)) {
        const samples = {};
        for (const item of Array.isArray(value) ? value : []) if (dict(item) && uid_key(get(item, 'mediaResource'))) samples[uid_key(item.mediaResource)] = clone(item);
        this[key + '_by_uid'] = samples;
      } else if (key === 'preview_brightness') {
        this.preview_brightness = (Array.isArray(value) ? value : []).filter(dict).map(clone);
      } else if (key === 'media_schedule') {
        this.media_schedule = Array.isArray(value) ? value : [];
      } else {
        const dot = key.indexOf('.');
        const role = key.slice(0, dot), field = key.slice(dot + 1), data = this.roles[role];
        if (field === 'transport') {
          const previous_track = get(data[field], 'trackName'), previous_uid = get(data[field], 'trackUid');
          data[field] = dict(value) ? value : {};
          const transport = data[field];
          if (!truth(get(transport, 'trackUid'))) transport.trackUid = resource_uid(get(transport, 'trackResource'));
          if (!truth(get(transport, 'trackName'))) transport.trackName = resource_name(get(transport, 'trackResource'));
          const current_track = get(transport, 'trackName'), current_uid = get(transport, 'trackUid');
          const switched = truth(previous_uid) && truth(current_uid) ? uid_text(previous_uid) !== uid_text(current_uid) : Boolean(truth(previous_track) && truth(current_track) && current_track !== previous_track);
          if (switched) {
            data.annotations = {};
            delete this.stream_status[role + '.annotations'];
            delete this.stream_errors[role + '.annotations'];
            data.active_brightness = [];
            data.graphical_schedule = {};
            data.graphical_preview_brightness = {};
            data.content_layers = [];
            data.active_content = [];
            data.active_membership = {};
            delete this.stream_status[role + '.active_content'];
            this.active_history[role] = blank_history();
            for (const name of VIDEO_FIELDS) data[name] = [];
          }
        } else if (field === 'active_content') {
          if (dict(value) && Array.isArray(get(value, 'layers'))) {
            if (as_float(get(value, 'beat')) === null || as_float(get(value, 'trackSeconds')) === null || value.layers.some(row => !dict(row) || truth(get(row, 'errorType')))) {
              this.set_stream_error(key, 'Incomplete atomic active membership packet');
              return;
            }
            data.active_membership = clone(value);
            data[field] = clone(value.layers);
          } else if (Array.isArray(value)) {
            data.active_membership = {};
            data[field] = clone(value);
          } else {
            this.set_stream_error(key, 'Invalid active membership packet');
            return;
          }
        } else if (field === 'graphical_schedule' || field === 'graphical_preview_brightness') data[field] = dict(value) ? clone(value) : {};
        else if (['sections', 'content_layers', 'active_brightness', ...VIDEO_FIELDS, 'active_video_details', 'active_video_tsec', 'active_video', 'video_layers', 'active_media', 'active_elapsed', 'active_remaining', 'active'].includes(field)) data[field] = Array.isArray(value) ? value : [];
      }
      const kind = value === null ? 'NoneType' : Array.isArray(value) ? 'list' : dict(value) ? 'dict' : typeof value === 'boolean' ? 'bool' : typeof value === 'number' ? (Number.isInteger(value) ? 'int' : 'float') : 'str';
      this.stream_status[key] = {lastUpdate: wall(), kind, items: Array.isArray(value) ? value.length : dict(value) ? Object.keys(value).length : 1};
      this.touch();
    }
    set_stream_error(key, message) {
      const now = wall(), clean = str(or(message, 'Unknown property-path error')).slice(0, 2000);
      this.stream_errors[key] = {message: clean, lastUpdate: now};
      this.stream_status[key] = {lastUpdate: now, kind: 'error', items: 0, error: clean};
      if (!key.endsWith('.annotations')) this.touch();
    }
    update_annotations(role, data, expected_track = null) {
      if (expected_track !== null && !equal(this.track_identities()[role], expected_track)) return false;
      this.roles[role].annotations = dict(data) ? data : {};
      let values = this.roles[role].annotations;
      values = or(get(values, 'annotations'), values);
      const key = role + '.annotations';
      delete this.stream_errors[key];
      this.stream_status[key] = {lastUpdate: wall(), kind: 'annotations', items: ['sections', 'notes', 'tags'].reduce((sum, field) => sum + or(get(values, field), []).length, 0)};
      return true;
    }
    update_project(data) {
      const result = dict(data) ? data : {};
      const project_path = strip(str(or(get(result, 'projectPath'), '')));
      const configured_name = strip(str(or(get(get(this.config, 'ui', {}), 'project_name'), '')));
      let path_name = '';
      if (project_path) {
        path_name = project_path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop();
        for (const suffix of ['.d3project', '.d3']) if (path_name.toLowerCase().endsWith(suffix)) { path_name = path_name.slice(0, -suffix.length); break; }
      }
      this.project = {name: configured_name || path_name || 'DISGUISE PROJECT', path: project_path, version: clone(or(get(result, 'version'), {}))};
      this.touch();
    }
    set_error(message) { this.last_error = message; this.last_error_wall = wall(); }
    track_names() { return Object.fromEntries(ROLES.map(role => [role, str(or(get(or(get(this.roles[role], 'transport'), {}), 'trackName'), ''))])); }
    track_identities() { return Object.fromEntries(ROLES.map(role => [role, {name: str(or(get(or(get(this.roles[role], 'transport'), {}), 'trackName'), '')), uid: uid_text(get(or(get(this.roles[role], 'transport'), {}), 'trackUid'))}])); }
    _section_metadata(role, role_data, section) {
      const result = {tc: null, midi: null, osc: null, notes: null, metadataMatch: null};
      if (!truth(section)) return result;
      if (has(this.stream_errors, role + '.annotations')) { result.metadataMatch = 'api-error'; return result; }
      let annotations = or(get(role_data, 'annotations'), {});
      annotations = or(get(annotations, 'annotations'), annotations);
      const api_sections = get(annotations, 'sections', []).filter(item => dict(item) && as_float(get(item, 'time')) !== null);
      api_sections.sort((a, b) => as_float(a.time) - as_float(b.time));
      const track_sections = get(role_data, 'sections', []).filter(dict).slice().sort((a, b) => integer(get(a, 'index', 0)) - integer(get(b, 'index', 0)));
      if (!api_sections.length) { result.metadataMatch = 'no-annotations'; return result; }
      if (api_sections.length !== track_sections.length) { result.metadataMatch = 'section-count-mismatch'; return result; }
      if (new Set(api_sections.map(item => as_float(item.time))).size !== api_sections.length) { result.metadataMatch = 'duplicate-section-times'; return result; }
      const indices = track_sections.map(item => integer(get(item, 'index', 0)));
      const ordinal = indices.indexOf(integer(get(section, 'index', 0)));
      if (ordinal === -1) return result;
      const at_time = as_float(api_sections[ordinal].time);
      const tolerance = Math.max(0, Number(get(get(this.config, 'logic', {}), 'annotation_time_tolerance', 0.01)));
      const grouped = {tc: [], midi: [], osc: [], notes: []};
      const tag_fields = {TC: 'tc', MIDI: 'midi', CUE: 'osc'};
      for (const item of get(annotations, 'tags', [])) {
        if (!dict(item)) continue;
        const position = as_float(get(item, 'time'));
        const field = get(tag_fields, strip(str(or(get(item, 'type'), ''))).toUpperCase());
        if (field && position !== null && Math.abs(position - at_time) <= tolerance) {
          const value = strip(str(get(item, 'value') !== null ? get(item, 'value') : ''));
          if (value && !grouped[field].includes(value)) grouped[field].push(value);
        }
      }
      for (const item of get(annotations, 'notes', [])) {
        if (!dict(item)) continue;
        const position = as_float(get(item, 'time'));
        if (position !== null && Math.abs(position - at_time) <= tolerance) {
          const value = strip(str(or(get(item, 'text'), '')));
          if (value && !grouped.notes.includes(value)) grouped.notes.push(value);
        }
      }
      for (const [key, values] of Object.entries(grouped)) result[key] = values.length ? values.join(' · ') : null;
      result.metadataMatch = 'section-ordinal';
      return result;
    }
    _section_label(role_data, section) {
      const index = integer(get(section, 'index', 0));
      const annotations = or(get(role_data, 'annotations'), {});
      const values = or(get(annotations, 'annotations'), annotations);
      const sections_api = or(get(values, 'sections'), []), notes_api = or(get(values, 'notes'), []), tags_api = or(get(values, 'tags'), []);
      const section_annotation = index < sections_api.length ? get(sections_api, index < 0 ? sections_api.length + index : index, {}) : {};
      const section_time = as_float(get(section_annotation, 'time'));
      let note = '', cue = '';
      if (section_time !== null) {
        const tolerance = Number(get(get(this.config, 'logic', {}), 'annotation_time_tolerance', 0.01));
        for (const item of notes_api) {
          const item_time = as_float(get(item, 'time'));
          if (item_time !== null && Math.abs(item_time - section_time) <= tolerance) { note = strip(str(or(get(item, 'text'), ''))); if (note) break; }
        }
        for (const item of tags_api) {
          const item_time = as_float(get(item, 'time')), tag_type = str(or(get(item, 'type'), '')).toUpperCase();
          if (item_time !== null && Math.abs(item_time - section_time) <= tolerance && tag_type === 'CUE') { cue = strip(str(or(get(item, 'value'), ''))); if (cue) break; }
        }
      }
      const api_index = strip(str(or(get(section_annotation, 'index'), '')));
      const number = 'SECTION ' + String(index + 1).padStart(2, '0');
      const labels = {note, cue, index: api_index ? 'SECTION ' + api_index : '', number};
      for (const source of get(get(this.config, 'logic', {}), 'section_label_priority', ['number'])) {
        const value = get(labels, str(source), '');
        if (value) return value;
      }
      return number;
    }
    _play_mode(transport) {
      if (truth(get(transport, 'loopSection'))) return 'Loop section';
      if (truth(get(transport, 'holding'))) return 'Holding';
      if (truth(get(transport, 'sectionPlayMode'))) return 'Play to end';
      if (truth(get(transport, 'playing'))) return 'Play';
      if (truth(get(transport, 'stopped'))) return 'Stopped';
      return 'Idle';
    }
    _media_interval(item) {
      let start = as_float(get(item, 'effectiveStartBeat')), end = as_float(get(item, 'effectiveEndBeat'));
      if (start === null) { const layer_start = as_float(get(item, 'layerStartBeat'), 0), content_start = as_float(get(item, 'contentStartBeat'), layer_start); start = Math.max(layer_start, content_start); }
      if (end === null) {
        const layer_end = as_float(get(item, 'layerEndBeat'), start);
        let content_end = as_float(get(item, 'contentEndBeat'), layer_end);
        if (content_end === null || content_end > MAX_FLOAT_SENTINEL) content_end = layer_end;
        end = Math.min(layer_end, content_end);
      }
      return [start, end];
    }
    _normalise_layer(item) {
      const result = clone(item), layer_resource = or(get(result, 'layerResource'), get(result, 'layer')), module_resource = or(get(result, 'moduleResource'), get(result, 'module'));
      result.layerResource = layer_resource;
      result.moduleResource = module_resource;
      result.layerUid = uid_text(or(get(result, 'layerUid'), resource_uid(layer_resource)));
      result.layerName = strip(str(or(get(result, 'layerName'), '')));
      result.moduleType = strip(str(or(get(result, 'moduleType'), resource_type(module_resource), '')));
      result.layerType = strip(str(or(get(result, 'layerType'), module_label(result.moduleType))));
      return result;
    }
    _layer_catalog(role_data) {
      const layers = [];
      for (const source_name of ['content_layers', 'video_layers', 'active_content', 'active_standard_video_details', 'active_variable_video_details']) {
        for (const raw of get(role_data, source_name, [])) {
          if (!dict(raw)) continue;
          const item = this._normalise_layer(raw);
          if (layers.some(existing => this._same_layer(item, existing))) continue;
          layers.push(item);
        }
      }
      const by_uid = {}, by_name = {};
      for (const item of layers) {
        if (uid_key(get(item, 'layerUid'))) by_uid[uid_key(item.layerUid)] = item;
        if (strip(str(or(get(item, 'layerName'), '')))) by_name[fold(str(or(get(item, 'layerName'), '')))] = item;
      }
      return [layers, by_uid, by_name];
    }
    _track_media(track_name, track_uid, role_data) {
      const [, layers_by_uid, layers_by_name] = this._layer_catalog(role_data);
      const wanted_uid = uid_key(track_uid), wanted_name = fold(strip(str(or(track_name, '')))), result = [];
      for (const [ordinal, raw] of this.media_schedule.entries()) {
        if (!dict(raw)) continue;
        const track_resource = or(get(raw, 'trackResource'), get(raw, 'track'));
        const raw_track_uid = or(get(raw, 'trackUid'), resource_uid(track_resource));
        const raw_track_name = strip(str(or(get(raw, 'trackName'), resource_name(track_resource), '')));
        const same_uid = Boolean(wanted_uid && uid_key(raw_track_uid) === wanted_uid), same_name = Boolean(wanted_name && fold(raw_track_name) === wanted_name);
        if (!same_uid && !same_name) continue;
        const item = clone(raw);
        item._ordinal = ordinal;
        item.trackResource = track_resource;
        item.trackUid = uid_text(raw_track_uid);
        item.trackName = raw_track_name;
        item.mediaResource = or(get(item, 'mediaResource'), get(item, 'resource'));
        const layer_resource = or(get(item, 'layerResource'), get(item, 'layer'));
        let layer_uid = or(get(item, 'layerUid'), resource_uid(layer_resource));
        let layer_name = strip(str(or(get(item, 'layerName'), '')));
        let catalogue_item = get(layers_by_uid, uid_key(layer_uid));
        if (catalogue_item === null && layer_name) catalogue_item = get(layers_by_name, fold(layer_name));
        if (truth(catalogue_item)) {
          layer_uid = or(layer_uid, get(catalogue_item, 'layerUid'));
          layer_name = or(layer_name, get(catalogue_item, 'layerName', ''));
          item.moduleResource = clone(get(catalogue_item, 'moduleResource'));
          item.moduleType = get(catalogue_item, 'moduleType');
          item.layerType = get(catalogue_item, 'layerType');
        }
        item.layerResource = layer_resource;
        item.layerUid = uid_text(layer_uid);
        item.layerName = layer_name || resource_name(layer_resource) || '—';
        item.moduleType = str(or(get(item, 'moduleType'), 'VariableVideoModule'));
        item.layerType = str(or(get(item, 'layerType'), module_label(item.moduleType)));
        item.mediaName = clean_media_name(item);
        [item.effectiveStartBeat, item.effectiveEndBeat] = this._media_interval(item);
        result.push(item);
      }
      return result;
    }
    _audio_metadata(item) {
      const uid = uid_key(get(item, 'mediaResource'));
      const sample = !has(this.stream_errors, 'media_audio') ? get(this.media_audio_by_uid, uid, {}) : {};
      const value = get(sample, 'hasAudio');
      return typeof value === 'boolean' ? {hasAudio: value, audioSource: 'VideoClip.hasAudio'} : {hasAudio: null, audioSource: null};
    }
    _media_identity_metadata(item) {
      const result = {mediaName: clean_media_name(item), mediaVersion: null}, uid = uid_key(get(item, 'mediaResource'));
      if (has(this.stream_errors, 'media_versions')) return result;
      const version = get(get(this.media_versions_by_uid, uid, {}), 'version');
      if (typeof version !== 'string' || version.length > 32 || !/^[0-9][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*(?![\s\S])/.test(version)) return result;
      result.mediaVersion = version !== '0' ? version : null;
      const sample = !has(this.stream_errors, 'media_files') ? get(this.media_files_by_uid, uid, {}) : {};
      if (get(sample, 'version') === version) {
        const files = get(sample, 'files');
        const names = new Set((Array.isArray(files) ? files : []).filter(file => dict(file) && typeof get(file, 'path') === 'string' && strip(file.path) && !file.path.toLowerCase().endsWith('.apx')).map(resource_name));
        if (names.size === 1) result.mediaName = Array.from(names)[0];
      }
      return result;
    }
    _preview_brightness_metadata(item) {
      const [start] = this._media_interval(item);
      const result = {brightness: null, brightnessSource: null, brightnessSampleBeat: start, brightnessReason: 'no-preview-sample'};
      if (has(this.stream_errors, 'preview_brightness')) { result.brightnessReason = 'preview-stream-error'; return result; }
      const track_uid = uid_key(or(get(item, 'trackUid'), get(item, 'trackResource'))), layer_uid = uid_key(or(get(item, 'layerUid'), get(item, 'layerResource'))), media_uid = uid_key(get(item, 'mediaResource'));
      if (!(track_uid && layer_uid && media_uid)) return result;
      for (const sample of this.preview_brightness) {
        const beat = as_float(get(sample, 'sampleBeat'));
        if (uid_key(get(sample, 'trackResource')) !== track_uid || uid_key(get(sample, 'layerResource')) !== layer_uid || uid_key(get(sample, 'mediaResource')) !== media_uid || beat === null || Math.abs(beat - start) > 1e-6) continue;
        const controls = ['expressionActive', 'sockpuppetControlled', 'externallyControlled'].map(key => get(sample, key));
        if (controls.some(value => value === true)) { result.brightnessReason = 'external-control'; return result; }
        if (!controls.every(value => value === false)) { result.brightnessReason = 'control-status-unknown'; return result; }
        const value = as_float(get(sample, 'brightness'));
        if (value !== null && typeof get(sample, 'brightness') !== 'boolean' && Math.abs(value) < MAX_FLOAT_SENTINEL) Object.assign(result, {brightness: value, brightnessSource: 'FieldSequence.getSequencedValue', brightnessReason: 'sequenced-at-media-start'});
        else result.brightnessReason = 'invalid-preview-value';
        return result;
      }
      return result;
    }
    _media_preview(item) {
      const result = {layerName: get(item, 'layerName', '—'), layerType: get(item, 'layerType', 'Video'), mediaName: get(item, 'mediaName', '—'), layerUid: get(item, 'layerUid'), mediaUid: resource_uid(get(item, 'mediaResource')), durationTimecode: null, durationSeconds: null, durationFps: null, durationSource: null, ...this._preview_brightness_metadata(item), ...this._audio_metadata(item), ...this._media_identity_metadata(item)};
      const uid = uid_key(get(item, 'mediaResource'));
      const metadata = !has(this.stream_errors, 'media_metadata') ? get(this.media_metadata_by_uid, uid, {}) : {};
      const duration = as_float(get(metadata, 'durationSeconds')), fps = as_float(get(metadata, 'durationFps')), tc = get(metadata, 'durationTimecode');
      if (!is_still_media_name(str(result.mediaName)) && duration !== null && duration > 0 && duration < MAX_FLOAT_SENTINEL && fps !== null && fps > 0 && typeof tc === 'string' && strip(tc)) Object.assign(result, {durationTimecode: strip(tc), durationSeconds: duration, durationFps: fps, durationSource: 'VideoClip.transportDuration'});
      return result;
    }
    _media_for_section(section, track_media) {
      if (!truth(section)) return {layerName: '—', mediaName: '—'};
      const start = as_float(get(section, 'startBeat'), 0), end = as_float(get(section, 'endBeat'), start), candidates = [];
      for (const item of track_media) {
        const [media_start, media_end] = this._media_interval(item), overlap = Math.min(end, media_end) - Math.max(start, media_start);
        if (overlap > 1e-6) candidates.push([Math.max(start, media_start), get(item, '_ordinal', 0), item]);
      }
      candidates.sort((a, b) => compare(a.slice(0, 2), b.slice(0, 2)));
      return candidates.length ? this._media_preview(candidates[0][2]) : {layerName: '—', mediaName: '—'};
    }
    _adjacent_media(beat, track_media, direction) {
      const current = as_float(beat), candidates = [];
      if (current === null) return {layerName: '—', mediaName: '—'};
      for (const item of track_media) {
        const [start, end] = this._media_interval(item);
        if (direction === 'next' && start > current + 1e-6) candidates.push([start, get(item, '_ordinal', 0), item]);
        else if (direction === 'previous' && end <= current + 1e-6) candidates.push([end, get(item, '_ordinal', 0), item]);
      }
      candidates.sort((a, b) => compare(a.slice(0, 2), b.slice(0, 2)) * (direction === 'previous' ? -1 : 1));
      return candidates.length ? this._media_preview(candidates[0][2]) : {layerName: '—', mediaName: '—'};
    }
    _layer_for_section(section, role_data) {
      if (!truth(section)) return {layerName: '—', mediaName: '—'};
      const start = as_float(get(section, 'startBeat'), 0), end = as_float(get(section, 'endBeat'), start), [layers] = this._layer_catalog(role_data), candidates = [];
      for (const [ordinal, item] of layers.entries()) {
        if (get(item, 'enabled') === false) continue;
        const layer_start = as_float(get(item, 'layerStartBeat')), layer_end = as_float(get(item, 'layerEndBeat'));
        if (layer_start === null || layer_end === null) continue;
        if (Math.min(end, layer_end) - Math.max(start, layer_start) > 1e-6) candidates.push([Math.max(start, layer_start), ordinal, item]);
      }
      candidates.sort((a, b) => compare(a.slice(0, 2), b.slice(0, 2)));
      return candidates.length ? {layerName: or(get(candidates[0][2], 'layerName'), '—'), layerType: or(get(candidates[0][2], 'layerType'), 'Content'), mediaName: '—'} : {layerName: '—', mediaName: '—'};
    }
    _adjacent_layer(beat, role_data, direction) {
      const current = as_float(beat), [layers] = this._layer_catalog(role_data), candidates = [];
      if (current === null) return {layerName: '—', mediaName: '—'};
      for (const [ordinal, item] of layers.entries()) {
        if (get(item, 'enabled') === false) continue;
        const start = as_float(get(item, 'layerStartBeat')), end = as_float(get(item, 'layerEndBeat'));
        if (start === null || end === null) continue;
        if (direction === 'next' && start > current + 1e-6) candidates.push([start, ordinal, item]);
        else if (direction === 'previous' && end <= current + 1e-6) candidates.push([end, ordinal, item]);
      }
      candidates.sort((a, b) => compare(a.slice(0, 2), b.slice(0, 2)) * (direction === 'previous' ? -1 : 1));
      return candidates.length ? {layerName: or(get(candidates[0][2], 'layerName'), '—'), layerType: or(get(candidates[0][2], 'layerType'), 'Content'), mediaName: '—'} : {layerName: '—', mediaName: '—'};
    }
    _payload_matches_track(payload, transport) {
      const wanted = uid_key(or(get(transport, 'trackUid'), get(transport, 'trackResource'))), actual = uid_key(or(get(payload, 'trackResource'), get(payload, 'trackUid')));
      return Boolean(wanted && actual && wanted === actual);
    }
    _future_layers(role, role_data) {
      if (has(this.stream_errors, role + '.graphical_schedule')) return [[], 'stream-error'];
      const payload = or(get(role_data, 'graphical_schedule'), {});
      if (truth(payload)) {
        if (!this._payload_matches_track(payload, or(get(role_data, 'transport'), {}))) return [[], 'track-mismatch'];
        if (!Array.isArray(get(payload, 'layers'))) return [[], 'invalid-payload'];
        return [payload.layers.filter(dict).map(row => this._normalise_layer(row)), 'ok'];
      }
      const rows = or(get(role_data, 'content_layers'), []);
      return [rows.filter(dict).map(row => this._normalise_layer(row)), rows.length ? 'compatibility-catalog' : 'no-data'];
    }
    _layer_preview(role, role_data, layer, beat) {
      const result = {layerName: or(get(layer, 'layerName'), '—'), layerType: or(get(layer, 'layerType'), 'Content'), layerUid: get(layer, 'layerUid'), mediaName: '—', mediaUid: null, hasAudio: null, audioSource: null, durationTimecode: null, durationSeconds: null, durationFps: null, durationSource: null, brightness: null, brightnessSource: null, brightnessSampleBeat: beat, brightnessReason: 'no-preview-sample'};
      if (has(this.stream_errors, role + '.graphical_preview_brightness')) { result.brightnessReason = 'preview-stream-error'; return result; }
      const payload = or(get(role_data, 'graphical_preview_brightness'), {});
      if (!this._payload_matches_track(payload, or(get(role_data, 'transport'), {}))) return result;
      const samples = get(payload, 'samples');
      if (!Array.isArray(samples)) return result;
      for (const sample of samples) {
        if (!dict(sample)) continue;
        const sample_beat = as_float(get(sample, 'sampleBeat'));
        if (!this._same_layer(layer, sample) || sample_beat === null || Math.abs(sample_beat - beat) > 1e-6) continue;
        const controls = ['expressionActive', 'sockpuppetControlled', 'externallyControlled'].map(key => get(sample, key));
        if (controls.some(value => value === true)) result.brightnessReason = 'external-control';
        else if (!controls.every(value => value === false)) result.brightnessReason = 'control-status-unknown';
        else {
          const value = as_float(get(sample, 'brightness'));
          if (value !== null && typeof get(sample, 'brightness') !== 'boolean' && Math.abs(value) < MAX_FLOAT_SENTINEL) Object.assign(result, {brightness: value, brightnessSource: 'FieldSequence.getSequencedValue', brightnessReason: 'sequenced-at-layer-start'});
          else result.brightnessReason = 'invalid-preview-value';
        }
        break;
      }
      return result;
    }
    _next_scheduled(role, role_data, track_media) {
      const transport = or(get(role_data, 'transport'), {}), current = as_float(get(transport, 'beat'));
      const [layers, catalog_status] = this._future_layers(role, role_data);
      const selection = {catalogStatus: catalog_status, complete: catalog_status === 'ok', catalogLayers: layers.length, candidates: 0, kind: null, startBeat: null, stackIndex: null, simultaneousLayers: 0, tieBreak: 'lowest-layer'};
      const empty = {layerName: '—', layerType: 'Content', mediaName: '—'};
      if (current === null || Math.abs(current) >= MAX_FLOAT_SENTINEL) { selection.reason = 'unknown-playhead'; return [empty, selection]; }
      if (['stream-error', 'track-mismatch', 'invalid-payload'].includes(catalog_status)) { selection.reason = catalog_status; return [empty, selection]; }
      const candidates = [];
      for (const [ordinal, layer] of layers.entries()) {
        const start = as_float(get(layer, 'layerStartBeat')), end = as_float(get(layer, 'layerEndBeat'));
        if (get(layer, 'enabled') === false || start === null || end === null || Math.abs(start) >= MAX_FLOAT_SENTINEL || start <= current + 1e-6 || end <= start) continue;
        candidates.push([start, ordinal, 1, end, 'layer-start', layer]);
      }
      const wanted_uid = uid_key(or(get(transport, 'trackUid'), get(transport, 'trackResource')));
      for (const item of track_media) {
        const actual_uid = uid_key(or(get(item, 'trackUid'), get(item, 'trackResource')));
        if (wanted_uid && actual_uid && wanted_uid !== actual_uid) continue;
        const matched = layers.map((layer, ordinal) => [ordinal, layer]).find(pair => this._same_layer(item, pair[1]));
        if (matched && get(matched[1], 'enabled') === false) continue;
        if (catalog_status === 'ok' && matched === undefined) continue;
        const [start, end] = this._media_interval(item);
        if (Math.abs(start) >= MAX_FLOAT_SENTINEL || start <= current + 1e-6 || end <= start) continue;
        const ordinal = matched ? matched[0] : layers.length + get(item, '_ordinal', 0);
        candidates.push([start, ordinal, 0, end, 'media-start', item]);
      }
      selection.candidates = candidates.length;
      if (!candidates.length) { selection.reason = 'no-future-start'; return [empty, selection]; }
      const earliest = Math.min(...candidates.map(entry => entry[0]));
      const simultaneous = candidates.filter(entry => Math.abs(entry[0] - earliest) <= 1e-6);
      simultaneous.sort((a, b) => compare([-a[1], a[2], a[0]], [-b[1], b[2], b[0]]));
      const [start, ordinal, , end, kind, item] = simultaneous[0];
      Object.assign(selection, {kind, startBeat: start, stackIndex: ordinal, simultaneousLayers: new Set(simultaneous.map(entry => entry[1])).size, reason: 'nearest-start'});
      const result = kind === 'media-start' ? this._media_preview(item) : this._layer_preview(role, role_data, item, start);
      Object.assign(result, {scheduledStartBeat: start, scheduledEndBeat: end});
      return [result, selection];
    }
    _sort_active(role, active) {
      const priority = get(this.config.timelines[role], 'layer_priority', []), priority_map = {};
      priority.forEach((name, index) => { priority_map[str(name)] = index; });
      const indexed = Array.from(active.entries());
      indexed.sort((a, b) => compare([get(priority_map, str(or(get(a[1], 'layerName'), '')), Object.keys(priority_map).length), a[0]], [get(priority_map, str(or(get(b[1], 'layerName'), '')), Object.keys(priority_map).length), b[0]]));
      return indexed.map(pair => pair[1]);
    }
    _same_layer(left, right) {
      const left_uid = uid_key(or(get(left, 'layerUid'), get(left, 'layerResource'))), right_uid = uid_key(or(get(right, 'layerUid'), get(right, 'layerResource')));
      if (left_uid && right_uid) return left_uid === right_uid;
      const left_module_uid = uid_key(get(left, 'moduleResource')), right_module_uid = uid_key(get(right, 'moduleResource'));
      if (left_module_uid && right_module_uid) return left_module_uid === right_module_uid;
      const left_name = fold(strip(str(or(get(left, 'layerName'), '')))), right_name = fold(strip(str(or(get(right, 'layerName'), ''))));
      return Boolean(left_name && right_name && left_name === right_name);
    }
    _layer_hidden(row) { return get(row, 'enabled') === false || get(row, 'enabledIncludingParents') === false || get(row, 'disabled') === true; }
    _active_rows(role, role_data, track_media) {
      const transport = or(get(role_data, 'transport'), {}), beat = as_float(get(transport, 'beat')), track_seconds = as_float(get(transport, 'trackSeconds'));
      const [layer_catalog] = this._layer_catalog(role_data), authoritative = has(this.stream_status, role + '.active_content');
      if (this.connection_mode === 'live' && !authoritative) return [];
      const legacy_active = get(role_data, 'active', []).filter(dict).map(item => this._normalise_layer(item));
      let exact_active = (authoritative ? get(role_data, 'active_content', []) : get(role_data, 'active_media', [])).filter(dict).map(item => this._normalise_layer(item));
      for (const member of exact_active) {
        const stored = layer_catalog.find(item => this._same_layer(member, item));
        if (stored) for (const [key, value] of Object.entries(stored)) if ((get(member, key) === null || get(member, key) === '') && value !== null && value !== '') member[key] = clone(value);
      }
      for (const source_name of [...VIDEO_FIELDS, 'active_video_details', 'active_video_tsec', 'active_video']) {
        for (const raw of get(role_data, source_name, [])) {
          if (!dict(raw)) continue;
          const item = this._normalise_layer(raw);
          let target = exact_active.find(row => this._same_layer(row, item));
          if (!target) {
            if (authoritative) continue;
            target = item;
            exact_active.push(target);
          } else for (const [key, value] of Object.entries(item)) {
            if (value !== null && value !== '' && (!authoritative || !['layerResource', 'layerUid', 'layerName', 'enabled', 'layerStartBeat', 'layerEndBeat', 'layerStartSec', 'layerEndSec'].includes(key))) target[key] = clone(value);
          }
        }
      }
      for (const [source_name, value_key] of [['active_elapsed', 'elapsed'], ['active_remaining', 'remaining']]) {
        for (const raw of get(role_data, source_name, [])) {
          if (!dict(raw)) continue;
          const item = this._normalise_layer(raw);
          let target = exact_active.find(row => this._same_layer(row, item));
          if (!target) {
            if (authoritative) continue;
            target = item;
            exact_active.push(target);
          }
          if (has(item, value_key)) target[value_key] = get(item, value_key);
        }
      }
      if (!exact_active.length && !authoritative) exact_active = legacy_active;
      let basic_active = [];
      if (authoritative) basic_active = exact_active;
      else if (layer_catalog.length && beat !== null) {
        for (const item of layer_catalog) {
          const start = as_float(get(item, 'layerStartBeat')), end = as_float(get(item, 'layerEndBeat'));
          if (get(item, 'enabled') === false || start === null || end === null) continue;
          if (start <= beat && beat < end) basic_active.push(item);
        }
      } else if (exact_active.length) basic_active = exact_active;
      else if (legacy_active.length) basic_active = legacy_active;
      for (const exact of exact_active) if (!basic_active.some(base => this._same_layer(exact, base))) basic_active.push(exact);
      const unique_active = [];
      for (const item of basic_active) if (!unique_active.some(existing => this._same_layer(item, existing))) unique_active.push(item);
      basic_active = unique_active;
      const min_brightness = Number(get(get(this.config, 'logic', {}), 'minimum_brightness', 0.001)), live_threshold = Number(get(get(this.config, 'ui', {}), 'live_threshold_seconds', 86400)), default_fps = as_float(get(get(this.config, 'ui', {}), 'default_fps'), 25);
      let rows = [];
      for (const base of basic_active) {
        const brightness = as_float(get(base, 'brightness'), 1);
        if (brightness !== null && brightness < min_brightness) continue;
        let row = this._normalise_layer(base);
        const exact = exact_active.find(item => this._same_layer(item, row));
        if (exact) {
          for (const [key, value] of Object.entries(exact)) if (value !== null && value !== '') row[key] = clone(value);
          row = this._normalise_layer(row);
        }
        if (this._layer_hidden(row)) continue;
        const brightness_key = role + '.active_brightness', samples = or(get(role_data, 'active_brightness'), []);
        const brightness_sample = samples.find(sample => dict(sample) && this._same_layer(row, this._normalise_layer(sample)));
        if (has(this.stream_errors, brightness_key)) row.brightness = null;
        else if (brightness_sample !== undefined) row.brightness = as_float(get(brightness_sample, 'brightness'));
        else row.brightness = as_float(get(row, 'brightness'));
        const mapped_candidates = [];
        for (const item of track_media) {
          if (!this._same_layer(item, row)) continue;
          const [start, end] = this._media_interval(item);
          if (beat === null || (start <= beat && beat < end)) mapped_candidates.push(item);
        }
        mapped_candidates.sort((a, b) => compare([this._media_interval(b)[0], get(b, '_ordinal', 0)], [this._media_interval(a)[0], get(a, '_ordinal', 0)]));
        const mapped = mapped_candidates.length ? mapped_candidates[0] : null;
        if (mapped && !truth(get(row, 'mediaResource'))) row.mediaResource = clone(get(mapped, 'mediaResource'));
        if (mapped && !strip(str(or(get(row, 'mediaName'), '')))) row.mediaName = get(mapped, 'mediaName');
        row.mediaName = clean_media_name(row);
        row.layerName = str(or(get(row, 'layerName'), '—'));
        row.layerUid = uid_text(or(get(row, 'layerUid'), resource_uid(get(row, 'layerResource'))));
        row.moduleType = strip(str(or(get(row, 'moduleType'), '')));
        row.layerType = str(or(get(row, 'layerType'), module_label(get(row, 'moduleType'))));
        Object.assign(row, this._audio_metadata(row), this._media_identity_metadata(row));
        if (['', '—'].includes(row.layerName) && !row.layerUid) continue;
        row.endPoint = is_still_media_name(row.mediaName) ? null : end_point_label(get(row, 'atEndPoint'));
        const fps = as_float(get(row, 'fps'), default_fps);
        let elapsed = as_float(get(row, 'elapsed')), remaining = as_float(get(row, 'remaining'));
        const frame = as_float(get(row, 'frameNumber')), clip_start = as_float(get(row, 'clipStartFrame')), clip_end = as_float(get(row, 'clipEndFrame')), clip_frames = as_float(get(row, 'clipNFrames'));
        const frame_range_valid = Boolean(fps && fps > 0 && clip_start !== null && clip_end !== null && clip_end > clip_start && (clip_frames === null || clip_frames > 1));
        if (frame_range_valid && frame !== null) {
          const frame_elapsed = Math.max(0, (frame - clip_start) / fps), frame_remaining = Math.max(0, (clip_end - frame) / fps);
          let used_frame_fallback = false;
          if (elapsed === null || (elapsed <= 0 && frame_elapsed > 0)) { elapsed = frame_elapsed; used_frame_fallback = true; }
          if (remaining === null || (remaining <= 0 && frame_remaining > 0)) { remaining = frame_remaining; used_frame_fallback = true; }
          if (used_frame_fallback) row.timingFallback = 'frame';
        }
        const media_name = str(or(get(row, 'mediaName'), ''));
        const media_runtime_valid = elapsed !== null && remaining !== null && (remaining > 0 || elapsed > 0 || frame_range_valid) && !is_still_media_name(media_name);
        if (media_runtime_valid) { row.elapsed = Math.max(0, elapsed); row.remaining = Math.max(0, remaining); row.timingSource = 'media'; row.timingApproximate = false; }
        else { row.elapsed = null; row.remaining = null; row.timingSource = 'none'; }
        if (row.elapsed === null || row.remaining === null) {
          let start_sec = as_float(get(row, 'layerStartSec')), end_sec = as_float(get(row, 'layerEndSec'));
          if (mapped) { start_sec = as_float(get(mapped, 'effectiveStartSec'), start_sec); end_sec = as_float(get(mapped, 'effectiveEndSec'), end_sec); }
          if (track_seconds !== null && start_sec !== null && end_sec !== null && end_sec >= start_sec) { row.elapsed = Math.max(0, track_seconds - start_sec); row.remaining = Math.max(0, end_sec - track_seconds); row.timingSource = 'layer'; row.timingApproximate = true; }
        }
        row.fps = fps;
        row.timingAvailable = get(row, 'elapsed') !== null && get(row, 'remaining') !== null;
        if (row.remaining !== null && row.remaining >= live_threshold) row.remaining = null;
        rows.push(row);
      }
      rows = this._sort_active(role, rows);
      const limit = integer(get(this.config.timelines[role], 'max_active_layers', role === 'main' ? 3 : 1));
      return rows.slice(0, Math.max(1, limit));
    }
    _derive_role(role, role_data, connected = true) {
      const transport = clone(or(get(role_data, 'transport'), {})), membership = or(get(role_data, 'active_membership'), {});
      const roster_uid = uid_key(get(membership, 'trackResource')), track_key = uid_key(or(get(transport, 'trackUid'), get(transport, 'trackResource')));
      const membership_known = has(this.stream_status, role + '.active_content');
      const membership_valid = membership_known && !has(this.stream_errors, role + '.active_content') && (!truth(membership) || Boolean(roster_uid && track_key && roster_uid === track_key));
      if (membership_valid && truth(membership)) {
        transport.beat = get(membership, 'beat');
        transport.trackSeconds = get(membership, 'trackSeconds');
        const sample_beat = as_float(get(membership, 'beat'));
        const sample_section = get(role_data, 'sections', []).find(s => sample_beat !== null && as_float(get(s, 'startBeat'), 0) <= sample_beat && sample_beat < as_float(get(s, 'endBeat'), MAX_FLOAT_SENTINEL));
        if (sample_section) transport.sectionIndex = get(sample_section, 'index');
      }
      role_data = {...role_data, transport};
      if (truth(membership) && (!roster_uid || !track_key || roster_uid !== track_key)) role_data.active_content = [];
      const sections = get(role_data, 'sections', []).filter(dict).map(clone).sort((a, b) => integer(get(a, 'index', 0)) - integer(get(b, 'index', 0)));
      for (const section of sections) section.label = this._section_label(role_data, section);
      const track_name = str(or(get(transport, 'trackName'), 'NOT CONNECTED')), track_uid = uid_text(get(transport, 'trackUid'));
      const track_media = this._track_media(track_name, track_uid, role_data), current_index = integer(get(transport, 'sectionIndex'));
      const by_index = {};
      for (const section of sections) by_index[integer(get(section, 'index', 0))] = section;
      const current_section = current_index !== null ? get(by_index, current_index) : null;
      const next_section = current_index !== null ? get(by_index, current_index + 1) : null;
      const active = this._active_rows(role, role_data, track_media), [next_media, next_selection] = this._next_scheduled(role, role_data, track_media);
      let countdown_source = active.find(item => get(item, 'timingSource') === 'media' && get(item, 'remaining') !== null);
      if (!countdown_source) countdown_source = active.find(item => get(item, 'remaining') !== null && !['', '—'].includes(str(or(get(item, 'mediaName'), ''))) && !is_still_media_name(str(or(get(item, 'mediaName'), ''))));
      if (!countdown_source) countdown_source = active.find(item => get(item, 'layerType') === 'Video' && !['', '—'].includes(str(or(get(item, 'mediaName'), ''))) && !is_still_media_name(str(or(get(item, 'mediaName'), ''))));
      const section_payload = (section, media) => !truth(section) ? {available: false, label: '—', ...media, ...this._section_metadata(role, role_data, null)} : {available: true, index: get(section, 'index'), label: get(section, 'label', '—'), startBeat: get(section, 'startBeat'), endBeat: get(section, 'endBeat'), ...media, ...this._section_metadata(role, role_data, section)};
      const history = this.active_history[role];
      const context = [or(get(this.project, 'path'), get(this.project, 'name')), get(transport, 'transportName'), uid_key(track_uid) || track_name];
      if (!equal(history.context, context)) Object.assign(history, {context, rows: null, previous: null, sequence: 0});
      const can_observe = connected && (membership_valid || (!membership_known && this.connection_mode !== 'live'));
      if (can_observe) {
        const old_rows = history.rows;
        const hidden_rows = get(role_data, 'active_content', []).filter(row => dict(row) && this._layer_hidden(row));
        const hidden = row => this._layer_hidden(row) || hidden_rows.some(item => this._same_layer(row, item));
        if (truth(history.previous) && hidden(history.previous)) history.previous = null;
        const departed = old_rows !== null ? old_rows.filter(row => !hidden(row) && !active.some(now => this._same_layer(row, now))) : [];
        if (departed.length) {
          const [catalogue] = this._future_layers(role, role_data);
          const departure_order = row => {
            const found = catalogue.findIndex(layer => this._same_layer(row, layer));
            const stack = found === -1 ? old_rows.findIndex(old => equal(old, row)) : found;
            return [as_float(get(row, 'layerEndBeat'), -MAX_FLOAT_SENTINEL), stack];
          };
          // Python max keeps the first equal candidate.
          const last = departed.reduce((best, row) => compare(departure_order(row), departure_order(best)) > 0 ? row : best);
          history.sequence += 1;
          history.previous = {...clone(last), available: true, departedAt: wall(), departureSequence: history.sequence, historySource: 'active-exit'};
        }
        history.rows = active.map(row => section_payload(current_section, row));
      }
      const previous = truth(history.previous) ? clone(history.previous) : {available: false, label: '—', layerName: '—', layerType: 'Content', mediaName: '—', historySource: 'awaiting-observed-exit'};
      return {
        role,
        transportName: str(or(get(transport, 'transportName'), get(this.config.timelines[role], 'transport', '—'))),
        trackName: track_name, trackUid: track_uid, trackMediaItems: track_media.length,
        playMode: this._play_mode(transport),
        playbackMode: truth(get(transport, 'loopSection')) ? 'Loop section' : truth(get(transport, 'sectionPlayMode')) ? 'Play to end' : has(transport, 'sectionPlayMode') ? 'Continuous' : null,
        playing: truth(get(transport, 'playing')), holding: truth(get(transport, 'holding')),
        stopped: typeof get(transport, 'stopped') === 'boolean' ? get(transport, 'stopped') : null,
        currentBeat: as_float(get(transport, 'beat')), currentSeconds: as_float(get(transport, 'trackSeconds')),
        currentSection: section_payload(current_section, {layerName: '—', layerType: 'Content', mediaName: '—'}),
        previous,
        activeMembership: {available: connected && membership_valid, authoritative: membership_known, atomic: truth(membership), trackMatches: !roster_uid || !track_key || roster_uid === track_key, sampleBeat: get(transport, 'beat'), source: membership_known ? 'TrackPlayer.activeLayers' : 'legacy'},
        previousSelection: {source: previous.historySource, sequence: history.sequence, layerUid: get(previous, 'layerUid')},
        active,
        next: section_payload(next_section, next_media), nextSelection: next_selection,
        nextSection: section_payload(next_section, {layerName: '—', layerType: 'Content', mediaName: '—'}),
        countdownSeconds: countdown_source ? get(countdown_source, 'remaining') : null,
        countdownSource: countdown_source ? {layerUid: or(get(countdown_source, 'layerUid'), ''), layerName: or(get(countdown_source, 'layerName'), '—'), layerType: or(get(countdown_source, 'layerType'), 'Video'), mediaName: or(get(countdown_source, 'mediaName'), '—'), timingSource: or(get(countdown_source, 'timingSource'), 'unknown'), timingApproximate: truth(get(countdown_source, 'timingApproximate'))} : null
      };
    }
    snapshot() {
      const now = monotonic(), stale_after = Number(get(get(this.config, 'logic', {}), 'stale_after_seconds', 3));
      const stale = !this.last_update_monotonic || now - this.last_update_monotonic > stale_after;
      const connected = Boolean(this.connected && !stale);
      const output_available = connected && has(OUTPUT_STATES, this.output_code) && !has(this.stream_errors, 'output_state');
      const output_code = output_available ? this.output_code : null;
      const [output_state, output_label] = get(OUTPUT_STATES, output_code, ['unknown', 'NO DATA']);
      const fps_available = connected && this.director_fps !== null && !has(this.stream_errors, 'director_fps');
      const fps_raw_available = connected && this.director_fps_raw !== null && !has(this.stream_errors, 'director_fps_raw');
      const main = this._derive_role('main', this.roles.main, connected), aux = this._derive_role('aux', this.roles.aux, connected);
      return {
        appVersion: APP_VERSION, generatedAt: wall(), project: clone(this.project),
        outputs: {state: output_state, label: output_label, code: output_code, available: output_available, source: OUTPUT_STATE_PROPERTY, updatedAt: get(get(this.stream_status, 'output_state', {}), 'lastUpdate'), error: get(get(this.stream_errors, 'output_state', {}), 'message', '')},
        performance: {fps: fps_available ? this.director_fps : null, rawFps: fps_raw_available ? this.director_fps_raw : null, averageSamples: fps_average_samples(this.config), rawAvailable: fps_raw_available, rawStats: clone(this.fps_raw_stats), available: fps_available, source: DIRECTOR_FPS_OBJECT + ' → ' + director_fps_property(this.config), rawSource: DIRECTOR_FPS_OBJECT + ' → ' + DIRECTOR_FPS_RAW_PROPERTY},
        status: {connected, socketConnected: this.connected, stale, mode: this.connection_mode, seedHost: this.seed_host, directorHost: this.director_host, directorName: this.director_name || this.director_host, directorIp: this.director_ip, lastUpdate: this.last_update_wall, lastError: this.last_error, lastErrorAt: this.last_error_wall, logFile: 'Browser diagnostics', scheduleItems: this.media_schedule.length, streams: clone(this.stream_status), streamErrors: clone(this.stream_errors)},
        main, aux, ui: clone(get(this.config, 'ui', {}))
      };
    }
  }
  // ipaddress.ip_address accepts canonical IPv4 and IPv6, including scoped IPv6.
  function canonical_ip(address) {
    if (typeof address === 'boolean') address = Number(address);
    if (typeof address === 'number' && Number.isInteger(address) && address >= 0) {
      if (address <= 0xffffffff) return [24, 16, 8, 0].map(shift => (address >>> shift) & 255).join('.');
      let number = BigInt(address);
      if (number >= (BigInt(1) << BigInt(128))) return '';
      const groups = [];
      for (let i = 0; i < 8; i++) { groups.unshift((number & BigInt(65535)).toString(16)); number >>= BigInt(16); }
      return canonical_ip(groups.join(':'));
    }
    if (typeof address !== 'string' || address.includes('/')) return '';
    if (!address.includes(':')) {
      const parts = address.split('.');
      return parts.length === 4 && parts.every(part => /^(?:0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255) ? parts.map(Number).join('.') : '';
    }
    const scope = address.indexOf('%');
    const zone = scope === -1 ? '' : address.slice(scope);
    let text = scope === -1 ? address : address.slice(0, scope);
    if (zone && (zone.length < 2 || zone.slice(1).includes('%'))) return '';
    if (text.includes('.')) {
      const last = text.lastIndexOf(':');
      const ipv4 = canonical_ip(text.slice(last + 1));
      if (!ipv4) return '';
      const bytes = ipv4.split('.').map(Number);
      text = text.slice(0, last + 1) + ((bytes[0] << 8) + bytes[1]).toString(16) + ':' + ((bytes[2] << 8) + bytes[3]).toString(16);
    }
    if ((text.match(/::/g) || []).length > 1) return '';
    const halves = text.split('::'), left = halves[0] ? halves[0].split(':') : [], right = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
    const all = left.concat(right);
    if (!all.every(part => /^[0-9a-fA-F]{1,4}$/.test(part))) return '';
    if ((halves.length === 1 && left.length !== 8) || (halves.length === 2 && all.length >= 8)) return '';
    const groups = halves.length === 1 ? left : left.concat(Array(8 - all.length).fill('0'), right);
    const numbers = groups.map(part => parseInt(part, 16));
    let best_start = -1, best_length = 1;
    for (let i = 0; i < 8;) {
      if (numbers[i] !== 0) { i++; continue; }
      let end = i;
      while (end < 8 && numbers[end] === 0) end++;
      if (end - i > best_length) { best_start = i; best_length = end - i; }
      i = end;
    }
    if (best_start === -1) return numbers.map(n => n.toString(16)).join(':') + zone;
    return numbers.slice(0, best_start).map(n => n.toString(16)).join(':') + '::' + numbers.slice(best_start + best_length).map(n => n.toString(16)).join(':') + zone;
  }
  return {DashboardStore, as_float, uid_text, uid_key, resource_uid, resource_path, resource_name, resource_type, module_label, end_point_label, is_still_media_name, split_property_errors, clean_media_name, transport_expression, fps_average_samples, director_fps_property, APP_VERSION, MAX_FLOAT_SENTINEL, OUTPUT_STATE_PROPERTY, OUTPUT_STATES, DIRECTOR_FPS_OBJECT, DIRECTOR_FPS_RAW_PROPERTY};
}));
