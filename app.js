// Area MP3 — shared helpers used by every page.
(function () {
  const C = window.APP_CONFIG;
  const configured = !/YOUR-/.test(C.SUPABASE_URL + C.SUPABASE_ANON_KEY);

  const sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  const BUCKET = "media";   // public: covers, previews, videos, AR targets, avatars
  const SONGS = "songs";    // private: full songs (MP3/WAV), only reachable through a paid/free download link
  const siteRoot = location.origin + location.pathname.replace(/[^/]*$/, "");

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function publicUrl(path) { return path ? sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl : ""; }
  function trackLink(slug) { return siteRoot + "t.html?s=" + encodeURIComponent(slug); }
  function arLink(slug) { return siteRoot + "ar.html?s=" + encodeURIComponent(slug); }
  function profileLink(handle) { return siteRoot + "u.html?h=" + encodeURIComponent(handle); }
  function money(n, cur) {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || C.CURRENCY || "USD" }).format(+n || 0); }
    catch { return "$" + (+n || 0).toFixed(2); }
  }
  function priceLabel(t) { return +t.price > 0 ? money(t.price, t.currency) : "FREE"; }
  function artistName(p) { return p ? (p.display_name || (p.handle ? "@" + p.handle : "")) : ""; }
  function fileType(t) { return (t && t.audio_format === "wav") ? "WAV" : "MP3"; }
  function fmtTime(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }

  let toastTimer;
  function toast(msg, isErr) {
    if (isErr && /failed to fetch|networkerror|load failed/i.test(String(msg))) {
      msg = "Can't reach the server. Check your connection and try again.";
    }
    let el = document.getElementById("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
    el.textContent = msg;
    el.className = "show" + (isErr ? " err" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.className = el.className.replace("show", "")), isErr ? 5000 : 2600);
  }

  function timeAgo(d) {
    const s = Math.max(1, (Date.now() - new Date(d).getTime()) / 1000);
    if (s < 3600) return Math.max(1, Math.floor(s / 60)) + "m ago";
    if (s < 86400) return Math.floor(s / 3600) + "h ago";
    if (s < 604800) return Math.floor(s / 86400) + "d ago";
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  async function getSession() {
    if (!configured) return null;
    const { data } = await sb.auth.getSession();
    return data.session;
  }
  function signInUrl(next) {
    return "auth.html?next=" + encodeURIComponent(next || (location.pathname.split("/").pop() + location.search));
  }
  async function requireAuth() {
    const s = await getSession();
    if (!s) { location.replace(signInUrl()); return new Promise(() => {}); }
    return s;
  }

  // calls the "pay" server function (supabase/functions/pay)
  async function callFunction(action, body) {
    const s = await getSession();
    const res = await fetch(C.SUPABASE_URL + "/functions/v1/pay", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: C.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + (s ? s.access_token : C.SUPABASE_ANON_KEY),
      },
      body: JSON.stringify(Object.assign({ action }, body || {})),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "Request failed (" + res.status + ")");
    return out;
  }

  // ── header ───────────────────────────────────────────────────
  async function mountHeader(active) {
    document.title = document.title.replace("{site}", C.SITE_NAME);
    const h = document.createElement("header");
    h.className = "site-header";
    h.innerHTML =
      '<a class="brand" href="index.html" aria-label="' + esc(C.SITE_NAME) + ' home"><img class="brand-logo" src="logo.png" alt="' + esc(C.SITE_NAME) + '"></a>' +
      '<nav class="nav" id="nav"></nav>';
    document.body.prepend(h);
    if (!configured) {
      const b = document.createElement("div");
      b.className = "setup-banner";
      b.innerHTML = "SETUP › add your Supabase URL and key in <code>config.js</code> (see README)";
      document.body.prepend(b);
    }
    const nav = h.querySelector("#nav");
    const s = await getSession();
    const on = (k) => (active === k ? " on" : "");
    nav.innerHTML =
      '<a class="link' + on("explore") + '" href="explore.html">Explore</a>' +
      '<a class="link hide-sm' + on("upload") + '" href="upload.html">Upload</a>' +
      (s ? '<a class="btn btn-sm my-btn' + (active === "me" ? " on" : "") + '" href="dashboard.html">My page<span class="dot" id="inbox-dot" hidden></span></a>'
         : '<a class="btn btn-sm" href="' + signInUrl() + '">Sign in</a>');
    if (s) sb.rpc("unread_count").then(({ data }) => {
      const d = document.getElementById("inbox-dot");
      if (d && data > 0) { d.hidden = false; d.textContent = data > 9 ? "9+" : data; }
    });
  }

  // permanent page name (handle) made from the email the first time it's needed
  async function ensureHandle(session) {
    const uid = session.user.id;
    const { data: prof } = await sb.from("profiles").select("handle").eq("id", uid).maybeSingle();
    if (prof && prof.handle) return prof.handle;
    let base = (session.user.email || "").split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 24);
    if (base.length < 3) base = (base + "artist").slice(0, 24);
    for (let i = 0; i < 8; i++) {
      const guess = i === 0 ? base : base + Math.floor(10 + Math.random() * (i < 4 ? 990 : 99990));
      const { data, error } = await sb.from("profiles").update({ handle: guess })
        .eq("id", uid).is("handle", null).select("handle").maybeSingle();
      if (!error && data) return data.handle;
      if (error && error.code !== "23505") throw error;
      if (!error && !data) {
        const again = await sb.from("profiles").select("handle").eq("id", uid).maybeSingle();
        if (again.data && again.data.handle) return again.data.handle;
      }
    }
    throw new Error("Couldn't create your page name. Please try again.");
  }

  function avatarHTML(p, size) {
    const name = artistName(p) || "?";
    const style = size ? ' style="width:' + size + "px;height:" + size + "px;font-size:" + Math.round(size * 0.4) + 'px"' : "";
    if (p && p.avatar_path) return '<div class="avatar"' + style + '><img alt="" src="' + esc(publicUrl(p.avatar_path)) + '"></div>';
    return '<div class="avatar"' + style + ">" + esc(name.replace("@", "").charAt(0).toUpperCase()) + "</div>";
  }

  // crop to a centered square and save as JPEG
  function squareJpeg(file, px) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => {
        const side = Math.min(im.naturalWidth, im.naturalHeight), out = Math.min(px || 400, side);
        const cv = document.createElement("canvas"); cv.width = cv.height = out;
        cv.getContext("2d").drawImage(im, (im.naturalWidth - side) / 2, (im.naturalHeight - side) / 2, side, side, 0, 0, out, out);
        cv.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read that image."))), "image/jpeg", 0.9);
        URL.revokeObjectURL(url);
      };
      im.onerror = () => rej(new Error("Couldn't read that image. Try a JPG or PNG."));
      im.src = url;
    });
  }

  // ── preview player (bottom bar) ──────────────────────────────
  const PLAY = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z"/></svg>';
  const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4.5h4v15H6zM14 4.5h4v15h-4z"/></svg>';
  const audio = new Audio();
  audio.preload = "none";
  let current = null, bar = null;

  function playButton(t) {
    return '<button class="pbtn" type="button" data-play="' + esc(t.id) + '" aria-label="Play preview">' + PLAY + "</button>";
  }
  function syncButtons() {
    document.querySelectorAll("[data-play]").forEach((b) => {
      const on = current && b.dataset.play === current.id && !audio.paused;
      b.classList.toggle("playing", !!on);
      b.innerHTML = on ? PAUSE : PLAY;
      b.setAttribute("aria-label", on ? "Pause" : "Play preview");
    });
    if (bar) {
      bar.querySelector("[data-pp]").innerHTML = audio.paused ? PLAY : PAUSE;
      bar.querySelector(".eqw").innerHTML = audio.paused ? "" : '<span class="eq"><i></i><i></i><i></i><i></i></span>';
    }
  }
  function mountBar() {
    if (bar) return;
    bar = document.createElement("div");
    bar.className = "player";
    bar.innerHTML =
      '<div class="bar"><div></div></div>' +
      '<img alt="">' +
      '<div class="pi"><b></b><span></span></div>' +
      '<span class="eqw"></span>' +
      '<a class="btn btn-sm" data-buy href="#">Buy</a>' +
      '<button class="pbtn" type="button" data-pp aria-label="Play or pause">' + PLAY + "</button>" +
      '<button class="x" type="button" aria-label="Close player">✕</button>';
    document.body.appendChild(bar);
    document.documentElement.style.setProperty("--player-h", bar.offsetHeight + "px");
    bar.querySelector("[data-pp]").onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
    bar.querySelector(".x").onclick = () => {
      audio.pause(); bar.remove(); bar = null; current = null;
      document.documentElement.style.setProperty("--player-h", "0px"); syncButtons();
    };
    bar.querySelector(".bar").onclick = (e) => {
      if (!audio.duration) return;
      const r = e.currentTarget.getBoundingClientRect();
      audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
    };
  }
  function play(t) {
    if (current && current.id === t.id) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); return; }
    if (!t.preview_path) return toast("No preview for this track yet.", true);
    current = t;
    audio.src = publicUrl(t.preview_path);
    audio.play().catch(() => toast("Tap play again to start the preview."));
    mountBar();
    const p = t.profiles || {};
    bar.querySelector("img").src = publicUrl(t.cover_path);
    bar.querySelector(".pi b").textContent = t.title;
    bar.querySelector(".pi span").textContent = (artistName(p) ? artistName(p) + " · " : "") + "PREVIEW · " + priceLabel(t);
    const buy = bar.querySelector("[data-buy]");
    buy.textContent = +t.price > 0 ? "Buy " + money(t.price, t.currency) : "Download";
    buy.href = trackLink(t.slug);
    buy.onclick = (e) => { e.preventDefault(); App.buy(t); };
  }
  audio.addEventListener("play", syncButtons);
  audio.addEventListener("pause", syncButtons);
  audio.addEventListener("ended", syncButtons);
  audio.addEventListener("timeupdate", () => {
    if (bar && audio.duration) bar.querySelector(".bar > div").style.width = (audio.currentTime / audio.duration) * 100 + "%";
  });
  // one click handler for every play button on the page
  const trackIndex = {};
  function registerTracks(list) { (list || []).forEach((t) => (trackIndex[t.id] = t)); }
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-play]");
    if (!b) return;
    e.preventDefault();
    const t = trackIndex[b.dataset.play];
    if (t) play(t);
  });

  // track card used on Explore, profiles and the home page
  function trackCard(t, opts) {
    opts = opts || {};
    const p = t.profiles || {};
    return '<div class="tk">' +
      '<div class="cov"><a href="' + esc(trackLink(t.slug)) + '"><img loading="lazy" alt="" src="' + esc(publicUrl(t.cover_path)) + '"></a>' +
        '<span class="tag pill solid">' + esc(priceLabel(t)) + "</span>" +
        (t.audio_format === "wav" ? '<span class="pill solid" style="position:absolute;right:10px;top:10px">WAV</span>' : "") +
        playButton(t) + "</div>" +
      '<div class="body">' +
        '<a class="t" href="' + esc(trackLink(t.slug)) + '">' + esc(t.title) + "</a>" +
        (!opts.hideArtist && p.handle ? '<a class="a" href="' + esc(profileLink(p.handle)) + '">' + esc(artistName(p)) + "</a>" : "") +
        '<div class="meta">' + esc([t.genre, t.duration ? fmtTime(t.duration) : ""].filter(Boolean).join(" · ") || " ") +
"</div>" +
        (t.likes ? '<div class="meta">' + nLikes(t) + (nLikes(t) === 1 ? " LIKE" : " LIKES") + " · " + nComments(t) + (nComments(t) === 1 ? " COMMENT" : " COMMENTS") + "</div>" : "") +
        (opts.actions || "") +
      "</div></div>";
  }
  const TRACK_COLS = "id, slug, owner, title, genre, description, cover_path, preview_path, video_path, mind_path, cover_aspect, video_aspect, duration, price, currency, created_at, audio_format, profiles!owner(handle, display_name, avatar_path), likes(count), comments(count)";
  const nLikes = (t) => (t.likes && t.likes[0] && t.likes[0].count) || 0;
  const nComments = (t) => (t.comments && t.comments[0] && t.comments[0].count) || 0;
  // artist's share of each sale, as shown on the site (the real split is set on the server)
  function artistCut() { return +(100 - (+C.PLATFORM_FEE_PERCENT || 0)).toFixed(2); }

  // ── follow ───────────────────────────────────────────────────
  async function followerCount(uid) {
    const { count } = await sb.from("follows").select("follower", { count: "exact", head: true }).eq("following", uid);
    return count || 0;
  }
  // turns a button into a Follow / Following toggle. onChange(newCount delta)
  async function mountFollow(btn, artistId, onChange) {
    const s = await getSession();
    const me = s && s.user.id;
    if (me === artistId) { btn.hidden = true; return; }
    let on = false;
    if (me) {
      const { data } = await sb.from("follows").select("follower").eq("follower", me).eq("following", artistId).maybeSingle();
      on = !!data;
    }
    const paint = () => { btn.textContent = on ? "Following ✓" : "+ Follow"; btn.classList.toggle("btn-primary", !on); btn.setAttribute("aria-pressed", on); };
    paint(); btn.hidden = false;
    btn.onclick = async () => {
      if (!me) { location.href = signInUrl(); return; }
      btn.disabled = true;
      const r = on ? await sb.from("follows").delete().eq("follower", me).eq("following", artistId)
                   : await sb.from("follows").insert({ follower: me, following: artistId });
      btn.disabled = false;
      if (r.error && !/duplicate/i.test(r.error.message)) return toast("Couldn't update that. Try again.", true);
      on = !on; paint();
      if (onChange) onChange(on ? 1 : -1);
      toast(on ? "Following" : "Unfollowed");
    };
  }

  // ── buying + downloading ─────────────────────────────────────
  function startDownload(url) {
    // the link carries a "download" header, so phones save it (iPhone: Files → Downloads)
    const a = document.createElement("a");
    a.href = url; a.rel = "noopener"; a.setAttribute("download", "");
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function download(t, btn) {
    try {
      if (btn) btn.disabled = true;
      const out = await callFunction("download", { track_id: t.id });
      startDownload(out.url);
      toast("Downloading " + t.title);
      return true;
    } catch (e) { toast(e.message, true); return false; }
    finally { if (btn) btn.disabled = false; }
  }
  async function owns(t) {
    const s = await getSession();
    if (!s) return false;
    if (s.user.id === t.owner) return true;
    const { data } = await sb.from("purchases").select("id").eq("buyer", s.user.id).eq("track_id", t.id).limit(1);
    return !!(data && data.length);
  }

  function loadPayPal() {
    if (window.paypal) return Promise.resolve(window.paypal);
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(C.PAYPAL_CLIENT_ID) +
        "&intent=capture&components=buttons&disable-funding=credit,paylater&currency=" + encodeURIComponent(C.CURRENCY || "USD");
      s.dataset.ppSdk = "1";
      s.onload = () => res(window.paypal);
      s.onerror = () => rej(new Error("PayPal couldn't load. Turn off ad blockers and try again."));
      document.head.appendChild(s);
    });
  }

  // Buy button: free → download, already bought → download, otherwise PayPal checkout
  async function buy(t, onDone) {
    const s = await getSession();
    if (!s) { location.href = signInUrl("t.html?s=" + encodeURIComponent(t.slug) + "&buy=1"); return; }
    if (!(+t.price > 0) || (await owns(t))) return download(t);

    const bg = document.createElement("div");
    bg.className = "modal-bg show";
    bg.innerHTML =
      '<div class="modal">' +
        '<div class="label">Checkout</div>' +
        '<div class="row" style="gap:14px;margin:12px 0 16px;flex-wrap:nowrap">' +
          '<img alt="" src="' + esc(publicUrl(t.cover_path)) + '" style="width:64px;height:64px;object-fit:cover">' +
          '<div style="min-width:0"><b style="display:block;overflow-wrap:anywhere">' + esc(t.title) + "</b>" +
          '<span class="muted small">' + esc(artistName(t.profiles)) + " · " + fileType(t) + " download</span></div>" +
          '<span class="spacer"></span><b class="mono" style="font-size:1.3rem">' + esc(money(t.price, t.currency)) + "</b>" +
        "</div>" +
        '<div id="pp-box" style="min-height:120px"><p class="small muted mono" style="padding:30px 0;text-align:center">Loading PayPal<span class="cursor"></span></p></div>' +
        '<p class="small muted" style="margin-top:6px">Secure checkout with PayPal or any card. The artist gets ' + esc(artistCut()) + '% of every sale. The ' + fileType(t) + ' file downloads to this device right after, and stays in My page › Purchases.</p>' +
        '<p class="small" id="pp-msg" style="margin-top:10px"></p>' +
        '<button class="btn btn-ghost btn-block" id="pp-close" style="margin-top:8px">Cancel</button>' +
      "</div>";
    document.body.appendChild(bg);
    const msg = bg.querySelector("#pp-msg"), box = bg.querySelector("#pp-box");
    const close = () => bg.remove();
    bg.querySelector("#pp-close").onclick = close;
    bg.onclick = (e) => { if (e.target === bg) close(); };

    try {
      const pre = await callFunction("prepare", { track_id: t.id }); // { payee } or { owned: true }
      if (pre.owned) { close(); return download(t); }
      const pp = await loadPayPal();
      box.innerHTML = "";
      await pp.Buttons({
        style: { shape: "rect", color: "white", layout: "vertical", label: "pay", height: 48 },
        createOrder: async () => (await callFunction("create", { track_id: t.id })).id,
        onApprove: async (data) => {
          msg.textContent = "Confirming payment…";
          try {
            const out = await callFunction("capture", { order_id: data.orderID });
            box.innerHTML = '<div class="note" style="text-align:center">PAYMENT COMPLETE ✓<br><span class="small">Your download is starting.</span></div>' +
              '<a class="btn btn-primary btn-block" style="margin-top:12px" href="' + esc(out.url) + '" download>Download ' + fileType(t) + '</a>';
            msg.textContent = "";
            bg.querySelector("#pp-close").textContent = "Done";
            startDownload(out.url);
            if (onDone) onDone();
          } catch (e) {
            msg.textContent = "Payment went through but we couldn't confirm it yet (" + e.message + "). Check My page › Purchases in a minute, or contact us.";
          }
        },
        onCancel: () => { msg.textContent = "Cancelled. You weren't charged."; },
        onError: (err) => { console.error(err); msg.textContent = "PayPal hit an error. Please try again."; },
      }).render(box);
    } catch (e) {
      box.innerHTML = '<p class="small" style="padding:24px 0">' + esc(e.message) + "</p>";
    }
  }

  // ── QR + share ───────────────────────────────────────────────
  function loadQR() {
    if (window.QRCode) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  async function renderQR(el, text, size) {
    await loadQR();
    el.innerHTML = "";
    new QRCode(el, { text, width: size || 160, height: size || 160, colorDark: "#000", colorLight: "#fff", correctLevel: QRCode.CorrectLevel.M });
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); toast("Link copied"); }
    catch { prompt("Copy this link:", text); }
  }
  async function share(title, url) {
    if (navigator.share) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === "AbortError") return; } }
    copy(url);
  }

  window.App = {
    C, sb, configured, BUCKET, SONGS, siteRoot, esc, publicUrl, trackLink, arLink, profileLink, money, priceLabel, artistName, fmtTime, fileType,
    toast, timeAgo, getSession, signInUrl, requireAuth, callFunction, mountHeader, ensureHandle, avatarHTML, squareJpeg,
    play, playButton, registerTracks, trackCard, TRACK_COLS, nLikes, nComments, artistCut, followerCount, mountFollow, buy, download, owns, startDownload,
    renderQR, copy, share,
  };
})();
