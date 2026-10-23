#!/bin/bash
# Copyright (C) 2026 Vladimir Zakharov / viavision.pro
# SPDX-License-Identifier: GPL-3.0-only
DPD_ROOT="$(cd -- "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 1
cd "$DPD_ROOT" || exit 1
export PYTHONDONTWRITEBYTECODE=1
export PIP_DISABLE_PIP_VERSION_CHECK=1
export PIP_CACHE_DIR="$DPD_ROOT/.private/pip-cache"
DPD_MODE="${1:-start}"

dpd_pause() {
    if [[ -t 0 ]]; then
        read -r -p "Press Return to close this window... " _
    fi
}
dpd_fail() {
    echo ""
    echo "DPD: $1" >&2
    dpd_pause
    exit 1
}
case "$DPD_MODE" in
    install|demo|start|window) ;;
    *) dpd_fail "Unknown launch mode: $DPD_MODE" ;;
esac
[[ "$(uname -s)" == Darwin ]] || dpd_fail "Use these .command launchers on macOS."

echo "Disguise Playback Dashboard v0.4.13"
DPD_PYTHON="$DPD_ROOT/.private/.venv/bin/python"
dpd_python_supported() {
    "$1" -c 'import sys, ssl, venv; raise SystemExit(0 if (3, 10) <= sys.version_info < (4, 0) else 1)' >/dev/null 2>&1
}

dpd_load_uv() {
    DPD_UV="$DPD_ROOT/.private/runtime-tools/uv"
    export UV_PYTHON_INSTALL_DIR="$DPD_ROOT/.private/python"
    export UV_PYTHON_INSTALL_BIN=0
    export UV_CACHE_DIR="$DPD_ROOT/.private/uv-cache"
    export UV_NO_CONFIG=1
    export UV_NO_PROGRESS=1
    if [[ -x "$DPD_UV" ]] && [[ "$("$DPD_UV" --version 2>/dev/null)" == "uv 0.13.0"* ]]; then
        return
    fi
    case "$(uname -m)" in
        arm64)
            DPD_UV_ARCH=aarch64
            DPD_UV_SHA=a9c1b29002cf3c83f07fa9cd8a887a3be0107d90e23189721221e7257db8e3d6
            ;;
        x86_64)
            DPD_UV_ARCH=x86_64
            DPD_UV_SHA=5f44dcbde809b632f47c36fadb241cb4d6f9af71d0c8f172b5d2026d3dde742c
            ;;
        *) dpd_fail "Automatic Python installation supports Apple Silicon and Intel Macs." ;;
    esac
    mkdir -p "$DPD_ROOT/.private/runtime-tools" || dpd_fail "Cannot create the local installer folder."
    DPD_DOWNLOAD="$(mktemp -d "$DPD_ROOT/.private/uv-download.XXXXXX")" || dpd_fail "Cannot create a download folder."
    trap 'if [[ -n "$DPD_DOWNLOAD" ]]; then rm -rf "$DPD_DOWNLOAD"; fi' EXIT
    echo "Downloading the local Python installer (uv)..."
    curl --fail --location --retry 2 --connect-timeout 20 --max-time 180 \
        --proto '=https' --tlsv1.2 --silent --show-error \
        --output "$DPD_DOWNLOAD/uv.tar.gz" \
        "https://github.com/astral-sh/uv/releases/download/0.13.0/uv-$DPD_UV_ARCH-apple-darwin.tar.gz" \
        || dpd_fail "Cannot download the Python installer. Check internet access and try again."
    DPD_DOWNLOADED_SHA="$(shasum -a 256 "$DPD_DOWNLOAD/uv.tar.gz" | awk '{print $1}')"
    [[ "$DPD_DOWNLOADED_SHA" == "$DPD_UV_SHA" ]] || dpd_fail "Python installer checksum did not match. Nothing was installed."
    tar -xzf "$DPD_DOWNLOAD/uv.tar.gz" -C "$DPD_DOWNLOAD" || dpd_fail "Cannot extract the Python installer."
    cp "$DPD_DOWNLOAD/uv-$DPD_UV_ARCH-apple-darwin/uv" "$DPD_UV.new" \
        && chmod +x "$DPD_UV.new" && mv "$DPD_UV.new" "$DPD_UV" \
        || dpd_fail "Cannot save the local Python installer."
    rm -rf "$DPD_DOWNLOAD"
    DPD_DOWNLOAD=""
    "$DPD_UV" --version || dpd_fail "The local Python installer cannot run on this Mac."
}

dpd_preserve_old_env() {
    if [[ -e "$DPD_ROOT/.private/.venv" ]]; then
        DPD_OLD_ENV="$DPD_ROOT/.private/venv-before-setup-$(date +%Y%m%d-%H%M%S)-$$"
        mv "$DPD_ROOT/.private/.venv" "$DPD_OLD_ENV" || dpd_fail "Cannot preserve the previous Python environment."
        echo "Previous environment saved in $(basename "$DPD_OLD_ENV")."
    fi
}

if [[ ! -x "$DPD_PYTHON" ]] || ! dpd_python_supported "$DPD_PYTHON"; then
    DPD_BOOTSTRAP=""
    for candidate in python3 python3.15 python3.14 python3.13 python3.12 python3.11 python3.10 \
        /opt/homebrew/bin/python3 /usr/local/bin/python3 \
        /Library/Frameworks/Python.framework/Versions/3.*/bin/python3 \
        /opt/homebrew/opt/python@3.*/bin/python3* /usr/local/opt/python@3.*/bin/python3* \
        "$DPD_ROOT"/.private/python/*/bin/python3.12; do
        candidate_path="$(command -v "$candidate" 2>/dev/null)" || continue
        if dpd_python_supported "$candidate_path"; then
            DPD_BOOTSTRAP="$candidate_path"
            break
        fi
    done
    mkdir -p "$DPD_ROOT/.private" || dpd_fail "Cannot create .private in this folder."
    if [[ -z "$DPD_BOOTSTRAP" ]]; then
        echo "No suitable Python 3.10+ was found. Installing local Python 3.12..."
        dpd_load_uv
        "$DPD_UV" python install 3.12 --no-bin || dpd_fail "Cannot install local Python. Check internet access and try again."
        DPD_BOOTSTRAP="$("$DPD_UV" python find 3.12 --managed-python --no-python-downloads)" \
            || dpd_fail "The downloaded Python could not be located."
        dpd_preserve_old_env
        "$DPD_UV" venv --python "$DPD_BOOTSTRAP" --seed "$DPD_ROOT/.private/.venv" \
            || dpd_fail "Cannot create the local Python environment."
    else
        echo "Preparing the local Python environment..."
        dpd_preserve_old_env
        if ! "$DPD_BOOTSTRAP" -m venv "$DPD_ROOT/.private/.venv"; then
            echo "Preparing the environment with the local installer..."
            dpd_load_uv
            dpd_preserve_old_env
            "$DPD_UV" venv --python "$DPD_BOOTSTRAP" --seed "$DPD_ROOT/.private/.venv" \
                || dpd_fail "Cannot create the local Python environment."
        fi
    fi
fi
dpd_python_supported "$DPD_PYTHON" || dpd_fail "Python must be version 3.10+ and include SSL support."
"$DPD_PYTHON" --version

if ! "$DPD_PYTHON" -m pip --version >/dev/null 2>&1; then
    echo "Preparing pip..."
    if ! "$DPD_PYTHON" -m ensurepip --upgrade || ! "$DPD_PYTHON" -m pip --version >/dev/null 2>&1; then
        dpd_load_uv
        "$DPD_UV" pip install --python "$DPD_PYTHON" --reinstall pip \
            || dpd_fail "Cannot prepare pip in the local environment."
    fi
fi
dpd_dependencies_ok() {
    "$DPD_PYTHON" -m pip install --dry-run --no-index --no-deps -r "$DPD_ROOT/app/requirements.txt" >/dev/null 2>&1 \
        && "$DPD_PYTHON" -m pip check >/dev/null 2>&1 \
        && "$DPD_PYTHON" -c 'from websockets.sync.client import connect; from websockets.exceptions import ConnectionClosed' >/dev/null 2>&1
}
echo "Checking all dependencies in requirements.txt..."
if ! dpd_dependencies_ok; then
    echo "Installing missing or incompatible dependencies (internet access needed)..."
    "$DPD_PYTHON" -m pip install -r "$DPD_ROOT/app/requirements.txt" \
        || dpd_fail "Dependency installation failed. Check internet access and try again."
    if ! dpd_dependencies_ok; then
        echo "Repairing the local dependency installation..."
        "$DPD_PYTHON" -m pip install --upgrade pip \
            && "$DPD_PYTHON" -m pip install --force-reinstall -r "$DPD_ROOT/app/requirements.txt" \
            || dpd_fail "Cannot repair the local dependencies."
    fi
fi
"$DPD_PYTHON" -m pip check || dpd_fail "The local environment has incompatible dependencies."
dpd_dependencies_ok || dpd_fail "Required libraries could not be verified."
echo "Python and all required libraries are ready."

if [[ ! -f "$DPD_ROOT/config.json" && ! -f "$DPD_ROOT/.private/config.json" ]]; then
    [[ -f "$DPD_ROOT/app/config.example.json" ]] || dpd_fail "config.json is missing. Extract the complete release ZIP again."
    mkdir -p "$DPD_ROOT/.private" || dpd_fail "Cannot create the settings folder."
    cp "$DPD_ROOT/app/config.example.json" "$DPD_ROOT/.private/config.json" || dpd_fail "Cannot create local settings."
fi

case "$DPD_MODE" in
    install)
        echo "Ready. Open DEMO.command, START.command or WINDOW.command."
        dpd_pause
        exit 0
        ;;
    demo) "$DPD_PYTHON" "$DPD_ROOT/app/server.py" --demo --open ;;
    start) "$DPD_PYTHON" "$DPD_ROOT/app/server.py" --open ;;
    window) "$DPD_PYTHON" -m app.window ;;
esac
DPD_RESULT=$?
if [[ "$DPD_RESULT" -ne 0 && "$DPD_RESULT" -ne 130 ]]; then
    echo ""
    echo "DPD stopped with an error. See .private/logs/dashboard.log." >&2
    dpd_pause
fi
exit "$DPD_RESULT"
