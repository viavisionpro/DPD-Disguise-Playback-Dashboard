# Disguise Playback Dashboard

[Русская версия](README_RU.md)

**DPD** is a read-only playback dashboard for **Disguise Designer**. It runs in
a browser and receives live data from the **Director over the local network**.
Run DPD on Windows or macOS and open it on the same computer or another device
on the network.

DPD displays only layers from the **Video** and **Generative** categories.
It monitors playback without controlling Designer.

## What DPD displays

- Main and second timelines: track names, playback mode and ON AIR status.
- Up to three active layers on the main timeline and one on the second.
- Layer names, types and brightness; media filenames when available, selected
  version tags such as `v.2`, and embedded-audio indicators.
- Elapsed and remaining time, a large countdown and upcoming media.
- Current and next section metadata: TC, MIDI, OSC and notes in Advanced;
  upcoming clip duration in Simple.
- Director output state — FADE UP, FADE DOWN or HOLD — plus Director FPS in Advanced.
- Project name, clock, date and connection status, with stream diagnostics.

The original media version has no tag. **DISABLED** layers are excluded;
MUTE filtering is not supported. The audio icon indicates an embedded track,
not audible output. Timing for stills and generative content is approximate.

## Two views

### Advanced

A detailed view with Previous / Active / Next, section metadata and Director FPS.

![DPD Advanced view](assets/screenshots/DPD_Advanced.png)

### Simple

A compact view with Active / Next and larger time displays.

![DPD Simple view](assets/screenshots/DPD_Simple.png)

## Installation and launch

Requires a running **Designer r30+** session and network access to its API.
On Windows, install **Python 3.10+** with **Python Launcher (`py`)**.
On macOS, setup reuses a suitable Python or installs a local copy automatically.
**WINDOW** requires Google Chrome. Initial setup requires internet access.

1. Download the **Runtime ZIP** from [Releases](https://github.com/viavisionpro/DPD-Disguise-Playback-Dashboard/releases/latest) and extract it completely.
2. Open **Windows/** or **macOS/** and run **INSTALL**.
3. Run **DEMO** to try DPD without Designer.
4. Edit **config.json** as described below.
5. Run **START** for your default browser or **WINDOW** for a separate Chrome window.

Launchers end in `.bat` on Windows and `.command` on macOS.
Keep the terminal open; **Ctrl+C** stops DPD.
If macOS blocks a downloaded launcher, open it once, then allow it in
**System Settings → Privacy & Security → Open Anyway**.

## Connection settings

Edit the root **config.json** while DPD is stopped.

| Setting | Value |
| --- | --- |
| `designer.host` | Director IP. Default: `127.0.0.1` for Designer on the same computer. |
| `designer.port` | Designer HTTP API port. Default: `80`. |
| `timelines.main.transport` | Exact main Transport Manager name. Default: `default`. |
| `timelines.aux.transport` | Exact second Transport Manager name. Default: `second`. |
| `server.bind` | Default: `0.0.0.0`, listening on all local interfaces. Use `127.0.0.1` for access from this computer only. |
| `server.port` | DPD web port. Default: `8080`. |

Open **http://127.0.0.1:8080/** on the DPD computer, or
**http://DPD-COMPUTER-IP:8080/** from another device on the local network.
Use the footer links to switch between Advanced and Simple.

When upgrading, extract into a new folder and copy your **config.json**.
Existing settings are preserved. Source installations use **.private/config.json**
when no root config exists.

## Diagnostics

Press **D** or click **DIAGNOSTICS**; **Esc** closes it.
The full log is **.private/logs/dashboard.log**.
If DEMO works but live data is missing, check the Director IP, API port and
Transport Manager names. Run **INSTALL** again to repair dependencies.

## License

[GNU GPLv3 only](LICENSE) · Copyright © 2026 Vladimir Zakharov · [viavision.pro](https://viavision.pro)
