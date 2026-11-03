// 3D depth maps, made in the artist's own browser when they upload (nothing is sent anywhere else).
// Uses the small "Depth Anything V2" model through transformers.js. The model (~25 MB) downloads once
// and is cached by the browser. Returns a grayscale PNG: brighter = closer to the camera.
(function () {
  "use strict";
  var LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";
  var MODEL = "onnx-community/depth-anything-v2-small";
  var pipe = null;

  async function getPipe(onStatus) {
    if (pipe) return pipe;
    onStatus && onStatus("Loading the 3D model (one time, about 25 MB)…");
    var tf = await import(LIB);
    tf.env.allowLocalModels = false;
    var opts = { dtype: "q8" };
    try { if (navigator.gpu && (await navigator.gpu.requestAdapter())) opts = { device: "webgpu", dtype: "fp16" }; } catch (e) {}
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
    var small = await shrink(blob, 640);
    var url = URL.createObjectURL(small);
    try {
      var out = await p(url);
      var r = Array.isArray(out) ? out[0] : out;
      var canvas = r.depth.toCanvas();
      // soften hard edges a little so tilting doesn't tear around hair and fingers
      var c2 = document.createElement("canvas"); c2.width = canvas.width; c2.height = canvas.height;
      var g = c2.getContext("2d"); g.filter = "blur(2px)"; g.drawImage(canvas, 0, 0);
      return await new Promise(function (ok, no) { c2.toBlob(function (b) { b ? ok(b) : no(new Error("no depth")); }, "image/png"); });
    } finally { URL.revokeObjectURL(url); }
  }

  window.AreaDepth = { depthMap: depthMap };
})();
