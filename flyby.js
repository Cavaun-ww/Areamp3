// Home page hero background: album covers and artist photos fly toward you through a dark grid,
// with drifting letters. Blurred drops are never shown here.
(function () {
  "use strict";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var LETTERS = "AREAMP3MUSICLOCATIONFINDUNLOCKSCANEXPERIENCE0123456789".split("");

  window.Flyby = function (canvas, urls) {
    var ctx = canvas.getContext("2d");
    var W = 0, H = 0, dpr = 1, items = [], letters = [], stars = [], imgs = [], raf = 0, last = 0, t0 = performance.now();

    // load images (skip any that fail)
    urls.forEach(function (u) {
      var im = new Image();
      im.decoding = "async";
      im.onload = function () { imgs.push(im); };
      im.src = u;
    });

    function size() {
      var r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = r.width; H = r.height;
      canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    var rnd = function (a, b) { return a + Math.random() * (b - a); };
    function spawn(it, far) {
      // keep a clear lane in the middle so the logo and text stay readable
      var ang = Math.random() * Math.PI * 2, rad = rnd(0.35, 1.25);
      it.x = Math.cos(ang) * rad * 1.6; it.y = Math.sin(ang) * rad * 0.9;
      it.z = far ? rnd(2.2, 3) : rnd(0.4, 3);
      it.k = Math.floor(Math.random() * 1e6);
      it.s = rnd(0.18, 0.34);           // size in world units
      it.a = rnd(0.82, 1.25);            // aspect
      return it;
    }
    var COUNT = (canvas.getBoundingClientRect().width || 400) < 600 ? 18 : 28;
    for (var i = 0; i < COUNT; i++) items.push(spawn({}, false));
    for (var j = 0; j < 70; j++) letters.push({ x: Math.random(), y: Math.random(), c: LETTERS[(Math.random() * LETTERS.length) | 0], v: rnd(0.002, 0.008), o: rnd(0.08, 0.32) });

    function grid(time) {
      var cx = W / 2, cy = H * 0.46;
      ctx.lineWidth = 1;
      // rays from the center
      ctx.strokeStyle = "rgba(150,200,230,0.07)";
      ctx.beginPath();
      for (var a = 0; a < 24; a++) {
        var ang = (a / 24) * Math.PI * 2;
        ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(ang) * W * 1.2, cy + Math.sin(ang) * H * 1.2);
      }
      ctx.stroke();
      // rings rushing outward (the "tunnel")
      var phase = (time / 2600) % 1;
      for (var r = 0; r < 7; r++) {
        var f = Math.pow((r + phase) / 7, 2.2);
        ctx.strokeStyle = "rgba(150,200,230," + (0.1 * f).toFixed(3) + ")";
        var hw = W * 0.06 + f * W * 0.9, hh = H * 0.05 + f * H * 0.9;
        ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
      }
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      var dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      var time = now - t0;
      ctx.clearRect(0, 0, W, H);
      grid(time);

      // drifting letters
      ctx.font = "10px 'Share Tech Mono', ui-monospace, monospace";
      ctx.textAlign = "center";
      letters.forEach(function (l) {
        l.x += l.v * dt * 4; if (l.x > 1.02) { l.x = -0.02; l.y = Math.random(); }
        ctx.fillStyle = "rgba(200,220,235," + l.o + ")";
        ctx.fillText(l.c, l.x * W, l.y * H);
      });

      // covers flying toward you (far ones first)
      var cx = W / 2, cy = H * 0.46, focal = Math.min(W, H * 1.4) * 0.55;
      items.sort(function (a, b) { return b.z - a.z; });
      items.forEach(function (it) {
        it.z -= dt * 0.16;
        if (it.z < 0.12) spawn(it, true);
        if (!imgs.length) return;
        var sc = focal / it.z, w = it.s * sc, h = w / it.a;
        var x = cx + it.x * sc - w / 2, y = cy + it.y * sc - h / 2;
        if (x > W || y > H || x + w < 0 || y + h < 0) return;
        var fadeIn = Math.min(1, (3 - it.z) / 0.6), fadeOut = Math.min(1, (it.z - 0.12) / 0.35);
        var op = Math.max(0, Math.min(fadeIn, fadeOut)) * 0.75;
        // fade covers that pass behind the logo, words and buttons so they stay easy to read
        var dx = (x + w / 2 - cx) / (W * 0.40), dy = (y + h / 2 - cy) / (H * 0.40), d = dx * dx + dy * dy;
        if (d < 1) op *= Math.max(0.06, d * d);
        if (op <= 0.01) return;
        var im = imgs[it.k % imgs.length];
        ctx.globalAlpha = op;
        // cover the box like object-fit: cover
        var ir = im.naturalWidth / im.naturalHeight, br = w / h, sx = 0, sy = 0, sw = im.naturalWidth, sh = im.naturalHeight;
        if (ir > br) { sw = sh * br; sx = (im.naturalWidth - sw) / 2; } else { sh = sw / br; sy = (im.naturalHeight - sh) / 2; }
        try { ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h); } catch (e) {}
        ctx.strokeStyle = "rgba(230,240,248,0.55)"; ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.globalAlpha = 1;
      });

    }

    size();
    window.addEventListener("resize", size);
    if (reduce) { // no motion: draw one still frame once the covers load
      setTimeout(function () { frame(performance.now()); cancelAnimationFrame(raf); }, 1200);
      return;
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
    });
    raf = requestAnimationFrame(frame);
  };
})();
