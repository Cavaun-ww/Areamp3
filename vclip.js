// Makes a smaller clip of a video (MP4 / MOV, e.g. straight from an iPhone) using the phone's own video
// decoder and encoder (WebCodecs). It reads the file a piece at a time, so even big 4K videos don't fill the
// phone's memory, and it runs faster than playing the video. The sound is copied over as it is (no re-encoding).
// AreaClip.clip(file, { start, end, bps, maxSide, onPct }) → Promise<File> (an .mp4)
// Throws an error with .unsupported = true when this browser or file can't use this path (the page then
// falls back to its older method).
(function () {
  "use strict";
  var MP4BOX = "https://cdn.jsdelivr.net/npm/mp4box@2.4.1/+esm";
  var MUXER = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm";

  function unsupported(msg) { var e = new Error(msg || "unsupported"); e.unsupported = true; return e; }
  function ok() { return typeof window.VideoDecoder === "function" && typeof window.VideoEncoder === "function" && typeof window.VideoFrame === "function"; }

  // top-level boxes of the file (ftyp, moov, mdat…) without reading the video data
  async function topBoxes(file) {
    var out = {}, pos = 0, n = 0;
    while (pos + 8 <= file.size && n++ < 64) {
      var dv = new DataView(await file.slice(pos, pos + 16).arrayBuffer());
      var size = dv.getUint32(0), type = String.fromCharCode(dv.getUint8(4), dv.getUint8(5), dv.getUint8(6), dv.getUint8(7));
      if (size === 1) size = Number(dv.getBigUint64(8));
      else if (size === 0) size = file.size - pos;
      if (size < 8) break;
      if (!out[type]) out[type] = { pos: pos, size: size };
      pos += size;
    }
    if (!out.moov) throw unsupported("no moov");
    return out;
  }

  // waits until the coder has room, so only a few frames are ever in memory
  function room(coder, max) {
    if (coder.decodeQueueSize !== undefined ? coder.decodeQueueSize <= max : coder.encodeQueueSize <= max) return Promise.resolve();
    return new Promise(function (ok) {
      var t = setTimeout(function () { coder.removeEventListener("dequeue", check); ok(); }, 3000);
      var check = function () {
        var q = coder.decodeQueueSize !== undefined ? coder.decodeQueueSize : coder.encodeQueueSize;
        if (q <= max || coder.state === "closed") { clearTimeout(t); coder.removeEventListener("dequeue", check); ok(); }
      };
      coder.addEventListener("dequeue", check);
    });
  }

  async function clip(file, o) {
    if (!ok()) throw unsupported("no WebCodecs");
    var start = Math.max(0, o.start || 0), end = o.end, onPct = o.onPct || function () {};
    var lib = await import(MP4BOX), Mux = await import(MUXER);

    // 1. read just the index (ftyp + moov), wherever it sits in the file
    var boxes = await topBoxes(file);
    var mp4 = lib.createFile();
    // ftyp + moov joined into one small piece (the sample positions inside moov still point into the real file)
    var info = await new Promise(function (ok, bad) {
      var timer = setTimeout(function () { bad(unsupported("index timeout")); }, 15000);
      mp4.onReady = function (i) { clearTimeout(timer); ok(i); };
      mp4.onError = function (e) { clearTimeout(timer); bad(unsupported("index: " + e)); };
      (async function () {
        var parts = [boxes.ftyp, boxes.moov].filter(Boolean), bufs = [], total = 0;
        for (var i = 0; i < parts.length; i++) { var ab = await file.slice(parts[i].pos, parts[i].pos + parts[i].size).arrayBuffer(); bufs.push(ab); total += ab.byteLength; }
        var joined = new Uint8Array(total), off = 0;
        bufs.forEach(function (b) { joined.set(new Uint8Array(b), off); off += b.byteLength; });
        mp4.appendBuffer(lib.MP4BoxBuffer.fromArrayBuffer(joined.buffer, 0));
        mp4.flush();
      })().catch(function (e) { clearTimeout(timer); bad(unsupported("index: " + e)); });
    });
    var vt = info.videoTracks && info.videoTracks[0];
    if (!vt) throw unsupported("no video track");
    var vtrak = mp4.getTrackById(vt.id);
    var vs = vtrak.samples || [];
    if (!vs.length) throw unsupported("no samples");

    // decoder setup (H.264 / HEVC from phones)
    var entry = vtrak.mdia.minf.stbl.stsd.entries[0];
    var cbox = entry.avcC || entry.hvcC || entry.vpcC || entry.av1C;
    var description;
    if (cbox) {
      var ds = new lib.DataStream(undefined, 0, lib.Endianness.BIG_ENDIAN);
      cbox.write(ds);
      description = new Uint8Array(ds.buffer, 8); // skip the box header
    }
    var dconf = { codec: vt.codec.indexOf("hev1") === 0 ? vt.codec.replace("hev1", "hvc1") : vt.codec, codedWidth: vt.video.width, codedHeight: vt.video.height, description: description };
    var dsup = await VideoDecoder.isConfigSupported(dconf).catch(function () { return { supported: false }; });
    if (!dsup.supported) { dconf.codec = vt.codec; dsup = await VideoDecoder.isConfigSupported(dconf).catch(function () { return { supported: false }; }); }
    if (!dsup.supported) throw unsupported("can't decode " + vt.codec);

    // rotation (phones store portrait videos sideways with a turn flag)
    var m = vt.matrix || (vtrak.tkhd && vtrak.tkhd.matrix) || [65536, 0, 0, 0, 65536, 0];
    var rot = Math.round(Math.atan2(m[1], m[0]) * 180 / Math.PI); rot = ((rot % 360) + 360) % 360;
    var srcW = vt.video.width, srcH = vt.video.height;
    var turned = rot === 90 || rot === 270;
    var outW0 = turned ? srcH : srcW, outH0 = turned ? srcW : srcH;
    var maxSide = o.maxSide || 1280;
    var s = Math.min(1, maxSide / Math.max(outW0, outH0));
    var W = Math.max(2, Math.round(outW0 * s / 2) * 2), H = Math.max(2, Math.round(outH0 * s / 2) * 2);

    // encoder setup: H.264, which every phone and browser can play
    var fps = 30, econf = null;
    var cands = ["avc1.42001f", "avc1.4d401f", "avc1.4d0028", "avc1.640028", "avc1.42002a"];
    for (var c = 0; c < cands.length && !econf; c++) {
      var tryc = { codec: cands[c], width: W, height: H, bitrate: o.bps, framerate: fps, avc: { format: "avc" } };
      var es = await VideoEncoder.isConfigSupported(tryc).catch(function () { return { supported: false }; });
      if (es.supported) econf = tryc;
    }
    if (!econf) throw unsupported("can't encode H.264");

    // sound: copied straight over when it's AAC (phones record AAC)
    var at = info.audioTracks && info.audioTracks[0], audio = null;
    if (at && /^mp4a\.40/.test(at.codec)) {
      try {
        var atrak = mp4.getTrackById(at.id), ae = atrak.mdia.minf.stbl.stsd.entries[0];
        var asc = null;
        var findEsds = function (b, d) { if (!b || d > 4) return null; if (b.esds) return b.esds; var kids = b.boxes || []; for (var q = 0; q < kids.length; q++) { var r = kids[q].type === "esds" ? kids[q] : findEsds(kids[q], d + 1); if (r) return r; } return b.wave ? findEsds(b.wave, d + 1) : null; };
        var esds = findEsds(ae, 0);
        var esd = esds && esds.esd;
        var dcd = esd && esd.descs && esd.descs[0];
        var dsi = dcd && dcd.descs && dcd.descs[0];
        if (dsi && dsi.data) asc = new Uint8Array(dsi.data);
        // QuickTime files sometimes hide it: build the standard AAC-LC setup from the rate and channels
        if (!asc) {
          var rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
          var fi = rates.indexOf(at.audio.sample_rate), chn = at.audio.channel_count;
          if (fi >= 0 && chn > 0 && chn < 8) asc = new Uint8Array([(2 << 3) | (fi >> 1), ((fi & 1) << 7) | (chn << 3)]);
        }
        audio = { trak: atrak, samples: atrak.samples || [], rate: at.audio.sample_rate, ch: at.audio.channel_count, asc: asc, codec: at.codec };
        if (!audio.samples.length || !asc) audio = null;
      } catch (e) { audio = null; }
    }

    var target = new Mux.ArrayBufferTarget();
    var muxer = new Mux.Muxer({
      target: target,
      video: { codec: "avc", width: W, height: H },
      audio: audio ? { codec: "aac", numberOfChannels: audio.ch, sampleRate: audio.rate } : undefined,
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });

    var failed = null;
    var enc = new VideoEncoder({ output: function (chunk, meta) { muxer.addVideoChunk(chunk, meta); }, error: function (e) { failed = failed || e; } });
    enc.configure(econf);

    var cv = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(W, H) : Object.assign(document.createElement("canvas"), { width: W, height: H });
    var ctx = cv.getContext("2d");
    var startUs = start * 1e6, endUs = end * 1e6, nOut = 0, lastTs = -1, frameUs = 1e6 / fps;
    var dec = new VideoDecoder({
      output: function (frame) {
        try {
          var ts = frame.timestamp;
          if (ts < startUs - 1000 || ts > endUs || failed) return;
          if (lastTs >= 0 && ts - lastTs < frameUs * 0.9) return; // cap at 30 fps (iPhone 60 fps videos)
          lastTs = ts;
          ctx.save();
          ctx.translate(W / 2, H / 2); ctx.rotate(rot * Math.PI / 180);
          var dw = turned ? H : W, dh = turned ? W : H;
          ctx.drawImage(frame, -dw / 2, -dh / 2, dw, dh);
          ctx.restore();
          var vf = new VideoFrame(cv, { timestamp: Math.max(0, Math.round(ts - startUs)), duration: Math.round(frameUs) });
          enc.encode(vf, { keyFrame: nOut % (fps * 2) === 0 });
          vf.close(); nOut++;
        } finally { frame.close(); }
      },
      error: function (e) { failed = failed || e; },
    });
    dec.configure(dconf);

    // 2. feed the video, a sample at a time, starting from the key frame before the start
    var ts0 = function (smp) { return smp.cts * 1e6 / smp.timescale; };
    var first = 0;
    for (var i = 0; i < vs.length; i++) { if (ts0(vs[i]) > startUs) break; if (vs[i].is_sync) first = i; }
    var last = vs.length - 1;
    for (var j = first; j < vs.length; j++) { if (ts0(vs[j]) > endUs + 1e6 && vs[j].is_sync) { last = j - 1; break; } }
    for (var k = first; k <= last; k++) {
      if (failed) throw failed;
      var smp = vs[k];
      var data = await file.slice(smp.offset, smp.offset + smp.size).arrayBuffer();
      await room(dec, 4); await room(enc, 4);
      dec.decode(new EncodedVideoChunk({ type: smp.is_sync ? "key" : "delta", timestamp: Math.round(ts0(smp)), duration: Math.round(smp.duration * 1e6 / smp.timescale), data: data }));
      if (k % 10 === 0) onPct(Math.min(0.97, (k - first) / Math.max(1, last - first)));
    }
    await dec.flush(); dec.close();
    await enc.flush(); enc.close();
    if (failed) throw failed;
    if (!nOut) throw unsupported("no frames came out");

    // 3. the sound for the same part
    if (audio) {
      var meta = { decoderConfig: { codec: audio.codec, numberOfChannels: audio.ch, sampleRate: audio.rate, description: audio.asc } };
      var firstA = true;
      for (var a = 0; a < audio.samples.length; a++) {
        var as = audio.samples[a], ats = as.cts * 1e6 / as.timescale;
        if (ats < startUs) continue;
        if (ats > endUs) break;
        var ad = new Uint8Array(await file.slice(as.offset, as.offset + as.size).arrayBuffer());
        muxer.addAudioChunkRaw(ad, "key", Math.round(ats - startUs), Math.round(as.duration * 1e6 / as.timescale), firstA ? meta : undefined);
        firstA = false;
      }
    }
    muxer.finalize();
    onPct(1);
    return new File([target.buffer], "clip.mp4", { type: "video/mp4" });
  }

  window.AreaClip = { clip: clip, supported: ok };
})();
