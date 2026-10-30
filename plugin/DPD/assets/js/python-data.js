// Copyright (C) 2026 Vladimir Zakharov / viavision.pro
// SPDX-License-Identifier: GPL-3.0-only
// The payload literal contains only hex digits: no Python/runner escape layers.
(function(root){
 'use strict';
 function jsonExpression(value){
  const bytes=new TextEncoder().encode(JSON.stringify(value));
  const hex=Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');
  return 'json.loads(bytearray.fromhex("'+hex+'").decode("utf-8"))';
 }
 const builtinsPreamble='try:\n    import __builtin__ as dpd_builtins\nexcept ImportError:\n    import builtins as dpd_builtins\nException = dpd_builtins.Exception\n';
 const api={jsonExpression,builtinsPreamble};root.DPDPython=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
