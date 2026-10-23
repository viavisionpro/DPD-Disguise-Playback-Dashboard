#!/usr/bin/env python3


# Copyright (C) 2026 Vladimir Zakharov / viavision.pro
# SPDX-License-Identifier: GPL-3.0-only

from __future__ import annotations

import argparse
import copy
import errno
import json
import logging
from logging.handlers import RotatingFileHandler
import math
import ipaddress
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import threading
import time
import traceback
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen, build_opener, ProxyHandler
import webbrowser

try:
    from websockets.sync.client import connect as websocket_connect
    from websockets.exceptions import ConnectionClosed
except ImportError:
    websocket_connect = None

    class ConnectionClosed(Exception):
        pass


APP_DIR = Path(__file__).resolve().parents[1]
WEB_DIR = Path(__file__).resolve().parent / "web"
LOCAL_DIR = APP_DIR / ".private"
DEFAULT_CONFIG_PATH = LOCAL_DIR / "config.json"
LEGACY_CONFIG_PATH = APP_DIR / "config.json"
LOG_DIR = LOCAL_DIR / "logs"
LOG_PATH = LOG_DIR / "dashboard.log"
LOGGER = logging.getLogger("disguise-dashboard")
APP_VERSION = "0.4.13"

MAX_FLOAT_SENTINEL = 1.0e300





OUTPUT_STATE_PROPERTY = "LocalState.directorState().output"
OUTPUT_STATES = {0: ("fade-down", "FADE DOWN"), 1: ("fade-up", "FADE UP"), 2: ("hold", "HOLD")}
DIRECTOR_FPS_OBJECT = 'subsystem:MonitoringManager.findLocalMonitor("fps")'
DIRECTOR_FPS_PROPERTY = 'object.seriesAverage("Actual", 60)'


DIRECTOR_FPS_RAW_PROPERTY = 'float(object.seriesAverage("Actual", 1))'



MEDIA_METADATA_PROPERTY = (
    '[{"mediaResource": m.mappedResource, '
    '"durationTimecode": m.mappedResource.transportDuration.asString(True), '
    '"durationSeconds": m.mappedResource.transportDuration.t, '
    '"durationFps": m.mappedResource.transportDuration.fps()} '
    'for m in object.getMappedMediaOfType(VideoClip, 0) '
    'if m.mappedResource is not None and not m.mappedResource.isVideoIn '
    'and m.mappedResource.fileNFrames > 1]'
)




MEDIA_AUDIO_PROPERTY = (
    '[{"mediaResource": m.mappedResource, "hasAudio": m.mappedResource.hasAudio} '
    'for m in object.getMappedMediaOfType(VideoClip, 0) '
    'if m.mappedResource is not None and not m.mappedResource.isVideoIn]'
)





MEDIA_VERSIONS_PROPERTY = (
    '[{"mediaResource": m.mappedResource, "version": m.mappedResource.enabledVersion} '
    'for m in object.getMappedMediaOfType(VideoClip, 0) '
    'if m.mappedResource is not None and not m.mappedResource.isVideoIn]'
)
MEDIA_FILES_PROPERTY = (
    '[{"mediaResource": m.mappedResource, "version": m.mappedResource.enabledVersion, '
    '"files": [p for f in m.mappedResource.file.fragments '
    'if f.enabled and not f.isFrameReplacement '
    'and f.version == m.mappedResource.enabledVersion for p in f.proxies]} '
    'for m in object.getMappedMediaOfType(VideoClip, 0) '
    'if m.mappedResource is not None and not m.mappedResource.isVideoIn '
    'and m.mappedResource.file is not None]'
)






PREVIEW_BRIGHTNESS_PROPERTY = (
    '[{"trackResource": m.track, "layerResource": m.layer, '
    '"mediaResource": m.mappedResource, "sampleBeat": t, '
    '"expressionActive": expr, "sockpuppetControlled": sock, '
    '"externallyControlled": external, '
    '"brightness": None if (expr or sock or external) else '
    'float(b.getSequencedValue(t).value)} '
    'for m in object.getMappedMediaOfType(VideoClip, 0) '
    'if m.layer is not None and m.track is not None and m.mappedResource is not None '
    'for b in [m.layer.findSequence("brightness")] if b is not None '
    'for t in [max(m.layer.tStart, m.contentSequencingStart)] if t < m.layer.tEnd '
    'for expr in [b.expression is not None and not b.expression.isDisabled '
    'and bool(b.expression.expression.strip())] '
    'for sock in [b.sockpuppetControlled()] '
    'for external in [b.externallyControlled(t)]]'
)


def fps_average_samples(config: dict) -> int:
    try:
        return max(1, min(300, int(config.get("updates", {}).get("fps_average_samples", 60))))
    except (TypeError, ValueError):
        return 60


def director_fps_property(config: dict) -> str:
    return 'object.seriesAverage("Actual", %d)' % fps_average_samples(config)








MEDIA_SCHEDULE_PROPERTY = (
    '[{'
    '"mediaResource": m.mappedResource, '
    '"trackResource": m.track, '
    '"trackName": m.track.description, '
    '"layerResource": m.layer, '
    '"layerName": m.layer.name, '
    '"layerStartBeat": m.layer.tStart, '
    '"layerEndBeat": m.layer.tEnd, '
    '"contentStartBeat": m.contentSequencingStart, '
    '"contentEndBeat": m.contentSequencingEnd'
    '} for m in object.getMappedMediaOfType(VideoClip, 0)]'
)


TRANSPORT_STATE_PROPERTY = (
    '{'
    '"transportName": object.description, '
    '"trackName": object.track.description, '
    '"trackResource": object.track, '
    '"beat": object.player.tCurrent, '
    '"trackSeconds": object.track.beatToTime(object.player.tCurrent), '
    '"sectionIndex": object.track.beatToSection(object.player.tCurrent), '
    '"playing": object.player.playing, '
    '"holding": object.player.holding, '
    '"stopped": object.player.stopped, '
    '"loopSection": object.player.loopSectionMode, '
    '"sectionPlayMode": object.player.sectionPlayMode'
    '}'
)


SECTIONS_PROPERTY = (
    '[{'
    '"index": i, '
    '"startBeat": object.track.sectionInfo(i).tStart, '
    '"endBeat": object.track.sectionInfo(i).tEnd, '
    '"startSec": object.track.beatToTime(object.track.sectionInfo(i).tStart), '
    '"endSec": object.track.beatToTime(object.track.sectionInfo(i).tEnd)'
    '} for i in range(object.track.nSections())]'
)







ACTIVE_GRAPHICAL_PROPERTY = (
    '{"trackResource": object.track, '
    '"beat": object.player.tCurrent, '
    '"trackSeconds": object.track.beatToTime(object.player.tCurrent), '
    '"layers": [{'
    '"layerResource": l, '
    '"layerName": l.name, '
    '"layerStartBeat": l.tStart, '
    '"layerEndBeat": l.tEnd, '
    '"layerStartSec": object.track.beatToTime(l.tStart), '
    '"layerEndSec": object.track.beatToTime(l.tEnd), '
    '"enabled": l.enabledIncludingParents, '
    '"moduleType": str(l.moduleType)'
    '} for l in object.player.activeLayers if l.isGraphical()]}'
)





GRAPHICAL_SCHEDULE_PROPERTY = (
    '{"trackResource": object.track, "layers": ['
    '{"layerResource": l, "layerName": l.name, '
    '"moduleType": str(l.moduleType), "enabled": l.enabledIncludingParents, '
    '"layerStartBeat": l.tStart, "layerEndBeat": l.tEnd} '
    'for parent in object.track.layers for l in parent.getLeafLayers() '
    'if l.isGraphical()]}'
)



GRAPHICAL_PREVIEW_BRIGHTNESS_PROPERTY = (
    '{"trackResource": object.track, "samples": ['
    '{"layerResource": l, "sampleBeat": t, "expressionActive": expr, '
    '"sockpuppetControlled": sock, "externallyControlled": external, '
    '"brightness": None if (expr or sock or external) else '
    'float(b.getSequencedValue(t).value)} '
    'for parent in object.track.layers for l in parent.getLeafLayers() '
    'if l.isGraphical() and l.enabledIncludingParents '
    'for b in [l.findSequence("brightness")] if b is not None '
    'for t in [l.tStart] if t < l.tEnd '
    'for expr in [b.expression is not None and not b.expression.isDisabled '
    'and bool(b.expression.expression.strip())] '
    'for sock in [b.sockpuppetControlled()] '
    'for external in [b.externallyControlled(t)]]}'
)





ACTIVE_BRIGHTNESS_PROPERTY = (
    '[{'
    '"layerResource": l, '
    '"layerName": l.name, '
    '"brightness": object.player.playHead.getModuleForLayer(l).brightness'
    '} for l in object.player.activeLayers '
    'if l.isGraphical() and object.player.playHead.getModuleForLayer(l) is not None]'
)





ACTIVE_STANDARD_VIDEO_DETAILS_PROPERTY = (
    '[{'
    '"layerResource": l, '
    '"layerName": l.name, '
    '"moduleType": "VideoModule", '
    '"moduleResource": object.player.playHead.getModuleForLayer(l), '
    '"mediaResource": object.player.playHead.getModuleForLayer(l).video, '
    '"atEndPoint": object.player.playHead.getModuleForLayer(l).at_end_point'
    '} for l in object.track.getLeafLayers(VideoModule) '
    'if l.enabledIncludingParents and l.contains(object.player.tCurrent)]'
)


ACTIVE_STANDARD_VIDEO_FRAMES_PROPERTY = (
    '[{'
    '"layerResource": l, '
    '"layerName": l.name, '
    '"moduleType": "VideoModule", '
    '"frameNumber": object.player.playHead.getModuleForLayer(l).currentFrame, '
    '"clipStartFrame": (object.player.playHead.getModuleForLayer(l).video.start '
    'if object.player.playHead.getModuleForLayer(l).video is not None else 0), '
    '"clipEndFrame": (object.player.playHead.getModuleForLayer(l).video.end '
    'if object.player.playHead.getModuleForLayer(l).video is not None else 0), '
    '"clipNFrames": (object.player.playHead.getModuleForLayer(l).video.fileNFrames '
    'if object.player.playHead.getModuleForLayer(l).video is not None else 0), '
    '"fps": (object.player.playHead.getModuleForLayer(l).video.fps '
    'if object.player.playHead.getModuleForLayer(l).video is not None else 0.0)'
    '} for l in object.track.getLeafLayers(VideoModule) '
    'if l.enabledIncludingParents and l.contains(object.player.tCurrent)]'
)





ACTIVE_STANDARD_VIDEO_ELAPSED_PROPERTY = (
    '[{'
    '"layerResource": l, "layerName": l.name, "moduleType": "VideoModule", '
    '"elapsed": object.player.playHead.getModuleForLayer(l).tSecElapsed'
    '} for l in object.track.getLeafLayers(VideoModule) '
    'if l.enabledIncludingParents and l.contains(object.player.tCurrent)]'
)


ACTIVE_STANDARD_VIDEO_REMAINING_PROPERTY = (
    '[{'
    '"layerResource": l, "layerName": l.name, "moduleType": "VideoModule", '
    '"remaining": object.player.playHead.getModuleForLayer(l).tSecRemaining'
    '} for l in object.track.getLeafLayers(VideoModule) '
    'if l.enabledIncludingParents and l.contains(object.player.tCurrent)]'
)




ACTIVE_VARIABLE_VIDEO_DETAILS_PROPERTY = (
    '[{'
    '"layerResource": l, '
    '"layerName": l.name, '
    '"moduleType": "VariableVideoModule", '
    '"moduleResource": object.player.playHead.getModuleForLayer(l), '
    '"mediaResource": object.player.playHead.getModuleForLayer(l).video, '
    '"atEndPoint": object.player.playHead.getModuleForLayer(l).at_end_point'
    '} for l in object.track.getLeafLayers(VariableVideoModule) '
    'if l.enabledIncludingParents and l.contains(object.player.tCurrent)]'
)


ACTIVE_VARIABLE_VIDEO_FRAMES_PROPERTY = (
    '[{'
    '"layerResource": l, '
    '"layerName": l.name, '
    '"moduleType": "VariableVideoModule", '
    '"frameNumber": object.player.playHead.getModuleForLayer(l).frameNumberDisplay, '
    '"clipStartFrame": object.player.playHead.getModuleForLayer(l).clipStartFrame, '
    '"clipEndFrame": object.player.playHead.getModuleForLayer(l).clipEndFrame, '
    '"clipNFrames": object.player.playHead.getModuleForLayer(l).clipNFrames, '
    '"fps": (object.player.playHead.getModuleForLayer(l).video.fps '
    'if object.player.playHead.getModuleForLayer(l).video is not None else 0.0)'
    '} for l in object.track.getLeafLayers(VariableVideoModule) '
    'if l.enabledIncludingParents and l.contains(object.player.tCurrent)]'
)


ACTIVE_VARIABLE_VIDEO_ELAPSED_PROPERTY = (
    '[{'
    '"layerResource": l, "layerName": l.name, "moduleType": "VariableVideoModule", '
    '"elapsed": object.player.playHead.getModuleForLayer(l).tSecElapsed'
    '} for l in object.track.getLeafLayers(VariableVideoModule) '
    'if l.enabledIncludingParents and l.contains(object.player.tCurrent)]'
)


ACTIVE_VARIABLE_VIDEO_REMAINING_PROPERTY = (
    '[{'
    '"layerResource": l, "layerName": l.name, "moduleType": "VariableVideoModule", '
    '"remaining": object.player.playHead.getModuleForLayer(l).tSecRemaining'
    '} for l in object.track.getLeafLayers(VariableVideoModule) '
    'if l.enabledIncludingParents and l.contains(object.player.tCurrent)]'
)


def load_config(path: Path) -> dict:

    with path.open("r", encoding="utf-8-sig") as handle:
        data = json.load(handle)
    if "designer" not in data or "timelines" not in data:
        raise ValueError("config.json must contain 'designer' and 'timelines'")
    for role in ("main", "aux"):
        if role not in data["timelines"]:
            raise ValueError("config.json is missing timelines.%s" % role)
    return data


def setup_logging(config: dict) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    level_name = str(config.get("logging", {}).get("level", "INFO")).upper()
    level = getattr(logging, level_name, logging.INFO)
    LOGGER.setLevel(level)
    LOGGER.handlers.clear()

    formatter = logging.Formatter(
        "%(asctime)s.%(msecs)03d %(levelname)-8s %(threadName)s %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    file_handler = RotatingFileHandler(
        LOG_PATH,
        maxBytes=int(config.get("logging", {}).get("max_bytes", 5_000_000)),
        backupCount=int(config.get("logging", {}).get("backup_count", 3)),
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(level)
    LOGGER.addHandler(file_handler)

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    console.setLevel(level)
    LOGGER.addHandler(console)


def as_float(value, default=None):
    try:
        number = float(value)
        return number if math.isfinite(number) else default
    except (TypeError, ValueError):
        return default


def uid_text(value) -> str:
    if value is None:
        return ""
    return str(value)


def uid_key(value) -> str:

    if isinstance(value, dict):
        value = value.get("uid")
    text = uid_text(value).strip().lower()
    if not text:
        return ""
    try:
        return str(int(text, 0))
    except (TypeError, ValueError):
        return text


def resource_uid(resource) -> str:

    if isinstance(resource, dict):
        return uid_text(resource.get("uid"))
    return ""


def resource_path(resource) -> str:

    if isinstance(resource, str):
        return resource
    if not isinstance(resource, dict):
        return ""
    path = resource.get("path", "")
    if isinstance(path, str):
        return path
    if isinstance(path, dict):
        for key in ("path", "value", "filename", "relativePath"):
            if isinstance(path.get(key), str):
                return path[key]
    return ""


def resource_name(resource) -> str:

    path = resource_path(resource)
    if not path:
        return ""
    normalised = path.replace("\\", "/")
    name = normalised.rsplit("/", 1)[-1]
    return name[:-4] if name.lower().endswith(".apx") else name


def resource_type(resource) -> str:
    if not isinstance(resource, dict):
        return ""
    value = str(resource.get("type") or "").strip()
    return value.rsplit(".", 1)[-1]


def module_label(value) -> str:

    raw = resource_type(value) if isinstance(value, dict) else str(value or "")
    raw = raw.strip().rsplit(".", 1)[-1]


    class_match = re.search(r"([A-Za-z0-9_]+Module)", raw)
    if class_match:
        raw = class_match.group(1)
    if raw.endswith("Module"):
        raw = raw[:-6]
    labels = {
        "VariableVideo": "Video",
        "VariableVideoTransition": "Video",
        "Video": "Video",
        "VideoMove": "Video",
        "VideoTransition": "Video",
        "SockPuppetVideo": "Video",
        "DepthVideo": "Depth Video",
        "TestPattern": "Test Pattern",
        "RenderStream": "RenderStream",
        "RenderStreamLocal": "RenderStream",
        "StageRender": "Stage Render",
        "RGBColour": "RGB Colour",
        "TimecodeReadout": "Timecode",
    }
    if raw in labels:
        return labels[raw]

    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", raw)
    return spaced or "Content"


def end_point_label(value):
    try:
        return {0: "Loop", 1: "Ping-Pong", 2: "Pause"}.get(int(value))
    except (TypeError, ValueError):
        return None


def is_still_media_name(name: str) -> bool:
    suffix = Path(str(name or "")).suffix.lower()
    return suffix in {
        ".bmp", ".dpx", ".exr", ".gif", ".jpeg", ".jpg", ".png",
        ".psd", ".tga", ".tif", ".tiff",
    }


def split_property_errors(value):

    if isinstance(value, list):
        valid = []
        errors = []
        for item in value:
            if isinstance(item, dict) and item.get("errorType"):
                errors.append(
                    "%s: %s"
                    % (
                        item.get("errorType"),
                        item.get("message") or "Unknown property-path error",
                    )
                )
            else:
                valid.append(item)
        return valid, errors
    if isinstance(value, dict) and value.get("errorType"):
        return None, [
            "%s: %s"
            % (
                value.get("errorType"),
                value.get("message") or "Unknown property-path error",
            )
        ]
    return value, []


def clean_media_name(item: dict) -> str:
    explicit = str(item.get("mediaName") or "").strip()
    if explicit:
        return explicit
    name = resource_name(item.get("mediaResource") or item.get("resource"))
    if name:
        return name
    return "—"


def transport_expression(timeline_config: dict) -> str:
    override = str(timeline_config.get("transport_expression", "")).strip()
    if override:
        return override
    name = str(timeline_config.get("transport", "default"))
    cleaned = name.strip()




    if re.fullmatch(r"[A-Za-z0-9_]+", cleaned):
        return "transportmanager:%s" % cleaned
    escaped = name.replace("\\", "\\\\").replace('"', '\\"')
    return 'transportmanager:"%s"' % escaped


class DashboardStore:
    def __init__(self, config: dict):
        self.config = config
        self.lock = threading.RLock()
        self.connected = False
        self.connection_mode = "starting"
        self.seed_host = str(config["designer"].get("host", "127.0.0.1"))
        self.director_host = ""
        self.director_name = ""
        self.director_ip = ""
        self.last_update_monotonic = 0.0
        self.last_update_wall = None
        self.last_error = ""
        self.last_error_wall = None
        self.connection_attempt = 0
        self.stream_status = {}
        self.stream_errors = {}
        self.output_code = None
        self.director_fps = None
        self.director_fps_raw = None
        self.fps_raw_stats = {"count": 0, "min": None, "max": None}
        self.media_metadata_by_uid = {}
        self.media_audio_by_uid = {}
        self.media_versions_by_uid = {}
        self.media_files_by_uid = {}
        self.preview_brightness = []
        self.last_snapshot_log_monotonic = 0.0
        self.active_history = {role: {"context": None, "rows": None,
                                     "previous": None, "sequence": 0}
                               for role in ("main", "aux")}
        self.project = {
            "name": str(config.get("ui", {}).get("project_name") or "").strip(),
            "path": "",
            "version": {},
        }
        self.media_schedule = []
        self.roles = {
            "main": {
                "transport": {},
                "sections": [],
                "graphical_schedule": {},
                "graphical_preview_brightness": {},
                "content_layers": [],
                "active_content": [],
                "active_membership": {},
                "active_brightness": [],
                "active_standard_video_details": [],
                "active_standard_video_frames": [],
                "active_standard_video_elapsed": [],
                "active_standard_video_remaining": [],
                "active_standard_video_tsec": [],
                "active_variable_video_details": [],
                "active_variable_video_frames": [],
                "active_variable_video_elapsed": [],
                "active_variable_video_remaining": [],
                "active_variable_video_tsec": [],
                "active": [],
                "annotations": {},
            },
            "aux": {
                "transport": {},
                "sections": [],
                "graphical_schedule": {},
                "graphical_preview_brightness": {},
                "content_layers": [],
                "active_content": [],
                "active_membership": {},
                "active_brightness": [],
                "active_standard_video_details": [],
                "active_standard_video_frames": [],
                "active_standard_video_elapsed": [],
                "active_standard_video_remaining": [],
                "active_standard_video_tsec": [],
                "active_variable_video_details": [],
                "active_variable_video_frames": [],
                "active_variable_video_elapsed": [],
                "active_variable_video_remaining": [],
                "active_variable_video_tsec": [],
                "active": [],
                "annotations": {},
            },
        }

    def set_connection(self, connected: bool, mode: str, host: str = "", error: str = ""):
        with self.lock:
            if not connected or not self.connected or (host and host != self.director_host):
                self.director_ip = ""
                self.director_name = ""
                for role in ("main", "aux"):
                    self.active_history[role]["rows"] = None
                    if host and self.director_host and host != self.director_host:
                        self.active_history[role]["previous"] = None
                    self.roles[role]["active_membership"] = {}
                    self.roles[role]["active_content"] = []
                    self.stream_status.pop(role + ".active_content", None)


                self.output_code = None
                self.director_fps = None
                self.director_fps_raw = None
                self.fps_raw_stats = {"count": 0, "min": None, "max": None}
                self.media_metadata_by_uid = {}
                self.media_audio_by_uid = {}
                self.media_versions_by_uid = {}
                self.media_files_by_uid = {}
                self.preview_brightness = []
                for role in ("main", "aux"):
                    for field in ("graphical_schedule", "graphical_preview_brightness"):
                        self.roles[role][field] = {}
                        self.stream_status.pop(role + "." + field, None)
                        if connected:
                            self.stream_errors.pop(role + "." + field, None)
                for key in ("output_state", "director_fps", "director_fps_raw", "media_metadata", "media_audio", "media_versions", "media_files", "preview_brightness"):
                    self.stream_status.pop(key, None)
                    if connected:
                        self.stream_errors.pop(key, None)
            self.connected = connected
            self.connection_mode = mode
            if host:
                self.director_host = host
            self.last_error = error
            self.last_error_wall = time.time() if error else None
            if connected:
                self.last_update_monotonic = time.monotonic()
                self.last_update_wall = time.time()

    def set_director_identity(self, name: str, address: str):
        with self.lock:
            self.director_name = str(name or self.director_host)
            try:
                self.director_ip = str(ipaddress.ip_address(address))
            except ValueError:
                self.director_ip = ""

    def touch(self):
        with self.lock:
            self.last_update_monotonic = time.monotonic()
            self.last_update_wall = time.time()

    def update_value(self, key: str, value):
        with self.lock:
            self.stream_errors.pop(key, None)
            if key == "output_state":

                valid = (not isinstance(value, bool) and isinstance(value, (int, float))
                         and value in OUTPUT_STATES)
                if not valid:
                    self.output_code = None
                    self.set_stream_error(key, "Unknown LocalState.output value: %r" % value)
                    return
                code = int(value)
                if code != self.output_code:
                    LOGGER.info("Output state: %s (LocalState.directorState().output=%d)", OUTPUT_STATES[code][1], code)
                self.output_code = code
            elif key in ("director_fps", "director_fps_raw"):
                valid = (not isinstance(value, bool) and isinstance(value, (int, float))
                         and math.isfinite(value) and value >= 0)
                if not valid:
                    if key == "director_fps":
                        self.director_fps = None
                    else:
                        self.director_fps_raw = None
                    self.set_stream_error(key, "Invalid Director FPS value: %r" % value)
                    return
                if key == "director_fps":
                    self.director_fps = float(value)
                else:
                    self.director_fps_raw = float(value)
                    stats = self.fps_raw_stats
                    stats["count"] += 1
                    stats["min"] = min(stats["min"], value) if stats["min"] is not None else value
                    stats["max"] = max(stats["max"], value) if stats["max"] is not None else value
            elif key == "media_metadata":
                self.media_metadata_by_uid = {
                    uid_key(item.get("mediaResource")): copy.deepcopy(item)
                    for item in (value if isinstance(value, list) else [])
                    if isinstance(item, dict) and uid_key(item.get("mediaResource"))
                }
            elif key == "media_audio":
                self.media_audio_by_uid = {
                    uid_key(item.get("mediaResource")): copy.deepcopy(item)
                    for item in (value if isinstance(value, list) else [])
                    if isinstance(item, dict) and uid_key(item.get("mediaResource"))
                }
            elif key in ("media_versions", "media_files"):
                samples = {
                    uid_key(item.get("mediaResource")): copy.deepcopy(item)
                    for item in (value if isinstance(value, list) else [])
                    if isinstance(item, dict) and uid_key(item.get("mediaResource"))
                }
                if key == "media_versions":
                    self.media_versions_by_uid = samples
                else:
                    self.media_files_by_uid = samples
            elif key == "preview_brightness":
                self.preview_brightness = [copy.deepcopy(item) for item in (value if isinstance(value, list) else [])
                                           if isinstance(item, dict)]
            elif key == "media_schedule":
                self.media_schedule = value if isinstance(value, list) else []
            else:
                role, field = key.split(".", 1)
                if field == "transport":
                    previous_track = self.roles[role][field].get("trackName")
                    previous_uid = self.roles[role][field].get("trackUid")
                    self.roles[role][field] = value if isinstance(value, dict) else {}
                    transport = self.roles[role][field]
                    if not transport.get("trackUid"):
                        transport["trackUid"] = resource_uid(transport.get("trackResource"))
                    if not transport.get("trackName"):
                        transport["trackName"] = resource_name(transport.get("trackResource"))
                    current_track = self.roles[role][field].get("trackName")
                    current_uid = transport.get("trackUid")
                    switched = (
                        uid_text(previous_uid) != uid_text(current_uid)
                        if previous_uid and current_uid
                        else bool(previous_track and current_track and current_track != previous_track)
                    )


                    if switched:
                        self.roles[role]["annotations"] = {}
                        self.stream_status.pop("%s.annotations" % role, None)
                        self.stream_errors.pop("%s.annotations" % role, None)
                        self.roles[role]["active_brightness"] = []
                        self.roles[role]["graphical_schedule"] = {}
                        self.roles[role]["graphical_preview_brightness"] = {}
                        self.roles[role]["content_layers"] = []
                        self.roles[role]["active_content"] = []
                        self.roles[role]["active_membership"] = {}
                        self.stream_status.pop(role + ".active_content", None)
                        self.active_history[role] = {"context": None, "rows": None,
                                                     "previous": None, "sequence": 0}
                        self.roles[role]["active_standard_video_details"] = []
                        self.roles[role]["active_standard_video_frames"] = []
                        self.roles[role]["active_standard_video_elapsed"] = []
                        self.roles[role]["active_standard_video_remaining"] = []
                        self.roles[role]["active_standard_video_tsec"] = []
                        self.roles[role]["active_variable_video_details"] = []
                        self.roles[role]["active_variable_video_frames"] = []
                        self.roles[role]["active_variable_video_elapsed"] = []
                        self.roles[role]["active_variable_video_remaining"] = []
                        self.roles[role]["active_variable_video_tsec"] = []
                elif field == "active_content":


                    if isinstance(value, dict) and isinstance(value.get("layers"), list):
                        if (as_float(value.get("beat")) is None or
                                as_float(value.get("trackSeconds")) is None or
                                any(not isinstance(row, dict) or row.get("errorType")
                                    for row in value["layers"])):
                            self.set_stream_error(key, "Incomplete atomic active membership packet")
                            return
                        self.roles[role]["active_membership"] = copy.deepcopy(value)
                        self.roles[role][field] = copy.deepcopy(value["layers"])
                    elif isinstance(value, list):
                        self.roles[role]["active_membership"] = {}
                        self.roles[role][field] = copy.deepcopy(value)
                    else:
                        self.set_stream_error(key, "Invalid active membership packet")
                        return
                elif field in ("graphical_schedule", "graphical_preview_brightness"):
                    self.roles[role][field] = copy.deepcopy(value) if isinstance(value, dict) else {}
                elif field in (
                    "sections",
                    "content_layers",
                    "active_brightness",
                    "active_standard_video_details",
                    "active_standard_video_frames",
                    "active_standard_video_elapsed",
                    "active_standard_video_remaining",
                    "active_standard_video_tsec",
                    "active_variable_video_details",
                    "active_variable_video_frames",
                    "active_variable_video_elapsed",
                    "active_variable_video_remaining",
                    "active_variable_video_tsec",
                    "active_video_details",
                    "active_video_tsec",
                    "active_video",
                    "video_layers",
                    "active_media",
                    "active_elapsed",
                    "active_remaining",
                    "active",
                ):
                    self.roles[role][field] = value if isinstance(value, list) else []
            self.stream_status[key] = {
                "lastUpdate": time.time(),
                "kind": type(value).__name__,
                "items": len(value) if isinstance(value, (list, dict)) else 1,
            }
            self.touch()

    def set_stream_error(self, key: str, message: str):

        with self.lock:
            now = time.time()
            clean = str(message or "Unknown property-path error")[:2000]
            self.stream_errors[key] = {"message": clean, "lastUpdate": now}
            self.stream_status[key] = {
                "lastUpdate": now,
                "kind": "error",
                "items": 0,
                "error": clean,
            }
            if not key.endswith(".annotations"):
                self.touch()

    def update_annotations(self, role: str, data: dict, expected_track=None):
        with self.lock:
            if expected_track is not None:
                current = self.track_identities()[role]
                if current != expected_track:
                    return False
            self.roles[role]["annotations"] = data if isinstance(data, dict) else {}
            values = self.roles[role]["annotations"]
            values = values.get("annotations") or values
            key = "%s.annotations" % role
            self.stream_errors.pop(key, None)
            self.stream_status[key] = {
                "lastUpdate": time.time(), "kind": "annotations",
                "items": sum(len(values.get(field) or []) for field in ("sections", "notes", "tags")),
            }

            return True

    def update_project(self, data: dict):
        with self.lock:
            result = data if isinstance(data, dict) else {}
            project_path = str(result.get("projectPath") or "").strip()
            configured_name = str(
                self.config.get("ui", {}).get("project_name") or ""
            ).strip()
            path_name = ""
            if project_path:
                normalised = project_path.replace("\\", "/").rstrip("/")
                path_name = normalised.rsplit("/", 1)[-1]
                for suffix in (".d3project", ".d3"):
                    if path_name.lower().endswith(suffix):
                        path_name = path_name[: -len(suffix)]
                        break
            self.project = {
                "name": configured_name or path_name or "DISGUISE PROJECT",
                "path": project_path,
                "version": copy.deepcopy(result.get("version") or {}),
            }
            self.touch()

    def set_error(self, message: str):
        with self.lock:
            self.last_error = message
            self.last_error_wall = time.time()

    def track_names(self) -> dict:

        with self.lock:
            return {
                role: str((self.roles[role].get("transport") or {}).get("trackName") or "")
                for role in ("main", "aux")
            }

    def track_identities(self) -> dict:
        with self.lock:
            return {
                role: {
                    "name": str((self.roles[role].get("transport") or {}).get("trackName") or ""),
                    "uid": uid_text((self.roles[role].get("transport") or {}).get("trackUid")),
                }
                for role in ("main", "aux")
            }

    def _section_metadata(self, role: str, role_data: dict, section: dict) -> dict:

        result = {"tc": None, "midi": None, "osc": None, "notes": None,
                  "metadataMatch": None}
        if not section:
            return result
        if "%s.annotations" % role in self.stream_errors:
            result["metadataMatch"] = "api-error"
            return result
        annotations = role_data.get("annotations") or {}
        annotations = annotations.get("annotations") or annotations
        api_sections = [item for item in annotations.get("sections", [])
                        if isinstance(item, dict) and as_float(item.get("time")) is not None]
        api_sections.sort(key=lambda item: as_float(item["time"]))
        track_sections = [item for item in role_data.get("sections", []) if isinstance(item, dict)]
        track_sections.sort(key=lambda item: int(item.get("index", 0)))
        if not api_sections:
            result["metadataMatch"] = "no-annotations"
            return result
        if len(api_sections) != len(track_sections):
            result["metadataMatch"] = "section-count-mismatch"
            return result
        if len({as_float(item["time"]) for item in api_sections}) != len(api_sections):
            result["metadataMatch"] = "duplicate-section-times"
            return result
        indices = [int(item.get("index", 0)) for item in track_sections]
        try:
            ordinal = indices.index(int(section.get("index", 0)))
        except (ValueError, TypeError):
            return result
        at_time = as_float(api_sections[ordinal]["time"])
        tolerance = max(0.0, float(self.config.get("logic", {}).get("annotation_time_tolerance", 0.01)))
        grouped = {"tc": [], "midi": [], "osc": [], "notes": []}


        tag_fields = {"TC": "tc", "MIDI": "midi", "CUE": "osc"}
        for item in annotations.get("tags", []):
            if not isinstance(item, dict):
                continue
            position = as_float(item.get("time"))
            field = tag_fields.get(str(item.get("type") or "").strip().upper())
            if field and position is not None and abs(position - at_time) <= tolerance:
                value = str(item.get("value") if item.get("value") is not None else "").strip()
                if value and value not in grouped[field]:
                    grouped[field].append(value)
        for item in annotations.get("notes", []):
            if not isinstance(item, dict):
                continue
            position = as_float(item.get("time"))
            if position is not None and abs(position - at_time) <= tolerance:
                value = str(item.get("text") or "").strip()
                if value and value not in grouped["notes"]:
                    grouped["notes"].append(value)
        result.update({key: " · ".join(values) if values else None for key, values in grouped.items()})
        result["metadataMatch"] = "section-ordinal"
        return result

    def _section_label(self, role_data: dict, section: dict) -> str:
        index = int(section.get("index", 0))
        annotations = role_data.get("annotations") or {}
        sections_api = list((annotations.get("annotations") or annotations).get("sections") or [])
        notes_api = list((annotations.get("annotations") or annotations).get("notes") or [])
        tags_api = list((annotations.get("annotations") or annotations).get("tags") or [])

        section_annotation = sections_api[index] if index < len(sections_api) else {}
        section_time = as_float(section_annotation.get("time"))

        note = ""
        cue = ""
        if section_time is not None:
            tolerance = float(self.config.get("logic", {}).get("annotation_time_tolerance", 0.01))
            for item in notes_api:
                item_time = as_float(item.get("time"))
                if item_time is not None and abs(item_time - section_time) <= tolerance:
                    note = str(item.get("text") or "").strip()
                    if note:
                        break
            for item in tags_api:
                item_time = as_float(item.get("time"))
                tag_type = str(item.get("type") or "").upper()
                if item_time is not None and abs(item_time - section_time) <= tolerance and tag_type == "CUE":
                    cue = str(item.get("value") or "").strip()
                    if cue:
                        break

        api_index = str(section_annotation.get("index") or "").strip()
        values = {
            "note": note,
            "cue": cue,
            "index": ("SECTION %s" % api_index) if api_index else "",
            "number": "SECTION %02d" % (index + 1),
        }
        priority = self.config.get("logic", {}).get(
            "section_label_priority", ["number"]
        )
        for source in priority:
            value = values.get(str(source), "")
            if value:
                return value
        return "SECTION %02d" % (index + 1)

    @staticmethod
    def _play_mode(transport: dict) -> str:
        if transport.get("loopSection"):
            return "Loop section"
        if transport.get("holding"):
            return "Holding"
        if transport.get("sectionPlayMode"):
            return "Play to end"
        if transport.get("playing"):
            return "Play"
        if transport.get("stopped"):
            return "Stopped"
        return "Idle"

    @staticmethod
    def _media_interval(item: dict):
        start = as_float(item.get("effectiveStartBeat"))
        end = as_float(item.get("effectiveEndBeat"))
        if start is None:
            layer_start = as_float(item.get("layerStartBeat"), 0.0)
            content_start = as_float(item.get("contentStartBeat"), layer_start)
            start = max(layer_start, content_start)
        if end is None:
            layer_end = as_float(item.get("layerEndBeat"), start)
            content_end = as_float(item.get("contentEndBeat"), layer_end)
            if content_end is None or content_end > MAX_FLOAT_SENTINEL:
                content_end = layer_end
            end = min(layer_end, content_end)
        return start, end

    @staticmethod
    def _normalise_layer(item: dict) -> dict:
        result = copy.deepcopy(item)
        layer_resource = result.get("layerResource") or result.get("layer")
        module_resource = result.get("moduleResource") or result.get("module")
        result["layerResource"] = layer_resource
        result["moduleResource"] = module_resource
        result["layerUid"] = uid_text(
            result.get("layerUid") or resource_uid(layer_resource)
        )
        result["layerName"] = str(result.get("layerName") or "").strip()
        result["moduleType"] = str(
            result.get("moduleType") or resource_type(module_resource) or ""
        ).strip()
        result["layerType"] = str(
            result.get("layerType") or module_label(result["moduleType"])
        ).strip()
        return result

    def _layer_catalog(self, role_data: dict):



        layers = []
        for source_name in (
            "content_layers",
            "video_layers",
            "active_content",
            "active_standard_video_details",
            "active_variable_video_details",
        ):
            for raw in role_data.get(source_name, []):
                if not isinstance(raw, dict):
                    continue
                item = self._normalise_layer(raw)
                if any(self._same_layer(item, existing) for existing in layers):
                    continue
                layers.append(item)
        by_uid = {
            uid_key(item.get("layerUid")): item
            for item in layers
            if uid_key(item.get("layerUid"))
        }
        by_name = {
            str(item.get("layerName") or "").casefold(): item
            for item in layers
            if str(item.get("layerName") or "").strip()
        }
        return layers, by_uid, by_name

    def _track_media(self, track_name: str, track_uid: str, role_data: dict) -> list:
        _, layers_by_uid, layers_by_name = self._layer_catalog(role_data)
        wanted_uid = uid_key(track_uid)
        wanted_name = str(track_name or "").strip().casefold()
        result = []

        for ordinal, raw in enumerate(self.media_schedule):
            if not isinstance(raw, dict):
                continue

            track_resource = raw.get("trackResource") or raw.get("track")
            raw_track_uid = raw.get("trackUid") or resource_uid(track_resource)
            raw_track_name = str(
                raw.get("trackName") or resource_name(track_resource) or ""
            ).strip()
            same_uid = bool(wanted_uid and uid_key(raw_track_uid) == wanted_uid)
            same_name = bool(
                wanted_name and raw_track_name.casefold() == wanted_name
            )
            if not same_uid and not same_name:
                continue

            item = copy.deepcopy(raw)
            item["_ordinal"] = ordinal
            item["trackResource"] = track_resource
            item["trackUid"] = uid_text(raw_track_uid)
            item["trackName"] = raw_track_name
            item["mediaResource"] = item.get("mediaResource") or item.get("resource")

            layer_resource = item.get("layerResource") or item.get("layer")
            layer_uid = item.get("layerUid") or resource_uid(layer_resource)
            layer_name = str(item.get("layerName") or "").strip()
            catalogue_item = layers_by_uid.get(uid_key(layer_uid))
            if catalogue_item is None and layer_name:
                catalogue_item = layers_by_name.get(layer_name.casefold())
            if catalogue_item:
                layer_uid = layer_uid or catalogue_item.get("layerUid")
                layer_name = layer_name or catalogue_item.get("layerName", "")
                item["moduleResource"] = copy.deepcopy(
                    catalogue_item.get("moduleResource")
                )
                item["moduleType"] = catalogue_item.get("moduleType")
                item["layerType"] = catalogue_item.get("layerType")

            item["layerResource"] = layer_resource
            item["layerUid"] = uid_text(layer_uid)
            item["layerName"] = layer_name or resource_name(layer_resource) or "—"
            item["moduleType"] = str(
                item.get("moduleType") or "VariableVideoModule"
            )
            item["layerType"] = str(
                item.get("layerType") or module_label(item["moduleType"])
            )
            item["mediaName"] = clean_media_name(item)
            start, end = self._media_interval(item)
            item["effectiveStartBeat"] = start
            item["effectiveEndBeat"] = end
            result.append(item)
        return result

    def _audio_metadata(self, item: dict) -> dict:
        uid = uid_key(item.get("mediaResource"))
        sample = self.media_audio_by_uid.get(uid, {}) if "media_audio" not in self.stream_errors else {}
        value = sample.get("hasAudio")
        if isinstance(value, bool):
            return {"hasAudio": value, "audioSource": "VideoClip.hasAudio"}
        return {"hasAudio": None, "audioSource": None}

    def _media_identity_metadata(self, item: dict) -> dict:
        result = {"mediaName": clean_media_name(item), "mediaVersion": None}
        uid = uid_key(item.get("mediaResource"))
        if "media_versions" in self.stream_errors:
            return result
        version = self.media_versions_by_uid.get(uid, {}).get("version")
        if (not isinstance(version, str) or len(version) > 32
                or not re.fullmatch(r"[0-9][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*", version)):
            return result
        result["mediaVersion"] = version if version != "0" else None
        sample = self.media_files_by_uid.get(uid, {}) if "media_files" not in self.stream_errors else {}
        if sample.get("version") == version:
            files = sample.get("files")
            names = {
                resource_name(file) for file in (files if isinstance(files, list) else [])
                if isinstance(file, dict) and isinstance(file.get("path"), str)
                and file["path"].strip() and not file["path"].lower().endswith(".apx")
            }


            if len(names) == 1:
                result["mediaName"] = names.pop()
        return result

    def _preview_brightness_metadata(self, item: dict) -> dict:
        start, _ = self._media_interval(item)
        result = {"brightness": None, "brightnessSource": None,
                  "brightnessSampleBeat": start, "brightnessReason": "no-preview-sample"}
        if "preview_brightness" in self.stream_errors:
            result["brightnessReason"] = "preview-stream-error"
            return result
        track_uid = uid_key(item.get("trackUid") or item.get("trackResource"))
        layer_uid = uid_key(item.get("layerUid") or item.get("layerResource"))
        media_uid = uid_key(item.get("mediaResource"))
        if not all((track_uid, layer_uid, media_uid)):
            return result
        for sample in self.preview_brightness:
            beat = as_float(sample.get("sampleBeat"))
            if (uid_key(sample.get("trackResource")) != track_uid or
                    uid_key(sample.get("layerResource")) != layer_uid or
                    uid_key(sample.get("mediaResource")) != media_uid or
                    beat is None or abs(beat - start) > 1e-6):
                continue
            controls = [sample.get(key) for key in ("expressionActive", "sockpuppetControlled", "externallyControlled")]
            if any(value is True for value in controls):
                result["brightnessReason"] = "external-control"
                return result
            if not all(value is False for value in controls):
                result["brightnessReason"] = "control-status-unknown"
                return result
            value = as_float(sample.get("brightness"))
            if value is not None and not isinstance(sample.get("brightness"), bool) and abs(value) < MAX_FLOAT_SENTINEL:
                result.update(brightness=value, brightnessSource="FieldSequence.getSequencedValue",
                              brightnessReason="sequenced-at-media-start")
            else:
                result["brightnessReason"] = "invalid-preview-value"
            return result
        return result

    def _media_preview(self, item: dict) -> dict:
        result = {
            "layerName": item.get("layerName", "—"),
            "layerType": item.get("layerType", "Video"),
            "mediaName": item.get("mediaName", "—"),
            "layerUid": item.get("layerUid"),
            "mediaUid": resource_uid(item.get("mediaResource")),
            "durationTimecode": None, "durationSeconds": None,
            "durationFps": None, "durationSource": None,
            **self._preview_brightness_metadata(item),
            **self._audio_metadata(item),
            **self._media_identity_metadata(item),
        }
        uid = uid_key(item.get("mediaResource"))
        metadata = self.media_metadata_by_uid.get(uid, {}) if "media_metadata" not in self.stream_errors else {}
        duration = as_float(metadata.get("durationSeconds"))
        fps = as_float(metadata.get("durationFps"))
        tc = metadata.get("durationTimecode")
        if (not is_still_media_name(str(result["mediaName"])) and duration is not None
                and 0 < duration < MAX_FLOAT_SENTINEL and fps is not None and fps > 0
                and isinstance(tc, str) and tc.strip()):
            result.update(durationTimecode=tc.strip(), durationSeconds=duration,
                          durationFps=fps, durationSource="VideoClip.transportDuration")
        return result

    def _media_for_section(self, section: dict | None, track_media: list) -> dict:
        if not section:
            return {"layerName": "—", "mediaName": "—"}
        start = as_float(section.get("startBeat"), 0.0)
        end = as_float(section.get("endBeat"), start)
        candidates = []
        for item in track_media:
            media_start, media_end = self._media_interval(item)
            overlap = min(end, media_end) - max(start, media_start)
            if overlap > 1.0e-6:
                candidates.append((max(start, media_start), item.get("_ordinal", 0), item))
        candidates.sort(key=lambda entry: (entry[0], entry[1]))
        if not candidates:
            return {"layerName": "—", "mediaName": "—"}
        item = candidates[0][2]
        return self._media_preview(item)

    def _adjacent_media(self, beat, track_media: list, direction: str) -> dict:

        current = as_float(beat)
        if current is None:
            return {"layerName": "—", "mediaName": "—"}
        candidates = []
        for item in track_media:
            start, end = self._media_interval(item)
            if direction == "next" and start > current + 1.0e-6:
                candidates.append((start, item.get("_ordinal", 0), item))
            elif direction == "previous" and end <= current + 1.0e-6:
                candidates.append((end, item.get("_ordinal", 0), item))
        if not candidates:
            return {"layerName": "—", "mediaName": "—"}
        candidates.sort(key=lambda entry: (entry[0], entry[1]), reverse=direction == "previous")
        item = candidates[0][2]
        return self._media_preview(item)

    def _layer_for_section(self, section: dict | None, role_data: dict) -> dict:
        if not section:
            return {"layerName": "—", "mediaName": "—"}
        start = as_float(section.get("startBeat"), 0.0)
        end = as_float(section.get("endBeat"), start)
        layers, _, _ = self._layer_catalog(role_data)
        candidates = []
        for ordinal, item in enumerate(layers):
            if item.get("enabled") is False:
                continue
            layer_start = as_float(item.get("layerStartBeat"))
            layer_end = as_float(item.get("layerEndBeat"))
            if layer_start is None or layer_end is None:
                continue
            overlap = min(end, layer_end) - max(start, layer_start)
            if overlap > 1.0e-6:
                candidates.append((max(start, layer_start), ordinal, item))
        candidates.sort(key=lambda entry: (entry[0], entry[1]))
        if not candidates:
            return {"layerName": "—", "mediaName": "—"}
        return {
            "layerName": candidates[0][2].get("layerName") or "—",
            "layerType": candidates[0][2].get("layerType") or "Content",
            "mediaName": "—",
        }

    def _adjacent_layer(self, beat, role_data: dict, direction: str) -> dict:
        current = as_float(beat)
        if current is None:
            return {"layerName": "—", "mediaName": "—"}
        layers, _, _ = self._layer_catalog(role_data)
        candidates = []
        for ordinal, item in enumerate(layers):
            if item.get("enabled") is False:
                continue
            start = as_float(item.get("layerStartBeat"))
            end = as_float(item.get("layerEndBeat"))
            if start is None or end is None:
                continue
            if direction == "next" and start > current + 1.0e-6:
                candidates.append((start, ordinal, item))
            elif direction == "previous" and end <= current + 1.0e-6:
                candidates.append((end, ordinal, item))
        if not candidates:
            return {"layerName": "—", "mediaName": "—"}
        candidates.sort(key=lambda entry: (entry[0], entry[1]), reverse=direction == "previous")
        return {
            "layerName": candidates[0][2].get("layerName") or "—",
            "layerType": candidates[0][2].get("layerType") or "Content",
            "mediaName": "—",
        }

    @staticmethod
    def _payload_matches_track(payload: dict, transport: dict) -> bool:
        wanted = uid_key(transport.get("trackUid") or transport.get("trackResource"))
        actual = uid_key(payload.get("trackResource") or payload.get("trackUid"))

        return bool(wanted and actual and wanted == actual)

    def _future_layers(self, role: str, role_data: dict) -> tuple[list, str]:
        key = role + ".graphical_schedule"
        if key in self.stream_errors:
            return [], "stream-error"
        payload = role_data.get("graphical_schedule") or {}
        if payload:
            if not self._payload_matches_track(payload, role_data.get("transport") or {}):
                return [], "track-mismatch"
            if not isinstance(payload.get("layers"), list):
                return [], "invalid-payload"
            return [self._normalise_layer(row) for row in payload["layers"]
                    if isinstance(row, dict)], "ok"



        rows = role_data.get("content_layers") or []
        return [self._normalise_layer(row) for row in rows if isinstance(row, dict)], (
            "compatibility-catalog" if rows else "no-data")

    def _layer_preview(self, role: str, role_data: dict, layer: dict, beat: float) -> dict:
        result = {
            "layerName": layer.get("layerName") or "—",
            "layerType": layer.get("layerType") or "Content",
            "layerUid": layer.get("layerUid"), "mediaName": "—", "mediaUid": None,
            "hasAudio": None, "audioSource": None,
            "durationTimecode": None, "durationSeconds": None,
            "durationFps": None, "durationSource": None,
            "brightness": None, "brightnessSource": None,
            "brightnessSampleBeat": beat, "brightnessReason": "no-preview-sample",
        }
        if role + ".graphical_preview_brightness" in self.stream_errors:
            result["brightnessReason"] = "preview-stream-error"
            return result
        payload = role_data.get("graphical_preview_brightness") or {}
        if not self._payload_matches_track(payload, role_data.get("transport") or {}):
            return result
        samples = payload.get("samples")
        if not isinstance(samples, list):
            return result
        for sample in samples:
            if not isinstance(sample, dict):
                continue
            sample_beat = as_float(sample.get("sampleBeat"))
            if (not self._same_layer(layer, sample) or sample_beat is None or
                    abs(sample_beat - beat) > 1e-6):
                continue
            controls = [sample.get(key) for key in
                        ("expressionActive", "sockpuppetControlled", "externallyControlled")]
            if any(value is True for value in controls):
                result["brightnessReason"] = "external-control"
            elif not all(value is False for value in controls):
                result["brightnessReason"] = "control-status-unknown"
            else:
                value = as_float(sample.get("brightness"))
                if value is not None and not isinstance(sample.get("brightness"), bool) and abs(value) < MAX_FLOAT_SENTINEL:
                    result.update(brightness=value, brightnessSource="FieldSequence.getSequencedValue",
                                  brightnessReason="sequenced-at-layer-start")
                else:
                    result["brightnessReason"] = "invalid-preview-value"
            break
        return result

    def _next_scheduled(self, role: str, role_data: dict, track_media: list) -> tuple[dict, dict]:

        transport = role_data.get("transport") or {}
        current = as_float(transport.get("beat"))
        layers, catalog_status = self._future_layers(role, role_data)
        selection = {"catalogStatus": catalog_status, "complete": catalog_status == "ok",
                     "catalogLayers": len(layers), "candidates": 0, "kind": None,
                     "startBeat": None, "stackIndex": None,
                     "simultaneousLayers": 0, "tieBreak": "lowest-layer"}
        empty = {"layerName": "—", "layerType": "Content", "mediaName": "—"}
        if current is None or abs(current) >= MAX_FLOAT_SENTINEL:
            selection["reason"] = "unknown-playhead"
            return empty, selection
        if catalog_status in ("stream-error", "track-mismatch", "invalid-payload"):


            selection["reason"] = catalog_status
            return empty, selection
        candidates = []
        for ordinal, layer in enumerate(layers):
            start, end = as_float(layer.get("layerStartBeat")), as_float(layer.get("layerEndBeat"))
            if (layer.get("enabled") is False or start is None or end is None or
                    abs(start) >= MAX_FLOAT_SENTINEL or start <= current + 1e-6 or end <= start):
                continue
            candidates.append((start, ordinal, 1, end, "layer-start", layer))
        wanted_uid = uid_key(transport.get("trackUid") or transport.get("trackResource"))
        for item in track_media:
            actual_uid = uid_key(item.get("trackUid") or item.get("trackResource"))
            if wanted_uid and actual_uid and wanted_uid != actual_uid:
                continue
            matched = next(((ordinal, layer) for ordinal, layer in enumerate(layers)
                            if self._same_layer(item, layer)), None)
            if matched and matched[1].get("enabled") is False:
                continue
            if catalog_status == "ok" and matched is None:
                continue
            start, end = self._media_interval(item)
            if abs(start) >= MAX_FLOAT_SENTINEL or start <= current + 1e-6 or end <= start:
                continue
            ordinal = matched[0] if matched else len(layers) + item.get("_ordinal", 0)


            candidates.append((start, ordinal, 0, end, "media-start", item))
        selection["candidates"] = len(candidates)
        if not candidates:
            selection["reason"] = "no-future-start"
            return empty, selection
        earliest = min(entry[0] for entry in candidates)
        simultaneous = [entry for entry in candidates if abs(entry[0] - earliest) <= 1e-6]





        start, ordinal, _, end, kind, item = min(
            simultaneous, key=lambda entry: (-entry[1], entry[2], entry[0]))
        selection.update(kind=kind, startBeat=start, stackIndex=ordinal,
                         simultaneousLayers=len({entry[1] for entry in simultaneous}),
                         reason="nearest-start")
        result = (self._media_preview(item) if kind == "media-start" else
                  self._layer_preview(role, role_data, item, start))
        result.update(scheduledStartBeat=start, scheduledEndBeat=end)
        return result, selection

    def _sort_active(self, role: str, active: list) -> list:
        priority = self.config["timelines"][role].get("layer_priority", [])
        priority_map = {str(name): i for i, name in enumerate(priority)}
        indexed = list(enumerate(active))
        indexed.sort(
            key=lambda pair: (
                priority_map.get(str(pair[1].get("layerName") or ""), len(priority_map)),
                pair[0],
            )
        )
        return [item for _, item in indexed]

    @staticmethod
    def _same_layer(left: dict, right: dict) -> bool:
        left_uid = uid_key(left.get("layerUid") or left.get("layerResource"))
        right_uid = uid_key(right.get("layerUid") or right.get("layerResource"))
        if left_uid and right_uid:
            return left_uid == right_uid
        left_module_uid = uid_key(left.get("moduleResource"))
        right_module_uid = uid_key(right.get("moduleResource"))
        if left_module_uid and right_module_uid:
            return left_module_uid == right_module_uid
        left_name = str(left.get("layerName") or "").strip().casefold()
        right_name = str(right.get("layerName") or "").strip().casefold()
        return bool(left_name and right_name and left_name == right_name)

    def _layer_hidden(self, row: dict) -> bool:
        return (row.get("enabled") is False or row.get("enabledIncludingParents") is False
                or row.get("disabled") is True)

    def _active_rows(self, role: str, role_data: dict, track_media: list) -> list:
        transport = role_data.get("transport") or {}
        beat = as_float(transport.get("beat"))
        track_seconds = as_float(transport.get("trackSeconds"))
        layer_catalog, _, _ = self._layer_catalog(role_data)
        authoritative = role + ".active_content" in self.stream_status
        if self.connection_mode == "live" and not authoritative:
            return []
        legacy_active = [
            self._normalise_layer(item)
            for item in role_data.get("active", [])
            if isinstance(item, dict)
        ]
        exact_active = [
            self._normalise_layer(item)
            for item in (role_data.get("active_content", []) if authoritative
                         else role_data.get("active_media", []))
            if isinstance(item, dict)
        ]
        for member in exact_active:
            stored = next((item for item in layer_catalog if self._same_layer(member, item)), None)
            if stored:
                for key, value in stored.items():
                    if member.get(key) in (None, "") and value not in (None, ""):
                        member[key] = copy.deepcopy(value)

        for source_name in (
            "active_standard_video_details",
            "active_standard_video_frames",
            "active_standard_video_elapsed",
            "active_standard_video_remaining",
            "active_standard_video_tsec",
            "active_variable_video_details",
            "active_variable_video_frames",
            "active_variable_video_elapsed",
            "active_variable_video_remaining",
            "active_variable_video_tsec",
            "active_video_details",
            "active_video_tsec",
            "active_video",
        ):
            for raw in role_data.get(source_name, []):
                if not isinstance(raw, dict):
                    continue
                item = self._normalise_layer(raw)
                target = next(
                    (row for row in exact_active if self._same_layer(row, item)),
                    None,
                )
                if target is None:
                    if authoritative:
                        continue
                    target = item
                    exact_active.append(target)
                else:
                    for key, value in item.items():
                        if (value is not None and value != "" and
                                (not authoritative or key not in (
                                    "layerResource", "layerUid", "layerName", "enabled",
                                    "layerStartBeat", "layerEndBeat", "layerStartSec", "layerEndSec"))):
                            target[key] = copy.deepcopy(value)


        for source_name, value_key in (
            ("active_elapsed", "elapsed"),
            ("active_remaining", "remaining"),
        ):
            for raw in role_data.get(source_name, []):
                if not isinstance(raw, dict):
                    continue
                item = self._normalise_layer(raw)
                target = next(
                    (row for row in exact_active if self._same_layer(row, item)),
                    None,
                )
                if target is None:
                    if authoritative:
                        continue
                    target = item
                    exact_active.append(target)
                if value_key in item:
                    target[value_key] = item.get(value_key)
        if not exact_active and not authoritative:
            exact_active = legacy_active





        basic_active = []
        if authoritative:
            basic_active = exact_active
        elif layer_catalog and beat is not None:
            for item in layer_catalog:
                start = as_float(item.get("layerStartBeat"))
                end = as_float(item.get("layerEndBeat"))
                if item.get("enabled") is False or start is None or end is None:
                    continue
                if start <= beat < end:
                    basic_active.append(item)
        elif exact_active:
            basic_active = exact_active
        elif legacy_active:
            basic_active = legacy_active



        for exact in exact_active:
            if not any(self._same_layer(exact, base) for base in basic_active):
                basic_active.append(exact)



        unique_active = []
        for item in basic_active:
            if any(self._same_layer(item, existing) for existing in unique_active):
                continue
            unique_active.append(item)
        basic_active = unique_active

        min_brightness = float(
            self.config.get("logic", {}).get("minimum_brightness", 0.001)
        )
        live_threshold = float(
            self.config.get("ui", {}).get("live_threshold_seconds", 86_400)
        )
        default_fps = as_float(self.config.get("ui", {}).get("default_fps"), 25.0)
        rows = []

        for base in basic_active:
            brightness = as_float(base.get("brightness"), 1.0)
            if brightness is not None and brightness < min_brightness:
                continue

            row = self._normalise_layer(base)
            exact = next(
                (item for item in exact_active if self._same_layer(item, row)),
                None,
            )
            if exact:
                for key, value in exact.items():
                    if value is not None and value != "":
                        row[key] = copy.deepcopy(value)
                row = self._normalise_layer(row)

            if self._layer_hidden(row):
                continue

            brightness_key = "%s.active_brightness" % role
            samples = role_data.get("active_brightness") or []
            brightness_sample = next(
                (sample for sample in samples if isinstance(sample, dict)
                 and self._same_layer(row, self._normalise_layer(sample))), None,
            )
            if brightness_key in self.stream_errors:
                row["brightness"] = None
            elif brightness_sample is not None:
                row["brightness"] = as_float(brightness_sample.get("brightness"))
            else:
                row["brightness"] = as_float(row.get("brightness"))

            mapped_candidates = []
            for item in track_media:
                if not self._same_layer(item, row):
                    continue
                start, end = self._media_interval(item)
                if beat is None or start <= beat < end:
                    mapped_candidates.append(item)
            mapped_candidates.sort(
                key=lambda item: (
                    self._media_interval(item)[0],
                    item.get("_ordinal", 0),
                ),
                reverse=True,
            )
            mapped = mapped_candidates[0] if mapped_candidates else None

            if mapped and not row.get("mediaResource"):
                row["mediaResource"] = copy.deepcopy(mapped.get("mediaResource"))
            if mapped and not str(row.get("mediaName") or "").strip():
                row["mediaName"] = mapped.get("mediaName")
            row["mediaName"] = clean_media_name(row)
            row["layerName"] = str(row.get("layerName") or "—")
            row["layerUid"] = uid_text(
                row.get("layerUid") or resource_uid(row.get("layerResource"))
            )
            row["moduleType"] = str(row.get("moduleType") or "").strip()
            row["layerType"] = str(
                row.get("layerType") or module_label(row.get("moduleType"))
            )
            row.update(self._audio_metadata(row))
            row.update(self._media_identity_metadata(row))



            if row["layerName"] in ("", "—") and not row["layerUid"]:
                continue

            row["endPoint"] = (
                None
                if is_still_media_name(row["mediaName"])
                else end_point_label(row.get("atEndPoint"))
            )

            fps = as_float(row.get("fps"), default_fps)
            elapsed = as_float(row.get("elapsed"))
            remaining = as_float(row.get("remaining"))
            frame = as_float(row.get("frameNumber"))
            clip_start = as_float(row.get("clipStartFrame"))
            clip_end = as_float(row.get("clipEndFrame"))
            clip_frames = as_float(row.get("clipNFrames"))
            frame_range_valid = bool(
                fps and fps > 0
                and clip_start is not None
                and clip_end is not None
                and clip_end > clip_start
                and (clip_frames is None or clip_frames > 1)
            )





            if frame_range_valid and frame is not None:
                frame_elapsed = max(0.0, (frame - clip_start) / fps)
                frame_remaining = max(0.0, (clip_end - frame) / fps)
                used_frame_fallback = False



                if elapsed is None or (elapsed <= 0.0 and frame_elapsed > 0.0):
                    elapsed = frame_elapsed
                    used_frame_fallback = True
                if remaining is None or (remaining <= 0.0 and frame_remaining > 0.0):
                    remaining = frame_remaining
                    used_frame_fallback = True
                if used_frame_fallback:
                    row["timingFallback"] = "frame"

            media_name = str(row.get("mediaName") or "")
            media_runtime_valid = bool(
                (elapsed is not None and remaining is not None)
                and (
                    remaining > 0.0
                    or elapsed > 0.0
                    or frame_range_valid
                )
                and not is_still_media_name(media_name)
            )

            if media_runtime_valid:


                row["elapsed"] = max(0.0, elapsed)
                row["remaining"] = max(0.0, remaining)
                row["timingSource"] = "media"
                row["timingApproximate"] = False
            else:
                row["elapsed"] = None
                row["remaining"] = None
                row["timingSource"] = "none"




            if row["elapsed"] is None or row["remaining"] is None:
                start_sec = as_float(row.get("layerStartSec"))
                end_sec = as_float(row.get("layerEndSec"))
                if mapped:
                    start_sec = as_float(mapped.get("effectiveStartSec"), start_sec)
                    end_sec = as_float(mapped.get("effectiveEndSec"), end_sec)
                if (
                    track_seconds is not None
                    and start_sec is not None
                    and end_sec is not None
                    and end_sec >= start_sec
                ):
                    row["elapsed"] = max(0.0, track_seconds - start_sec)
                    row["remaining"] = max(0.0, end_sec - track_seconds)
                    row["timingSource"] = "layer"
                    row["timingApproximate"] = True

            row["fps"] = fps
            row["timingAvailable"] = bool(
                row.get("elapsed") is not None and row.get("remaining") is not None
            )

            if row["remaining"] is not None and row["remaining"] >= live_threshold:
                row["remaining"] = None
            rows.append(row)

        rows = self._sort_active(role, rows)
        limit = int(
            self.config["timelines"][role].get(
                "max_active_layers", 3 if role == "main" else 1
            )
        )
        return rows[: max(1, limit)]

    def _derive_role(self, role: str, role_data: dict, connected: bool = True) -> dict:
        transport = copy.deepcopy(role_data.get("transport") or {})
        membership = role_data.get("active_membership") or {}
        roster_uid = uid_key(membership.get("trackResource"))
        track_key = uid_key(transport.get("trackUid") or transport.get("trackResource"))
        membership_known = role + ".active_content" in self.stream_status
        membership_valid = (membership_known and
                            role + ".active_content" not in self.stream_errors and
                            (not membership or bool(roster_uid and track_key and roster_uid == track_key)))
        if membership_valid and membership:


            transport["beat"] = membership.get("beat")
            transport["trackSeconds"] = membership.get("trackSeconds")
            sample_beat = as_float(membership.get("beat"))
            sample_section = next((s for s in role_data.get("sections", [])
                                   if sample_beat is not None and
                                   as_float(s.get("startBeat"), 0) <= sample_beat <
                                   as_float(s.get("endBeat"), MAX_FLOAT_SENTINEL)), None)
            if sample_section:
                transport["sectionIndex"] = sample_section.get("index")
        role_data = {**role_data, "transport": transport}
        if membership and (not roster_uid or not track_key or roster_uid != track_key):
            role_data["active_content"] = []
        sections = [copy.deepcopy(s) for s in role_data.get("sections", []) if isinstance(s, dict)]
        sections.sort(key=lambda item: int(item.get("index", 0)))
        for section in sections:
            section["label"] = self._section_label(role_data, section)

        track_name = str(transport.get("trackName") or "NOT CONNECTED")
        track_uid = uid_text(transport.get("trackUid"))
        track_media = self._track_media(track_name, track_uid, role_data)
        current_index = transport.get("sectionIndex")
        try:
            current_index = int(current_index)
        except (TypeError, ValueError):
            current_index = None

        by_index = {int(section.get("index", 0)): section for section in sections}
        current_section = by_index.get(current_index) if current_index is not None else None
        previous_section = by_index.get(current_index - 1) if current_index is not None else None
        next_section = by_index.get(current_index + 1) if current_index is not None else None

        active = self._active_rows(role, role_data, track_media)
        next_media, next_selection = self._next_scheduled(role, role_data, track_media)

        countdown_source = next(
            (
                item for item in active
                if item.get("timingSource") == "media"
                and item.get("remaining") is not None
            ),
            None,
        )
        if countdown_source is None:
            countdown_source = next(
                (
                    item for item in active
                    if item.get("remaining") is not None
                    and str(item.get("mediaName") or "") not in ("", "—")
                    and not is_still_media_name(str(item.get("mediaName") or ""))
                ),
                None,
            )
        if countdown_source is None:
            countdown_source = next(
                (
                    item for item in active
                    if item.get("layerType") == "Video"
                    and str(item.get("mediaName") or "") not in ("", "—")
                    and not is_still_media_name(str(item.get("mediaName") or ""))
                ),
                None,
            )

        def section_payload(section, media):
            if not section:
                return {"available": False, "label": "—", **media,
                        **self._section_metadata(role, role_data, None)}
            return {
                "available": True,
                "index": section.get("index"),
                "label": section.get("label", "—"),
                "startBeat": section.get("startBeat"),
                "endBeat": section.get("endBeat"),
                **media,
                **self._section_metadata(role, role_data, section),
            }

        history = self.active_history[role]
        context = (self.project.get("path") or self.project.get("name"),
                   transport.get("transportName"), uid_key(track_uid) or track_name)
        if history["context"] != context:
            history.update(context=context, rows=None, previous=None, sequence=0)


        can_observe = connected and (membership_valid or
                                    (not membership_known and self.connection_mode != "live"))
        if can_observe:
            old_rows = history["rows"]
            hidden_rows = [row for row in role_data.get("active_content", [])
                           if isinstance(row, dict) and self._layer_hidden(row)]
            def hidden(row):
                return self._layer_hidden(row) or any(self._same_layer(row, item) for item in hidden_rows)
            if history["previous"] and hidden(history["previous"]):
                history["previous"] = None
            departed = ([row for row in old_rows
                         if not hidden(row) and not any(self._same_layer(row, now) for now in active)]
                        if old_rows is not None else [])
            if departed:


                catalogue, _ = self._future_layers(role, role_data)
                def departure_order(row):
                    stack = next((i for i, layer in enumerate(catalogue)
                                  if self._same_layer(row, layer)), old_rows.index(row))
                    return (as_float(row.get("layerEndBeat"), -MAX_FLOAT_SENTINEL), stack)
                last = max(departed, key=departure_order)
                history["sequence"] += 1
                history["previous"] = {**copy.deepcopy(last), "available": True,
                                       "departedAt": time.time(),
                                       "departureSequence": history["sequence"],
                                       "historySource": "active-exit"}
                LOGGER.info("ACTIVE exit [%s]: %s; Previous=%s", role,
                            ", ".join(row.get("layerName", "—") for row in departed),
                            last.get("layerName", "—"))
            history["rows"] = [section_payload(current_section, row) for row in active]
        previous = copy.deepcopy(history["previous"]) if history["previous"] else {
            "available": False, "label": "—", "layerName": "—", "layerType": "Content",
            "mediaName": "—", "historySource": "awaiting-observed-exit"}

        return {
            "role": role,
            "transportName": str(transport.get("transportName") or self.config["timelines"][role].get("transport", "—")),
            "trackName": track_name,
            "trackUid": track_uid,
            "trackMediaItems": len(track_media),
            "playMode": self._play_mode(transport),
            "playbackMode": ("Loop section" if transport.get("loopSection") else
                             "Play to end" if transport.get("sectionPlayMode") else
                             "Continuous" if "sectionPlayMode" in transport else None),
            "playing": bool(transport.get("playing")),
            "holding": bool(transport.get("holding")),
            "currentBeat": as_float(transport.get("beat")),
            "currentSeconds": as_float(transport.get("trackSeconds")),
            "currentSection": section_payload(
                current_section,
                {"layerName": "—", "layerType": "Content", "mediaName": "—"},
            ),
            "previous": previous,
            "activeMembership": {"available": connected and membership_valid,
                                 "authoritative": membership_known,
                                 "atomic": bool(membership),
                                 "trackMatches": not roster_uid or not track_key or roster_uid == track_key,
                                 "sampleBeat": transport.get("beat"),
                                 "source": "TrackPlayer.activeLayers" if membership_known else "legacy"},
            "previousSelection": {"source": previous["historySource"],
                                  "sequence": history["sequence"],
                                  "layerUid": previous.get("layerUid")},
            "active": active,
            "next": section_payload(next_section, next_media),
            "nextSelection": next_selection,
            "nextSection": section_payload(
                next_section, {"layerName": "—", "layerType": "Content", "mediaName": "—"},
            ),
            "countdownSeconds": (
                countdown_source.get("remaining") if countdown_source else None
            ),
            "countdownSource": (
                {
                    "layerUid": countdown_source.get("layerUid") or "",
                    "layerName": countdown_source.get("layerName") or "—",
                    "layerType": countdown_source.get("layerType") or "Video",
                    "mediaName": countdown_source.get("mediaName") or "—",
                    "timingSource": countdown_source.get("timingSource") or "unknown",
                    "timingApproximate": bool(
                        countdown_source.get("timingApproximate")
                    ),
                }
                if countdown_source
                else None
            ),
        }

    def snapshot(self) -> dict:
        with self.lock:
            now = time.monotonic()
            stale_after = float(self.config.get("logic", {}).get("stale_after_seconds", 3.0))
            stale = not self.last_update_monotonic or (now - self.last_update_monotonic) > stale_after
            connected = bool(self.connected and not stale)
            output_available = connected and self.output_code in OUTPUT_STATES and "output_state" not in self.stream_errors
            output_code = self.output_code if output_available else None
            output_state, output_label = OUTPUT_STATES.get(output_code, ("unknown", "NO DATA"))
            fps_available = connected and self.director_fps is not None and "director_fps" not in self.stream_errors
            fps_raw_available = connected and self.director_fps_raw is not None and "director_fps_raw" not in self.stream_errors
            main = self._derive_role("main", self.roles["main"], connected)
            aux = self._derive_role("aux", self.roles["aux"], connected)
            return {
                "appVersion": APP_VERSION,
                "generatedAt": time.time(),
                "project": copy.deepcopy(self.project),
                "outputs": {
                    "state": output_state, "label": output_label, "code": output_code,
                    "available": output_available, "source": OUTPUT_STATE_PROPERTY,
                    "updatedAt": self.stream_status.get("output_state", {}).get("lastUpdate"),
                    "error": self.stream_errors.get("output_state", {}).get("message", ""),
                },
                "performance": {
                    "fps": self.director_fps if fps_available else None,
                    "rawFps": self.director_fps_raw if fps_raw_available else None,
                    "averageSamples": fps_average_samples(self.config),
                    "rawAvailable": fps_raw_available,
                    "rawStats": copy.deepcopy(self.fps_raw_stats),
                    "available": fps_available,
                    "source": DIRECTOR_FPS_OBJECT + " → " + director_fps_property(self.config),
                    "rawSource": DIRECTOR_FPS_OBJECT + " → " + DIRECTOR_FPS_RAW_PROPERTY,
                },
                "status": {
                    "connected": connected,
                    "socketConnected": self.connected,
                    "stale": stale,
                    "mode": self.connection_mode,
                    "seedHost": self.seed_host,
                    "directorHost": self.director_host,
                    "directorName": self.director_name or self.director_host,
                    "directorIp": self.director_ip,
                    "lastUpdate": self.last_update_wall,
                    "lastError": self.last_error,
                    "lastErrorAt": self.last_error_wall,
                    "logFile": str(LOG_PATH),
                    "scheduleItems": len(self.media_schedule),
                    "streams": copy.deepcopy(self.stream_status),
                    "streamErrors": copy.deepcopy(self.stream_errors),
                },
                "main": main,
                "aux": aux,
                "ui": copy.deepcopy(self.config.get("ui", {})),
            }

    def log_snapshot_summary(self, snapshot: dict):

        interval = float(
            self.config.get("logging", {}).get("state_snapshot_seconds", 10.0)
        )
        now = time.monotonic()
        with self.lock:
            if interval <= 0 or now - self.last_snapshot_log_monotonic < interval:
                return
            self.last_snapshot_log_monotonic = now
            stats = copy.deepcopy(self.fps_raw_stats)
            self.fps_raw_stats = {"count": 0, "min": None, "max": None}

        perf = snapshot.get("performance") or {}
        LOGGER.info("Performance: director=%s fps_average=%s average_samples=%s "
                    "fps_raw=%s raw_samples=%s raw_min=%s raw_max=%s source=%s",
                    (snapshot.get("status") or {}).get("directorHost"),
                    perf.get("fps"), perf.get("averageSamples"), perf.get("rawFps"),
                    stats["count"], stats["min"], stats["max"], perf.get("source"))

        for role in ("main", "aux"):
            data = snapshot.get(role) or {}
            active = [
                {
                    "layer": item.get("layerName"),
                    "type": item.get("layerType"),
                    "media": item.get("mediaName"),
                    "elapsed": item.get("elapsed"),
                    "remaining": item.get("remaining"),
                    "endPoint": item.get("endPoint"),
                    "brightness": item.get("brightness"),
                    "hasAudio": item.get("hasAudio"),
                }
                for item in data.get("active", [])
            ]
            LOGGER.info(
                "Derived %s: transport=%s track=%s beat=%s section=%s "
                "trackMedia=%s previous=%s active=%s next=%s countdown=%s currentSection=%s",
                role,
                data.get("transportName"),
                data.get("trackName"),
                data.get("currentBeat"),
                (data.get("currentSection") or {}).get("index"),
                data.get("trackMediaItems"),
                json.dumps(data.get("previous") or {}, ensure_ascii=False, separators=(",", ":")),
                json.dumps(active, ensure_ascii=False, separators=(",", ":")),
                json.dumps(data.get("next") or {}, ensure_ascii=False, separators=(",", ":")),
                data.get("countdownSeconds"),
                json.dumps(data.get("currentSection") or {}, ensure_ascii=False, separators=(",", ":")),
            )


class DisguiseLiveClient(threading.Thread):
    def __init__(self, config: dict, store: DashboardStore, stop_event: threading.Event):
        super().__init__(name="DesignerLiveUpdate", daemon=True)
        self.config = config
        self.store = store
        self.stop_event = stop_event
        self.subscription_specs = []
        self.id_to_key = {}
        self.pending_values = {}
        self.logged_stream_states = set()
        self.last_annotations_track = {"main": None, "aux": None}
        self.last_annotations_refresh = {"main": 0.0, "aux": 0.0}
        self.annotations_lock = threading.Lock()
        self.director_host = ""
        self.port = int(config["designer"].get("port", 80))
        self._build_subscriptions()

    def _build_subscriptions(self):
        self.subscription_specs = [
            {
                "key": "output_state",
                "object": "domain:MappedMedia",
                "property": OUTPUT_STATE_PROPERTY,
                "frequency": int(self.config.get("updates", {}).get("outputs_ms", 100)),
            },
            {
                "key": "media_schedule",
                "object": "domain:MappedMedia",
                "property": MEDIA_SCHEDULE_PROPERTY,
                "frequency": int(self.config.get("updates", {}).get("schedule_ms", 1000)),
            }
        ]
        for role in ("main", "aux"):
            obj = transport_expression(self.config["timelines"][role])
            self.subscription_specs.extend(
                [
                    {
                        "key": "%s.transport" % role,
                        "object": obj,
                        "property": TRANSPORT_STATE_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("transport_ms", 100)),
                    },
                    {
                        "key": "%s.sections" % role,
                        "object": obj,
                        "property": SECTIONS_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("sections_ms", 1000)),
                    },
                    {
                        "key": "%s.active_content" % role,
                        "object": obj,
                        "property": ACTIVE_GRAPHICAL_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("active_layers_ms", 100)),
                    },
                    {
                        "key": "%s.active_brightness" % role,
                        "object": obj,
                        "property": ACTIVE_BRIGHTNESS_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("brightness_ms", 100)),
                    },
                    {
                        "key": "%s.active_standard_video_details" % role,
                        "object": obj,
                        "property": ACTIVE_STANDARD_VIDEO_DETAILS_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("video_details_ms", 500)),
                    },
                    {
                        "key": "%s.active_standard_video_frames" % role,
                        "object": obj,
                        "property": ACTIVE_STANDARD_VIDEO_FRAMES_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("video_timing_ms", 250)),
                    },
                    {
                        "key": "%s.active_standard_video_elapsed" % role,
                        "object": obj,
                        "property": ACTIVE_STANDARD_VIDEO_ELAPSED_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("video_timing_ms", 250)),
                    },
                    {
                        "key": "%s.active_standard_video_remaining" % role,
                        "object": obj,
                        "property": ACTIVE_STANDARD_VIDEO_REMAINING_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("video_timing_ms", 250)),
                    },
                    {
                        "key": "%s.active_variable_video_details" % role,
                        "object": obj,
                        "property": ACTIVE_VARIABLE_VIDEO_DETAILS_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("video_details_ms", 500)),
                    },
                    {
                        "key": "%s.active_variable_video_frames" % role,
                        "object": obj,
                        "property": ACTIVE_VARIABLE_VIDEO_FRAMES_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("video_timing_ms", 250)),
                    },
                    {
                        "key": "%s.active_variable_video_elapsed" % role,
                        "object": obj,
                        "property": ACTIVE_VARIABLE_VIDEO_ELAPSED_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("video_timing_ms", 250)),
                    },
                    {
                        "key": "%s.active_variable_video_remaining" % role,
                        "object": obj,
                        "property": ACTIVE_VARIABLE_VIDEO_REMAINING_PROPERTY,
                        "frequency": int(self.config.get("updates", {}).get("video_timing_ms", 250)),
                    },
                ]
            )


        self.subscription_specs.append({
            "key": "director_fps", "object": DIRECTOR_FPS_OBJECT,
            "property": director_fps_property(self.config),
            "frequency": int(self.config.get("updates", {}).get("fps_ms", 1000)),
        })
        self.subscription_specs.extend([
            {"key": "director_fps_raw", "object": DIRECTOR_FPS_OBJECT,
             "property": DIRECTOR_FPS_RAW_PROPERTY,
             "frequency": int(self.config.get("updates", {}).get("fps_ms", 1000))},
            {"key": "media_metadata", "object": "domain:MappedMedia",
             "property": MEDIA_METADATA_PROPERTY,
             "frequency": int(self.config.get("updates", {}).get("media_metadata_ms", 1000))},
            {"key": "media_audio", "object": "domain:MappedMedia",
             "property": MEDIA_AUDIO_PROPERTY,
             "frequency": int(self.config.get("updates", {}).get("media_audio_ms", 1000))},
            {"key": "media_versions", "object": "domain:MappedMedia",
             "property": MEDIA_VERSIONS_PROPERTY, "frequency": 1000},
            {"key": "media_files", "object": "domain:MappedMedia",
             "property": MEDIA_FILES_PROPERTY, "frequency": 1000},
            {"key": "preview_brightness", "object": "domain:MappedMedia",
             "property": PREVIEW_BRIGHTNESS_PROPERTY,
             "frequency": int(self.config.get("updates", {}).get("preview_brightness_ms", 1000))},
        ])

        for role in ("main", "aux"):
            obj = transport_expression(self.config["timelines"][role])
            self.subscription_specs.extend([
                {"key": role + ".graphical_schedule", "object": obj,
                 "property": GRAPHICAL_SCHEDULE_PROPERTY,
                 "frequency": int(self.config.get("updates", {}).get("layers_ms", 1000))},
                {"key": role + ".graphical_preview_brightness", "object": obj,
                 "property": GRAPHICAL_PREVIEW_BRIGHTNESS_PROPERTY,
                 "frequency": int(self.config.get("updates", {}).get("preview_brightness_ms", 1000))},
            ])

    def _http_json(self, host: str, endpoint: str, timeout: float = 4.0):
        url = "http://%s:%d%s" % (host, self.port, endpoint)
        request = Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "DisguisePlaybackDashboard/%s" % APP_VERSION,
            },
        )
        with urlopen(request, timeout=timeout) as response:
            payload = response.read().decode("utf-8")
            data = json.loads(payload)
        status = data.get("status") if isinstance(data, dict) else None
        if isinstance(status, dict):
            try:
                code = int(status.get("code", 0))
            except (TypeError, ValueError):
                code = -1
            if code != 0:
                raise RuntimeError(
                    "Designer API %s returned code %s: %s"
                    % (endpoint, code, status.get("message") or "Unknown API error")
                )
        return data

    def _host_reachable(self, host: str) -> bool:
        try:
            data = self._http_json(host, "/api/session/status/project", timeout=2.0)
            return int((data.get("status") or {}).get("code", 0)) == 0
        except Exception:
            return False

    def _refresh_project_info(self):
        try:
            response = self._http_json(
                self.director_host, "/api/session/status/project", timeout=3.0
            )
            self.store.update_project(response.get("result") or {})
            LOGGER.info(
                "Project: %s",
                (self.store.project or {}).get("name") or "unknown",
            )
        except Exception as exc:
            LOGGER.warning("Couldn't load project information: %s", exc)

    def _resolve_director(self) -> str:
        settings = self.config["designer"]
        seed = str(settings.get("host", "127.0.0.1")).strip()
        self.director_name = seed
        override = str(settings.get("director_host_override", "")).strip()
        if override or not settings.get("auto_discover_director", True):
            endpoint = override or seed
            self.director_name = endpoint


            try:
                data = self._http_json(endpoint, "/api/session/status/session")
                director = (data.get("result") or {}).get("director") or {}
                self.director_name = str(director.get("hostname") or endpoint).strip()
            except (OSError, ValueError):
                LOGGER.debug("Director identity unavailable for %s", endpoint)
            LOGGER.info("Using configured Director endpoint: %s", endpoint)
            return endpoint

        LOGGER.info("Querying session status via %s:%d", seed, self.port)
        data = self._http_json(seed, "/api/session/status/session")
        result = data.get("result") or {}
        director = result.get("director") or {}
        hostname = str(director.get("hostname") or "").strip()
        self.director_name = hostname or seed
        if result.get("isRunningSolo", False):
            LOGGER.info("Designer reports Solo mode; using %s", seed)
            return seed
        if not hostname:
            LOGGER.warning("Session status has no Director hostname; using configured host %s", seed)
            return seed
        if self._host_reachable(hostname):
            LOGGER.info("Discovered Director: %s", hostname)
            return hostname
        if self._host_reachable(seed):
            LOGGER.warning(
                "Director hostname '%s' isn't reachable from this PC; using configured host '%s'. "
                "If the configured host is an Actor, set director_host_override to the Director IP.",
                hostname,
                seed,
            )
            return seed
        return hostname

    def _subscribe(self, websocket):
        self.id_to_key.clear()
        self.pending_values.clear()
        self.logged_stream_states.clear()
        for spec in self.subscription_specs:
            message = {
                "subscribe": {
                    "object": spec["object"],
                    "properties": [spec["property"]],
                    "configuration": {"updateFrequencyMs": spec["frequency"]},
                }
            }
            LOGGER.debug("Subscribe %s: %s / %s", spec["key"], spec["object"], spec["property"])
            websocket.send(json.dumps(message, separators=(",", ":")))




            deadline = time.monotonic() + float(
                self.config.get("designer", {}).get("subscribe_timeout_seconds", 2.0)
            )
            while time.monotonic() < deadline:
                try:
                    raw = websocket.recv(timeout=max(0.05, deadline - time.monotonic()))
                except TimeoutError:
                    LOGGER.warning("No subscription acknowledgement for %s", spec["key"])
                    break
                if raw is None:
                    raise ConnectionError("Live Update socket returned no data")
                response = self._handle_message(raw, subscription_context=spec["key"])
                if "error" in response or spec["key"] in self.id_to_key.values():
                    break

    def _handle_subscriptions(self, subscriptions: list):
        by_pair = {(spec["object"], spec["property"]): spec["key"] for spec in self.subscription_specs}
        by_property = {}
        for spec in self.subscription_specs:
            by_property.setdefault(spec["property"], []).append(spec["key"])

        for item in subscriptions:
            if not isinstance(item, dict):
                continue
            subscription_id = item.get("id")
            pair = (item.get("objectPath"), item.get("propertyPath"))
            key = by_pair.get(pair)
            if not key:
                candidates = by_property.get(item.get("propertyPath"), [])
                if len(candidates) == 1:
                    key = candidates[0]
            if key is not None and isinstance(subscription_id, int):
                self.id_to_key[subscription_id] = key
                if subscription_id in self.pending_values:
                    self._store_stream_value(
                        key, self.pending_values.pop(subscription_id)
                    )
        LOGGER.debug("Mapped %d Live Update subscription IDs", len(self.id_to_key))

    def _store_stream_value(self, key: str, value):
        clean_value, property_errors = split_property_errors(value)
        if property_errors:
            message = " | ".join(dict.fromkeys(property_errors))


            if clean_value not in (None, [], {}):
                self.store.update_value(key, clean_value)
            self.store.set_stream_error(key, message)
            marker = (key, "property-error", message)
            if marker not in self.logged_stream_states:
                self.logged_stream_states.add(marker)
                LOGGER.error("Live stream %s property error: %s", key, message)
            if clean_value in (None, [], {}):
                return
            value = clean_value
        else:
            self.store.update_value(key, value)
        if isinstance(value, list):
            state = "nonempty" if value else "empty"
            count = len(value)
            sample = value[0] if value else None
        elif isinstance(value, dict):
            state = "nonempty" if value else "empty"
            count = len(value)
            sample = value
        else:
            state = "value"
            count = 1
            sample = value
        marker = (key, state)
        if marker in self.logged_stream_states:
            return
        self.logged_stream_states.add(marker)
        sample_text = json.dumps(
            sample, ensure_ascii=False, separators=(",", ":")
        )[:1600]
        LOGGER.info(
            "Live stream %s: %d item(s); sample=%s",
            key,
            count,
            sample_text,
        )

    def _handle_values(self, values: list):
        for item in values:
            if not isinstance(item, dict):
                continue
            subscription_id = item.get("id")
            key = self.id_to_key.get(subscription_id)
            if key:
                self._store_stream_value(key, item.get("value"))
            elif isinstance(subscription_id, int):
                self.pending_values[subscription_id] = item.get("value")

    def _refresh_annotations_if_needed(self, force=False):
        label_sources = {
            str(value).lower()
            for value in self.config.get("logic", {}).get(
                "section_label_priority", ["number"]
            )
        }
        cards_enabled = self.config.get("logic", {}).get("section_metadata_enabled", True)
        if not cards_enabled and not label_sources.intersection({"note", "cue", "index"}):
            return
        if not self.director_host or not self.store.connected or self.stop_event.is_set():
            return
        if not self.annotations_lock.acquire(blocking=False):
            return
        identities = self.store.track_identities()
        now = time.monotonic()
        interval = max(1.0, float(self.config.get("updates", {}).get("annotations_seconds", 10.0)))
        due = any(
            identity["name"] and identity["name"] != "NOT CONNECTED"
            and (force or identity != self.last_annotations_track[role]
                 or now - self.last_annotations_refresh[role] >= interval)
            for role, identity in identities.items()
        )
        if not due:
            self.annotations_lock.release()
            return
        threading.Thread(
            target=self._refresh_annotations, args=(force,),
            name="SectionMetadata", daemon=True,
        ).start()

    def _refresh_annotations(self, force=False):

        try:
            self._load_annotations(force)
        finally:
            self.annotations_lock.release()

    def _load_annotations(self, force=False):
        identities = self.store.track_identities()
        host = self.director_host
        now = time.monotonic()
        interval = max(1.0, float(self.config.get("updates", {}).get("annotations_seconds", 10.0)))
        for role in ("main", "aux"):
            identity = identities[role]
            track_name = identity["name"]
            if not track_name or track_name == "NOT CONNECTED":
                continue
            changed = identity != self.last_annotations_track[role]
            expired = now - self.last_annotations_refresh[role] >= interval
            if not force and not changed and not expired:
                continue
            locator = "uid=%s" % quote(identity["uid"], safe="") if identity["uid"] else "name=%s" % quote(track_name, safe="")
            endpoint = "/api/session/transport/annotations?%s" % locator

            self.last_annotations_track[role] = identity
            self.last_annotations_refresh[role] = now
            try:
                response = self._http_json(host, endpoint)
                result = response.get("result") or {}
                if (host != self.director_host or self.stop_event.is_set()
                        or not self.store.update_annotations(role, result, expected_track=identity)):
                    continue
                LOGGER.debug("Annotations refreshed for %s track '%s'", role, track_name)
            except Exception as exc:
                if host == self.director_host and self.store.track_identities()[role] == identity:
                    self.store.set_stream_error("%s.annotations" % role, str(exc))
                LOGGER.warning("Couldn't load annotations for track '%s': %s", track_name, exc)

    def _handle_message(self, raw: str, subscription_context: str = ""):
        LOGGER.debug("Live Update RX: %s", raw[:5000])
        data = json.loads(raw)
        if "error" in data:
            message = str(data.get("error"))
            contextual = "%s: %s" % (subscription_context, message) if subscription_context else message
            self.store.set_error(contextual)
            if subscription_context:
                self.store.set_stream_error(subscription_context, message)
            LOGGER.error("Designer Live Update error%s: %s", " for %s" % subscription_context if subscription_context else "", message)
        if isinstance(data.get("subscriptions"), list):
            self._handle_subscriptions(data["subscriptions"])
        if isinstance(data.get("valuesChanged"), list):
            self._handle_values(data["valuesChanged"])
            self._refresh_annotations_if_needed()
        return data

    def run(self):
        if websocket_connect is None:
            message = "Missing dependency 'websockets'. Run Windows/INSTALL.bat or macOS/INSTALL.command; manual setup: pip install -r app/requirements.txt"
            LOGGER.error(message)
            self.store.set_connection(False, "dependency-error", error=message)
            return

        initial_delay = float(self.config.get("designer", {}).get("reconnect_initial_seconds", 1.0))
        max_delay = float(self.config.get("designer", {}).get("reconnect_max_seconds", 15.0))
        delay = initial_delay
        while not self.stop_event.is_set():
            self.store.connection_attempt += 1
            try:
                self.store.set_connection(False, "connecting")
                self.director_host = self._resolve_director()
                self._refresh_project_info()
                ws_url = "ws://%s:%d/api/session/liveupdate" % (self.director_host, self.port)
                LOGGER.info("Connecting to %s", ws_url)
                with websocket_connect(
                    ws_url,
                    open_timeout=float(self.config["designer"].get("connect_timeout_seconds", 5.0)),
                    close_timeout=2.0,
                    max_size=16 * 1024 * 1024,
                ) as websocket:
                    self.store.set_connection(True, "live", self.director_host)
                    remote = getattr(websocket, "remote_address", None)
                    self.store.set_director_identity(self.director_name, remote[0] if remote else "")
                    LOGGER.info("Live Update connected")
                    self._subscribe(websocket)
                    delay = initial_delay
                    while not self.stop_event.is_set():
                        try:
                            message = websocket.recv(timeout=1.0)
                        except TimeoutError:


                            self.store.touch()
                            self._refresh_annotations_if_needed()
                            continue
                        if message is None:
                            raise ConnectionError("Live Update socket returned no data")
                        self._handle_message(message)
            except (ConnectionClosed, ConnectionError, OSError, HTTPError, URLError, socket.gaierror) as exc:
                message = "%s: %s" % (type(exc).__name__, exc)
                self.store.set_connection(False, "reconnecting", self.director_host, message)
                LOGGER.warning("Designer connection lost: %s; retrying in %.1fs", message, delay)
            except Exception as exc:
                message = "%s: %s" % (type(exc).__name__, exc)
                self.store.set_connection(False, "error", self.director_host, message)
                LOGGER.error("Unexpected Designer client error: %s\n%s", message, traceback.format_exc())

            if self.stop_event.wait(delay):
                break
            delay = min(max_delay, max(initial_delay, delay * 1.8))

        self.store.set_connection(False, "stopped", self.director_host)
        LOGGER.info("Live Update client stopped")


class DemoClient(threading.Thread):


    def __init__(self, config: dict, store: DashboardStore, stop_event: threading.Event):
        super().__init__(name="DemoData", daemon=True)
        self.config = config
        self.store = store
        self.stop_event = stop_event

    @staticmethod
    def sections():
        return [
            {"index": 0, "startBeat": 0.0, "endBeat": 24.0, "startSec": 0.0, "endSec": 24.0},
            {"index": 1, "startBeat": 24.0, "endBeat": 54.0, "startSec": 24.0, "endSec": 54.0},
            {"index": 2, "startBeat": 54.0, "endBeat": 84.0, "startSec": 54.0, "endSec": 84.0},
            {"index": 3, "startBeat": 84.0, "endBeat": 110.0, "startSec": 84.0, "endSec": 110.0},
        ]

    def run(self):
        self.store.set_connection(True, "demo", "DEMO-DIRECTOR")
        self.store.update_project(
            {
                "projectPath": "C:/Disguise/Projects/Playback Dashboard Demo",
                "version": {"major": 34, "minor": 0, "hotfix": 0},
            }
        )
        section_names = ["OPENING", "PRODUCT REVEAL", "SPEAKER WALK-IN", "FINALE"]
        section_times = [0.0, 24.0, 54.0, 84.0]
        annotations = {
            "annotations": {
                "sections": [{"time": section_times[i], "index": str(i + 1)} for i in range(4)],
                "notes": [{"time": section_times[i], "text": name} for i, name in enumerate(section_names)],
                "tags": [
                    {"time": section_times[i], "type": tag_type, "value": value}
                    for i in range(4)
                    for tag_type, value in [
                        ("TC", "10:00:%02d:00" % int(section_times[i] % 60)),
                        ("MIDI", "1.%d" % (60 + i)), ("CUE", "1.%d" % (i + 1)),
                    ]
                ],
            }
        }
        self.store.update_annotations("main", annotations)
        self.store.update_annotations("aux", {"annotations": {"sections": [{"time": 0, "index": "S"}], "notes": [{"time": 0, "text": "COMPANY LOGO"}], "tags": [{"time": 0, "type": "CUE", "value": "2.1"}]}})

        schedule = [
            {"mediaName": "00_opening_ident.mov", "trackName": "training", "trackUid": 100, "layerName": "Opening Ident", "layerUid": 1000, "effectiveStartBeat": 0.0, "effectiveEndBeat": 24.0, "effectiveStartSec": 0.0, "effectiveEndSec": 24.0},
            {"mediaName": "01_product_background.mov", "trackName": "training", "trackUid": 100, "layerName": "LED Background", "layerUid": 1001, "effectiveStartBeat": 24.0, "effectiveEndBeat": 54.0, "effectiveStartSec": 24.0, "effectiveEndSec": 54.0},
            {"mediaName": "01_product_alpha_overlay_v12.mov", "trackName": "training", "trackUid": 100, "layerName": "Product Overlay", "layerUid": 1002, "effectiveStartBeat": 24.0, "effectiveEndBeat": 54.0, "effectiveStartSec": 24.0, "effectiveEndSec": 54.0},
            {"mediaName": "01_particles_loop.mov", "trackName": "training", "trackUid": 100, "layerName": "Particles", "layerUid": 1003, "effectiveStartBeat": 24.0, "effectiveEndBeat": 54.0, "effectiveStartSec": 24.0, "effectiveEndSec": 54.0},
            {"mediaName": "02_speaker_walkin.mov", "trackName": "training", "trackUid": 100, "layerName": "Speaker Walk-in", "layerUid": 1004, "effectiveStartBeat": 54.0, "effectiveEndBeat": 84.0, "effectiveStartSec": 54.0, "effectiveEndSec": 84.0},
            {"mediaName": "03_finale.mov", "trackName": "training", "trackUid": 100, "layerName": "Finale", "layerUid": 1005, "effectiveStartBeat": 84.0, "effectiveEndBeat": 110.0, "effectiveStartSec": 84.0, "effectiveEndSec": 110.0},
        ]
        for ordinal, item in enumerate(schedule):
            item["mediaResource"] = {"uid": str(10000 + ordinal), "path": "objects/videoclip/" + item["mediaName"] + ".apx", "type": "VideoClip"}
        self.store.update_value("media_schedule", schedule)
        self.store.update_value("media_audio", [
            {"mediaResource": item["mediaResource"], "hasAudio": ordinal in (0, 1, 4, 5)}
            for ordinal, item in enumerate(schedule)
        ])
        self.store.update_value("preview_brightness", [
            {"mediaResource": item["mediaResource"], "trackResource": {"uid": item["trackUid"]},
             "layerResource": {"uid": item["layerUid"]}, "sampleBeat": item["effectiveStartBeat"],
             "brightness": 0.75 if ordinal == 4 else 1.0, "expressionActive": False,
             "sockpuppetControlled": False, "externallyControlled": False}
            for ordinal, item in enumerate(schedule)
        ])
        self.store.update_value("media_metadata", [
            {"mediaResource": item["mediaResource"], "durationSeconds": item["effectiveEndSec"] - item["effectiveStartSec"],
             "durationTimecode": "00:00:%02d:00" % int(item["effectiveEndSec"] - item["effectiveStartSec"]), "durationFps": 25}
            for item in schedule
        ])
        started = time.monotonic()
        while not self.stop_event.wait(0.1):
            self.store.update_value("output_state", 1)
            self.store.update_value("director_fps", 60.0)
            self.store.update_value("director_fps_raw", 60.0)
            beat = (time.monotonic() - started + 35.0) % 110.0
            section_index = 0 if beat < 24 else 1 if beat < 54 else 2 if beat < 84 else 3
            section = self.sections()[section_index]
            active_schedule = [
                item for item in schedule
                if item["trackName"] == "training" and item["effectiveStartBeat"] <= beat < item["effectiveEndBeat"]
            ]
            active = []
            for item in active_schedule:
                active.append(
                    {
                        "layerName": item["layerName"],
                        "layerUid": item["layerUid"],
                        "mediaName": item["mediaName"],
                        "moduleType": "VariableVideoModule",
                        "layerType": "Video",
                        "atEndPoint": 0 if "loop" in item["mediaName"].lower() else 2,
                        "elapsed": beat - item["effectiveStartBeat"],
                        "remaining": item["effectiveEndBeat"] - beat,
                        "fps": 25.0,
                        "brightness": 1.0,
                        "blendMode": 0,
                    }
                )
            self.store.update_value(
                "main.transport",
                {
                    "transportName": "default",
                    "trackName": "training",
                    "trackUid": 100,
                    "beat": beat,
                    "trackSeconds": beat,
                    "sectionIndex": section_index,
                    "playing": True,
                    "holding": False,
                    "stopped": False,
                    "loopSection": section_index == 1,
                    "sectionPlayMode": section_index != 1,
                },
            )
            self.store.update_value("main.sections", self.sections())
            self.store.update_value("main.active", active)
            self.store.update_value("main.active_brightness", [
                {"layerUid": item["layerUid"], "layerName": item["layerName"],
                 "brightness": 1.0 if ordinal == 0 else (
                     0.65 + 0.30 * math.sin(beat * 0.20) if ordinal == 1 else 0.30)}
                for ordinal, item in enumerate(active)
            ])
            self.store.update_value(
                "aux.transport",
                {
                    "transportName": "Second",
                    "trackName": "SECOND",
                    "trackUid": 200,
                    "beat": beat,
                    "trackSeconds": beat,
                    "sectionIndex": 0,
                    "playing": True,
                    "holding": False,
                    "stopped": False,
                    "loopSection": True,
                    "sectionPlayMode": False,
                },
            )
            self.store.update_value(
                "aux.sections",
                [{"index": 0, "startBeat": 0.0, "endBeat": 999999.0, "startSec": 0.0, "endSec": 999999.0}],
            )
            self.store.update_value(
                "aux.active",
                [
                    {
                        "layerName": "Logo still",
                        "layerUid": 1999,
                        "layerStartSec": 0.0,
                        "layerEndSec": 110.0,
                        "mediaName": "company_logo.png",
                        "moduleType": "VideoModule",
                        "layerType": "Video",
                        "atEndPoint": 0,
                        "elapsed": None,
                        "remaining": None,
                        "fps": 25.0,
                        "brightness": 1.0,
                    },
                    {
                        "layerName": "Web information",
                        "layerUid": 2000,
                        "layerStartSec": 0.0,
                        "layerEndSec": 110.0,
                        "mediaName": "—",
                        "moduleType": "WebModule",
                        "layerType": "Web",
                        "elapsed": None,
                        "remaining": None,
                        "fps": 50.0,
                        "brightness": 1.0,
                        "blendMode": 0,
                    }
                ],
            )


def open_log_folder():
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(str(LOG_DIR))
    else:
        subprocess.Popen(["open" if sys.platform == "darwin" else "xdg-open", str(LOG_DIR)],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def read_log_tail(lines: int = 200) -> str:
    try:
        with LOG_PATH.open("r", encoding="utf-8", errors="replace") as handle:
            content = handle.readlines()
        return "".join(content[-max(1, min(lines, 2000)):])
    except FileNotFoundError:
        return "Log file has not been created yet."


class DashboardHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def server_bind(self):
        exclusive = getattr(socket, "SO_EXCLUSIVEADDRUSE", None)
        if exclusive is not None:
            self.allow_reuse_address = False
            self.allow_reuse_port = False
            self.socket.setsockopt(socket.SOL_SOCKET, exclusive, 1)
        super().server_bind()

    def __init__(self, server_address, handler_class, store: DashboardStore, config: dict):
        super().__init__(server_address, handler_class)
        self.store = store
        self.config_data = config


class DashboardRequestHandler(SimpleHTTPRequestHandler):
    server_version = "DisguisePlaybackDashboard/%s" % APP_VERSION

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, fmt, *args):
        LOGGER.debug("HTTP %s - %s", self.address_string(), fmt % args)

    def _send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, text: str, content_type="text/plain; charset=utf-8", status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            snapshot = self.server.store.snapshot()
            self.server.store.log_snapshot_summary(snapshot)
            self._send_json(snapshot)
            return
        if parsed.path == "/api/health":
            snapshot = self.server.store.snapshot()
            code = 200 if snapshot["status"]["connected"] else 503
            self._send_json(snapshot["status"], status=code)
            return
        if parsed.path == "/api/log-tail":
            query = parse_qs(parsed.query)
            try:
                lines = int((query.get("lines") or ["200"])[0])
            except ValueError:
                lines = 200
            self._send_text(read_log_tail(lines))
            return
        if parsed.path == "/api/config":
            safe = {
                "designer": self.server.config_data.get("designer", {}),
                "timelines": self.server.config_data.get("timelines", {}),
                "updates": self.server.config_data.get("updates", {}),
                "logic": self.server.config_data.get("logic", {}),
                "ui": self.server.config_data.get("ui", {}),
            }
            self._send_json(safe)
            return
        if parsed.path in ("", "/"):
            self.path = "/dashboard.html"
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/open-log-folder":
            origin = urlparse(self.headers.get("Origin", ""))
            host = urlparse("http://" + self.headers.get("Host", ""))
            try:
                local = (ipaddress.ip_address(self.client_address[0]).is_loopback
                         and host.hostname in ("localhost", "127.0.0.1", "::1")
                         and (host.port or 80) == self.server.server_port
                         and origin.scheme == "http" and origin.netloc == host.netloc
                         and self.headers.get("X-DPD-Action") == "open-log-folder")
            except ValueError:
                local = False
            if not local:
                self._send_json({"error": "Open DPD on the bridge computer to open its log folder."}, status=403)
                return
            try:
                open_log_folder()
                self._send_json({"ok": True})
            except OSError:
                LOGGER.exception("Cannot open log folder")
                self._send_json({"error": "Could not open the log folder. Open .private/logs manually."}, status=500)
            return
        if parsed.path != "/api/client-log":
            self._send_json({"error": "Not found"}, status=404)
            return
        try:
            length = min(int(self.headers.get("Content-Length", "0")), 16_384)
            raw = self.rfile.read(length).decode("utf-8", errors="replace")
            payload = json.loads(raw) if raw else {}
            level = str(payload.get("level", "ERROR")).upper()
            message = str(payload.get("message", "Browser event"))[:4000]
            context = payload.get("context")
            if context is not None:
                message += " | context=" + json.dumps(context, ensure_ascii=False)[:4000]
            log_method = {
                "DEBUG": LOGGER.debug,
                "INFO": LOGGER.info,
                "WARNING": LOGGER.warning,
                "ERROR": LOGGER.error,
            }.get(level, LOGGER.error)
            log_method("Browser: %s", message)
            self._send_json({"ok": True})
        except Exception as exc:
            LOGGER.warning("Invalid browser log request: %s", exc)
            self._send_json({"error": "Invalid request"}, status=400)

    def end_headers(self):
        if urlparse(self.path).path.endswith((".html", ".css", ".js")):
            self.send_header("Cache-Control", "no-store, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()


def local_url(config: dict) -> str:
    host = str(config.get("server", {}).get("bind", "0.0.0.0"))
    display_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    port = int(config.get("server", {}).get("port", 8080))
    return "http://%s:%d/" % (display_host, port)


def parse_arguments():
    parser = argparse.ArgumentParser(description="Disguise playback dashboard")
    default_config = LEGACY_CONFIG_PATH if LEGACY_CONFIG_PATH.is_file() else DEFAULT_CONFIG_PATH
    parser.add_argument("--config", default=str(default_config), help="Path to config.json")
    parser.add_argument("--demo", action="store_true", help="Run with generated data and no Designer connection")
    parser.add_argument("--open", action="store_true", help="Open the dashboard in the default browser")
    return parser.parse_args()



def windows_listeners(port: int) -> list:

    script = (
        '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; '
        '$items=@(Get-NetTCPConnection -State Listen -LocalPort ' + str(int(port)) +
        ' -ErrorAction SilentlyContinue | ForEach-Object { '
        '$entry=$_; $proc=Get-CimInstance Win32_Process '
        "-Filter ('ProcessId=' + $entry.OwningProcess) -ErrorAction Stop; "
        '[pscustomobject]@{OwningProcess=$entry.OwningProcess; '
        'LocalAddress=$entry.LocalAddress; Name=$proc.Name; CommandLine=$proc.CommandLine} }); '
        'ConvertTo-Json -InputObject $items -Compress'
    )
    result = subprocess.run(['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive',
                             '-Command', script], check=True, capture_output=True,
                            text=True, encoding='utf-8-sig', timeout=15)
    data = json.loads(result.stdout or '[]')
    if isinstance(data, dict):
        data = [data]
    return [{'pid': int(item['OwningProcess']), 'address': item['LocalAddress'],
             'name': item.get('Name') or 'unknown process',
             'commandLine': item.get('CommandLine') or ''} for item in data]


def stop_windows_process(pid: int):
    if pid <= 0 or pid == os.getpid():
        raise OSError('Cannot stop an invalid or current process')
    subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], check=True,
                   capture_output=True, text=True, timeout=10)


def replace_windows_instance(bind: str, port: int):

    host = '127.0.0.1' if bind in ('0.0.0.0', '::') else bind
    address = socket.gethostbyname(host)

    with socket.socket() as local_check:
        try:
            local_check.bind((address, 0))
        except OSError as exc:
            raise OSError('server.bind must be an address of this computer (or 0.0.0.0); '
                          'put the Director address in designer.host.') from exc
    with socket.socket() as probe:
        probe.settimeout(.5)
        if probe.connect_ex((address, port)) != 0:
            return
    stopped = set()
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        with socket.socket() as probe:
            probe.settimeout(.2)
            if probe.connect_ex((address, port)) != 0:
                return len(stopped)
        owners = windows_listeners(port)
        owners = [owner for owner in owners
                  if owner['address'] in (address, '0.0.0.0', '::', '::ffff:' + address)]
        by_pid = {owner['pid']: owner for owner in owners}
        if len(by_pid) != 1:
            raise OSError(f'Cannot identify one local owner of {host}:{port}; no process was stopped.')
        owner = next(iter(by_pid.values()))
        if owner['pid'] in stopped:
            time.sleep(.2)
            continue
        identified = False
        try:

            endpoint = f'http://{address}:{port}/api/state'
            with build_opener(ProxyHandler({})).open(endpoint, timeout=2) as response:
                data = json.loads(response.read(1024 * 1024))
                identified = (response.geturl() == endpoint
                              and response.headers.get('Server', '').startswith('DisguisePlaybackDashboard/')
                              and isinstance(data, dict) and isinstance(data.get('appVersion'), str)
                              and isinstance(data.get('main'), dict) and isinstance(data.get('aux'), dict))
        except (OSError, ValueError):
            pass
        if not identified:
            raise OSError(f"Port {port} is used by {owner['name']} (PID {owner['pid']}), "
                          'not a verified DPD instance. It was left running. '
                          'Choose an unused server.port in config.json.')
        LOGGER.info('Replacing previous DPD: PID %s on %s:%s', owner['pid'], host, port)
        stop_windows_process(owner['pid'])
        stopped.add(owner['pid'])
        if len(stopped) >= 8:
            raise OSError(f'Too many DPD restarts on port {port}; check for an external auto-restart service.')
        time.sleep(.1)
    raise OSError(f'Previous DPD did not release port {port}; new instance was not started.')


def main(browser_opener=None) -> int:
    args = parse_arguments()
    config_path = Path(args.config).resolve()
    try:
        config = load_config(config_path)
    except Exception as exc:
        print("Cannot load %s: %s" % (config_path, exc), file=sys.stderr)
        return 2

    setup_logging(config)
    LOGGER.info("Starting Disguise Playback Dashboard %s", APP_VERSION)
    LOGGER.info("Configuration: %s", config_path)
    stop_event = threading.Event()
    store = DashboardStore(config)
    client = DemoClient(config, store, stop_event) if args.demo else DisguiseLiveClient(config, store, stop_event)

    bind = str(config.get("server", {}).get("bind", "0.0.0.0"))
    port = int(config.get("server", {}).get("port", 8080))
    try:
        if sys.platform == "win32":
            replace_windows_instance(bind, port)
        bind_deadline = time.monotonic() + 10
        while True:
            try:
                httpd = DashboardHTTPServer((bind, port), DashboardRequestHandler, store, config)
                break
            except OSError as exc:

                if (sys.platform != "win32" or time.monotonic() >= bind_deadline
                        or (exc.errno not in (errno.EADDRINUSE, errno.EACCES)
                            and getattr(exc, "winerror", None) not in (10048, 10013))):
                    raise
                time.sleep(.2)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        LOGGER.error("Cannot start local web server on %s:%d: %s", bind, port, exc)
        stop_event.set()
        return 3

    client.start()
    url = local_url(config)
    LOGGER.info("Dashboard: %s", url)
    LOGGER.info("Log file: %s", LOG_PATH)
    print("\nDashboard: %s" % url)
    print("Press Ctrl+C to stop.\n")

    browser_failed = threading.Event()
    browser_timer = None
    if args.open or browser_opener is not None:
        def open_dashboard():
            try:
                (browser_opener or webbrowser.open)(url)
            except OSError as exc:
                LOGGER.error("Cannot open dashboard window: %s", exc)
                browser_failed.set()
                httpd.shutdown()
        browser_timer = threading.Timer(0.8, open_dashboard)
        browser_timer.start()

    try:
        httpd.serve_forever(poll_interval=0.5)
    except KeyboardInterrupt:
        LOGGER.info("Shutdown requested")
    finally:
        if browser_timer is not None:
            browser_timer.cancel()
        stop_event.set()
        httpd.server_close()
        client.join(timeout=3.0)
        LOGGER.info("Dashboard stopped")
    return 4 if browser_failed.is_set() else 0


if __name__ == "__main__":
    raise SystemExit(main())
