
# Copyright (C) 2026 Vladimir Zakharov / viavision.pro
# SPDX-License-Identifier: GPL-3.0-only
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
from urllib.request import urlopen

from app import server


def find_chrome():
    if sys.platform == 'win32':
        paths = [Path(os.environ[key]) / 'Google/Chrome/Application/chrome.exe'
                 for key in ('LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)') if os.environ.get(key)]
        return next((path for path in paths if path.is_file()), None)
    return next((path for path in (
        Path('/Applications/Google Chrome.app'),
        Path.home() / 'Applications/Google Chrome.app',
    ) if path.is_dir()), None)


def chrome_command(chrome, url):
    command = [str(chrome)] if sys.platform == 'win32' else ['open', '-na', str(chrome), '--args']
    command += ['--user-data-dir=' + str(server.LOCAL_DIR / 'chrome-window'),
                '--app=' + url, '--no-first-run', '--no-default-browser-check']
    if sys.platform == 'win32':
        command.append('--start-fullscreen')
    return command


def main() -> int:
    chrome = find_chrome()
    if chrome is None:
        print('Google Chrome is required for WINDOW. Install Chrome or use START.', file=sys.stderr)
        return 1
    if sys.platform == 'win32':


        return server.main(browser_opener=lambda url: subprocess.Popen(
            chrome_command(chrome, url), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
    config_path = (server.LEGACY_CONFIG_PATH if server.LEGACY_CONFIG_PATH.is_file()
                   else server.DEFAULT_CONFIG_PATH)
    try:
        config = server.load_config(config_path)
        url = server.local_url(config)
        host = str(config.get('server', {}).get('bind', '0.0.0.0'))
        host = '127.0.0.1' if host in ('0.0.0.0', '::') else host
        port = int(config.get('server', {}).get('port', 8080))
        with socket.socket() as probe:
            probe.settimeout(.5)
            if probe.connect_ex((host, port)) == 0:
                print(f'Port {port} is already in use. Stop the other DPD instance '
                      'with Ctrl+C before opening this launcher.', file=sys.stderr)
                return 1
    except (OSError, ValueError) as error:
        print(f'Cannot prepare DPD: {error}', file=sys.stderr)
        return 1

    def stop(_signum, _frame):
        raise KeyboardInterrupt

    for signum in {signal.SIGTERM, getattr(signal, "SIGHUP", signal.SIGTERM)}:
        signal.signal(signum, stop)
    process = None
    try:
        process = subprocess.Popen([sys.executable, str(server.APP_DIR / 'app/server.py')],
                                   cwd=server.APP_DIR, start_new_session=True)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if process.poll() is not None:
                return process.returncode or 1
            try:
                with urlopen(url + 'api/state', timeout=.5) as response:
                    state = json.load(response)
                if state.get('appVersion') == server.APP_VERSION and process.poll() is None:
                    break
            except (OSError, ValueError):
                time.sleep(.1)
        else:
            print('The local DPD server did not become ready. See .private/logs/dashboard.log.',
                  file=sys.stderr)
            return 1
        subprocess.run(chrome_command(chrome, url), check=True)
        print('Chrome window opened. Keep this Terminal window running; Ctrl+C stops DPD.',
              flush=True)
        return process.wait()
    except KeyboardInterrupt:
        return 0
    except (OSError, subprocess.CalledProcessError) as error:
        print(f'Cannot open the Chrome window: {error}', file=sys.stderr)
        return 1
    finally:
        if process is not None and process.poll() is None:
            if sys.platform == "win32":
                process.terminate()
            else:
                process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == '__main__':
    raise SystemExit(main())
