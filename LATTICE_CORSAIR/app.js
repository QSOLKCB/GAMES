/* LATTICE CORSAIR interface: title, flight loop, HUD, radar, stations, galaxy
 * map, audio and saves. Rules live in universe.js and flight.js; this file
 * reads their state and calls their functions.
 *
 * OPT-INC-001: station screens and the galaxy map rebuild only when their
 * signature (career.version, a monotonic epoch, plus the view) changes, and
 * HUD text nodes are written only when their value changes.
 */
(function () {
  "use strict";

  const U = window.CorsairUniverse, F = window.CorsairFlight, War = window.SovereignCore, Skins = window.InertiaSkins;
  const PAD = window.QsolInput.BUTTON, AXIS = window.QsolInput.AXIS;
  const SAVE_KEY = "qsol-lattice-corsair-save-v1", SETTINGS_KEY = "qsol-lattice-corsair-settings-v1";
  const FILES = ["SHIPS.TXT", "EQUIPMENT.TXT", "COMMODITIES.TXT", "OUTLAWS.TXT", "MISSIONS.TXT", "PILOTNAMES.TXT"];
  const WAR_FILES = ["EMPIRES.TXT", "HULLS.TXT", "COMPONENTS.TXT", "FACILITIES.TXT", "TECHNOLOGY.TXT", "SYSTEMNAMES.TXT"];
  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Math.round(n).toLocaleString("en-US");

  const ui = {
    app: $("app"), canvas: $("game"), hud: $("hud"), station: $("station"), map: $("map"), title: $("title"), help: $("help"), pause: $("pause"),
    dead: $("dead"), fatal: $("fatal"), toast: $("toast"), stationBody: $("stationBody"), mapSvg: $("mapSvg"), mapInfo: $("mapInfo"),
    radar: $("radar"), target: $("targetPanel"), prompt: $("prompt"), comms: $("comms"), missions: $("hudMissions"), factionGrid: $("factionGrid"),
    pilot: $("pilotInput"), difficulty: $("difficultySelect"), seed: $("seedInput"), begin: $("beginButton"), cont: $("continueButton"),
    dataSource: $("dataSource"), audioButton: $("audioButton"), deadText: $("deadText"),
  };

  // ---------------------------------------------------------------------
  // Data: bundles always work; over HTTP the live .TXT files win.
  // ---------------------------------------------------------------------
  async function fetchTexts(dir, names) {
    const out = {};
    for (const name of names) {
      const r = await fetch(`${dir}/${name}`, { cache: "no-cache" });
      if (!r.ok) throw new Error(name);
      out[name] = await r.text();
    }
    return out;
  }
  async function loadData() {
    let warTexts = window.SovereignData, texts = window.CorsairData, source = "bundled packed.js";
    if (/^https?:$/.test(location.protocol)) {
      try { texts = await fetchTexts("data", FILES); warTexts = await fetchTexts("../SOVEREIGN_LATTICE/data", WAR_FILES); source = "live data/*.TXT"; }
      catch (_e) { texts = window.CorsairData; warTexts = window.SovereignData; }
    }
    return { data: U.parseData(texts, War.parseData(warTexts)), source };
  }

  // ---------------------------------------------------------------------
  // Audio: synthesized, off until the captain turns it on.
  // ---------------------------------------------------------------------
  const audio = {
    ctx: null, on: false, last: {},
    toggle() {
      this.on = !this.on;
      if (this.on && !this.ctx) { const C = window.AudioContext || window.webkitAudioContext; if (C) this.ctx = new C(); }
      ui.audioButton.textContent = this.on ? "Audio on" : "Audio off";
      ui.audioButton.setAttribute("aria-pressed", String(this.on));
    },
    tone(f, d, type, v, slide) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + d);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + d + 0.02);
    },
    play(name, gap = 0.05) {
      if (!this.on || !this.ctx) return;
      const now = this.ctx.currentTime;
      if (this.last[name] && now - this.last[name] < gap) return;
      this.last[name] = now;
      if (name === "laser") this.tone(880, 0.07, "square", 0.025, -500);
      else if (name === "cannon") this.tone(220, 0.14, "sawtooth", 0.04, -120);
      else if (name === "missile") this.tone(300, 0.35, "triangle", 0.04, 400);
      else if (name === "hit") this.tone(140, 0.08, "square", 0.03, -60);
      else if (name === "boom") { this.tone(90, 0.5, "sawtooth", 0.06, -60); this.tone(60, 0.6, "square", 0.04, -30); }
      else if (name === "dock") { this.tone(520, 0.12, "sine", 0.05); setTimeout(() => this.tone(780, 0.18, "sine", 0.05), 110); }
      else if (name === "jump") this.tone(160, 0.6, "sawtooth", 0.05, 900);
      else if (name === "coin") this.tone(1046, 0.12, "triangle", 0.04);
      else if (name === "alarm") this.tone(440, 0.2, "square", 0.04, -200);
      else if (name === "error") this.tone(150, 0.15, "square", 0.04);
    },
  };

  // ---------------------------------------------------------------------
  // Session.
  // ---------------------------------------------------------------------
  let data = null, career = null, world = null, presentation = null;
  const session = {
    mode: "title", faction: 0, keys: new Set(), camera: { x: 0, y: 0, zoom: 1.25 }, assist: true, autopilot: false, routeTo: null,
    tab: "market", lastStationKey: "", lastMapKey: "", accumulator: 0, lastTime: 0, toastTimer: 0, comms: [], hud: {}, mapSelect: null,
    shieldWarned: false, frames: 0,
  };
  const gamepad = new window.QsolInput.GamepadReader();

  function toast(text) { ui.toast.textContent = text; ui.toast.classList.add("show"); session.toastTimer = 3; }
  function fail(error) { audio.play("error"); toast(error.message || String(error)); }
  function act(fn) { try { const r = fn(); return r; } catch (e) { fail(e); return undefined; } }
  function comms(text, color, from) {
    session.comms.push({ text, color: color || "#8a9b97", from: from || "", age: 0 });
    if (session.comms.length > 5) session.comms.shift();
    renderComms();
  }
  function renderComms() {
    ui.comms.innerHTML = session.comms.map((c) => `<li style="--c:${c.color}">${c.from ? `<b>${esc(c.from)}:</b> ` : ""}${esc(c.text)}</li>`).join("");
  }
  const factionColor = (faction, clan) => F.factionColor(career, faction, clan);
  function shipSvg(skin, color, big) {
    const h = Skins.hull(skin), shade = window.CorsairShade, pt = ([x, y]) => `${(y * 20).toFixed(1)},${(-x * 20).toFixed(1)}`;
    const [cx, cy, cl, cw] = h.canopy;
    return `<svg class="ship-svg${big ? " big" : ""}" viewBox="-24 -28 48 48" aria-hidden="true"><polygon points="${h.hull.map(pt).join(" ")}" fill="${shade(color, 0.4)}" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<polygon points="${h.deck.map(pt).join(" ")}" fill="${shade(color, 0.85)}"/>${h.engines.map(([x, y, s]) => `<circle cx="${(y * 20).toFixed(1)}" cy="${(-x * 20).toFixed(1)}" r="${(s * 20).toFixed(1)}" fill="#ffb35c"/>`).join("")}` +
      `<ellipse cx="${(cy * 20).toFixed(1)}" cy="${(-cx * 20).toFixed(1)}" rx="${(cw * 20).toFixed(1)}" ry="${(cl * 20).toFixed(1)}" fill="#c8f2ea"/></svg>`;
  }

  // ---------------------------------------------------------------------
  // Modes.
  // ---------------------------------------------------------------------
  function setMode(mode) {
    session.mode = mode;
    ui.app.classList.toggle("is-title", mode === "title");
    ui.title.hidden = mode !== "title";
    ui.hud.hidden = mode !== "flight";
    ui.station.hidden = mode !== "docked";
    ui.pause.hidden = true;
    ui.dead.hidden = mode !== "dead";
    if (mode !== "flight") { session.keys.clear(); session.autopilot = false; }
    gamepad.reset();
  }
  function saveCareer(quiet) {
    if (!career) return;
    try { localStorage.setItem(SAVE_KEY, U.serialize(career)); if (!quiet) toast(`Career saved on day ${career.day}.`); }
    catch (_e) { if (!quiet) toast("Saving is unavailable in this browser context."); }
  }
  function savedCareer() { try { return localStorage.getItem(SAVE_KEY); } catch (_e) { return null; } }

  function beginCareer() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ faction: session.faction, pilot: ui.pilot.value, difficulty: ui.difficulty.value, seed: ui.seed.value })); } catch (_e) { /* optional */ }
    career = U.createCareer({ seed: ui.seed.value, faction: session.faction, pilot: ui.pilot.value, difficulty: ui.difficulty.value, data });
    world = null;
    session.routeTo = null; session.comms = []; session.mapSelect = null;
    enterStation();
    toast(`Welcome aboard, ${career.pilot}. You fly under the ${career.war.empires[0].name} flag.`);
  }
  function continueCareer() {
    try { career = U.deserialize(savedCareer(), data); }
    catch (e) { fail(e); ui.cont.hidden = true; return; }
    world = null; session.routeTo = null; session.comms = []; session.mapSelect = null;
    if (career.docked && U.station(career, career.docked)) enterStation();
    else launch(null);
  }
  function enterStation() {
    session.tab = "market"; session.lastStationKey = "";
    setMode("docked");
    saveCareer(true);
  }
  function launch(fromSystem) {
    world = F.createFlight(career, fromSystem != null ? { fromSystem } : { station: career.docked });
    if (career.docked) U.undock(career);
    session.camera.x = world.player.x; session.camera.y = world.player.y;
    session.accumulator = 0; session.shieldWarned = false;
    setMode("flight");
    ui.canvas.focus({ preventScroll: true });
  }
  function tryDock() {
    const d = F.dockable(world);
    if (!d) return false;
    if (!d.slow) { toast("Too fast to dock: brake first (S)."); return true; }
    F.persist(world, career);
    const done = act(() => U.dock(career, d.station.id));
    if (!done) return true;
    audio.play("dock");
    for (const m of done) toast(`Contract complete: +${fmt(m.reward)} credits`);
    world = null;
    enterStation();
    return true;
  }
  function tryJump() {
    const j = F.jumpable(world);
    if (!j) return false;
    if (!j.slow) { toast("Too fast for the gate: brake first (S)."); return true; }
    F.persist(world, career);
    const from = career.system;
    act(() => U.jump(career, j.gate.to));
    audio.play("jump");
    if (session.routeTo === career.system) { session.routeTo = null; session.autopilot = false; }
    launch(from);
    toast(`${career.war.galaxy.systems[career.system].name} · day ${career.day}`);
    saveCareer(true);
    return true;
  }
  function interact() {
    if (session.mode !== "flight" || !world || world.playerDead) return;
    if (!tryDock() && !tryJump()) toast("Nothing to dock with or jump through here.");
  }

  // ---------------------------------------------------------------------
  // Route and autopilot.
  // ---------------------------------------------------------------------
  function routeNext() {
    if (session.routeTo == null || session.routeTo === career.system) return null;
    const path = War.route(career.war, career.system, session.routeTo);
    return path && path.length ? path[0] : null;
  }
  function waypoint() {
    if (!world) return null;
    const next = routeNext();
    if (next != null) { const g = world.layout.gates.find((x) => x.to === next); if (g) return { x: g.x, y: g.y, label: `Gate to ${g.name}`, gate: next }; }
    // Courier destination stations in this system.
    for (const m of career.missions) if (m.status === "active" && m.targetStation && m.targetSystem === career.system) {
      const st = world.layout.stations.find((s) => s.id === m.targetStation);
      if (st) return { x: st.x, y: st.y, label: st.name, station: st.id };
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // Flight input.
  // ---------------------------------------------------------------------
  function flightInput() {
    const k = session.keys;
    const input = {
      turn: (k.has("d") || k.has("arrowright") ? 1 : 0) - (k.has("a") || k.has("arrowleft") ? 1 : 0),
      thrust: k.has("w") || k.has("arrowup") ? 1 : 0, reverse: k.has("s") || k.has("arrowdown") ? 1 : 0,
      boost: k.has("shift"), fire: k.has(" "), missile: k.has("f"), assist: session.assist,
    };
    if (gamepad.armed) {
      const x = gamepad.axis(AXIS.LX), y = gamepad.axis(AXIS.LY);
      if (x) input.turn = Math.max(-1, Math.min(1, input.turn + Math.sign(x) * Math.pow(Math.abs(x), 1.5)));
      if (y < -0.2) input.thrust = Math.max(input.thrust, -y);
      if (y > 0.35 || gamepad.held(PAD.DOWN)) input.reverse = 1;
      if (gamepad.held(PAD.UP)) input.thrust = 1;
      input.fire ||= gamepad.held(PAD.RT);
      input.missile ||= gamepad.held(PAD.LT);
      input.boost ||= gamepad.held(PAD.EAST);
    }
    if (session.autopilot) {
      const wp = waypoint(), target = world.player.target != null ? world.ships.find((s) => s.id === world.player.target && s.alive) : null;
      const goal = wp || (target ? { x: target.x, y: target.y } : null);
      if (goal && !input.turn && !input.thrust && !input.reverse) Object.assign(input, F.autopilot(world, goal.x, goal.y));
      if (!goal) session.autopilot = false;
    }
    return input;
  }

  function handleEvents() {
    for (const e of world.events) {
      if (e.type === "fire") audio.play(e.kind, e.kind === "laser" ? 0.06 : 0.1);
      else if (e.type === "missile" && e.owner === world.player.id) audio.play("missile", 0.2);
      else if (e.type === "hit" && e.player) audio.play("hit", 0.08);
      else if (e.type === "comms") comms(e.text, factionColor(e.faction, e.clan), e.from);
      else if (e.type === "aggression") {
        U.recordAggression(career, e.faction);
        comms(`You fired on ${e.name}. ${e.faction < 0 ? "" : `${career.war.empires[e.faction].name} standing falls.`}`, "#e07a68");
      } else if (e.type === "kill") {
        audio.play("boom", 0.1);
        if (e.byPlayer) {
          const paid = U.recordKill(career, { faction: e.victim.faction, system: career.system, missionId: e.victim.missionId, name: e.victim.name });
          comms(`${e.victim.name} destroyed.`, factionColor(e.victim.faction, e.victim.clan));
          for (const m of paid) { toast(`Contract complete: +${fmt(m.reward)} credits`); audio.play("coin"); }
        }
      } else if (e.type === "loot") {
        const stored = U.addLoot(career, e);
        const parts = [];
        if (e.credits) parts.push(`${fmt(e.credits)} credits`);
        if (e.commodity != null) parts.push(stored ? `${stored} × ${data.commodities[e.commodity].name}` : "cargo (hold full)");
        toast(`Scooped ${parts.join(" and ")}`); audio.play("coin");
      } else if (e.type === "destroyed") {
        audio.play("boom");
        const lost = Math.floor(career.credits * U.DIFFICULTIES[career.difficulty].insurance / 100);
        ui.deadText.textContent = `The insurer will tow you to ${U.stationName(career, career.home)}, keep ${fmt(lost)} credits, and lend you a ship. Your cargo is gone.`;
        setMode("dead");
      }
    }
    world.events.length = 0;
  }

  // ---------------------------------------------------------------------
  // HUD (text written only on change).
  // ---------------------------------------------------------------------
  function setText(id, value) { if (session.hud[id] !== value) { session.hud[id] = value; $(id).textContent = value; } }
  function setWidth(id, frac) { const v = `${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%`; if (session.hud[id] !== v) { session.hud[id] = v; $(id).style.width = v; } }
  function renderHud() {
    const p = world.player, st = p.stats, sys = career.war.galaxy.systems[career.system];
    const owner = U.systemOwner(career, career.system);
    setText("hudSystem", sys.name);
    setText("hudOwner", `${owner >= 0 ? career.war.empires[owner].name : "unclaimed space"}${career.dens.includes(career.system) ? " · outlaw haven" : ""}${U.isFront(career, career.system) ? " · war front" : ""}`);
    setText("hudDay", String(career.day));
    setText("hudCredits", fmt(career.credits));
    setText("hudCargo", `${U.cargoUsed(career)}/${U.shipStats(data, career.ship).cargo}`);
    setWidth("barShield", st.shield ? p.shield / st.shield : 0);
    setWidth("barHull", Math.max(0, p.hull) / st.hull);
    setWidth("barEnergy", p.energy / st.energy);
    setText("hudSpeed", String(Math.round(Math.hypot(p.vx, p.vy))));
    setText("hudAmmo", String(p.ammo));
    const assist = $("hudAssist");
    if (session.hud.assist !== session.assist) { session.hud.assist = session.assist; assist.textContent = session.assist ? "ASSIST" : "NEWTONIAN"; assist.classList.toggle("on", session.assist); }
    $("hudAuto").hidden = !session.autopilot;
    // Missions.
    const mkey = `${career.version}|${career.system}`;
    if (session.hud.missions !== mkey) {
      session.hud.missions = mkey;
      ui.missions.innerHTML = career.missions.filter((m) => m.status === "active").map((m) => {
        const here = m.targetSystem === career.system, left = m.deadline - career.day;
        const progress = m.type === "patrol" || m.type === "war" ? ` ${m.progress}/${m.count}` : "";
        return `<li class="${here ? "here" : ""}">${esc(m.title)}${progress} · ${left}d${here ? " · HERE" : ` · ${esc(career.war.galaxy.systems[m.targetSystem].name)}`}</li>`;
      }).join("");
    }
    // Prompt.
    const d = F.dockable(world), j = F.jumpable(world), wp = waypoint();
    let prompt = "";
    if (d) prompt = d.slow ? `E — dock at ${d.station.name}` : `Brake to dock at ${d.station.name}`;
    else if (j) prompt = j.slow ? `E — jump to ${j.gate.name}` : `Brake to enter the gate to ${j.gate.name}`;
    else if (wp) prompt = `${wp.label} · ${Math.round(Math.hypot(wp.x - p.x, wp.y - p.y))} · J autopilot`;
    setText("prompt", prompt);
    // Target.
    const t = p.target != null ? world.ships.find((s) => s.id === p.target && s.alive) : null;
    const tkey = t ? `${t.id}|${Math.round(t.hull)}|${Math.round(t.shield)}|${Math.round(Math.hypot(t.x - p.x, t.y - p.y) / 10)}` : "";
    if (session.hud.target !== tkey) {
      session.hud.target = tkey;
      ui.target.hidden = !t;
      if (t) {
        const color = factionColor(t.faction, t.clan), hostile = F.hostile(world, career, p, t);
        const cargo = p.stats.scanner > 1 && t.loot && t.loot.commodity != null ? ` · hold: ${t.loot.qty} ${data.commodities[t.loot.commodity].name}` : "";
        ui.target.style.setProperty("--c", color);
        ui.target.innerHTML = `<b>${esc(t.name)}</b><span class="meta">${esc(F.factionName(career, t.faction, t.clan))} · ${esc(t.stats.name)} · ${t.role}${hostile ? " · HOSTILE" : ""}${cargo}</span>
          <div class="bar"><i style="width:${t.stats.shield ? t.shield / t.stats.shield * 100 : 0}%;background:var(--shield)"></i></div>
          <div class="bar"><i style="width:${Math.max(0, t.hull) / t.stats.hull * 100}%;background:var(--good)"></i></div>
          <span class="meta">${Math.round(Math.hypot(t.x - p.x, t.y - p.y))} away</span>`;
      }
    }
    if (st.shield && p.shield < st.shield * 0.15 && !session.shieldWarned) { session.shieldWarned = true; audio.play("alarm"); comms("Shields failing.", "#e07a68"); }
    if (p.shield > st.shield * 0.5) session.shieldWarned = false;
  }

  function renderRadar() {
    if (session.frames % 4) return;
    const p = world.player, range = 2400 * (p.stats.scanner || 1), k = 95 / range;
    const dot = (x, y) => [((x - p.x) * k).toFixed(1), ((y - p.y) * k).toFixed(1)];
    let html = `<circle r="96" fill="none" stroke="#183032"/><circle r="48" fill="none" stroke="#10201f"/>`;
    for (const g of world.layout.gates) { const [x, y] = dot(g.x, g.y); if (Math.hypot(x, y) < 96) html += `<circle cx="${x}" cy="${y}" r="4" fill="none" stroke="${g.to === routeNext() ? "#e8bd68" : "#5fb8a8"}" stroke-width="1.5"/>`; }
    for (const s of world.layout.stations) { const [x, y] = dot(s.x, s.y); if (Math.hypot(x, y) < 96) html += `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" fill="${s.kind === "den" ? "#c98b4a" : career.war.empires[s.faction].color}"/>`; }
    for (const k2 of world.pickups) { const [x, y] = dot(k2.x, k2.y); if (Math.hypot(x, y) < 96) html += `<circle cx="${x}" cy="${y}" r="1.6" fill="#9bddd1"/>`; }
    for (const s of world.ships) {
      if (!s.alive || s.isPlayer) continue;
      const [x, y] = dot(s.x, s.y);
      if (Math.hypot(x, y) > 96) continue;
      const hostile = F.hostile(world, career, p, s);
      html += `<circle cx="${x}" cy="${y}" r="${s.id === p.target ? 3.4 : 2.4}" fill="${hostile ? "#ff7a66" : factionColor(s.faction, s.clan)}" ${s.id === p.target ? 'stroke="#fff" stroke-width="1"' : ""}/>`;
    }
    html += `<path d="M 0 -6 L 4 4 L 0 2 L -4 4 Z" fill="#e8bd68" transform="rotate(${(p.angle * 180 / Math.PI + 90).toFixed(1)})"/>`;
    ui.radar.innerHTML = html;
  }

  // ---------------------------------------------------------------------
  // Station screens (rebuilt only when their signature changes).
  // ---------------------------------------------------------------------
  function renderStation() {
    const st = U.station(career, career.docked);
    if (!st) { launch(null); return; }
    const key = `${career.version}|${career.war.version}|${session.tab}`;
    if (key === session.lastStationKey) return;
    session.lastStationKey = key;
    const color = st.kind === "den" ? data.outlaws[st.clan].color : career.war.empires[st.faction].color;
    $("stationKicker").textContent = st.kind === "den" ? "OUTLAW HAVEN" : st.capital ? "CAPITAL STATION" : "DOCKED";
    $("stationName").textContent = st.name;
    $("stationName").style.color = color;
    $("stationSub").textContent = st.kind === "den" ? `${data.outlaws[st.clan].name} · no questions asked` : `${career.war.empires[st.faction].name} · ${st.type} world${U.isFront(career, st.system) ? " · war front" : ""} · your standing: ${U.standingLabel(U.standing(career, st.faction))}`;
    $("stationCredits").textContent = fmt(career.credits);
    $("stationCargo").textContent = `${U.cargoUsed(career)}/${U.shipStats(data, career.ship).cargo}`;
    $("stationDay").textContent = String(career.day);
    for (const b of ui.station.querySelectorAll("[data-tab]")) b.setAttribute("aria-pressed", String(b.dataset.tab === session.tab));
    const scroll = ui.stationBody.scrollTop;
    ui.stationBody.innerHTML = session.tab === "market" ? marketView(st) : session.tab === "shipyard" ? shipyardView(st)
      : session.tab === "outfitting" ? outfitView(st) : session.tab === "contracts" ? contractsView(st) : newsView();
    ui.stationBody.scrollTop = scroll;
  }

  function marketView(st) {
    const rows = U.market(career, st), cargo = career.cargo;
    const parcels = Object.keys(cargo).filter((k) => k.startsWith("Parcel "));
    return `<table class="table"><thead><tr><th>Commodity</th><th>Buy</th><th>Sell</th><th>Hold</th><th></th></tr></thead><tbody>` + rows.map((r) => {
      const c = data.commodities[r.index], held = cargo[c.name] || 0;
      const tag = st.kind === "colony" && c.produced.includes(st.type) ? `<span class="chip on">local</span>` : st.kind === "colony" && c.consumed.includes(st.type) ? `<span class="chip">in demand</span>` : "";
      return `<tr><td><b>${esc(c.name)}</b> ${tag}${c.illegal ? ' <span class="chip warn">illegal</span>' : ""}<div class="meta">${esc(c.description)}</div></td>
        <td class="num ${tag.includes("local") ? "cheap" : ""}">${r.sells ? fmt(r.buy) : "—"}</td><td class="num ${tag.includes("demand") ? "dear" : ""}">${r.buys ? fmt(r.sell) : "—"}</td><td class="num">${held || ""}</td>
        <td class="row"><button type="button" data-buy="${r.index}" data-qty="1" ${r.sells ? "" : "disabled"}>Buy 1</button><button type="button" data-buy="${r.index}" data-qty="10" ${r.sells ? "" : "disabled"}>Buy 10</button>
        <button type="button" data-sell="${r.index}" data-qty="1" ${held && r.buys ? "" : "disabled"}>Sell 1</button><button type="button" data-sell="${r.index}" data-qty="${held}" ${held && r.buys ? "" : "disabled"}>Sell all</button></td></tr>`;
    }).join("") + `</tbody></table>${parcels.length ? `<p class="meta">Sealed parcels aboard: ${parcels.length} (delivered automatically on docking at their destination).</p>` : ""}`;
  }

  function shipStatsLine(s) {
    return `<div class="stat-grid"><span>hull <b>${s.hull}</b></span><span>shield <b>${s.shield}</b></span><span>speed <b>${s.speed}</b></span><span>thrust <b>${s.thrust}</b></span><span>turn <b>${s.turn}</b></span><span>cargo <b>${s.cargo}</b></span></div>`;
  }
  function shipyardView(st) {
    const ship = career.ship, s = U.shipStats(data, ship), hull = data.ships[ship.hull], color = career.war.empires[0].color;
    const repairCost = U.repairCost(career), missingAmmo = s.ammo - ship.ammo;
    let html = `<div class="card mine"><div class="row">${shipSvg(hull.skin, color, true)}<div><h3>${esc(ship.name)} <span class="meta">${esc(hull.name)}</span></h3>${shipStatsLine(s)}
      <p class="meta">Damage ${ship.damage}/${s.hull} · missiles ${ship.ammo}/${s.ammo} · value ${fmt(U.shipValue(data, ship))}</p></div></div>
      <div class="row"><button type="button" data-action="repair" ${repairCost ? "" : "disabled"}>Repair (${fmt(repairCost)})</button><button type="button" data-action="restock" ${missingAmmo > 0 ? "" : "disabled"}>Restock missiles (${fmt(Math.max(0, missingAmmo) * 120)})</button>
      <input id="shipName" type="text" value="${esc(ship.name)}" maxlength="24" aria-label="Ship name"><button type="button" data-action="rename">Rename</button></div></div><h3 class="kicker" style="margin:14px 0 8px">Hulls for sale</h3><div class="cards">`;
    for (const h of U.shipsForSale(career, st)) {
      const preview = U.shipStats(data, { hull: h.index, weapons: [], utility: [], damage: 0, ammo: 0 });
      html += `<div class="card"><div class="row">${shipSvg(h.skin, color)}<div><h3>${esc(h.name)}</h3><p class="meta">${h.weapons} hardpoints · ${h.utility} bays · ${fmt(h.cost)} cr</p></div></div>
        <p>${esc(h.description)}</p>${shipStatsLine(preview)}<div class="row" style="margin-top:6px"><button type="button" data-buy-ship="${h.index}" ${h.index === ship.hull ? "disabled" : ""}>Buy (trade-in applied)</button></div></div>`;
    }
    return `${html}</div>`;
  }

  function outfitView(st) {
    const ship = career.ship, hull = data.ships[ship.hull];
    const fitted = (list, slot) => list.map((i, n) => `<button type="button" data-sell-slot="${slot}" data-pos="${n}" title="Sell for ${fmt(data.equipment[i].cost / 2)}">${esc(data.equipment[i].name)} ×</button>`).join("");
    let html = `<div class="card mine"><h3>Fitted to ${esc(ship.name)}</h3>
      <p class="meta">Hardpoints ${ship.weapons.length}/${hull.weapons}</p><div class="slots">${fitted(ship.weapons, "weapons") || '<span class="meta">empty</span>'}</div>
      <p class="meta">Utility bays ${ship.utility.length}/${hull.utility}</p><div class="slots">${fitted(ship.utility, "utility") || '<span class="meta">empty</span>'}</div>
      <p class="meta">Click a fitted item to sell it for half its price.</p></div><h3 class="kicker" style="margin:14px 0 8px">Equipment for sale</h3><div class="cards">`;
    for (const e of U.equipmentForSale(career, st)) {
      const full = e.weapon ? ship.weapons.length >= hull.weapons : ship.utility.length >= hull.utility;
      const stats = e.weapon ? `damage ${e.damage} · ${e.rate}/s · range ${e.range}${e.pierce ? ` · pierce ${e.pierce}%` : ""}${e.ammo ? ` · ${e.ammo} rounds` : ""}` : e.kind === "shield" ? `${e.value} points · +${e.regen}/s` : `${e.kind} +${e.value}`;
      html += `<div class="card"><h3>${esc(e.name)}</h3><p class="meta">${e.weapon ? "weapon" : "utility"} · ${stats}</p><p>${esc(e.description)}</p>
        <button type="button" data-buy-equipment="${e.index}" ${full || e.cost > career.credits ? "disabled" : ""}>Buy · ${fmt(e.cost)}</button></div>`;
    }
    return `${html}</div>`;
  }

  function contractsView(st) {
    const active = career.missions.filter((m) => m.status === "active");
    let html = `<h3 class="kicker" style="margin:0 0 8px">Your contracts (${active.length}/4)</h3>`;
    html += active.length ? `<div class="cards">${active.map((m) => `<div class="card mine"><h3>${esc(m.title)}</h3><p>${esc(m.brief)}</p>
      <p class="meta">${m.type}${m.count > 1 ? ` · ${m.progress}/${m.count}` : ""} · due day ${m.deadline} · ${fmt(m.reward)} cr</p>
      <div class="row"><button type="button" data-route="${m.targetSystem}">Plot route</button><button type="button" data-abandon="${m.id}">Abandon</button></div></div>`).join("")}</div>` : `<p class="meta">None. Take one below.</p>`;
    const offers = U.offers(career, st.id);
    html += `<h3 class="kicker" style="margin:16px 0 8px">Posted here</h3>`;
    html += offers.length ? `<div class="cards">${offers.map((m, i) => `<div class="card"><h3>${esc(m.title)}</h3><p>${esc(m.brief)}</p>
      <p class="meta">${m.type} · ${m.days} days · ${fmt(m.reward)} cr</p><button type="button" data-accept="${i}">Accept</button></div>`).join("")}</div>` : `<p class="meta">The board is empty. New postings every two days.</p>`;
    return html;
  }

  function newsView() {
    const war = career.war;
    let html = `<h3 class="kicker" style="margin:0 0 8px">Standing</h3>`;
    const bar = (v) => `<i><em style="left:${v < 0 ? 50 + v / 2 : 50}%;width:${Math.abs(v) / 2}%;background:${v < 0 ? "var(--danger)" : "var(--good)"}"></em></i>`;
    for (const e of war.empires) html += `<div class="rep"><span style="color:${e.color}">${esc(e.name)}${e.alive ? "" : " (fallen)"}</span>${bar(career.rep[e.id])}<span class="meta">${U.standingLabel(career.rep[e.id])}</span></div>`;
    html += `<div class="rep"><span style="color:#c98b4a">Outlaw clans</span>${bar(career.outlawRep)}<span class="meta">${U.standingLabel(career.outlawRep)}</span></div>`;
    html += `<p class="meta">Career: ${career.stats.kills} kills · ${career.stats.missions} contracts · ${career.stats.jumps} jumps · ${fmt(career.stats.earned)} cr earned · ${career.stats.deaths} ships lost</p>`;
    html += `<h3 class="kicker" style="margin:16px 0 8px">Lattice news</h3>` + career.news.slice().reverse().slice(0, 40).map((n) => `<div class="news"><small>DAY ${n.day}</small> ${esc(n.text)}</div>`).join("");
    return html;
  }

  // ---------------------------------------------------------------------
  // Galaxy map (SVG).
  // ---------------------------------------------------------------------
  function openMap() { ui.map.hidden = false; session.lastMapKey = ""; session.mapSelect = session.routeTo ?? career.system; renderMap(); }
  function closeMap() { ui.map.hidden = true; if (session.mode === "flight") ui.canvas.focus({ preventScroll: true }); }
  function renderMap() {
    if (ui.map.hidden) return;
    const key = `${career.version}|${career.war.version}|${session.routeTo}|${session.mapSelect}`;
    if (key === session.lastMapKey) return;
    session.lastMapKey = key;
    const g = career.war.galaxy, path = session.routeTo != null ? [career.system, ...(War.route(career.war, career.system, session.routeTo) || [])] : [];
    const onPath = new Set(); for (let i = 1; i < path.length; i++) onPath.add(`${Math.min(path[i - 1], path[i])}:${Math.max(path[i - 1], path[i])}`);
    const targets = new Set(career.missions.filter((m) => m.status === "active").map((m) => m.targetSystem));
    ui.mapSvg.setAttribute("viewBox", `0 0 ${g.width} ${g.height}`);
    let html = "";
    for (const [a, b] of g.lanes) {
      const A = g.systems[a], B = g.systems[b], hot = onPath.has(`${a}:${b}`);
      html += `<line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" stroke="${hot ? "#e8bd68" : "#1f3a3c"}" stroke-width="${hot ? 4 : 2}"/>`;
    }
    for (const s of g.systems) {
      const owner = U.systemOwner(career, s.id), color = owner >= 0 ? career.war.empires[owner].color : "#3a4a4c";
      if (owner >= 0) html += `<circle cx="${s.x}" cy="${s.y}" r="26" fill="${color}" opacity=".14"/>`;
      html += `<g class="sys" data-system="${s.id}"><circle cx="${s.x}" cy="${s.y}" r="18" fill="transparent"/><circle cx="${s.x}" cy="${s.y}" r="${s.id === career.system ? 9 : 6}" fill="${s.starColor}" stroke="${color}" stroke-width="3"/></g>`;
      if (s.id === career.system) html += `<circle cx="${s.x}" cy="${s.y}" r="16" fill="none" stroke="#9bddd1" stroke-width="2"/>`;
      if (s.id === session.mapSelect) html += `<circle cx="${s.x}" cy="${s.y}" r="20" fill="none" stroke="#e8bd68" stroke-width="2" stroke-dasharray="4 3"/>`;
      if (targets.has(s.id)) html += `<rect x="${s.x + 10}" y="${s.y - 18}" width="8" height="8" fill="#e8bd68" transform="rotate(45 ${s.x + 14} ${s.y - 14})"/>`;
      if (career.dens.includes(s.id)) html += `<text x="${s.x - 18}" y="${s.y - 14}" fill="#c98b4a">☠</text>`;
      html += `<text x="${s.x}" y="${s.y + 26}" text-anchor="middle">${esc(s.name)}</text>`;
    }
    ui.mapSvg.innerHTML = html;
    const sel = session.mapSelect != null ? g.systems[session.mapSelect] : null;
    if (sel) {
      const owner = U.systemOwner(career, sel.id), stations = U.stationsIn(career, sel.id);
      const jumps = (War.route(career.war, career.system, sel.id) || []).length;
      ui.mapInfo.innerHTML = `<h3>${esc(sel.name)}</h3><p class="meta">${owner >= 0 ? esc(career.war.empires[owner].name) : "unclaimed"}${U.isFront(career, sel.id) ? " · war front" : ""} · ${jumps} jump${jumps === 1 ? "" : "s"}</p>
        ${stations.map((s) => `<p>${esc(s.name)} <span class="meta">${s.kind === "den" ? "outlaw haven" : esc(career.war.empires[s.faction].adjective)}</span></p>`).join("") || '<p class="meta">No stations.</p>'}
        ${career.missions.filter((m) => m.status === "active" && m.targetSystem === sel.id).map((m) => `<p class="meta">Contract: ${esc(m.title)}</p>`).join("")}
        <div class="row">${sel.id !== career.system ? `<button type="button" class="primary" data-route="${sel.id}">${session.routeTo === sel.id ? "Route plotted" : "Plot route"}</button>` : '<span class="meta">You are here.</span>'}${session.routeTo != null ? '<button type="button" data-action="clear-route">Clear route</button>' : ""}</div>`;
    }
  }
  ui.mapSvg.addEventListener("click", (event) => {
    const g = event.target.closest("[data-system]");
    if (!g) return;
    session.mapSelect = Number(g.dataset.system);
    renderMap();
  });

  // ---------------------------------------------------------------------
  // Clicks.
  // ---------------------------------------------------------------------
  document.addEventListener("click", (event) => {
    const el = event.target.closest("button, [data-faction]");
    if (!el) return;
    const ds = el.dataset;
    if (ds.faction != null && session.mode === "title") {
      session.faction = Number(ds.faction);
      for (const c of ui.factionGrid.children) c.setAttribute("aria-checked", String(c.dataset.faction === ds.faction));
      return;
    }
    if (ds.action) return action(ds.action);
    if (!career) return;
    if (ds.tab) { session.tab = ds.tab; return; }
    if (ds.buy != null) { if (act(() => U.buy(career, Number(ds.buy), Number(ds.qty))) !== undefined) audio.play("coin"); return; }
    if (ds.sell != null) { const got = act(() => U.sell(career, Number(ds.sell), Number(ds.qty))); if (got !== undefined) { audio.play("coin"); toast(`Sold for ${fmt(got)} credits.`); } return; }
    if (ds.buyShip != null) { const paid = act(() => U.buyShip(career, Number(ds.buyShip))); if (paid !== undefined) toast(`New hull delivered (${fmt(paid)} credits after trade-in).`); return; }
    if (ds.buyEquipment != null) { act(() => U.buyEquipment(career, Number(ds.buyEquipment))); return; }
    if (ds.sellSlot) { act(() => U.sellEquipment(career, ds.sellSlot, Number(ds.pos))); return; }
    if (ds.accept != null) { const offer = U.offers(career, career.docked)[Number(ds.accept)]; if (offer) act(() => { U.accept(career, offer); toast("Contract accepted. Plot a route from the contract card or the map."); }); return; }
    if (ds.abandon) { act(() => U.abandon(career, ds.abandon)); return; }
    if (ds.route != null) { session.routeTo = Number(ds.route) === career.system ? null : Number(ds.route); session.mapSelect = Number(ds.route); session.lastMapKey = ""; toast(session.routeTo == null ? "That is here." : `Route plotted to ${career.war.galaxy.systems[session.routeTo].name}.`); renderMap(); return; }
  });
  function action(name) {
    switch (name) {
      case "help": ui.help.hidden = false; return;
      case "close-help": ui.help.hidden = true; return;
      case "audio": audio.toggle(); return;
      case "map": openMap(); return;
      case "close-map": closeMap(); return;
      case "clear-route": session.routeTo = null; session.lastMapKey = ""; renderMap(); return;
      case "pause": if (session.mode === "flight") ui.pause.hidden = false; return;
      case "resume": ui.pause.hidden = true; ui.canvas.focus({ preventScroll: true }); return;
      case "menu": if (world) F.persist(world, career); saveCareer(true); world = null; career = null; showTitle(); return;
      case "undock": launch(null); return;
      case "repair": { const paid = act(() => U.repair(career)); if (paid) toast(`Repaired for ${fmt(paid)} credits.`); return; }
      case "restock": { const n = act(() => U.restockMissiles(career)); if (n) toast(`${n} missiles loaded.`); return; }
      case "rename": act(() => U.renameShip(career, $("shipName").value)); return;
      case "insurance": U.destroyed(career); world = null; enterStation(); toast("A loaner waits in the bay."); return;
      default: return;
    }
  }

  // ---------------------------------------------------------------------
  // Keyboard.
  // ---------------------------------------------------------------------
  const isTyping = (t) => t && t.closest && t.closest("input, textarea, select");
  window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (!ui.help.hidden) { if (key === "escape") ui.help.hidden = true; return; }
    if (isTyping(event.target)) return;
    if (session.mode === "title") { if (key === "enter") { event.preventDefault(); ui.begin.click(); } return; }
    if (!ui.map.hidden) { if (key === "escape" || key === "m") closeMap(); return; }
    if (session.mode === "docked") {
      if (key === "l") { event.preventDefault(); launch(null); }
      else if (key === "m") openMap();
      return;
    }
    if (session.mode !== "flight") return;
    if (key === "p" || key === "escape") { ui.pause.hidden = !ui.pause.hidden; event.preventDefault(); return; }
    if (!ui.pause.hidden) return;
    if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "shift", "f"].includes(key)) { session.keys.add(key); event.preventDefault(); return; }
    if (key === "e") interact();
    else if (key === "tab") { event.preventDefault(); world.player.target = F.nextTarget(world, career, event.shiftKey ? -1 : 1, false); }
    else if (key === "r") world.player.target = F.nextTarget(world, career, 1, true);
    else if (key === "t") world.player.target = null;
    else if (key === "j") { session.autopilot = !session.autopilot; toast(session.autopilot ? "Autopilot engaged." : "Autopilot off."); }
    else if (key === "x") { session.assist = !session.assist; toast(session.assist ? "Flight assist on." : "Flight assist off: pure Newtonian."); }
    else if (key === "m") openMap();
    else if (key === "+" || key === "=") session.camera.zoom = Math.min(1.6, session.camera.zoom * 1.15);
    else if (key === "-" || key === "_") session.camera.zoom = Math.max(0.35, session.camera.zoom / 1.15);
    else if (key === "u") audio.toggle();
  });
  window.addEventListener("keyup", (event) => session.keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => { session.keys.clear(); gamepad.reset(); if (session.mode === "flight") ui.pause.hidden = false; });
  ui.canvas.addEventListener("wheel", (event) => {
    if (session.mode !== "flight") return;
    event.preventDefault();
    session.camera.zoom = Math.max(0.35, Math.min(1.6, session.camera.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
  }, { passive: false });

  // ---------------------------------------------------------------------
  // Gamepad (menus and flight).
  // ---------------------------------------------------------------------
  function pollGamepad() {
    gamepad.poll();
    if (gamepad.linked) toast("Gamepad linked: left stick fly, RT fire, A dock/jump, Start pause.");
    if (gamepad.lost && session.mode === "flight") ui.pause.hidden = false;
    if (!gamepad.armed) return;
    if (session.mode === "title") { if (gamepad.pressed(PAD.START) || gamepad.pressed(PAD.SOUTH)) ui.begin.click(); return; }
    if (session.mode === "dead") { if (gamepad.pressed(PAD.SOUTH)) action("insurance"); return; }
    if (!ui.map.hidden) { if (gamepad.pressed(PAD.EAST) || gamepad.pressed(PAD.NORTH)) closeMap(); return; }
    if (session.mode === "docked") { if (gamepad.pressed(PAD.START)) launch(null); else if (gamepad.pressed(PAD.NORTH)) openMap(); return; }
    if (session.mode !== "flight") return;
    if (gamepad.pressed(PAD.START)) { ui.pause.hidden = !ui.pause.hidden; return; }
    if (!ui.pause.hidden) return;
    if (gamepad.pressed(PAD.SOUTH)) interact();
    if (gamepad.pressed(PAD.WEST)) world.player.target = F.nextTarget(world, career, 1, true);
    if (gamepad.pressed(PAD.RB)) world.player.target = F.nextTarget(world, career, 1, false);
    if (gamepad.pressed(PAD.LB)) world.player.target = F.nextTarget(world, career, -1, false);
    if (gamepad.pressed(PAD.NORTH)) openMap();
    if (gamepad.pressed(PAD.SELECT)) session.assist = !session.assist;
    if (gamepad.pressed(PAD.R3)) session.autopilot = !session.autopilot;
  }

  // ---------------------------------------------------------------------
  // Main loop: fixed 60 Hz flight steps, interpolation-free (60 Hz camera).
  // ---------------------------------------------------------------------
  function frame(time) {
    requestAnimationFrame(frame); // schedule first: one bad frame never stops the loop
    const dt = Math.min(0.1, Math.max(0, (time - (session.lastTime || time)) / 1000));
    session.lastTime = time;
    session.frames++;
    pollGamepad();
    const flying = session.mode === "flight" && world && ui.pause.hidden && ui.map.hidden && ui.help.hidden;
    if (flying) {
      session.accumulator += dt;
      let steps = 0;
      while (session.accumulator >= F.DT && steps < 6) {
        F.step(world, career, flightInput());
        handleEvents();
        session.accumulator -= F.DT;
        steps++;
        if (session.mode !== "flight") break;
      }
      if (steps === 6) session.accumulator = 0;
    } else session.accumulator = 0;
    if (world && session.mode === "flight") {
      const p = world.player, lead = 0.35;
      const tx = p.x + p.vx * lead, ty = p.y + p.vy * lead, k = 1 - Math.exp(-dt * 6);
      session.camera.x += (tx - session.camera.x) * k; session.camera.y += (ty - session.camera.y) * k;
      renderHud();
      renderRadar();
    }
    if (session.mode === "docked") renderStation();
    if (!ui.map.hidden) renderMap();
    if (session.toastTimer > 0) { session.toastTimer -= dt; if (session.toastTimer <= 0) ui.toast.classList.remove("show"); }
    const width = ui.canvas.clientWidth || innerWidth, height = ui.canvas.clientHeight || innerHeight;
    const wp = world && session.mode === "flight" ? waypoint() : null;
    presentation.render({
      world: session.mode === "flight" || session.mode === "dead" ? world : null, camera: session.camera, width, height, time: time / 1000,
      reduced: presentation.stage.reducedMotion, seed: career ? career.seed ^ career.system : 1, waypoint: wp, routeGate: wp ? wp.gate : null,
      highlight: wp ? wp.station : null,
      factionColor: (st) => (st.kind === "den" ? data.outlaws[st.clan].color : career.war.empires[st.faction].color),
      shipColor: (s) => (s.isPlayer ? career.war.empires[0].color : factionColor(s.faction, s.clan)),
      hostile: (s) => F.hostile(world, career, world.player, s),
    });
  }

  // ---------------------------------------------------------------------
  // Title and boot.
  // ---------------------------------------------------------------------
  function showTitle() {
    setMode("title");
    ui.map.hidden = true;
    const empires = data.war.empires;
    ui.factionGrid.innerHTML = empires.map((e) => `<button class="faction-card" type="button" role="radio" aria-checked="${e.index === session.faction}" data-faction="${e.index}" style="--c:${e.color}">
      <b>${esc(e.name)}</b><small>${esc(e.race)} · ${esc(e.leader)} · ${esc(e.personality)}</small><p>${esc(e.description)}</p></button>`).join("");
    ui.cont.hidden = !savedCareer();
    ui.begin.focus();
  }
  ui.begin.addEventListener("click", () => beginCareer());
  ui.cont.addEventListener("click", () => continueCareer());
  $("randomSeed").addEventListener("click", () => {
    const words = ["DRIFT", "LEDGER", "EMBER", "TIDE", "LUMEN", "HOLLOW", "VECTOR", "SALT", "CROWN", "GATE"];
    const r = new Uint32Array(2); (window.crypto || {}).getRandomValues?.(r);
    ui.seed.value = `${words[r[0] % words.length]}-${(r[1] % 9000) + 1000}`;
  });

  async function boot() {
    presentation = new window.CorsairRenderer(ui.canvas, Skins);
    try {
      const loaded = await loadData();
      data = loaded.data;
      ui.dataSource.textContent = `Data: ${loaded.source}`;
    } catch (error) {
      ui.title.hidden = true; ui.fatal.hidden = false;
      $("fatalText").textContent = `${error.message}\n\nFix the file named above (each data/*.TXT file documents its format), then reload.`;
      return;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
      if (Number.isInteger(saved.faction) && data.war.empires[saved.faction]) session.faction = saved.faction;
      if (saved.pilot) ui.pilot.value = saved.pilot;
      if (saved.difficulty && U.DIFFICULTIES[saved.difficulty]) ui.difficulty.value = saved.difficulty;
      if (saved.seed) ui.seed.value = saved.seed;
    } catch (_e) { /* optional */ }
    showTitle();
    requestAnimationFrame(frame);
  }

  // Read-only hooks for automated browser checks.
  window.latticeCorsair = Object.freeze({
    get career() { return career; }, get world() { return world; }, get session() { return session; }, get renderer() { return presentation; },
    get data() { return data; }, launch, interact, openMap, closeMap,
  });
  boot();
})();
