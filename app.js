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
  function arLink(slug, go) { return siteRoot + "ar.html?s=" + encodeURIComponent(slug) + (go ? "&go=1" : ""); }
  function profileLink(handle) { return siteRoot + "u.html?h=" + encodeURIComponent(handle); }
  function money(n, cur) {
    try { return new Intl.NumberFormat(undefined, { style: "currency", currency: cur || C.CURRENCY || "USD" }).format(+n || 0); }
    catch { return "$" + (+n || 0).toFixed(2); }
  }
  function priceLabel(t) { return +t.price > 0 ? money(t.price, t.currency) : "FREE"; }
  // ── secret songs (locked until a listener finds the spot and scans it) ──
  function isLocked(t) { return !!t && !!t.song_lock && t.song_lock !== "none"; }
  function lockTag(t) {
    return { free: "FIND IT · FREE", listen: "FIND IT · LISTEN", buy: "FIND IT · " + money(t.price, t.currency) }[t.song_lock] || priceLabel(t);
  }
  function secretWord(t) { return t && t.has_song === false ? "video" : "song"; }
  function lockReward(t) {
    const w = secretWord(t);
    return { free: "a free download of the full " + w, listen: w === "video" ? "the video to watch in the AR camera any time" : "the full song to play in the AR camera any time", buy: "the right to buy the full " + w + " for " + money(t.price, t.currency) }[t.song_lock] || "";
  }
  async function hasUnlocked(t) {
    const s = await getSession();
    // true once they've scanned it in the AR camera (found it, for blurred songs)
    if (!s) return false;
    if (s.user.id === t.owner) return true;
    const { data } = await sb.from("unlocks").select("track_id").eq("user_id", s.user.id).eq("track_id", t.id).limit(1);
    return !!(data && data.length);
  }
  function artistName(p) { return p ? (p.display_name || (p.handle ? "@" + p.handle : "")) : ""; }
  // what listeners get: a song (MP3/WAV), a video, or both
  const hasSong = (t) => !t || t.has_song !== false;
  const hasVid = (t) => !!(t && t.has_video);
  function songType(t) { return (t && t.audio_format === "wav") ? "WAV" : "MP3"; }
  function fileType(t) { return !hasSong(t) ? "video" : hasVid(t) ? songType(t) + " + video" : songType(t); }
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
      '<a class="link hide-sm' + on("upload") + '" href="upload.html">Create</a>' +
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
    return '<button class="pbtn" type="button" data-play="' + esc(t.id) + '" aria-label="Play">' + PLAY + "</button>";
  }
  function syncButtons() {
    document.querySelectorAll("[data-play]").forEach((b) => {
      const on = current && b.dataset.play === current.id && !audio.paused;
      b.classList.toggle("playing", !!on);
      b.innerHTML = on ? PAUSE : PLAY;
      b.setAttribute("aria-label", on ? "Pause" : "Play");
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
  // everyone hears the whole song, unless it's blurred until found (then the preview plays)
  const fullCache = {};
  const canHearFull = (t) => hasSong(t) && !isLocked(t);
  function play(t, fullUrl) {
    if (current && current.id === t.id && !fullUrl) { audio.paused ? audio.play().catch(() => {}) : audio.pause(); return; }
    if (!fullUrl && canHearFull(t) && fullCache[t.id] && fullCache[t.id].exp > Date.now()) fullUrl = fullCache[t.id].url;
    const wantFull = !fullUrl && canHearFull(t);
    if (!fullUrl && isLocked(t)) {
      // blurred: silent until found. Listeners who found it (and the artist) hear the whole song.
      if (!t._found) return toast("This one stays silent until you find it in person.");
      const c = fullCache[t.id];
      if (c && c.exp > Date.now()) fullUrl = c.url;
      else {
        callFunction("stream", { track_id: t.id }).then((o) => {
          fullCache[t.id] = { url: o.url, exp: Date.now() + 50 * 60 * 1000 };
          play(t, o.url);
        }).catch((e) => toast(e.message, true));
        return;
      }
    }
    if (!fullUrl && !t.preview_path && !wantFull) return toast("Nothing to play for this one yet.", true);
    current = t;
    // start right away inside the tap (phones need that), then switch to the whole song when its link arrives
    if (fullUrl || t.preview_path) {
      audio.muted = wantFull; // quiet until the whole song is ready, so it doesn't jump
      audio.src = fullUrl || publicUrl(t.preview_path);
      audio.play().catch(() => toast("Tap play again to start it."));
    }
    mountBar();
    const p = t.profiles || {};
    bar.querySelector("img").src = publicUrl(t.cover_path);
    bar.querySelector(".pi b").textContent = t.title;
    const label = (full) => (artistName(p) ? artistName(p) + " · " : "") + (full ? "FULL SONG" : "PREVIEW · " + (isLocked(t) ? lockTag(t) : priceLabel(t)));
    bar.querySelector(".pi span").textContent = label(!!fullUrl || wantFull);
    const buy = bar.querySelector("[data-buy]");
    buy.textContent = isLocked(t) ? "Details" : +t.price > 0 ? "Buy " + money(t.price, t.currency) : "Download";
    buy.href = trackLink(t.slug);
    buy.onclick = (e) => { if (isLocked(t)) return; e.preventDefault(); App.buy(t); };
    if (wantFull) {
      callFunction("stream", { track_id: t.id }).then((o) => {
        fullCache[t.id] = { url: o.url, exp: Date.now() + 50 * 60 * 1000 };
        if (!current || current.id !== t.id) return;
        audio.src = o.url; audio.currentTime = 0; audio.muted = false;
        audio.play().catch(() => toast("Tap play again to start it."));
      }).catch(() => {
        audio.muted = false;
        if (!t.preview_path) toast("Couldn't load the song. Try again.", true);
        else if (bar) bar.querySelector(".pi span").textContent = label(false);
      });
    }
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
    return '<div class="tk' + (isLocked(t) ? " locked" : "") + '">' +
      '<div class="cov"><a href="' + esc(trackLink(t.slug)) + '"><img loading="lazy" alt=""' + (t.photo_hidden ? ' class="blurred"' : "") + ' src="' + esc(publicUrl(t.cover_path)) + '"></a>' +
        (t.photo_hidden ? '<span class="hide-badge"><i></i>FIND IT IN PERSON</span>' : "") +
        '<div class="tags">' +
        (!hasSong(t) || hasVid(t) || t.audio_format === "wav" ? '<span class="pill solid ty">' + esc(!hasSong(t) ? "VIDEO" : hasVid(t) ? songType(t) + "+VID" : "WAV") + "</span>" : "") + "</div>" +
        "</div>" + // music only plays in the AR camera
      '<div class="body">' +
        '<a class="t" href="' + esc(trackLink(t.slug)) + '">' + esc(t.title) + "</a>" +
        (!opts.hideArtist && p.handle ? '<a class="a" href="' + esc(profileLink(p.handle)) + '">' + esc(artistName(p)) + vBadge(p) + "</a>" : "") +
        (t.has_location ? '<div class="meta loc">[ ' + esc(t.place_name || "SECRET LOCATION") + (t.loc_approx ? " · AREA" : "") + " ]</div>" : "") +
        '<div class="meta">' + esc([t.genre, t.duration ? fmtTime(t.duration) : ""].filter(Boolean).join(" · ") || " ") +
"</div>" +
        (t.likes ? '<div class="meta">' + nLikes(t) + (nLikes(t) === 1 ? " LIKE" : " LIKES") + " · " + nComments(t) + (nComments(t) === 1 ? " COMMENT" : " COMMENTS") + "</div>" : "") +
        (opts.actions || "") +
      "</div></div>";
  }
  const TRACK_COLS = "id, slug, owner, title, genre, description, cover_path, preview_path, video_path, mind_path, cover_aspect, video_aspect, duration, price, currency, created_at, audio_format, has_song, has_video, pop_scale, lift, key_mode, is_private, photo_hidden, has_location, place_name, place_area, loc_approx, area_lat, area_lng, hint, song_lock, unlock_radius_m, profiles!owner(handle, display_name, avatar_path, verified, theme, bg_color, bg_image_path), likes(count), comments(count)";
  const nLikes = (t) => (t.likes && t.likes[0] && t.likes[0].count) || 0;
  const nComments = (t) => (t.comments && t.comments[0] && t.comments[0].count) || 0;
  // artist's share of each sale, as shown on the site (the real split is set on the server)
  // plans: what the artist keeps of each sale after PayPal's fee (Free or Pro)
  function artistCut(pro) { return +(100 - (+(pro ? C.PRO_FEE_PERCENT : C.FREE_FEE_PERCENT) || 0)).toFixed(2); }
  const isPro = (p) => !!(p && p.pro_until && new Date(p.pro_until) > new Date());
  // blue check: artists with more than 5 sales (set by the database)
  const CHECK_SVG = '<svg viewBox="0 0 24 24" shape-rendering="crispEdges" aria-hidden="true"><rect x="1" y="1" width="22" height="22" rx="3" fill="#1d9bf0"/><g fill="#fff"><rect x="5" y="11" width="3" height="3"/><rect x="8" y="14" width="3" height="3"/><rect x="11" y="11" width="3" height="3"/><rect x="14" y="8" width="3" height="3"/><rect x="17" y="5" width="3" height="3"/></g></svg>';
  const vBadge = (p) => (p && p.verified ? '<span class="vcheck" title="Verified: more than 5 sales" aria-label="Verified">' + CHECK_SVG + "</span>" : "");
  // artist page colors
  const THEMES = [["mono", "Mono", "#f4f4f4"], ["blue", "Blue", "#3aa0ff"], ["red", "Red", "#ff4d4d"], ["green", "Green", "#39d98a"],
    ["purple", "Purple", "#a77bff"], ["gold", "Gold", "#ffc94d"], ["pink", "Pink", "#ff5fb7"], ["cyan", "Cyan", "#3ee6e6"]];
  // page background: a color or a photo; content sits on a dark panel so it stays readable
  // same names as the accent colors, in deep shades so the page stays easy to read
  const BG_COLORS = [["#0d2a4d", "Blue"], ["#4d1414", "Red"], ["#0f3d26", "Green"], ["#2e1a52", "Purple"], ["#4a3a10", "Gold"], ["#4d1438", "Pink"], ["#0f4040", "Cyan"], ["#f4f4f4", "White"]];
  function applyBackground(p) {
    const b = document.body, img = p && p.bg_image_path, col = p && p.bg_color;
    if (img) { b.style.background = "#000 center / cover no-repeat fixed url('" + publicUrl(img) + "')"; b.classList.add("custom-bg"); }
    else if (col) { b.style.background = col; b.classList.add("custom-bg"); }
    else { b.style.background = ""; b.classList.remove("custom-bg"); }
  }
  function applyTheme(theme) {
    if (theme && theme !== "mono" && THEMES.some((x) => x[0] === theme)) document.body.dataset.theme = theme;
    else delete document.body.dataset.theme;
  }
  const proBadge = (p) => (isPro(p) ? '<span class="pill solid pro-badge" title="Pro artist">PRO</span>' : "");

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
  // play the full song in the bottom player (listeners who found it, buyers, the artist)
  async function playFull(t, btn) {
    try {
      if (btn) btn.disabled = true;
      const out = await callFunction("stream", { track_id: t.id });
      play(t, out.url);
    } catch (e) { toast(e.message, true); }
    finally { if (btn) btn.disabled = false; }
  }
  // kind "video" downloads the video; otherwise the song (or the video when there's no song)
  async function download(t, btn, kind) {
    try {
      if (btn) btn.disabled = true;
      const out = await callFunction("download", { track_id: t.id, kind: kind || "" });
      startDownload(out.url);
      toast("Downloading " + (kind === "video" ? "the video" : t.title));
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
    if (await owns(t)) return download(t);
    if (isLocked(t)) {
      const found = await hasUnlocked(t);
      if (!found) return toast("Find this song's secret spot and scan it to unlock it.", true);
      if (t.song_lock === "listen") { location.href = arLink(t.slug, true); return; } // listen in the AR camera
      if (t.song_lock === "free") return download(t);
    } else if (!(+t.price > 0)) return download(t);

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
        '<p class="small muted" style="margin-top:6px">Secure checkout with PayPal or any card. Most of what you pay goes to the artist. The ' + fileType(t) + ' file downloads to this device right after, and stays in My page › Purchases.</p>' +
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
              '<a class="btn btn-primary btn-block" style="margin-top:12px" href="' + esc(out.url) + '" download>Download ' + (hasSong(t) ? songType(t) : "video") + '</a>' +
              (hasSong(t) && hasVid(t) ? '<button class="btn btn-block" style="margin-top:8px" id="pp-vid">Download the video too</button>' : "");
            const pv = box.querySelector("#pp-vid"); if (pv) pv.onclick = () => download(t, pv, "video");
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

  // ── locations: map (Leaflet + OpenStreetMap), search, "use my location" (from Pixi Wizard) ──
  let leafletP = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletP) return leafletP;
    leafletP = new Promise((res, rej) => {
      const css = document.createElement("link");
      css.rel = "stylesheet"; css.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      js.onload = () => res(window.L); js.onerror = () => { leafletP = null; rej(new Error("Map didn't load")); };
      document.head.appendChild(js);
    });
    return leafletP;
  }
  function makeMap(el, lat, lng, zoom, opts) {
    return loadLeaflet().then((L) => {
      const map = L.map(el, Object.assign({ zoomControl: true, attributionControl: true }, opts || {})).setView([lat, lng], zoom || 15);
      // OpenStreetMap tiles, turned black & gray with CSS (.am-map) to match the site
      el.classList.add("am-map");
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      return { L, map };
    });
  }
  const pinIcon = (L) => L.divIcon({ className: "am-pin", html: "<i></i>", iconSize: [22, 22], iconAnchor: [11, 11] });
  function areaCircle(L, lat, lng) { return L.circle([lat, lng], { radius: 450, color: "#f4f4f4", weight: 1.5, dashArray: "4 4", fillColor: "#f4f4f4", fillOpacity: 0.08 }); }
  function geoSearch(q) {
    return fetch("https://nominatim.openstreetmap.org/search?format=json&limit=5&q=" + encodeURIComponent(q), { headers: { "Accept-Language": navigator.language || "en" } }).then((r) => r.json());
  }
  function geoName(lat, lng) {
    return fetch("https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=" + lat + "&lon=" + lng, { headers: { "Accept-Language": navigator.language || "en" } })
      .then((r) => r.json()).then((d) => {
        const a = d.address || {};
        const first = d.name || a.amenity || a.shop || a.tourism || a.building || (a.house_number && a.road ? a.house_number + " " + a.road : a.road);
        const city = a.city || a.town || a.village || a.suburb || a.county || "";
        return [first, city].filter(Boolean).join(", ") || (d.display_name || "").split(",").slice(0, 2).join(",");
      }).catch(() => "");
  }
  // the area around a pin (neighborhood, city, state…) so searches like "Bronx" find it
  function geoArea(lat, lng) {
    return fetch("https://nominatim.openstreetmap.org/reverse?format=json&zoom=14&lat=" + lat + "&lon=" + lng, { headers: { "Accept-Language": "en" } })
      .then((r) => r.json()).then((d) => {
        const a = d.address || {};
        return [a.neighbourhood, a.suburb, a.borough, a.city_district, a.city, a.town, a.village, a.county, a.state, a.postcode, a.country]
          .filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(", ").slice(0, 300);
      }).catch(() => null);
  }
  function hereNow(fresh) {
    return new Promise((res, rej) => {
      if (!navigator.geolocation) return rej(new Error("Location isn't available on this device."));
      navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy }),
        (e) => rej(new Error(e.code === 1 ? "Location is blocked. Allow it for this site in your browser settings." : "Couldn't get your location. Try again outside or near a window.")),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: fresh ? 0 : 60000 });
    });
  }
  function milesBetween(a, b) {
    const R = 3958.8, r = (d) => d * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function distLabel(mi) { return mi < 0.1 ? "right here" : mi < 10 ? mi.toFixed(1) + " mi away" : Math.round(mi) + " mi away"; }
  function directionsUrl(lat, lng) {
    return /iPhone|iPad|Macintosh/.test(navigator.userAgent) && "ontouchend" in document
      ? "https://maps.apple.com/?daddr=" + lat + "," + lng
      : "https://www.google.com/maps/dir/?api=1&destination=" + lat + "," + lng;
  }
  // "approximate area": move the public map point up to ~300 m in a random direction
  function fuzz(lat, lng) {
    const d = 120 + Math.random() * 180, a = Math.random() * 2 * Math.PI;
    return { lat: lat + (d * Math.cos(a)) / 111320, lng: lng + (d * Math.sin(a)) / (111320 * Math.cos(lat * Math.PI / 180)) };
  }

  // Location picker. Resolves { lat, lng, place_name, place_area, loc_approx }, null (remove), or undefined (cancel).
  function pickLocation(current) {
    return new Promise((resolve) => {
      const cur = current && current.lat != null ? current : null;
      const bg = document.createElement("div");
      bg.className = "modal-bg show loc-modal";
      bg.innerHTML =
        '<div class="modal">' +
          '<div class="label">Location</div><h3 style="margin:4px 0 6px">Where is the real image?</h3>' +
          '<p class="muted small" style="margin-bottom:12px">Pin the spot where your image lives (a mural, poster, sticker, shop window, show) so listeners can go find it and scan it.</p>' +
          '<div class="loc-search"><input class="input" id="loc-q" placeholder="Search a place or address" enterkeyhint="search"><button class="btn btn-sm" id="loc-go" type="button">Search</button></div>' +
          '<div id="loc-results" class="loc-results"></div>' +
          '<button class="btn btn-sm btn-ghost btn-block" id="loc-here" type="button" style="margin:8px 0">Use my current location</button>' +
          '<div class="note small" id="loc-warn" hidden>Don\'t pin your home. Use public places like a shop, mural or venue.</div>' +
          '<div class="loc-map" id="loc-map"><div class="muted small mono" style="padding:70px 0;text-align:center">SEARCH OR USE YOUR LOCATION TO DROP A PIN</div></div>' +
          '<p class="small muted" style="margin-top:6px">Drag the pin or tap the map to fine-tune it.</p>' +
          '<label class="field" style="margin-top:12px"><span>Place name (what listeners see)</span><input class="input" id="loc-name" maxlength="120" placeholder="e.g. Fordham Plaza mural"></label>' +
          '<label class="check" style="margin-top:12px"><input type="checkbox" id="loc-approx"> <span>Show approximate area only (about a 1/4 mile circle). The exact spot stays secret.</span></label>' +
          '<div class="row loc-actions" style="gap:8px;margin-top:16px">' +
            '<button class="btn btn-primary" id="loc-save" type="button" disabled>Save location</button>' +
            (cur ? '<button class="btn btn-ghost" id="loc-remove" type="button">Remove</button>' : "") +
            '<button class="btn btn-ghost" id="loc-cancel" type="button">Cancel</button>' +
          "</div>" +
        "</div>";
      document.body.appendChild(bg);
      const $ = (id) => bg.querySelector("#" + id);
      let point = cur ? { lat: cur.lat, lng: cur.lng } : null, map = null, marker = null;
      if (cur) { $("loc-name").value = cur.place_name || ""; $("loc-approx").checked = !!cur.loc_approx; }
      const done = (v) => { bg.remove(); resolve(v); };
      async function setPoint(lat, lng, name, fromHere) {
        point = { lat, lng };
        $("loc-save").disabled = false;
        if (fromHere) $("loc-warn").hidden = false;
        if (!map) {
          $("loc-map").innerHTML = "";
          try {
            const m = await makeMap($("loc-map"), lat, lng, 16); map = m.map;
            marker = m.L.marker([lat, lng], { draggable: true, icon: pinIcon(m.L) }).addTo(map);
            marker.on("dragend", () => { const p = marker.getLatLng(); point = { lat: p.lat, lng: p.lng }; });
            map.on("click", (e) => { marker.setLatLng(e.latlng); point = { lat: e.latlng.lat, lng: e.latlng.lng }; });
          } catch (e) { $("loc-map").innerHTML = '<div class="muted small" style="padding:20px;text-align:center">Map couldn\'t load, but your pin is set.</div>'; }
        } else { marker.setLatLng([lat, lng]); map.setView([lat, lng], 16); }
        if (name && !$("loc-name").value.trim()) $("loc-name").value = name.slice(0, 120);
        else if (!$("loc-name").value.trim()) geoName(lat, lng).then((n) => { if (n && !$("loc-name").value.trim()) $("loc-name").value = n.slice(0, 120); });
      }
      if (cur) setPoint(cur.lat, cur.lng, cur.place_name);
      async function search() {
        const q = $("loc-q").value.trim(); if (!q) return;
        $("loc-results").innerHTML = '<div class="muted small mono">SEARCHING…</div>';
        try {
          const rows = await geoSearch(q);
          $("loc-results").innerHTML = rows.length ? rows.map((r, i) => '<button type="button" data-i="' + i + '">' + esc(r.display_name) + "</button>").join("") : '<div class="muted small">No places found. Try adding the city.</div>';
          $("loc-results").querySelectorAll("button").forEach((b) => (b.onclick = () => {
            const r = rows[+b.dataset.i]; $("loc-results").innerHTML = "";
            setPoint(+r.lat, +r.lon, (r.name || r.display_name.split(",")[0]));
          }));
        } catch (e) { $("loc-results").innerHTML = '<div class="muted small">Search isn\'t working right now. Try "Use my current location".</div>'; }
      }
      $("loc-go").onclick = search;
      $("loc-q").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); search(); } });
      $("loc-here").onclick = async () => {
        $("loc-here").disabled = true; $("loc-here").textContent = "Finding you…";
        try { const p = await hereNow(true); await setPoint(p.lat, p.lng, null, true); }
        catch (e) { toast(e.message, true); }
        $("loc-here").disabled = false; $("loc-here").textContent = "Use my current location";
      };
      $("loc-save").onclick = async () => {
        if (!point) return;
        $("loc-save").disabled = true; $("loc-save").textContent = "Saving…";
        const area = await geoArea(point.lat, point.lng);
        done({ lat: point.lat, lng: point.lng, place_name: $("loc-name").value.trim().slice(0, 120) || null, place_area: area, loc_approx: $("loc-approx").checked });
      };
      if ($("loc-remove")) $("loc-remove").onclick = () => done(null);
      $("loc-cancel").onclick = () => done(undefined);
    });
  }
  // columns to save on the track for a picked location (exact spot goes in track_spots)
  function locationColumns(loc) {
    if (!loc) return { has_location: false, area_lat: null, area_lng: null, place_name: null, place_area: null, loc_approx: false };
    const shown = loc.loc_approx ? fuzz(loc.lat, loc.lng) : { lat: loc.lat, lng: loc.lng };
    return { has_location: true, area_lat: shown.lat, area_lng: shown.lng, place_name: loc.place_name, place_area: loc.place_area, loc_approx: !!loc.loc_approx };
  }

  // ── pop-out effects editor (size, lift, background removal), same as Pixi Wizard ──
  const LIFTS = [["Flat", 0], ["Low", 0.1], ["Medium", 0.25], ["High", 0.45]];
  function mountEffects(el, init) {
    init = init || {};
    const pop = Math.round((+init.pop_scale || 1) * 100);
    const liftIdx = Math.max(0, LIFTS.findIndex((l) => Math.abs(l[1] - (+init.lift || 0)) < 0.02));
    el.innerHTML =
      '<div class="fx">' +
        '<div class="fx-row"><span>Size <b class="fx-val" id="fx-pop-v">' + pop + "%</b></span>" +
          '<input type="range" id="fx-pop" min="100" max="200" step="5" value="' + pop + '"></div>' +
        '<div class="fx-hint">Over 100% spills past the image\'s edges.</div>' +
        '<div class="fx-row"><span>Lift off the image</span><div class="seg" id="fx-lift">' +
          LIFTS.map((l, i) => '<button type="button" data-i="' + i + '"' + (i === liftIdx ? ' class="on"' : "") + ">" + l[0] + "</button>").join("") + "</div></div>" +
        '<div class="fx-hint">Floats it toward the viewer so it looks 3D as they move.</div>' +
        '<div class="fx-row"><span>Remove background</span><div class="seg" id="fx-key">' +
          [["none", "Off"], ["green", "Green"], ["black", "Black"], ["white", "White"]].map((k) => '<button type="button" data-k="' + k[0] + '"' + ((init.key_mode || "none") === k[0] ? ' class="on"' : "") + ">" + k[1] + "</button>").join("") + "</div></div>" +
        '<div class="fx-hint">Film or export your visual on a solid green, black or white background and it disappears in AR, so only you float. With White, white parts of your art turn see-through too.</div>' +
      "</div>";
    const q = (s) => el.querySelector(s);
    q("#fx-pop").oninput = () => (q("#fx-pop-v").textContent = q("#fx-pop").value + "%");
    el.querySelectorAll(".seg").forEach((seg) => seg.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    }));
    return {
      get() {
        const li = +(q("#fx-lift .on") || {}).dataset.i || 0;
        return { pop_scale: (+q("#fx-pop").value) / 100, lift: LIFTS[li][1], key_mode: (q("#fx-key .on") || {}).dataset.k || "none" };
      },
    };
  }
  function effectsSummary(x) {
    const bits = [];
    if ((+x.pop_scale || 1) > 1) bits.push(Math.round(x.pop_scale * 100) + "%");
    const l = LIFTS.find((l) => Math.abs(l[1] - (+x.lift || 0)) < 0.02);
    if (l && l[1]) bits.push("lift " + l[0].toLowerCase());
    if (["green", "black", "white"].includes(x.key_mode)) bits.push(x.key_mode + " removed");
    return bits.join(" · ");
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

  // ── blurred + pinned: the image clears up only when you're there (same as Pixi Wizard) ──
  function nearReveal(t, art) {
    if (!art) return;
    const img = art.querySelector("img"), badge = art.querySelector(".hide-badge");
    if (!t.has_location || t.area_lat == null) return; // no spot: keep the "find it in person" badge
    const radiusMi = Math.max(t.loc_approx ? 1.0 : 0.15, (t.unlock_radius_m || 100) / 1609);
    if (badge) badge.remove();
    const card = document.createElement("div");
    card.className = "lock-card";
    card.innerHTML = "<b>Locked until you're there</b><span>" + (t.place_name ? "Go to " + esc(t.place_name) + " to reveal it" : "Go to the spot to reveal it") + '</span><button type="button" class="btn btn-sm btn-primary">I\'m here, unlock</button>';
    art.appendChild(card);
    const btn = card.querySelector("button"), sub = card.querySelector("span");
    function check(quiet) {
      if (!navigator.geolocation) { if (!quiet) sub.textContent = "This phone can't share its location."; return; }
      if (!quiet) { btn.disabled = true; btn.textContent = "Checking…"; }
      navigator.geolocation.getCurrentPosition((p) => {
        const d = milesBetween({ lat: p.coords.latitude, lng: p.coords.longitude }, { lat: t.area_lat, lng: t.area_lng });
        if (d <= radiusMi) {
          img.classList.remove("blurred");
          card.classList.add("done"); card.innerHTML = "<b>You found it</b>";
          setTimeout(() => { card.style.opacity = 0; setTimeout(() => card.remove(), 600); }, 2500);
        } else if (!quiet) {
          sub.textContent = "You're " + (d < 10 ? d.toFixed(1) : Math.round(d)) + " mi away. Get a little closer.";
          btn.disabled = false; btn.textContent = "Check again";
        }
      }, (e) => {
        if (quiet) return;
        sub.textContent = e.code === 1 ? "Turn on location for this site to unlock it." : "Couldn't find your location.";
        btn.disabled = false; btn.textContent = "Try again";
      }, { enableHighAccuracy: true, timeout: 12000, maximumAge: quiet ? 60000 : 0 });
    }
    btn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); check(false); };
    if (navigator.permissions && navigator.permissions.query) navigator.permissions.query({ name: "geolocation" }).then((st) => { if (st.state === "granted") check(true); }).catch(() => {});
  }

  window.App = {
    nearReveal,
    C, sb, configured, BUCKET, SONGS, siteRoot, esc, publicUrl, trackLink, arLink, profileLink, money, priceLabel, artistName, fmtTime, fileType, songType, hasSong, hasVid,
    toast, timeAgo, getSession, signInUrl, requireAuth, callFunction, mountHeader, ensureHandle, avatarHTML, squareJpeg,
    play, playButton, registerTracks, trackCard, TRACK_COLS, nLikes, nComments, artistCut, isPro, proBadge, vBadge, THEMES, applyTheme, BG_COLORS, applyBackground, loadPayPal, followerCount, mountFollow, buy, download, owns, startDownload,
    renderQR, copy, share,
    isLocked, lockTag, lockReward, secretWord, hasUnlocked, playFull,
    loadLeaflet, makeMap, pinIcon, areaCircle, pickLocation, locationColumns, hereNow, milesBetween, distLabel, directionsUrl,
    mountEffects, effectsSummary,
  };

  // ── pop-up windows hold still: freeze the page behind while one is open ──
  (function lockBehindModals() {
    let locked = false, y = 0;
    const sync = () => {
      const open = !!document.querySelector(".modal-bg.show");
      if (open === locked) return;
      locked = open;
      const b = document.body;
      if (open) {
        y = window.scrollY;
        b.style.position = "fixed"; b.style.top = -y + "px"; b.style.left = "0"; b.style.right = "0"; b.style.width = "100%";
        b.classList.add("modal-open");
      } else {
        b.style.position = b.style.top = b.style.left = b.style.right = b.style.width = "";
        b.classList.remove("modal-open");
        window.scrollTo(0, y);
      }
    };
    const start = () => new MutationObserver(sync).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "hidden"] });
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  })();
})();
