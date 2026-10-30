Disguise Playback Dashboard — native Plugin 0.5.9

INSTALL
Extract DPD-0.5.9 into your project's Plugins folder. Close DPD and remove the
previous DPD plugin folder from Plugins to avoid duplicate entries. Open the
project and choose DPD - Plugin from Designer's Plugins menu.

No JSON editing, runtime installation or separate server is needed. Director and
transports are detected automatically. With multiple transports, choose the main
one once; the project remembers it. Change it later in Diagnostics (D).

VIEWS
Compact opens inside Designer GUI, including layer colours from Designer's
Layer Colour Rules. Advanced and Simple are available through Designer's web
interface in a browser: open the Director's IP address, then select DPD - Plugin.
Advanced is the browser default; the footer switches between Advanced and Simple.

Designer r31+ is the target; size and colour operation confirmed on r33.2.4.
DPD monitors playback and does not control it. Diagnostics opens in the current
page. Native height resizing is still allowed by Designer.

GPL-3.0-only. Copyright 2026 Vladimir Zakharov / viavision.pro.
Vue MIT license: vue/VUE-LICENSE.txt.
