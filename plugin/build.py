#!/usr/bin/env python3
"""Package the independent Designer plugin; no standalone source is read."""
# Copyright (C) 2026 Vladimir Zakharov / viavision.pro
# SPDX-License-Identifier: GPL-3.0-only
import argparse
import os
import shutil
import subprocess
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent
VERSION = '0.5.9'
FILES = (
    'index.html', 'advanced.html', 'simple.html', 'compact.html', 'diagnostics.html',
    'compact.css', 'diagnostics.css', 'dashboard.css', 'simple.css', 'setup.css',
    'launch.js', 'python-data.js', 'preferences.js', 'dashboard-motion.js', 'state.js', 'designer-client.js',
    'demo.js', 'demo.json', 'config.json', 'properties.json', 'd3plugin.json', 'icon.svg',
    'favicon.ico', 'LICENSE', 'README.txt', 'vue/app.js', 'vue/VUE-LICENSE.txt',
    'assets/favicon.svg', 'assets/favicon-32.png', 'assets/apple-touch-icon.png',
)


def compile_frontend():
    frontend = ROOT / 'frontend'
    vite = frontend / 'node_modules/vite/bin/vite.js'
    if not vite.is_file():
        raise ValueError('Install development dependencies first: cd plugin/frontend && npm ci')
    subprocess.run([os.environ.get('DPD_NODE', 'node'), str(vite), 'build'], cwd=frontend, check=True)
    shutil.copyfile(frontend / 'node_modules/vue/LICENSE', ROOT / 'DPD/vue/VUE-LICENSE.txt')



def build(output=None):
    source = ROOT / 'DPD'
    missing = [name for name in FILES if not (source / name).is_file()]
    if missing:
        raise ValueError('Missing plugin files: ' + ', '.join(missing))
    destination = Path(output) if output else ROOT / ('dist/DPD_v' + VERSION + '_Plugin.zip')
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, 'w', compression=ZIP_DEFLATED) as archive:
        for name in FILES:
            # Stable metadata keeps the download reproducible between machines.
            info = ZipInfo('DPD-' + VERSION + '/' + name, date_time=(2026, 10, 29, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, (source / name).read_bytes())
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--rebuild', action='store_true', help='Compile Vue with development-only Node/Vite before packaging')
    args = parser.parse_args()
    if args.rebuild:
        compile_frontend()
    print(build(args.output))
