/* SOVEREIGN LATTICE interface: title screen, galaxy map input, panels, audio,
 * saves and the render loop. All rules live in core.js; this file only reads
 * state and issues orders through the core's order functions.
 *
 * OPT-INC-001: the side panel and star labels are rebuilt only when their
 * complete input signature changes. Signatures include state.version, a
 * monotonic epoch that every core mutation advances, so an A -> B -> A edit
 * still redraws.
 */
(function () {
  "use strict";

  const Core = window.SovereignCore;
  const Skins = window.InertiaSkins;
  const PAD = window.QsolInput.BUTTON;
  const AXIS = window.QsolInput.AXIS;
  const SAVE_KEY = "qsol-sovereign-lattice-save-v1";
  const SETTINGS_KEY = "qsol-sovereign-lattice-settings-v1";
  const ME = 0;
  const DATA_FILES = ["EMPIRES.TXT", "HULLS.TXT", "COMPONENTS.TXT", "FACILITIES.TXT", "TECHNOLOGY.TXT", "SYSTEMNAMES.TXT"];

  const $ = (id) => document.getElementById(id);
  const ui = {
    app: $("app"), canvas: $("game"), labels: $("labels"), topbar: $("topbar"), panel: $("panel"), report: $("report"),
    toast: $("toast"), modeHint: $("modeHint"), title: $("title"), help: $("help"), gameover: $("gameover"), fatal: $("fatal"),
    empireGrid: $("empireGrid"), size: $("sizeSelect"), rivals: $("rivalSelect"), turns: $("turnSelect"), seed: $("seedInput"),
    begin: $("beginButton"), cont: $("continueButton"), dataSource: $("dataSource"), audioButton: $("audioButton"),
    empireName: $("empireName"), empireSwatch: $("empireSwatch"), turnReadout: $("turnReadout"), minerals: $("mineralsReadout"),
    energy: $("energyReadout"), researchLabel: $("researchLabel"), research: $("researchReadout"), researchBar: $("researchBar"),
    endTurn: $("endTurn"), gameoverHeading: $("gameoverHeading"), gameoverKicker: $("gameoverKicker"), gameoverBody: $("gameoverBody"),
  };

  const esc = (text) => String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const roman = (n) => Core.roman(n);
  const fmt = (n) => (Math.abs(n) >= 10000 ? `${Math.round(n / 1000)}k` : String(n));
  const signed = (n) => (n >= 0 ? `+${fmt(n)}` : `−${fmt(-n)}`);

  // ---------------------------------------------------------------------
  // Data: bundled texts always work; over HTTP the live .TXT files win.
  // ---------------------------------------------------------------------
  async function loadData() {
    let texts = window.SovereignData, source = "bundled data/packed.js";
    if (/^https?:$/.test(location.protocol)) {
      try {
        const live = {};
        for (const name of DATA_FILES) {
          const response = await fetch(`data/${name}`, { cache: "no-cache" });
          if (!response.ok) throw new Error(name);
          live[name] = await response.text();
        }
        texts = live;
        source = "live data/*.TXT";
      } catch (_error) { /* keep the bundle */ }
    }
    return { data: Core.parseData(texts), source };
  }

  // ---------------------------------------------------------------------
  // Audio: tiny synthesized cues, off until the player turns them on.
  // ---------------------------------------------------------------------
  const audio = {
    ctx: null, on: false,
    toggle() {
      this.on = !this.on;
      if (this.on && !this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (Ctx) this.ctx = new Ctx();
      }
      ui.audioButton.textContent = this.on ? "Audio on" : "Audio off";
      ui.audioButton.setAttribute("aria-pressed", String(this.on));
      if (this.on) this.play("click");
    },
    tone(freq, dur, type, vol, delay) {
      if (!this.on || !this.ctx) return;
      const t = this.ctx.currentTime + (delay || 0), o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    },
    play(name) {
      if (name === "click") this.tone(660, 0.05, "square", 0.03);
      else if (name === "turn") { this.tone(330, 0.18, "triangle", 0.05); this.tone(495, 0.22, "triangle", 0.04, 0.09); }
      else if (name === "battle") { this.tone(110, 0.3, "sawtooth", 0.05); this.tone(82, 0.4, "square", 0.03, 0.08); }
      else if (name === "research") { [523, 659, 784].forEach((f, i) => this.tone(f, 0.18, "sine", 0.04, i * 0.08)); }
      else if (name === "order") this.tone(440, 0.07, "triangle", 0.04);
      else if (name === "error") this.tone(150, 0.15, "square", 0.04);
    },
  };

  // ---------------------------------------------------------------------
  // Session state (presentation only).
  // ---------------------------------------------------------------------
  let data = null;
  let state = null;
  let presentation = null;
  const session = {
    empireChoice: 0, camera: { x: 500, y: 350, zoom: 1 }, selection: { system: null, fleet: null }, tab: "system",
    moveMode: false, hover: null, preview: null, pulses: [], draft: null, cursor: null, dragging: null,
    lastPanelKey: "", lastLabelKey: "", lastTopKey: "", keys: new Set(), lastTime: 0, toastTimer: 0, reportTurn: 0,
  };
  const gamepad = new window.QsolInput.GamepadReader();

  function toast(text) {
    ui.toast.textContent = text;
    ui.toast.classList.add("show");
    session.toastTimer = 2.6;
  }
  function fail(error) { audio.play("error"); toast(error.message || String(error)); }
  function act(fn) {
    try { fn(); audio.play("order"); } catch (error) { fail(error); }
  }

  // ---------------------------------------------------------------------
  // Hull art: INERTIA ZERO outlines painted in an empire colour.
  // ---------------------------------------------------------------------
  function shipSvg(skin, color, big) {
    const h = Skins.hull(skin), shade = window.LatticeShade;
    const pt = ([x, y]) => `${(y * 20).toFixed(1)},${(-x * 20).toFixed(1)}`;
    const [cx, cy, cl, cw] = h.canopy;
    return `<svg class="ship-svg${big ? " big" : ""}" viewBox="-24 -28 48 48" aria-hidden="true">` +
      `<polygon points="${h.hull.map(pt).join(" ")}" fill="${shade(color, 0.38)}" stroke="${color}" stroke-width="1.2" stroke-linejoin="round"/>` +
      `<polygon points="${h.deck.map(pt).join(" ")}" fill="${shade(color, 0.85)}"/>` +
      h.engines.map(([x, y, s]) => `<circle cx="${(y * 20).toFixed(1)}" cy="${(-x * 20).toFixed(1)}" r="${(s * 20).toFixed(1)}" fill="#ffb35c"/>`).join("") +
      `<ellipse cx="${(cy * 20).toFixed(1)}" cy="${(-cx * 20).toFixed(1)}" rx="${(cw * 20).toFixed(1)}" ry="${(cl * 20).toFixed(1)}" fill="#c8f2ea"/></svg>`;
  }

  // ---------------------------------------------------------------------
  // Title screen.
  // ---------------------------------------------------------------------
  function readSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (_e) { return {}; }
  }
  function writeSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ empire: session.empireChoice, size: ui.size.value, rivals: ui.rivals.value, turns: ui.turns.value, seed: ui.seed.value }));
    } catch (_e) { /* optional */ }
  }
  function savedGame() {
    try { return localStorage.getItem(SAVE_KEY); } catch (_e) { return null; }
  }
  function buildTitle() {
    ui.empireGrid.innerHTML = data.empires.map((e) => `
      <button class="empire-card" type="button" role="radio" aria-checked="${e.index === session.empireChoice}" data-empire="${e.index}" style="--c:${e.color}">
        <b>${esc(e.name)}</b><small>${esc(e.race)} · ${esc(e.leader)} · ${esc(e.homeworld)} worlds · ${esc(e.personality)}</small>
        <p>${esc(e.description)}</p>
      </button>`).join("");
    ui.cont.hidden = !savedGame();
  }
  function showTitle() {
    ui.app.classList.add("is-title");
    ui.title.hidden = false;
    ui.topbar.hidden = true; ui.panel.hidden = true; ui.report.hidden = true; ui.gameover.hidden = true; ui.modeHint.hidden = true;
    state = null;
    ui.labels.innerHTML = "";
    session.lastLabelKey = "";
    buildTitle();
    ui.begin.focus();
  }
  function startGame(newState) {
    state = newState;
    ui.title.hidden = true; ui.app.classList.remove("is-title");
    ui.topbar.hidden = false; ui.panel.hidden = false;
    const home = state.galaxy.systems[state.empires[ME].capital];
    // Offset so the home star is not hidden behind the side panel.
    const panelShift = viewSize().width > 860 ? 200 : 0;
    session.camera = { x: home.x + panelShift / 1.1, y: home.y, zoom: 1.1 };
    session.selection = { system: home.id, fleet: null };
    session.tab = "system"; session.moveMode = false; session.draft = null; session.pulses = [];
    session.lastPanelKey = ""; session.lastLabelKey = ""; session.lastTopKey = "";
    gamepad.reset();
    ui.canvas.focus({ preventScroll: true });
    toast(`${state.empires[ME].leader} of the ${state.empires[ME].name}, the lattice awaits.`);
  }
  function newGame() {
    writeSettings();
    startGame(Core.createGame({ seed: ui.seed.value, size: ui.size.value, rivals: Number(ui.rivals.value), empire: session.empireChoice, maxTurns: Number(ui.turns.value), data }));
    // In the core the player is always empire slot 0; data index is the chosen empire.
  }
  function continueGame() {
    try { startGame(Core.deserialize(savedGame(), data)); }
    catch (error) { fail(error); ui.cont.hidden = true; }
  }
  function saveGame(quiet) {
    if (!state) return;
    try { localStorage.setItem(SAVE_KEY, Core.serialize(state)); if (!quiet) toast(`Saved turn ${state.turn}.`); }
    catch (_e) { if (!quiet) toast("Saving is unavailable in this browser context."); }
  }

  // ---------------------------------------------------------------------
  // Camera and picking.
  // ---------------------------------------------------------------------
  function viewSize() { return { width: ui.canvas.clientWidth || window.innerWidth, height: ui.canvas.clientHeight || window.innerHeight }; }
  function toWorld(px, py) {
    const { width, height } = viewSize(), c = session.camera;
    return { x: c.x + (px - width / 2) / c.zoom, y: c.y + (py - height / 2) / c.zoom };
  }
  function toScreen(x, y) {
    const { width, height } = viewSize(), c = session.camera;
    return { x: (x - c.x) * c.zoom + width / 2, y: (y - c.y) * c.zoom + height / 2 };
  }
  function clampCamera() {
    if (!state) return;
    const g = state.galaxy, c = session.camera;
    c.zoom = Math.max(0.4, Math.min(2.8, c.zoom));
    c.x = Math.max(-100, Math.min(g.width + 100, c.x));
    c.y = Math.max(-100, Math.min(g.height + 100, c.y));
  }
  function zoomAt(px, py, factor) {
    const before = toWorld(px, py);
    session.camera.zoom *= factor;
    clampCamera();
    const after = toWorld(px, py);
    session.camera.x += before.x - after.x;
    session.camera.y += before.y - after.y;
    clampCamera();
  }
  function orbitPositions() {
    const out = [], counts = new Map(), g = state.galaxy, visible = state.visible[ME];
    const lists = new Map();
    for (const f of state.fleets) {
      if (f.progress > 0) continue;
      if (f.owner !== ME && !visible[f.system]) continue;
      const list = lists.get(f.system) || [];
      list.push(f); lists.set(f.system, list);
    }
    for (const [system, list] of lists) {
      const sys = g.systems[system];
      list.forEach((fleet, i) => {
        const angle = -Math.PI / 2 + (i - (list.length - 1) / 2) * 0.62;
        out.push({ fleet, x: sys.x + Math.cos(angle) * 24, y: sys.y + Math.sin(angle) * 24 });
      });
      counts.set(system, list.length);
    }
    return out;
  }
  function pickSystem(world) {
    let best = null, bestD = Infinity;
    for (const sys of state.galaxy.systems) {
      const d = Math.hypot(sys.x - world.x, sys.y - world.y);
      if (d < bestD) { best = sys.id; bestD = d; }
    }
    return bestD <= 26 / Math.min(1, session.camera.zoom) ? best : null;
  }
  function pickFleet(world) {
    let best = null, bestD = Infinity;
    for (const p of orbitPositions()) {
      const d = Math.hypot(p.x - world.x, p.y - world.y);
      if (d < bestD) { best = p.fleet; bestD = d; }
    }
    return bestD <= 11 ? best : null;
  }
  function focusSystem(id) {
    const sys = state.galaxy.systems[id];
    session.camera.x = sys.x; session.camera.y = sys.y;
  }

  // ---------------------------------------------------------------------
  // Selection and orders.
  // ---------------------------------------------------------------------
  function selectSystem(id) {
    session.selection = { system: id, fleet: null };
    session.tab = "system";
    session.moveMode = false;
    audio.play("click");
  }
  function selectFleet(fleet) {
    session.selection = { system: fleet.progress ? null : fleet.system, fleet: fleet.id };
    session.tab = "fleet";
    session.moveMode = false;
    audio.play("click");
  }
  function selectedFleet() {
    return session.selection.fleet != null ? state.fleets.find((f) => f.id === session.selection.fleet) || null : null;
  }
  function moveSelectedTo(system) {
    const fleet = selectedFleet();
    if (!fleet || fleet.owner !== ME) { toast("Select one of your fleets first."); return; }
    act(() => {
      Core.orderMove(state, ME, fleet.id, system);
      const turns = etaTurns(fleet);
      toast(`${fleet.name} ordered to ${state.galaxy.systems[system].name}${turns ? ` — about ${turns} turn${turns === 1 ? "" : "s"}` : ""}.`);
    });
    session.moveMode = false;
  }
  function etaTurns(fleet) {
    const speed = Core.fleetStats(state, fleet).speed;
    if (!speed || !fleet.path.length) return 0;
    let total = -fleet.progress, from = fleet.system;
    for (const step of fleet.path) { total += Core.distance(state, from, step); from = step; }
    return Math.max(1, Math.ceil(total / speed));
  }
  function idleFleets() {
    return state.fleets.filter((f) => f.owner === ME && f.progress === 0 && f.order.type === "idle").sort((a, b) => a.id - b.id);
  }
  function cycleIdle(direction) {
    const list = idleFleets();
    if (!list.length) { toast("No idle fleets."); return; }
    const current = list.findIndex((f) => f.id === session.selection.fleet);
    const next = list[(current + direction + list.length) % list.length];
    selectFleet(next);
    focusSystem(next.system);
  }
  function cycleColony() {
    const list = Core.coloniesOf(state, ME).sort((a, b) => a.id - b.id);
    if (!list.length) return;
    const current = list.findIndex((c) => c.system === session.selection.system);
    const next = list[(current + 1) % list.length];
    selectSystem(next.system);
    focusSystem(next.system);
  }

  function endTurn() {
    if (!state || state.over) return;
    ui.endTurn.classList.add("busy");
    const events = Core.endTurn(state);
    ui.endTurn.classList.remove("busy");
    saveGame(true);
    const mineEvents = events.filter(relevant);
    session.pulses = [];
    let battle = false, research = false;
    for (const e of mineEvents) {
      if (e.type === "battle") { battle = true; session.pulses.push({ system: e.system, life: 1, color: "#d36f62" }); }
      if (e.type === "capture") session.pulses.push({ system: e.system, life: 1, color: "#e8bd68" });
      if (e.type === "research" && e.empire === ME) research = true;
    }
    audio.play(battle ? "battle" : research ? "research" : "turn");
    showReport(mineEvents);
    if (session.selection.fleet != null && !selectedFleet()) session.selection.fleet = null;
    if (state.over) showGameOver();
  }

  function relevant(e) {
    if (e.empire === ME) return true;
    if (e.involves && e.involves.includes(ME)) return true;
    if (e.type === "eliminated") return true;
    return e.system != null && state.empires[ME].known[e.system] && (e.type === "capture" || e.type === "battle");
  }

  function showReport(events) {
    if (!events.length) { ui.report.hidden = true; return; }
    const order = { capture: 0, eliminated: 0, battle: 1, invasion: 2, colonized: 3, research: 4, ruins: 4, built: 5 };
    const sorted = events.slice().sort((a, b) => (order[a.type] ?? 6) - (order[b.type] ?? 6));
    ui.report.innerHTML = `<button type="button" class="close" data-action="close-report" aria-label="Close report">×</button>` +
      `<h3>TURN ${state.turn - 1} REPORT</h3>` + sorted.slice(0, 9).map((e) => `<p>${esc(e.text)}</p>`).join("") +
      (sorted.length > 9 ? `<p class="meta">+${sorted.length - 9} more in the log (L)</p>` : "");
    ui.report.hidden = false;
  }

  function showGameOver() {
    const winner = state.winner != null ? state.empires[state.winner] : null;
    const won = state.winner === ME;
    ui.gameoverKicker.textContent = won ? "THE LATTICE IS YOURS" : "THE LATTICE SETTLES";
    ui.gameoverHeading.textContent = won ? "Victory" : state.empires[ME].alive ? "Outscored" : "Defeat";
    const rows = state.empires.slice().sort((a, b) => Core.score(state, b) - Core.score(state, a)).map((e) =>
      `<tr><td><span class="owner" style="background:${e.color}"></span>${esc(e.name)}</td><td>${e.alive ? "standing" : "fallen"}</td><td>${Core.score(state, e)}</td></tr>`).join("");
    ui.gameoverBody.innerHTML = `<p>${winner ? `${esc(winner.name)} ${won ? "rules the lattice" : "prevails"} on turn ${state.turn - 1}.` : "No empire remains."}</p>` +
      `<table class="score-table"><thead><tr><th>Empire</th><th>Status</th><th>Score</th></tr></thead><tbody>${rows}</tbody></table>`;
    ui.gameover.hidden = false;
  }

  // ---------------------------------------------------------------------
  // Top bar.
  // ---------------------------------------------------------------------
  function renderTopbar() {
    const e = state.empires[ME], key = `${state.version}`;
    if (session.lastTopKey === key) return;
    session.lastTopKey = key;
    const income = Core.empireIncome(state, e);
    ui.empireName.textContent = e.name;
    ui.empireSwatch.style.background = e.color;
    ui.empireSwatch.style.color = e.color;
    ui.turnReadout.textContent = `Turn ${state.turn} / ${state.settings.maxTurns} · ${e.leader}`;
    ui.minerals.innerHTML = `${fmt(e.minerals)} <em>${signed(income.minerals)}</em>`;
    ui.energy.innerHTML = `${fmt(e.energy)} <em class="${income.energy < 0 ? "neg" : ""}">${signed(income.energy)}</em>`;
    if (e.researchField) {
      const next = e.tech[e.researchField] + 1, cost = Core.techCost(data, e.researchField, next);
      ui.researchLabel.textContent = `RESEARCH · ${data.techs[e.researchField].name.toUpperCase()} ${next}`;
      ui.research.innerHTML = `${fmt(e.researchPoints)}/${fmt(cost)} <em>${signed(income.research)}</em>`;
      ui.researchBar.style.width = `${Math.min(100, e.researchPoints / cost * 100)}%`;
    } else {
      ui.researchLabel.textContent = "RESEARCH";
      ui.research.textContent = "complete";
      ui.researchBar.style.width = "100%";
    }
    ui.endTurn.disabled = state.over;
  }

  // ---------------------------------------------------------------------
  // Side panel. Rebuilt only when its signature changes (OPT-INC-001).
  // ---------------------------------------------------------------------
  function panelKey() {
    return [state.version, session.tab, session.selection.system, session.selection.fleet, session.moveMode,
      session.draft ? JSON.stringify(session.draft) : ""].join("|");
  }
  function renderPanel() {
    const key = panelKey();
    if (key === session.lastPanelKey) return;
    session.lastPanelKey = key;
    const scroll = ui.panel.scrollTop;
    const tabs = ["system", "fleet", "research", "designs", "empires", "log"];
    let html = `<div class="tabs">${tabs.map((t) => `<button type="button" data-tab="${t}" aria-pressed="${session.tab === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>`;
    if (session.tab === "system") html += systemPanel();
    else if (session.tab === "fleet") html += fleetPanel();
    else if (session.tab === "research") html += researchPanel();
    else if (session.tab === "designs") html += designPanel();
    else if (session.tab === "empires") html += empiresPanel();
    else html += logPanel();
    ui.panel.innerHTML = html;
    ui.panel.scrollTop = scroll;
    for (const b of document.querySelectorAll(".topnav [data-tab]")) b.setAttribute("aria-pressed", String(b.dataset.tab === session.tab));
  }

  function planetLine(e, planet) {
    const hab = Core.habitability(e, planet.type);
    if (Core.isOutpostType(planet.type)) return e.tech.colonization >= 2 ? "outpost site" : "outpost (Colonization 2)";
    return hab ? `habitable ${hab}% · max pop ${Core.maxPop(e, planet, 0, data)}` : "uninhabitable for us";
  }

  function systemPanel() {
    const id = session.selection.system;
    if (id == null) return `<p class="sub">Select a star on the map.</p>`;
    const sys = state.galaxy.systems[id], me = state.empires[ME];
    if (!me.known[id]) {
      return `<h2>${esc(sys.name)}</h2><p class="sub">${esc(sys.star)} star · unexplored</p>
        <p>No survey data. Send a scout (Pathfinder) here to chart it.</p>${fleetsHere(id)}`;
    }
    let html = `<h2>${esc(sys.name)}</h2><p class="sub">${esc(sys.star)} star · ${sys.planets.length} planet${sys.planets.length === 1 ? "" : "s"}${sys.ruins && !state.ruinsClaimed.includes(id) ? " · ancient beacon" : ""}</p>`;
    const colonyShips = state.fleets.filter((f) => f.owner === ME && f.system === id && f.progress === 0 && Core.fleetStats(state, f).colony);
    sys.planets.forEach((planet, i) => {
      const colony = Core.colonyAt(state, id, i);
      const mine = colony && colony.owner === ME;
      html += `<div class="card${mine ? " mine" : ""}"><div class="row"><b>${esc(sys.name)} ${roman(i + 1)}</b>
        <span class="chip">${planet.type}</span><span class="chip">size ${planet.size}</span><span class="chip">richness ${planet.richness}</span></div>`;
      if (colony) {
        const owner = state.empires[colony.owner];
        const seen = mine || state.visible[ME][id];
        html += `<div class="meta"><span class="owner" style="background:${owner.color}"></span>${esc(owner.name)}${colony.species !== owner.native ? ` · ${esc(colony.species)} population` : ""}${seen ? ` · pop ${colony.pop}/${Core.colonyMaxPop(state, colony)} · defence ${colony.defense}/${Core.maxDefense(state, colony)}` : " · last known"}</div>`;
        if (mine) html += colonyControls(colony);
      } else {
        html += `<div class="meta">${planetLine(me, planet)} · value ${Core.planetValue(me, planet)}</div>`;
        if (colonyShips.length && Core.canSettle(me, planet)) html += `<div class="row" style="margin-top:6px"><button type="button" data-colonize="${i}" data-fleet="${colonyShips[0].id}">Colonize with ${esc(colonyShips[0].name)}</button></div>`;
      }
      html += `</div>`;
    });
    return html + fleetsHere(id);
  }

  function colonyControls(colony) {
    const out = Core.colonyOutput(state, colony), slots = Core.facilitySlots(state, colony), used = Core.facilitiesUsed(colony);
    const facilities = Core.FACILITY_KEYS.filter((k) => colony.facilities[k]).map((k) => `${data.facilities[k].name}${colony.facilities[k] > 1 ? ` ×${colony.facilities[k]}` : ""}`).join(", ") || "none";
    let html = `<div class="meta">+${out.minerals} minerals · +${out.energy} energy · +${out.research} research · builds ${out.construction}/turn${colony.blockaded ? ` · <span class="warn">BLOCKADED</span>` : ""}</div>
      <div class="meta">Facilities (${used}/${slots}): ${esc(facilities)}</div>`;
    if (colony.queue.length) {
      html += `<h3>Build queue</h3>` + colony.queue.map((q, i) => {
        const name = q.kind === "facility" ? data.facilities[q.key].name : Core.designById(state.empires[ME], q.design)?.name || "ship";
        const turns = out.construction ? Math.ceil((q.cost - q.progress) / out.construction) : "∞";
        return `<div class="row"><span style="flex:1">${esc(name)} <span class="meta">${q.progress}/${q.cost} · ~${turns}t</span></span><button type="button" data-dequeue="${i}" data-colony="${colony.id}" aria-label="Remove ${esc(name)} from queue">×</button></div><div class="bar"><i style="width:${Math.min(100, q.progress / q.cost * 100)}%"></i></div>`;
      }).join("");
    }
    html += `<h3>Build facility</h3><div class="grid2 build">` + Core.FACILITY_KEYS.map((k) => {
      const f = data.facilities[k], problem = Core.canQueue(state, colony, { kind: "facility", key: k });
      return `<button type="button" data-build-facility="${k}" data-colony="${colony.id}" ${problem ? `disabled title="${esc(problem)}"` : `title="${esc(f.description)}"`}><span>${esc(f.name)}</span><span class="meta">${f.cost}</span></button>`;
    }).join("") + `</div>`;
    if (colony.facilities.shipyard) {
      const designs = state.empires[ME].designs;
      html += `<h3>Build ship</h3><div class="build">` + designs.map((d) => {
        const stats = Core.designStats(state, state.empires[ME], d), problem = Core.canQueue(state, colony, { kind: "ship", design: d.id });
        return `<button type="button" data-build-ship="${d.id}" data-colony="${colony.id}" ${problem ? `disabled title="${esc(problem)}"` : ""} style="margin:3px 0">
          <span>${esc(d.name)} <span class="meta">${esc(data.hulls[d.hull].name)}</span></span><span class="meta">${stats.cost}</span></button>`;
      }).join("") + `</div>`;
    }
    return html;
  }

  function fleetsHere(system) {
    const visible = state.visible[ME][system];
    const fleets = state.fleets.filter((f) => f.system === system && f.progress === 0 && (f.owner === ME || visible));
    if (!fleets.length) return "";
    return `<h3>Fleets in orbit</h3>` + fleets.map((f) => fleetCard(f)).join("");
  }
  function fleetCard(f) {
    const owner = state.empires[f.owner], stats = Core.fleetStats(state, f);
    const lead = Core.designById(owner, f.ships[0].design), skin = data.hulls[lead.hull].skin;
    const mine = f.owner === ME;
    return `<div class="card${mine ? " mine" : ""}${session.selection.fleet === f.id ? " selected" : ""}"><div class="fleet-line">${shipSvg(skin, owner.color)}
      <div><b>${esc(f.name)}</b> <span class="meta">${f.ships.length} ship${f.ships.length === 1 ? "" : "s"}</span>
      <div class="meta"><span class="owner" style="background:${owner.color}"></span>${esc(owner.adjective)} · strength ${stats.strength}${stats.troops ? ` · ${stats.troops} troops` : ""}${stats.colony ? " · colony pod" : ""}${mine ? ` · ${f.order.type}` : ""}</div></div>
      ${mine ? `<button type="button" data-select-fleet="${f.id}">Select</button>` : ""}</div></div>`;
  }

  function fleetPanel() {
    const fleet = selectedFleet();
    if (!fleet) return `<p class="sub">No fleet selected. Click a ship glyph near a star, or press Tab for the next idle fleet.</p>`;
    const owner = state.empires[fleet.owner], stats = Core.fleetStats(state, fleet), mine = fleet.owner === ME;
    const where = fleet.progress ? `between ${state.galaxy.systems[fleet.system].name} and ${state.galaxy.systems[fleet.path[0]].name}` : `at ${state.galaxy.systems[fleet.system].name}`;
    let html = `<h2>${esc(fleet.name)}</h2><p class="sub"><span class="owner" style="background:${owner.color}"></span>${esc(owner.name)} · ${where}</p>
      <div class="stat-grid"><span>speed <b>${stats.speed}</b></span><span>strength <b>${stats.strength}</b></span><span>troops <b>${stats.troops}</b></span>
      <span>pods <b>${stats.colony}</b></span><span>ships <b>${fleet.ships.length}</b></span><span>sensors <b>+${stats.sensor}</b></span></div>`;
    if (mine) {
      const dest = fleet.order.destination != null ? state.galaxy.systems[fleet.order.destination].name : null;
      html += `<p class="meta">Order: ${fleet.order.type}${dest ? ` → ${esc(dest)} (~${etaTurns(fleet)} turns)` : ""}</p>
        <div class="row"><button type="button" data-action="move-mode" aria-pressed="${session.moveMode}">Move… <kbd>M</kbd></button>
        <button type="button" data-action="stop">Stop</button>
        <button type="button" data-action="merge" ${fleet.progress ? "disabled" : ""}>Merge fleets here</button>
        <input type="text" id="fleetName" value="${esc(fleet.name)}" aria-label="Fleet name" size="12"><button type="button" data-action="rename">Rename</button></div>`;
      if (stats.colony && !fleet.progress) {
        const sys = state.galaxy.systems[fleet.system];
        const options = sys.planets.map((p, i) => ({ p, i })).filter(({ p, i }) => !Core.colonyAt(state, fleet.system, i) && Core.canSettle(owner, p));
        html += options.length ? `<h3>Colonize</h3><div class="row">${options.map(({ p, i }) => `<button type="button" data-colonize="${i}" data-fleet="${fleet.id}">${esc(sys.name)} ${roman(i + 1)} · ${p.type} ${p.size}</button>`).join("")}</div>`
          : `<p class="meta">No world here our people can settle. Right-click a star to move.</p>`;
      }
    }
    html += `<h3>Ships</h3>` + fleet.ships.map((ship) => {
      const d = Core.designById(owner, ship.design), s = Core.designStats(state, owner, d), hp = s.hp - ship.damage;
      return `<div class="card"><div class="fleet-line">${shipSvg(data.hulls[d.hull].skin, owner.color)}<div><b>${esc(ship.name)}</b>
        <div class="meta">${esc(d.name)} · ${esc(data.hulls[d.hull].name)} · ${s.weapons.length} weapons · shield ${s.shield}</div>
        <div class="bar hp"><i style="width:${Math.max(0, hp / s.hp * 100)}%"></i></div><div class="meta">${hp}/${s.hp} hp</div></div>
        ${mine && fleet.ships.length > 1 && !fleet.progress ? `<button type="button" data-detach="${ship.id}">Detach</button>` : ""}</div></div>`;
    }).join("");
    return html;
  }

  function researchPanel() {
    const e = state.empires[ME], income = Core.empireIncome(state, e);
    let html = `<h2>Research</h2><p class="sub">${income.research} points per turn${e.deficit ? ` · <span class="warn">halved by energy shortfall</span>` : ""}</p>`;
    for (const field of Core.FIELDS) {
      const t = data.techs[field], level = e.tech[field], maxed = level >= t.maxLevel;
      const cost = maxed ? 0 : Core.techCost(data, field, level + 1), current = e.researchField === field;
      const turns = !maxed && income.research ? Math.ceil(Math.max(0, cost - (current ? e.researchPoints : 0)) / income.research) : null;
      html += `<div class="card${current ? " selected" : ""}"><div class="row"><b style="flex:1">${esc(t.name)} ${level}${maxed ? " (complete)" : ""}</b>
        ${maxed ? "" : `<button type="button" data-research="${field}" ${current ? "disabled" : ""}>${current ? "Researching" : "Research"}</button>`}</div>
        <div class="meta">${esc(t.description)}</div>${maxed ? "" : `<div class="meta">Level ${level + 1}: ${cost} points${turns != null ? ` · ~${turns} turns` : ""}</div>`}
        ${current ? `<div class="bar"><i style="width:${Math.min(100, e.researchPoints / cost * 100)}%"></i></div>` : ""}</div>`;
    }
    return html;
  }

  function draftStats() {
    const e = state.empires[ME], d = session.draft;
    return Core.designStatsFresh(data, e, { id: -1, hull: d.hull, components: d.components });
  }
  function componentSummary(design) {
    const counts = new Map();
    for (const c of design.components) counts.set(data.components[c].name, (counts.get(data.components[c].name) || 0) + 1);
    return [...counts].map(([name, k]) => `${k}× ${esc(name)}`).join(", ");
  }
  function designPanel() {
    const e = state.empires[ME];
    let html = `<h2>Ship designs</h2><p class="sub">Components improve with research, so existing ships upgrade as you learn.</p>`;
    if (session.draft) {
      const d = session.draft, hull = data.hulls[d.hull], s = draftStats(), problem = Core.designAvailable(data, e, d.hull, d.components);
      html += `<div class="card selected"><div class="row"><b style="flex:1">New design</b><button type="button" data-action="cancel-draft">Cancel</button></div>
        <div class="row"><input type="text" id="draftName" value="${esc(d.name)}" aria-label="Design name" maxlength="32">
        <select id="draftHull" aria-label="Hull">${data.hulls.map((h, i) => `<option value="${i}" ${i === d.hull ? "selected" : ""} ${Core.designAvailable(data, e, i, [0]) === "hull not yet researched" ? "disabled" : ""}>${esc(h.name)} (${h.slots} slots)</option>`).join("")}</select></div>
        <div class="fleet-line" style="margin-top:6px">${shipSvg(hull.skin, e.color, true)}<div class="meta">${esc(hull.description)}<br>structure ${hull.structure} · speed ${hull.speed} · hull cost ${hull.cost}</div></div>
        <h3>Slots ${d.components.length}/${hull.slots}</h3><div class="slots">${d.components.map((c, i) => `<button type="button" data-remove-slot="${i}" title="Remove">${esc(data.components[c].name)} ×</button>`).join("")}${d.components.length < hull.slots ? `<button type="button" class="empty" disabled>${hull.slots - d.components.length} empty</button>` : ""}</div>
        <h3>Add component</h3><div class="slots">${data.components.map((c) => {
          const locked = c.requires && e.tech[c.requires.field] < c.requires.level;
          return `<button type="button" data-add-component="${c.index}" ${locked || d.components.length >= hull.slots ? "disabled" : ""} title="${esc(locked ? `Needs ${c.requires.field} ${c.requires.level}` : c.description)}">${esc(c.name)} · ${c.cost}</button>`;
        }).join("")}</div>
        <div class="stat-grid"><span>cost <b>${s.cost}</b></span><span>hp <b>${s.hp}</b></span><span>shield <b>${s.shield}</b></span><span>speed <b>${s.speed}</b></span>
        <span>weapons <b>${s.weapons.length}</b></span><span>firepower <b>${s.firepower}</b></span><span>troops <b>${s.troops}</b></span><span>pods <b>${s.colony}</b></span><span>upkeep <b>${s.upkeep}</b></span></div>
        ${problem ? `<p class="warn">${esc(problem)}</p>` : ""}<div class="row" style="margin-top:8px"><button type="button" data-action="save-draft" ${problem ? "disabled" : ""}>Save design</button></div></div>`;
    } else html += `<div class="row"><button type="button" data-action="new-draft">New design…</button><button type="button" data-action="auto-designs">Refit recommended designs</button></div>`;
    html += e.designs.slice().reverse().map((d) => {
      const s = Core.designStats(state, e, d), hull = data.hulls[d.hull];
      return `<div class="card"><div class="fleet-line">${shipSvg(hull.skin, e.color)}<div><b>${esc(d.name)}</b> <span class="meta">${esc(hull.name)} · ${d.role}</span>
        <div class="meta">${componentSummary(d)}</div>
        <div class="meta">cost ${s.cost} · hp ${s.hp} · firepower ${s.firepower} · speed ${s.speed}</div></div></div></div>`;
    }).join("");
    return html;
  }

  function empiresPanel() {
    const me = state.empires[ME];
    return `<h2>Empires</h2>` + state.empires.map((e) => {
      const def = data.empires[e.dataIndex], met = e.id === ME || state.colonies.some((c) => c.owner === e.id && me.known[c.system]);
      const colonies = Core.coloniesOf(state, e.id).length;
      return `<div class="card${e.id === ME ? " mine" : ""}"><div class="row"><span class="owner" style="background:${e.color}"></span><b style="flex:1">${esc(e.name)}</b><span class="chip">${e.alive ? (e.id === ME ? "you" : met ? "contacted" : "unmet") : "fallen"}</span></div>
        <div class="meta">${esc(e.race)} · ${esc(e.leader)} · ${esc(e.native)} worlds · ${esc(e.personality)}</div>
        <p style="margin:4px 0;font-size:12px">${esc(def.description)}</p>
        ${met || !e.alive ? `<div class="meta">${colonies} colonies · score ${Core.score(state, e)}${e.id === ME ? "" : ` · tech ${Core.FIELDS.reduce((n, f) => n + e.tech[f], 0)} levels`}</div>` : `<div class="meta">No contact yet.</div>`}</div>`;
    }).join("");
  }

  function logPanel() {
    const items = state.history.filter(relevant).slice(-150).reverse();
    return `<h2>Log</h2>` + (items.length ? items.map((e) => `<div class="log-item"><small>T${e.turn}</small> ${esc(e.text)}</div>`).join("") : `<p class="sub">Nothing yet. End a turn.</p>`);
  }

  // ---------------------------------------------------------------------
  // Labels: DOM text over the canvas, repositioned only when the camera or
  // state changes (OPT-INC-001 signature with the monotonic state.version).
  // ---------------------------------------------------------------------
  function renderLabels() {
    const { width, height } = viewSize(), c = session.camera;
    const key = `${state.version}|${c.x.toFixed(2)}|${c.y.toFixed(2)}|${c.zoom.toFixed(3)}|${width}x${height}`;
    if (key === session.lastLabelKey) return;
    session.lastLabelKey = key;
    const known = state.empires[ME].known;
    let html = "";
    for (const sys of state.galaxy.systems) {
      const p = toScreen(sys.x, sys.y);
      if (p.x < -60 || p.y < -30 || p.x > width + 60 || p.y > height + 30) continue;
      html += `<span class="${known[sys.id] ? "" : "unknown"}" style="left:${p.x.toFixed(1)}px;top:${(p.y + 16 * Math.min(1.4, c.zoom)).toFixed(1)}px">${esc(sys.name)}</span>`;
    }
    for (const o of orbitPositions()) if (o.fleet.ships.length > 1) {
      const p = toScreen(o.x, o.y - 12);
      html += `<span class="badge" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px">${o.fleet.ships.length}</span>`;
    }
    ui.labels.innerHTML = html;
  }

  // ---------------------------------------------------------------------
  // Input.
  // ---------------------------------------------------------------------
  function isTyping(target) { return target && target.closest && target.closest("input, textarea, select"); }

  ui.canvas.addEventListener("pointerdown", (event) => {
    if (!state) return;
    ui.canvas.focus({ preventScroll: true });
    session.dragging = { x: event.clientX, y: event.clientY, cx: session.camera.x, cy: session.camera.y, moved: false, button: event.button, id: event.pointerId };
    ui.canvas.setPointerCapture?.(event.pointerId);
  });
  ui.canvas.addEventListener("pointermove", (event) => {
    if (!state) return;
    const world = toWorld(event.offsetX, event.offsetY);
    session.hover = pickSystem(world);
    const fleet = selectedFleet();
    session.preview = session.moveMode && fleet && session.hover != null ? [fleet.progress ? fleet.path[0] : fleet.system, ...(Core.route(state, fleet.progress ? fleet.path[0] : fleet.system, session.hover) || [])] : null;
    const d = session.dragging;
    if (d && d.button === 0 && d.id === event.pointerId) {
      const dx = event.clientX - d.x, dy = event.clientY - d.y;
      if (Math.hypot(dx, dy) > 5) d.moved = true;
      if (d.moved) { session.camera.x = d.cx - dx / session.camera.zoom; session.camera.y = d.cy - dy / session.camera.zoom; clampCamera(); }
    }
  });
  ui.canvas.addEventListener("pointerup", (event) => {
    const d = session.dragging;
    session.dragging = null;
    if (!state || !d || d.moved) return;
    const world = toWorld(event.offsetX, event.offsetY);
    if (d.button === 2 || session.moveMode) {
      const target = pickSystem(world);
      if (target != null) moveSelectedTo(target);
      return;
    }
    const fleet = pickFleet(world);
    if (fleet) { selectFleet(fleet); return; }
    const sys = pickSystem(world);
    if (sys != null) selectSystem(sys);
  });
  ui.canvas.addEventListener("pointercancel", () => { session.dragging = null; });
  ui.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  ui.canvas.addEventListener("wheel", (event) => {
    if (!state) return;
    event.preventDefault();
    zoomAt(event.offsetX, event.offsetY, event.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  window.addEventListener("keydown", (event) => {
    if (!ui.fatal.hidden) return;
    if (event.key === "Escape") {
      if (!ui.help.hidden) { ui.help.hidden = true; return; }
      if (state && session.moveMode) { session.moveMode = false; return; }
      if (state && !ui.report.hidden) { ui.report.hidden = true; return; }
      if (state) { session.selection.fleet = null; return; }
    }
    if (isTyping(event.target)) return;
    if (!state) {
      if (event.key === "Enter" && ui.title.contains(event.target) === false) { event.preventDefault(); ui.begin.click(); }
      return;
    }
    if (!ui.help.hidden || !ui.gameover.hidden) return;
    const key = event.key.toLowerCase();
    if (event.key === "Enter" && !event.target.closest?.("button")) { event.preventDefault(); endTurn(); return; }
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key)) { session.keys.add(key); event.preventDefault(); return; }
    if (key === "+" || key === "=") zoomAt(viewSize().width / 2, viewSize().height / 2, 1.15);
    else if (key === "-" || key === "_") zoomAt(viewSize().width / 2, viewSize().height / 2, 1 / 1.15);
    else if (key === "m") { if (selectedFleet()?.owner === ME) session.moveMode = !session.moveMode; else toast("Select one of your fleets first."); }
    else if (key === "tab") { event.preventDefault(); cycleIdle(event.shiftKey ? -1 : 1); }
    else if (key === "c") cycleColony();
    else if (key === "f" && session.selection.system != null) focusSystem(session.selection.system);
    else if (key === "r") session.tab = "research";
    else if (key === "g") session.tab = "designs";
    else if (key === "e") session.tab = "empires";
    else if (key === "l") session.tab = "log";
    else if (key === "?" || key === "h") ui.help.hidden = false;
    else if (key === "u") audio.toggle();
  });
  window.addEventListener("keyup", (event) => session.keys.delete(event.key.toLowerCase()));
  window.addEventListener("blur", () => { session.keys.clear(); session.dragging = null; gamepad.reset(); });

  // Delegated clicks for every data-* control.
  document.addEventListener("click", (event) => {
    const el = event.target.closest("button, [data-empire]");
    if (!el) return;
    const ds = el.dataset;
    if (ds.empire != null && !state) {
      session.empireChoice = Number(ds.empire);
      for (const card of ui.empireGrid.children) card.setAttribute("aria-checked", String(card.dataset.empire === ds.empire));
      return;
    }
    if (ds.action) return handleAction(ds.action);
    if (!state) return;
    if (ds.tab) { session.tab = ds.tab; if (ds.tab === "designs") session.lastPanelKey = ""; return; }
    if (ds.selectFleet) { const f = state.fleets.find((x) => x.id === Number(ds.selectFleet)); if (f) selectFleet(f); return; }
    if (ds.colonize != null) {
      act(() => { Core.orderColonize(state, ME, Number(ds.fleet), Number(ds.colonize)); toast("Settlers will land at the end of the turn."); });
      return;
    }
    if (ds.buildFacility) { act(() => Core.queueBuild(state, ME, Number(ds.colony), { kind: "facility", key: ds.buildFacility })); return; }
    if (ds.buildShip) { act(() => Core.queueBuild(state, ME, Number(ds.colony), { kind: "ship", design: Number(ds.buildShip) })); return; }
    if (ds.dequeue != null) { act(() => Core.dequeue(state, ME, Number(ds.colony), Number(ds.dequeue))); return; }
    if (ds.research) { act(() => Core.setResearch(state, ME, ds.research)); return; }
    if (ds.detach) { act(() => { const f = Core.detachShip(state, ME, session.selection.fleet, Number(ds.detach)); selectFleet(f); }); return; }
    if (ds.addComponent != null && session.draft) { session.draft.components.push(Number(ds.addComponent)); return; }
    if (ds.removeSlot != null && session.draft) { session.draft.components.splice(Number(ds.removeSlot), 1); return; }
  });
  document.addEventListener("change", (event) => {
    if (event.target.id === "draftHull" && session.draft) {
      session.draft.hull = Number(event.target.value);
      session.draft.components = session.draft.components.slice(0, data.hulls[session.draft.hull].slots);
    }
    if (event.target.id === "draftName" && session.draft) session.draft.name = event.target.value;
  });

  function handleAction(action) {
    switch (action) {
      case "end-turn": return endTurn();
      case "help": ui.help.hidden = false; return;
      case "close-help": ui.help.hidden = true; return;
      case "close-report": ui.report.hidden = true; return;
      case "close-gameover": ui.gameover.hidden = true; return;
      case "audio": return audio.toggle();
      case "save": return saveGame(false);
      case "menu": saveGame(true); return showTitle();
      case "move-mode": session.moveMode = !session.moveMode; return;
      case "stop": return act(() => Core.orderStop(state, ME, session.selection.fleet));
      case "merge": return act(() => {
        const f = selectedFleet();
        const others = state.fleets.filter((x) => x.owner === ME && x !== f && x.system === f.system && x.progress === 0).map((x) => x.id);
        if (!others.length) throw new Error("No other fleets here to merge.");
        Core.mergeFleets(state, ME, f.id, others);
      });
      case "rename": return act(() => Core.renameFleet(state, ME, session.selection.fleet, document.getElementById("fleetName").value));
      case "new-draft": session.draft = { name: "New Design", hull: 1, components: [] }; return;
      case "cancel-draft": session.draft = null; return;
      case "save-draft": return act(() => {
        const name = document.getElementById("draftName")?.value || session.draft.name;
        const d = Core.createDesign(state, ME, name, session.draft.hull, session.draft.components);
        session.draft = null;
        toast(`${d.name} added to the shipyards.`);
      });
      case "auto-designs": return act(() => {
        const e = state.empires[ME];
        for (const role of ["scout", "colony", "warship", "troops"]) Core.autoDesign(state, e, role);
        toast("Recommended designs refreshed for current technology.");
      });
      default: return undefined;
    }
  }

  ui.begin.addEventListener("click", () => newGame());
  ui.cont.addEventListener("click", () => continueGame());
  document.getElementById("randomSeed").addEventListener("click", () => {
    const words = ["AURORA", "LATTICE", "MERIDIAN", "CINDER", "TIDE", "LUMEN", "HOLLOW", "VERTEX", "ZENITH", "QUARRY"];
    const r = new Uint32Array(2);
    (window.crypto || {}).getRandomValues?.(r);
    ui.seed.value = `${words[r[0] % words.length]}-${(r[1] % 9000) + 1000}`;
  });

  // ---------------------------------------------------------------------
  // Gamepad: cursor-driven, through the shared standard-mapping reader.
  // ---------------------------------------------------------------------
  function pollGamepad(dt) {
    gamepad.poll();
    if (gamepad.linked) toast("Gamepad linked: left stick cursor, A select, X move, Start end turn.");
    if (!gamepad.armed) { if (gamepad.lost) session.cursor = null; return; }
    if (!state) {
      if (gamepad.pressed(PAD.START) || gamepad.pressed(PAD.SOUTH)) ui.begin.click();
      return;
    }
    if (!ui.help.hidden) { if (gamepad.pressed(PAD.EAST) || gamepad.pressed(PAD.SOUTH)) ui.help.hidden = true; return; }
    if (!ui.gameover.hidden) { if (gamepad.pressed(PAD.SOUTH)) handleAction("menu"); return; }
    const c = session.camera;
    if (!session.cursor) session.cursor = { x: c.x, y: c.y };
    const speed = 420 / c.zoom * dt;
    session.cursor.x += gamepad.axis(AXIS.LX) * speed;
    session.cursor.y += gamepad.axis(AXIS.LY) * speed;
    c.x += gamepad.axis(AXIS.RX) * speed;
    c.y += gamepad.axis(AXIS.RY) * speed;
    // Keep the cursor on screen by nudging the camera at the edges.
    const { width, height } = viewSize(), halfW = width / 2 / c.zoom * 0.85, halfH = height / 2 / c.zoom * 0.8;
    if (session.cursor.x < c.x - halfW) c.x = session.cursor.x + halfW;
    if (session.cursor.x > c.x + halfW) c.x = session.cursor.x - halfW;
    if (session.cursor.y < c.y - halfH) c.y = session.cursor.y + halfH;
    if (session.cursor.y > c.y + halfH) c.y = session.cursor.y - halfH;
    if (gamepad.value(PAD.RT) > 0.2) c.zoom *= 1 + gamepad.value(PAD.RT) * dt * 1.5;
    if (gamepad.value(PAD.LT) > 0.2) c.zoom /= 1 + gamepad.value(PAD.LT) * dt * 1.5;
    clampCamera();
    session.hover = pickSystem(session.cursor);
    if (gamepad.pressed(PAD.SOUTH)) {
      const fleet = pickFleet(session.cursor);
      if (fleet) selectFleet(fleet); else if (session.hover != null) selectSystem(session.hover);
    }
    if (gamepad.pressed(PAD.WEST) && session.hover != null) moveSelectedTo(session.hover);
    if (gamepad.pressed(PAD.EAST)) { if (session.moveMode) session.moveMode = false; else session.selection.fleet = null; ui.report.hidden = true; }
    if (gamepad.pressed(PAD.RB)) { cycleIdle(1); session.cursor = { x: c.x, y: c.y }; }
    if (gamepad.pressed(PAD.LB)) { cycleIdle(-1); session.cursor = { x: c.x, y: c.y }; }
    if (gamepad.pressed(PAD.SELECT)) {
      const tabs = ["system", "fleet", "research", "designs", "empires", "log"];
      session.tab = tabs[(tabs.indexOf(session.tab) + 1) % tabs.length];
    }
    if (gamepad.pressed(PAD.START)) endTurn();
  }

  // ---------------------------------------------------------------------
  // Main loop.
  // ---------------------------------------------------------------------
  function frame(time) {
    const dt = Math.min(0.1, Math.max(0, (time - (session.lastTime || time)) / 1000));
    session.lastTime = time;
    pollGamepad(dt);
    if (state) {
      const pan = 520 / session.camera.zoom * dt, k = session.keys;
      if (k.has("arrowleft") || k.has("a")) session.camera.x -= pan;
      if (k.has("arrowright") || k.has("d")) session.camera.x += pan;
      if (k.has("arrowup") || k.has("w")) session.camera.y -= pan;
      if (k.has("arrowdown") || k.has("s")) session.camera.y += pan;
      clampCamera();
      for (const p of session.pulses) p.life -= dt * 0.5;
      session.pulses = session.pulses.filter((p) => p.life > 0);
      ui.modeHint.hidden = !session.moveMode;
      renderTopbar();
      renderPanel();
      renderLabels();
    }
    if (session.toastTimer > 0) { session.toastTimer -= dt; if (session.toastTimer <= 0) ui.toast.classList.remove("show"); }
    const { width, height } = viewSize();
    presentation.render({
      state, player: ME, camera: session.camera, width, height, selection: session.selection, hover: session.hover,
      moveMode: session.moveMode, preview: session.preview, pulses: session.pulses, cursor: session.cursor,
      time: time / 1000, reducedMotion: presentation.stage.reducedMotion,
    });
    requestAnimationFrame(frame);
  }

  // ---------------------------------------------------------------------
  // Boot.
  // ---------------------------------------------------------------------
  async function boot() {
    presentation = new window.LatticeRenderer(ui.canvas, Core, Skins);
    try {
      const loaded = await loadData();
      data = loaded.data;
      ui.dataSource.textContent = `Data: ${loaded.source}`;
    } catch (error) {
      ui.title.hidden = true;
      ui.fatal.hidden = false;
      document.getElementById("fatalText").textContent = `${error.message}\n\nFix the file named above (see the comments at the top of each data/*.TXT file), then reload.`;
      return;
    }
    const saved = readSettings();
    if (Number.isInteger(saved.empire) && data.empires[saved.empire]) session.empireChoice = saved.empire;
    for (const [el, value] of [[ui.size, saved.size], [ui.rivals, saved.rivals], [ui.turns, saved.turns]]) if (value && [...el.options].some((o) => o.value === value)) el.value = value;
    if (typeof saved.seed === "string" && saved.seed) ui.seed.value = saved.seed;
    showTitle();
    requestAnimationFrame(frame);
  }

  // Read-only hooks for automated browser checks.
  window.sovereignLattice = Object.freeze({
    get state() { return state; }, get session() { return session; }, get renderer() { return presentation; },
    get data() { return data; }, endTurn, moveSelectedTo, selectSystem, toScreen,
  });

  boot();
})();
