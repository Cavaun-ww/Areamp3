// 3D depth maps, made in the artist's own browser when they upload (nothing is sent anywhere else).
// Uses the small "Depth Anything V2" model through transformers.js. The model (~25 MB) downloads once
// and is cached by the browser. Returns a grayscale PNG: brighter = closer to the camera.
(function () {
  "use strict";
  var LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
  var MODEL = "onnx-community/depth-anything-v2-small";
  var pipe = null;
  // if the page ever dies in the middle of making depth (phone ran out of memory), count it;
  // after two, this device skips 3D so publishing always works
  var LS = { get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: function (k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) {} } };
  if (LS.get("d3busy")) { LS.set("d3fail", String((+LS.get("d3fail") || 0) + 1)); LS.set("d3busy", null); }
  function guard(fn) {
    return async function () {
      if ((+LS.get("d3fail") || 0) >= 2) throw new Error("3D off on this device");
      LS.set("d3busy", "1");
      try { return await fn.apply(this, arguments); } finally { LS.set("d3busy", null); }
    };
  }

  async function getPipe(onStatus) {
    if (pipe) return pipe;
    onStatus && onStatus("Loading the 3D model (one time, about 25 MB)…");
    var tf = await import(LIB);
    tf.env.allowLocalModels = false;
    var opts = { dtype: "q8" };
    var phone = window.matchMedia && matchMedia("(pointer: coarse)").matches;
    try { if (!phone && navigator.gpu && (await navigator.gpu.requestAdapter())) opts = { device: "webgpu", dtype: "fp16" }; } catch (e) {}
    try { pipe = await tf.pipeline("depth-estimation", MODEL, opts); }
    catch (e) { pipe = await tf.pipeline("depth-estimation", MODEL, { dtype: "q8" }); } // no WebGPU: fall back
    return pipe;
  }

  // shrink big photos first: faster, and the depth map doesn't need full size
  function shrink(blob, max) {
    return new Promise(function (ok, no) {
      var im = new Image();
      im.onload = function () {
        var s = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(im.naturalWidth * s)); c.height = Math.max(1, Math.round(im.naturalHeight * s));
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
        URL.revokeObjectURL(im.src);
        c.toBlob(function (b) { b ? ok(b) : no(new Error("Couldn't read the photo")); }, "image/jpeg", 0.9);
      };
      im.onerror = function () { no(new Error("Couldn't read the photo")); };
      im.src = URL.createObjectURL(blob);
    });
  }

  // blob (jpg/png/webp) → PNG blob of the depth map
  async function depthMap(blob, onStatus) {
    var p = await getPipe(onStatus);
    onStatus && onStatus("Adding 3D depth to your photo…");
    var small = await shrink(blob, window.matchMedia && matchMedia("(pointer: coarse)").matches ? 448 : 640);
    var url = URL.createObjectURL(small);
    try {
      var out = await p(url);
      var r = Array.isArray(out) ? out[0] : out;
      var canvas = r.depth.toCanvas();
      try { r.predicted_depth && r.predicted_depth.dispose && r.predicted_depth.dispose(); } catch (e) {}
      // soften hard edges a little so tilting doesn't tear around hair and fingers
      var c2 = document.createElement("canvas"); c2.width = canvas.width; c2.height = canvas.height;
      var g = c2.getContext("2d"); g.filter = "blur(2px)"; g.drawImage(canvas, 0, 0);
      return await new Promise(function (ok, no) { c2.toBlob(function (b) { b ? ok(b) : no(new Error("no depth")); }, "image/png"); });
    } finally { URL.revokeObjectURL(url); }
  }

  // ── many frames (GIFs and videos): depth of each frame, packed side by side into one PNG "sheet" ──
  var CELL = 128;
  async function depthCell(src) {
    var p = await getPipe();
    var out = await p(src), r = Array.isArray(out) ? out[0] : out, d = r.depth.toCanvas();
    var c = document.createElement("canvas"); c.width = c.height = CELL;
    var g = c.getContext("2d"); g.filter = "blur(1px)"; g.drawImage(d, 0, 0, CELL, CELL);
    return c;
  }
  function sheet(n) {
    var cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    var c = document.createElement("canvas"); c.width = cols * CELL; c.height = rows * CELL;
    var g = c.getContext("2d"); g.fillStyle = "#000"; g.fillRect(0, 0, c.width, c.height);
    return { c: c, g: g, cols: cols, put: function (k, cell) { g.drawImage(cell, (k % cols) * CELL, Math.floor(k / cols) * CELL); } };
  }
  var toPng = function (c) { return new Promise(function (ok, no) { c.toBlob(function (b) { b ? ok(b) : no(new Error("no depth")); }, "image/png"); }); };
  function frameCanvas(w, h) { var s = Math.min(1, 320 / Math.max(w, h)), c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s)); return c; }

  // videos: one depth frame about every second (at most 180), blended smoothly in the AR camera
  async function videoDepth(file, onPct) {
    await getPipe();
    var v = document.createElement("video"); v.muted = true; v.playsInline = true; v.setAttribute("playsinline", ""); v.preload = "auto";
    var url = URL.createObjectURL(file); v.src = url;
    try {
      await new Promise(function (ok, no) { v.onloadeddata = ok; v.onerror = function () { no(new Error("video")); }; });
      var dur = v.duration;
      if (!isFinite(dur)) { // recorded clips sometimes don't know their length until you jump to the end
        await new Promise(function (ok) { v.ontimeupdate = function () { v.ontimeupdate = null; ok(); }; v.currentTime = 1e7; setTimeout(ok, 3000); });
        dur = isFinite(v.duration) ? v.duration : v.currentTime;
      }
      if (!(dur > 0) || !isFinite(dur)) throw new Error("video length");
      var step = Math.max(1, dur / 180), n = Math.max(1, Math.floor(dur / step) + 1);
      var sh = sheet(n), fc = frameCanvas(v.videoWidth || 320, v.videoHeight || 320), fg = fc.getContext("2d");
      for (var k = 0; k < n; k++) {
        var t = Math.min(dur - 0.05, k * step);
        await new Promise(function (ok) { var done = function () { v.removeEventListener("seeked", done); ok(); }; v.addEventListener("seeked", done); v.currentTime = Math.max(0, t); });
        fg.drawImage(v, 0, 0, fc.width, fc.height);
        sh.put(k, await depthCell(fc));
        onPct && onPct((k + 1) / n);
      }
      return { blob: await toPng(sh.c), meta: { kind: "video", n: n, cols: sh.cols, cell: CELL, step: +step.toFixed(3) } };
    } finally { URL.revokeObjectURL(url); }
  }

  // GIFs: one depth shape from the middle frame (frame-by-frame used too much memory on phones)
  async function gifDepth(file, onPct) {
    var lib = await import("https://cdn.jsdelivr.net/npm/gifuct-js@2.1.2/+esm"); if (!lib.parseGIF && lib.default) lib = lib.default;
    var gif = lib.parseGIF(await file.arrayBuffer()), frames = lib.decompressFrames(gif, false), total = frames.length;
    if (!total) throw new Error("gif");
    var W = gif.lsd.width || 1, H = gif.lsd.height || 1, mid = Math.floor(total / 2);
    var full = document.createElement("canvas"); full.width = W; full.height = H; var fg = full.getContext("2d");
    var tmp = document.createElement("canvas"), tg = tmp.getContext("2d"), prev = null;
    for (var i = 0; i <= mid; i++) {
      var f = frames[i];
      if (prev && prev.disposalType === 2) fg.clearRect(prev.dims.left, prev.dims.top, prev.dims.width, prev.dims.height);
      var d = f.dims; tmp.width = d.width; tmp.height = d.height;
      var im = tg.createImageData(d.width, d.height), a = im.data, px = f.pixels, ct = f.colorTable, ti = f.transparentIndex;
      for (var p = 0; p < px.length; p++) { var c = px[p]; if (c === ti) continue; var col = ct[c], o = p * 4; if (!col) continue; a[o] = col[0]; a[o + 1] = col[1]; a[o + 2] = col[2]; a[o + 3] = 255; }
      tg.putImageData(im, 0, 0); fg.drawImage(tmp, d.left, d.top); prev = f;
    }
    frames = null; gif = null;
    var still = await new Promise(function (ok, no) { full.toBlob(function (b) { b ? ok(b) : no(new Error("gif")); }, "image/png"); });
    full.width = full.height = tmp.width = tmp.height = 1;
    onPct && onPct(0.5);
    var blob = await depthMap(still);
    onPct && onPct(1);
    return { blob: blob, meta: null };
  }

  window.AreaDepth = { depthMap: guard(depthMap), videoDepth: guard(videoDepth), gifDepth: guard(gifDepth) };
})();
