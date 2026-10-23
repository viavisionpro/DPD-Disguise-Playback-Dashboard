#!/bin/bash
# Copyright (C) 2026 Vladimir Zakharov / viavision.pro
# SPDX-License-Identifier: GPL-3.0-only
DPD_ROOT="$(cd -- "$(dirname "$0")/.." && pwd)" || exit 1
/bin/bash "$DPD_ROOT/app/launch_macos.sh" window
