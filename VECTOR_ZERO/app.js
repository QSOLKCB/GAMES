(function () {
  "use strict";

  const core = window.VectorZeroCore;
  const canvas = document.querySelector("#game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const threeStage = window.QsolThree
    ? window.QsolThree.create({ host: document.querySelector("#viewport"), source: canvas, preset: "vector" })
    : { render() {}, pulse() {} };
  const WIDTH = canvas.width;
  const HEIGHT = canvas.height;
  const FOCAL = 310;
  const NEAR = 72;
  const TICK_MS = 1000 / core.TICK_RATE;
  const MAX_FRAME_STEPS = 8;

  const bootLayer = document.querySelector("#bootLayer");
  const startButton = document.querySelector("#startButton");
  const seedInput = document.querySelector("#seedInput");
  const difficultySelect = document.querySelector("#difficultySelect");
  const pauseButton = document.querySelector("#pauseButton");
  const restartButton = document.querySelector("#restartButton");
  const soundButton = document.querySelector("#soundButton");
  const replayButton = document.querySelector("#replayButton");
  const fullscreenButton = document.querySelector("#fullscreenButton");
  const pointerHint = document.querySelector("#pointerHint");
  const messageLayer = document.querySelector("#messageLayer");
  const messageKicker = document.querySelector("#messageKicker");
  const messageTitle = document.querySelector("#messageTitle");
  const messageBody = document.querySelector("#messageBody");
  const messageButton = document.querySelector("#messageButton");
  const replayDialog = document.querySelector("#replayDialog");
  const replayText = document.querySelector("#replayText");
  const replayMeta = document.querySelector("#replayMeta");
  const copyReplayButton = document.querySelector("#copyReplayButton");
  const watchReplayButton = document.querySelector("#watchReplayButton");
  const sectorReadout = document.querySelector("#sectorReadout");
  const signatureReadout = document.querySelector("#signatureReadout");
  const objectiveReadout = document.querySelector("#objectiveReadout");
  const coreMeter = document.querySelector("#coreMeter");
  const coreReadout = document.querySelector("#coreReadout");
  const enemyReadout = document.querySelector("#enemyReadout");
  const modeReadout = document.querySelector("#modeReadout");
  const seedReadout = document.querySelector("#seedReadout");
  const tickReadout = document.querySelector("#tickReadout");
  const digestReadout = document.querySelector("#digestReadout");

  const keys = new Set();
  let mouseYaw = 0;
  let mousePitch = 0;
  let mouseFire = false;
  let mouseMissile = false;
  let automap = false;
  let state = null;
  let recorder = null;
  let replay = null;
  let replayCursor = null;
  let mode = "standby";
  let paused = false;
  let accumulator = 0;
  let previousTime = 0;
  let lastTelemetryTick = -1;
  let faceSignature = "";
  let mineFaces = [];
  let flash = 0;
  let shake = 0;
  let notice = "";
  let noticeTicks = 0;
  let audio = null;

  const PALETTES = Object.freeze([
    Object.freeze({ wall: "#765037", edge: "#b17b4c", deep: "#172321", accent: "#e2a85f", fog: "#07100f" }),
    Object.freeze({ wall: "#405f61", edge: "#6f9a94", deep: "#132024", accent: "#9bc8b6", fog: "#071013" }),
    Object.freeze({ wall: "#603a36", edge: "#a46551", deep: "#241819", accent: "#e5a15d", fog: "#11090a" }),
  ]);

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  function isInteractiveTarget(target) {
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target instanceof HTMLButtonElement;
  }

  function shade(hex, factor) {
    const value = parseInt(hex.slice(1), 16);
    const red = clamp(Math.floor(((value >> 16) & 255) * factor), 0, 255);
    const green = clamp(Math.floor(((value >> 8) & 255) * factor), 0, 255);
    const blue = clamp(Math.floor((value & 255) * factor), 0, 255);
    return `rgb(${red},${green},${blue})`;
  }

  function createAudio() {
    let context = null;
    let enabled = false;
    let hum = null;
    let humGain = null;
    let noiseSeed = 0x51a7c0de;

    function ensure() {
      if (!context) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return null;
        context = new AudioContextClass();
      }
      if (context.state === "suspended") context.resume();
      return context;
    }

    function tone(frequency, duration, type, volume, slide) {
      if (!enabled) return;
      const ac = ensure();
      if (!ac) return;
      const now = ac.currentTime;
      const oscillator = ac.createOscillator();
      const gain = ac.createGain();
      oscillator.type = type || "square";
      oscillator.frequency.setValueAtTime(frequency, now);
      if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, frequency + slide), now + duration);
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(gain).connect(ac.destination);
      oscillator.start(now);
      oscillator.stop(now + duration + 0.02);
    }

    function noise(duration, volume) {
      if (!enabled) return;
      const ac = ensure();
      if (!ac) return;
      const length = Math.floor(ac.sampleRate * duration);
      const buffer = ac.createBuffer(1, length, ac.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < length; index += 1) {
        noiseSeed ^= noiseSeed << 13;
        noiseSeed ^= noiseSeed >>> 17;
        noiseSeed ^= noiseSeed << 5;
        data[index] = ((noiseSeed >>> 0) / 0x80000000 - 1) * (1 - index / length);
      }
      const source = ac.createBufferSource();
      const gain = ac.createGain();
      source.buffer = buffer;
      gain.gain.value = volume;
      source.connect(gain).connect(ac.destination);
      source.start();
    }

    function startHum() {
      if (!enabled || hum) return;
      const ac = ensure();
      if (!ac) return;
      hum = ac.createOscillator();
      humGain = ac.createGain();
      hum.type = "sawtooth";
      hum.frequency.value = 43;
      humGain.gain.value = 0.011;
      hum.connect(humGain).connect(ac.destination);
      hum.start();
    }

    function stopHum() {
      if (hum) hum.stop();
      hum = null;
      humGain = null;
    }

    return {
      toggle() {
        enabled = !enabled;
        if (enabled) startHum();
        else stopHum();
        return enabled;
      },
      reset(seed) { noiseSeed = (seed >>> 0) || 0x51a7c0de; },
      events(events) {
        for (const event of events) {
          if (event.type === "shot" && event.kind === "laser") tone(176, 0.055, "square", 0.035, 220);
          else if (event.type === "shot") { noise(0.13, 0.08); tone(72, 0.18, "sawtooth", 0.04, 90); }
          else if (event.type === "enemy-hit") tone(104, 0.045, "square", 0.018, -24);
          else if (event.type === "enemy-down") { noise(0.2, 0.1); tone(54, 0.24, "sawtooth", 0.04, -25); }
          else if (event.type === "player-hit") { noise(0.11, 0.08); tone(39, 0.16, "square", 0.045, -12); }
          else if (event.type === "pickup") tone(event.kind === "core" ? 770 : 510, 0.14, "square", 0.03, 210);
          else if (event.type === "denied") tone(93, 0.12, "square", 0.03, -20);
          else if (event.type === "sector-complete" || event.type === "victory") {
            tone(220, 0.25, "square", 0.028, 220);
            window.setTimeout(() => tone(440, 0.3, "square", 0.028, 180), 160);
          }
        }
      },
    };
  }

  function releaseInput() {
    keys.clear();
    mouseYaw = 0;
    mousePitch = 0;
    mouseFire = false;
    mouseMissile = false;
    automap = false;
  }

  function inputWord() {
    const down = (code) => keys.has(code);
    let actions = 0;
    if (down("KeyW")) actions |= core.INPUT.FORWARD;
    if (down("KeyS")) actions |= core.INPUT.BACK;
    if (down("KeyA")) actions |= core.INPUT.STRAFE_LEFT;
    if (down("KeyD")) actions |= core.INPUT.STRAFE_RIGHT;
    if (down("KeyR")) actions |= core.INPUT.RISE;
    if (down("KeyF")) actions |= core.INPUT.FALL;
    if (down("KeyQ")) actions |= core.INPUT.ROLL_LEFT;
    if (down("KeyE")) actions |= core.INPUT.ROLL_RIGHT;
    if (down("Space") || mouseFire) actions |= core.INPUT.FIRE;
    if (down("KeyX") || mouseMissile) actions |= core.INPUT.MISSILE;
    if (down("ShiftLeft") || down("ShiftRight")) actions |= core.INPUT.BOOST;
    const pointerYaw = clamp(Math.trunc(mouseYaw), -64, 63);
    const pointerPitch = clamp(Math.trunc(mousePitch), -64, 63);
    mouseYaw -= pointerYaw;
    mousePitch -= pointerPitch;
    let yaw = pointerYaw;
    let pitch = pointerPitch;
    if (down("ArrowLeft")) yaw -= 5;
    if (down("ArrowRight")) yaw += 5;
    if (down("ArrowUp")) pitch -= 5;
    if (down("ArrowDown")) pitch += 5;
    yaw = clamp(yaw, -64, 63);
    pitch = clamp(pitch, -64, 63);
    return core.packInput(actions, yaw, pitch);
  }

  function buildMineFaces() {
    if (!state || faceSignature === state.blueprint.signature) return;
    faceSignature = state.blueprint.signature;
    mineFaces = [];
    const size = core.CELL_SIZE;
    const definitions = [
      { dx: -1, dy: 0, dz: 0, axis: "x", light: 0.76, vertices: (x0, y0, z0, x1, y1, z1) => [[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]] },
      { dx: 1, dy: 0, dz: 0, axis: "x", light: 0.9, vertices: (x0, y0, z0, x1, y1, z1) => [[x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [x1, y0, z0]] },
      { dx: 0, dy: -1, dz: 0, axis: "y", light: 0.55, vertices: (x0, y0, z0, x1, y1, z1) => [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]] },
      { dx: 0, dy: 1, dz: 0, axis: "y", light: 0.72, vertices: (x0, y0, z0, x1, y1, z1) => [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] },
      { dx: 0, dy: 0, dz: -1, axis: "z", light: 0.68, vertices: (x0, y0, z0, x1, y1, z1) => [[x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z0]] },
      { dx: 0, dy: 0, dz: 1, axis: "z", light: 0.84, vertices: (x0, y0, z0, x1, y1, z1) => [[x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]] },
    ];
    for (const cell of state.blueprint.cells) {
      const x0 = cell.x * size;
      const y0 = cell.y * size;
      const z0 = cell.z * size;
      const x1 = x0 + size;
      const y1 = y0 + size;
      const z1 = z0 + size;
      for (const definition of definitions) {
        if (core.isOpenCell(state.blueprint, cell.x + definition.dx, cell.y + definition.dy, cell.z + definition.dz)) continue;
        mineFaces.push({
          axis: definition.axis,
          light: definition.light,
          phase: (cell.x * 17 + cell.y * 31 + cell.z * 13) & 7,
          center: { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: (z0 + z1) / 2 },
          vertices: definition.vertices(x0, y0, z0, x1, y1, z1).map((point) => ({ x: point[0], y: point[1], z: point[2] })),
        });
      }
    }
  }

  function cameraPoint(point, basis) {
    const dx = point.x - state.player.x;
    const dy = point.y - state.player.y;
    const dz = point.z - state.player.z;
    return {
      x: (dx * basis.right.x + dy * basis.right.y + dz * basis.right.z) / core.TRIG_SCALE,
      y: (dx * basis.up.x + dy * basis.up.y + dz * basis.up.z) / core.TRIG_SCALE,
      z: (dx * basis.forward.x + dy * basis.forward.y + dz * basis.forward.z) / core.TRIG_SCALE,
    };
  }

  function clipNear(points) {
    const output = [];
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index];
      const previous = points[(index + points.length - 1) % points.length];
      const currentInside = current.z >= NEAR;
      const previousInside = previous.z >= NEAR;
      if (currentInside !== previousInside) {
        const ratio = (NEAR - previous.z) / (current.z - previous.z);
        output.push({
          x: previous.x + (current.x - previous.x) * ratio,
          y: previous.y + (current.y - previous.y) * ratio,
          z: NEAR,
        });
      }
      if (currentInside) output.push(current);
    }
    return output;
  }

  function screenPoint(point) {
    return {
      x: WIDTH / 2 + point.x * FOCAL / point.z,
      y: HEIGHT / 2 - point.y * FOCAL / point.z,
    };
  }

  function projectPoint(point) {
    if (!state) return null;
    const basis = core.getBasis(state.player.yaw, state.player.pitch, state.player.roll);
    const camera = cameraPoint(point, basis);
    return camera.z >= NEAR ? { ...screenPoint(camera), depth: camera.z, camera } : null;
  }

  function faceDrawable(face, basis, palette) {
    if (core.distanceApprox(face.center.x - state.player.x, face.center.y - state.player.y, face.center.z - state.player.z) > core.CELL_SIZE * 10) return null;
    const camera = face.vertices.map((vertex) => cameraPoint(vertex, basis));
    const clipped = clipNear(camera);
    if (clipped.length < 3) return null;
    const points = clipped.map(screenPoint);
    const depth = clipped.reduce((sum, point) => sum + point.z, 0) / clipped.length;
    const fog = clamp(1.15 - depth / (core.CELL_SIZE * 11), 0.2, 1);
    const axisFactor = face.axis === "y" ? 0.86 : face.axis === "z" ? 0.94 : 1;
    return { type: "face", depth, points, fill: shade(palette.wall, face.light * fog * axisFactor), edge: shade(palette.edge, fog * 0.75), phase: face.phase };
  }

  function entityDrawable(type, entity, basis, radius, color) {
    const camera = cameraPoint(entity, basis);
    if (camera.z < NEAR) return null;
    const point = screenPoint(camera);
    const size = clamp(radius * FOCAL / camera.z, 2, 92);
    if (point.x < -size * 2 || point.x > WIDTH + size * 2 || point.y < -size * 2 || point.y > HEIGHT + size * 2) return null;
    return { type, depth: camera.z, x: point.x, y: point.y, size, entity, color };
  }

  function drawFace(drawable) {
    ctx.beginPath();
    ctx.moveTo(drawable.points[0].x, drawable.points[0].y);
    for (let index = 1; index < drawable.points.length; index += 1) ctx.lineTo(drawable.points[index].x, drawable.points[index].y);
    ctx.closePath();
    ctx.fillStyle = drawable.fill;
    ctx.fill();
    ctx.strokeStyle = drawable.edge;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    if (drawable.points.length === 4 && drawable.phase % 3 === 0) {
      ctx.beginPath();
      ctx.moveTo((drawable.points[0].x + drawable.points[3].x) / 2, (drawable.points[0].y + drawable.points[3].y) / 2);
      ctx.lineTo((drawable.points[1].x + drawable.points[2].x) / 2, (drawable.points[1].y + drawable.points[2].y) / 2);
      ctx.strokeStyle = "rgba(8,14,12,0.28)";
      ctx.stroke();
    }
  }

  function drawEnemy(drawable) {
    const { x, y, size, entity } = drawable;
    const pain = entity.pain > 0;
    const color = pain ? "#f2dfb3" : drawable.color;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(((state.tick + entity.phase) & 255) / 255 * Math.PI * 2);
    ctx.fillStyle = "rgba(7,13,12,0.78)";
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = Math.max(5, size * 0.38);
    ctx.lineWidth = Math.max(1.5, size * 0.095);
    ctx.beginPath();
    if (entity.kind === "sentinel" || entity.kind === "custodian") {
      ctx.rect(-size * 0.48, -size * 0.48, size * 0.96, size * 0.96);
      ctx.moveTo(-size * 0.7, 0); ctx.lineTo(size * 0.7, 0);
      ctx.moveTo(0, -size * 0.7); ctx.lineTo(0, size * 0.7);
    } else {
      ctx.moveTo(0, -size * 0.72);
      ctx.lineTo(size * 0.7, 0);
      ctx.lineTo(0, size * 0.72);
      ctx.lineTo(-size * 0.7, 0);
      ctx.closePath();
      ctx.moveTo(-size * 0.62, -size * 0.3); ctx.lineTo(size * 0.62, size * 0.3);
      ctx.moveTo(size * 0.62, -size * 0.3); ctx.lineTo(-size * 0.62, size * 0.3);
    }
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = entity.kind === "custodian" ? "#f0b35d" : "#d8654c";
    ctx.fillRect(-size * 0.12, -size * 0.12, size * 0.24, size * 0.24);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = pain ? "#f8e5ae" : color;
    ctx.lineWidth = Math.max(1, size * 0.055);
    ctx.globalAlpha = 0.72 + Math.sin((state.tick + entity.phase) * 0.09) * 0.18;
    const bracket = size * 1.08;
    const corner = Math.max(3, size * 0.28);
    ctx.beginPath();
    ctx.moveTo(x - bracket, y - bracket + corner); ctx.lineTo(x - bracket, y - bracket); ctx.lineTo(x - bracket + corner, y - bracket);
    ctx.moveTo(x + bracket - corner, y - bracket); ctx.lineTo(x + bracket, y - bracket); ctx.lineTo(x + bracket, y - bracket + corner);
    ctx.moveTo(x - bracket, y + bracket - corner); ctx.lineTo(x - bracket, y + bracket); ctx.lineTo(x - bracket + corner, y + bracket);
    ctx.moveTo(x + bracket - corner, y + bracket); ctx.lineTo(x + bracket, y + bracket); ctx.lineTo(x + bracket, y + bracket - corner);
    ctx.stroke();
    if (size > 6) {
      ctx.font = "bold 7px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = pain ? "#fff0be" : color;
      ctx.fillText(`${core.ENEMY_TYPES[entity.kind].name} // ${Math.max(0, entity.health)}`, x, y + bracket + 9);
    }
    ctx.restore();
    if (entity.kind === "custodian") {
      const width = Math.max(10, size * 1.4);
      ctx.fillStyle = "#160b0b";
      ctx.fillRect(x - width / 2, y - size - 5, width, 2);
      ctx.fillStyle = "#d88b53";
      ctx.fillRect(x - width / 2, y - size - 5, width * Math.max(0, entity.health) / entity.maxHealth, 2);
    }
  }

  function drawPickup(drawable) {
    const { x, y, size, entity } = drawable;
    const pulse = 0.82 + Math.sin((state.tick + entity.id) * 0.08) * 0.16;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((state.tick + entity.id * 17) * 0.025);
    ctx.strokeStyle = drawable.color;
    ctx.lineWidth = Math.max(1, size * 0.09);
    if (entity.kind === "core") {
      ctx.strokeRect(-size * pulse, -size * pulse, size * 2 * pulse, size * 2 * pulse);
      ctx.rotate(Math.PI / 4);
      ctx.strokeRect(-size * 0.55, -size * 0.55, size * 1.1, size * 1.1);
      ctx.fillStyle = "rgba(235,176,94,0.32)";
      ctx.fillRect(-size * 0.3, -size * 0.3, size * 0.6, size * 0.6);
    } else {
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.8, 0, Math.PI * 2);
      ctx.moveTo(-size, 0); ctx.lineTo(size, 0);
      ctx.moveTo(0, -size); ctx.lineTo(0, size);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawExit(drawable) {
    const { x, y, size } = drawable;
    const open = state.coresCollected >= state.coresRequired;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(state.tick * 0.012);
    ctx.strokeStyle = open ? "#83c8b3" : "#b25a45";
    ctx.lineWidth = Math.max(1, size * 0.08);
    for (let index = 0; index < 3; index += 1) {
      ctx.rotate(Math.PI / 3);
      ctx.strokeRect(-size * (0.5 + index * 0.16), -size * (0.5 + index * 0.16), size * (1 + index * 0.32), size * (1 + index * 0.32));
    }
    ctx.restore();
  }

  function drawProjectile(drawable) {
    const radius = Math.max(1.2, drawable.size * 0.28);
    ctx.fillStyle = drawable.color;
    ctx.shadowColor = drawable.color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(drawable.x, drawable.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  function drawBackdrop(palette) {
    const gradient = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, 10, WIDTH / 2, HEIGHT / 2, WIDTH * 0.72);
    gradient.addColorStop(0, palette.deep);
    gradient.addColorStop(1, palette.fog);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "rgba(164,191,176,0.12)";
    for (let index = 0; index < 70; index += 1) {
      const x = (index * 97 + 31) % WIDTH;
      const y = (index * 53 + 19) % HEIGHT;
      ctx.fillRect(x, y, index % 9 === 0 ? 2 : 1, 1);
    }
  }

  function drawCockpit(palette, targetLock) {
    const player = state.player;
    const speed = core.distanceApprox(player.vx, player.vy, player.vz);
    ctx.strokeStyle = targetLock ? "rgba(244,184,91,0.98)" : "rgba(219,208,173,0.78)";
    ctx.lineWidth = targetLock ? 1.6 : 1;
    ctx.beginPath();
    ctx.moveTo(WIDTH / 2 - 12, HEIGHT / 2); ctx.lineTo(WIDTH / 2 - 4, HEIGHT / 2);
    ctx.moveTo(WIDTH / 2 + 4, HEIGHT / 2); ctx.lineTo(WIDTH / 2 + 12, HEIGHT / 2);
    ctx.moveTo(WIDTH / 2, HEIGHT / 2 - 12); ctx.lineTo(WIDTH / 2, HEIGHT / 2 - 4);
    ctx.moveTo(WIDTH / 2, HEIGHT / 2 + 4); ctx.lineTo(WIDTH / 2, HEIGHT / 2 + 12);
    ctx.stroke();
    if (targetLock) {
      ctx.font = "bold 7px monospace";
      ctx.textAlign = "center";
      ctx.fillStyle = "#efb45e";
      ctx.fillText("FIRE SOLUTION", WIDTH / 2, HEIGHT / 2 + 23);
      ctx.textAlign = "left";
    }
    ctx.fillStyle = "rgba(4,8,7,0.8)";
    ctx.fillRect(0, 0, WIDTH, 16);
    ctx.fillRect(0, HEIGHT - 27, WIDTH, 27);
    ctx.font = "8px monospace";
    ctx.textBaseline = "middle";
    ctx.fillStyle = palette.accent;
    ctx.fillText(`MINE 0${state.sector} // ${state.blueprint.signature}`, 7, 8);
    ctx.textAlign = "center";
    ctx.fillStyle = "#d5d1b6";
    ctx.fillText(`CORES ${state.coresCollected}/${state.coresRequired}`, WIDTH / 2, 8);
    ctx.textAlign = "right";
    ctx.fillText(String(state.score).padStart(7, "0"), WIDTH - 7, 8);
    ctx.textAlign = "left";
    ctx.fillStyle = "#6e8178";
    ctx.fillText("SHIELD", 7, HEIGHT - 19);
    ctx.fillText("ENERGY", 7, HEIGHT - 8);
    ctx.fillStyle = "#15201d";
    ctx.fillRect(48, HEIGHT - 22, 104, 5);
    ctx.fillRect(48, HEIGHT - 11, 104, 5);
    ctx.fillStyle = player.shield < 28 ? "#d96750" : "#77b4a5";
    ctx.fillRect(48, HEIGHT - 22, 104 * player.shield / player.maxShield, 5);
    ctx.fillStyle = "#d8a15f";
    ctx.fillRect(48, HEIGHT - 11, 104 * player.energy / 1000, 5);
    ctx.fillStyle = "#9aa79e";
    ctx.fillText(`MISSILES ${String(player.missiles).padStart(2, "0")}`, 174, HEIGHT - 14);
    ctx.fillText(`VECTOR ${String(speed).padStart(3, "0")}`, 279, HEIGHT - 14);
    ctx.fillText(`HOSTILES ${String(state.enemies.length).padStart(2, "0")}`, 382, HEIGHT - 14);
    if (noticeTicks > 0) {
      ctx.textAlign = "center";
      ctx.fillStyle = "rgba(4,8,7,0.82)";
      ctx.fillRect(WIDTH / 2 - 105, 24, 210, 16);
      ctx.fillStyle = palette.accent;
      ctx.fillText(notice, WIDTH / 2, 32);
    }
    ctx.textAlign = "left";
  }

  function drawAutomap() {
    const current = core.worldCell(state.player);
    const cellSize = 15;
    const mapWidth = state.blueprint.width * cellSize;
    const mapHeight = state.blueprint.depth * cellSize;
    const left = WIDTH / 2 - mapWidth / 2;
    const top = HEIGHT / 2 - mapHeight / 2;
    ctx.fillStyle = "rgba(2,6,5,0.9)";
    ctx.fillRect(left - 18, top - 27, mapWidth + 36, mapHeight + 48);
    ctx.strokeStyle = "#536e65";
    ctx.strokeRect(left - 18, top - 27, mapWidth + 36, mapHeight + 48);
    ctx.font = "8px monospace";
    ctx.fillStyle = "#d5a15f";
    ctx.fillText(`MINE SCHEMATIC // LAYER ${current.y + 1}/${state.blueprint.height}`, left - 8, top - 14);
    for (const cell of state.blueprint.cells) {
      if (cell.y !== current.y) continue;
      ctx.fillStyle = "#14231f";
      ctx.fillRect(left + cell.x * cellSize + 1, top + cell.z * cellSize + 1, cellSize - 2, cellSize - 2);
    }
    for (const pickup of state.pickups) {
      const cell = core.worldCell(pickup);
      if (cell.y !== current.y || pickup.kind !== "core") continue;
      ctx.fillStyle = "#d8a15f";
      ctx.fillRect(left + cell.x * cellSize + 5, top + cell.z * cellSize + 5, 5, 5);
    }
    for (const enemy of state.enemies) {
      const cell = core.worldCell(enemy);
      if (cell.y !== current.y) continue;
      ctx.fillStyle = "#c2604b";
      ctx.fillRect(left + cell.x * cellSize + 6, top + cell.z * cellSize + 6, 3, 3);
    }
    ctx.fillStyle = "#79b9aa";
    ctx.beginPath();
    ctx.arc(left + current.x * cellSize + cellSize / 2, top + current.z * cellSize + cellSize / 2, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  function render() {
    if (!state) {
      ctx.fillStyle = "#06100e";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.fillStyle = "#52675f";
      ctx.font = "9px monospace";
      ctx.fillText("VECTOR ZERO FLIGHT COMPUTER // STANDBY", 12, 18);
      threeStage.render({ tick: 0, speed: 0.08, activity: 0.07 });
      return;
    }
    buildMineFaces();
    const palette = PALETTES[state.sector - 1] || PALETTES[0];
    drawBackdrop(palette);
    const basis = core.getBasis(state.player.yaw, state.player.pitch, state.player.roll);
    const drawables = [];
    for (const face of mineFaces) {
      const drawable = faceDrawable(face, basis, palette);
      if (drawable) drawables.push(drawable);
    }
    const enemyColors = { drone: "#8aa698", hunter: "#b98252", sentinel: "#9c6255", custodian: "#d28c55" };
    for (const enemy of state.enemies) {
      const radius = enemy.kind === "custodian" ? 560 : enemy.kind === "sentinel" ? 430 : 360;
      const drawable = entityDrawable("enemy", enemy, basis, radius, enemyColors[enemy.kind]);
      if (drawable) drawables.push(drawable);
    }
    const pickupColors = { core: "#e7ad62", energy: "#74b9ad", shield: "#aec39b", missiles: "#c87955" };
    for (const pickup of state.pickups) {
      const drawable = entityDrawable("pickup", pickup, basis, pickup.kind === "core" ? 235 : 170, pickupColors[pickup.kind]);
      if (drawable) drawables.push(drawable);
    }
    const exit = entityDrawable("exit", state.blueprint.exit, basis, 510, palette.accent);
    if (exit) drawables.push(exit);
    for (const projectile of state.projectiles) {
      const color = projectile.kind === "laser" ? "#f4d477" : projectile.kind === "missile" ? "#e77a52" : "#73b8a8";
      const drawable = entityDrawable("projectile", projectile, basis, projectile.kind === "missile" ? 130 : 72, color);
      if (drawable) drawables.push(drawable);
    }
    drawables.sort((first, second) => second.depth - first.depth);
    const offsetX = shake > 0 ? ((state.tick * 17) % (shake * 2 + 1)) - shake : 0;
    const offsetY = shake > 0 ? ((state.tick * 11) % (shake * 2 + 1)) - shake : 0;
    ctx.save();
    ctx.translate(offsetX, offsetY);
    for (const drawable of drawables) {
      if (drawable.type === "face") drawFace(drawable);
      else if (drawable.type === "enemy") drawEnemy(drawable);
      else if (drawable.type === "pickup") drawPickup(drawable);
      else if (drawable.type === "exit") drawExit(drawable);
      else drawProjectile(drawable);
    }
    const targetLock = drawables.some((drawable) => drawable.type === "enemy" &&
      Math.hypot(drawable.x - WIDTH / 2, drawable.y - HEIGHT / 2) < Math.max(13, drawable.size * 0.72));
    drawCockpit(palette, targetLock);
    if (automap) drawAutomap();
    ctx.restore();
    if (state.player.hurt > 0 || flash > 0) {
      ctx.fillStyle = `rgba(151,45,33,${Math.max(state.player.hurt / 50, flash / 30)})`;
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    if (paused) {
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
    }
    threeStage.render({
      tick: state.tick,
      speed: Math.hypot(state.player.vx || 0, state.player.vy || 0, state.player.vz || 0) / core.FP,
      danger: 1 - state.player.shield / Math.max(1, state.player.maxShield || 100),
      activity: Math.max(flash / 10, state.projectiles.length ? 0.42 : 0.16),
      heading: state.player.yaw / core.ANGLE_MAX * Math.PI * 2,
    });
  }

  function showMessage(kicker, title, body, button, action) {
    messageKicker.textContent = kicker;
    messageTitle.textContent = title;
    messageBody.textContent = body;
    messageButton.textContent = button;
    messageButton.onclick = action;
    messageLayer.hidden = false;
  }

  function updateTelemetry(force) {
    if (!state) return;
    if (!force && (state.tick === lastTelemetryTick || state.tick % 12 !== 0)) return;
    lastTelemetryTick = state.tick;
    sectorReadout.textContent = `MINE 0${state.sector}`;
    signatureReadout.textContent = state.blueprint.signature;
    objectiveReadout.textContent = state.coresCollected >= state.coresRequired ? "Zero gate unlocked. Reach the exit lattice." : "Recover all vector cores and reach the zero gate.";
    coreReadout.textContent = `${state.coresCollected} / ${state.coresRequired}`;
    coreMeter.style.width = `${state.coresRequired ? state.coresCollected / state.coresRequired * 100 : 0}%`;
    enemyReadout.textContent = String(state.enemies.length);
    if (mode === "replay") {
      const replayTick = replayCursor ? replayCursor.tick : 0;
      const replayTicks = replay ? replay.ticks : 0;
      if (paused && replayTick >= replayTicks) modeReadout.textContent = `REPLAY COMPLETE ${replayTick}/${replayTicks}`;
      else if (paused) modeReadout.textContent = `REPLAY PAUSED ${replayTick}/${replayTicks}`;
      else modeReadout.textContent = `REPLAY ${replayTick}/${replayTicks}`;
    } else if (state.victory) modeReadout.textContent = "VECTOR ZERO";
    else if (state.gameOver) modeReadout.textContent = "SIGNAL LOST";
    else modeReadout.textContent = paused ? "PAUSED" : "LIVE INPUT";
    seedReadout.textContent = core.seedHex(state.seed);
    tickReadout.textContent = String(state.tick);
    digestReadout.textContent = core.stateDigest(state);
  }

  function setPaused(value) {
    if (!state || ((state.gameOver || state.victory) && mode !== "replay")) return;
    paused = Boolean(value);
    pauseButton.textContent = paused ? "RESUME" : "PAUSE";
    if (paused) {
      releaseInput();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      showMessage("FLIGHT COMPUTER HOLD", "SIMULATION PAUSED", "The fixed-tick mine clock is frozen on this exact canonical state.", "RESUME FLIGHT", () => setPaused(false));
    } else {
      messageLayer.hidden = true;
      previousTime = performance.now();
      canvas.focus();
    }
    updateTelemetry(true);
  }

  function handleEvents(events) {
    if (audio) audio.events(events);
    for (const event of events) {
      if (event.type === "shot") {
        flash = Math.max(flash, event.kind === "missile" ? 8 : 3);
        shake = Math.max(shake, event.kind === "missile" ? 3 : 1);
        threeStage.pulse("shot", event.kind === "missile" ? 0.72 : 0.3);
      } else if (event.type === "enemy-hit") {
        notice = `${core.ENEMY_TYPES[event.kind].name} // ${event.health}`;
        noticeTicks = 35;
      } else if (event.type === "enemy-down") {
        notice = `${core.ENEMY_TYPES[event.kind].name} ERASED`;
        noticeTicks = 60;
        shake = Math.max(shake, event.kind === "custodian" ? 7 : 4);
        threeStage.pulse("blast", event.kind === "custodian" ? 0.9 : 0.58);
      } else if (event.type === "player-hit") {
        notice = `SHIELD FRACTURE // -${event.amount}`;
        noticeTicks = 50;
        shake = Math.max(shake, 5);
        threeStage.pulse("impact", 0.82);
      } else if (event.type === "pickup") {
        notice = event.kind === "core" ? `VECTOR CORE ${event.cores}/${state.coresRequired}` : `${event.kind.toUpperCase()} RECOVERED`;
        noticeTicks = 75;
      } else if (event.type === "denied") {
        notice = event.reason;
        noticeTicks = 65;
      } else if (event.type === "sector-complete") {
        showMessage("ZERO GATE SYNCHRONISED", `MINE 0${event.sector} CLEARED`, `Canonical sector ${state.blueprint.signature} accepted. Score ${event.score}. Preparing the next mine lattice…`, "CONTINUE", () => { messageLayer.hidden = true; });
      } else if (event.type === "sector") {
        messageLayer.hidden = true;
        faceSignature = "";
        notice = `MINE 0${event.sector} // ${event.signature}`;
        noticeTicks = 120;
      } else if (event.type === "game-over") {
        if (mode === "replay") {
          notice = "PILOT SIGNAL LOST // LEDGER CONTINUES";
          noticeTicks = 90;
        } else {
          paused = true;
          releaseInput();
          showMessage("NULL-SPACE CASUALTY", "PILOT SIGNAL LOST", `Final score ${event.score}. Canonical state ${core.stateDigest(state)}.`, "RELAUNCH", restartRun);
        }
        updateTelemetry(true);
      } else if (event.type === "victory") {
        if (mode === "replay") {
          notice = "VECTOR ZERO ACHIEVED // LEDGER CONTINUES";
          noticeTicks = 90;
        } else {
          paused = true;
          releaseInput();
          showMessage("NULL AXIS STABILISED", "VECTOR ZERO ACHIEVED", `All three mines are canonical. Score ${event.score}. State ${core.stateDigest(state)}.`, "FLY AGAIN", restartRun);
        }
        updateTelemetry(true);
      }
    }
  }

  function simulationStep() {
    if (!state) return;
    let word;
    if (mode === "replay") {
      word = core.nextReplayInput(replayCursor);
      if (word === null) {
        paused = true;
        updateTelemetry(true);
        showMessage("REPLAY EOF", "RECEIPT COMPLETE", `Reproduced ${replay.ticks} ticks. Final canonical state ${core.stateDigest(state)}.`, "NEW LIVE FLIGHT", restartRun);
        return;
      }
    } else {
      word = inputWord();
      if (!core.tryRecordInput(recorder, word)) {
        paused = true;
        updateTelemetry(true);
        showMessage("RECORDER LIMIT", "TWO-HOUR CAP", "The bounded deterministic flight ledger is full.", "RELAUNCH", restartRun);
        return;
      }
    }
    core.step(state, word);
    handleEvents(state.events);
    if (mode === "replay" && (state.gameOver || state.victory)) updateTelemetry(true);
    if (flash > 0) flash -= 1;
    if (shake > 0) shake -= 1;
    if (noticeTicks > 0) noticeTicks -= 1;
  }

  function startRun(seed, difficulty, runMode, decodedReplay) {
    state = core.createRun(seed, difficulty);
    mode = runMode || "live";
    recorder = mode === "live" ? core.createRecorder(state.seed, state.difficulty) : null;
    replay = decodedReplay || null;
    replayCursor = replay ? core.createReplayCursor(replay) : null;
    paused = false;
    accumulator = 0;
    previousTime = performance.now();
    lastTelemetryTick = -1;
    faceSignature = "";
    flash = 0;
    shake = 0;
    notice = `MINE 01 // ${state.blueprint.signature}`;
    noticeTicks = 120;
    releaseInput();
    if (audio) audio.reset(state.seed);
    bootLayer.hidden = true;
    messageLayer.hidden = true;
    pauseButton.disabled = false;
    restartButton.disabled = false;
    replayButton.disabled = false;
    pauseButton.textContent = "PAUSE";
    updateTelemetry(true);
    canvas.focus();
  }

  function restartRun() {
    if (!state) return;
    startRun(state.seed, state.difficulty, "live", null);
  }

  function frame(time) {
    if (!previousTime) previousTime = time;
    const elapsed = Math.min(250, time - previousTime);
    previousTime = time;
    if (state && !paused && !replayDialog.open) {
      accumulator += elapsed;
      let steps = 0;
      while (accumulator >= TICK_MS && steps < MAX_FRAME_STEPS && !paused) {
        simulationStep();
        accumulator -= TICK_MS;
        steps += 1;
      }
      if (steps >= MAX_FRAME_STEPS) accumulator = 0;
    }
    render();
    updateTelemetry(false);
    requestAnimationFrame(frame);
  }

  function openReplayDialog() {
    if (!state) return;
    releaseInput();
    if (mode === "live" && recorder) {
      replayText.value = core.encodeReplay(recorder);
      replayMeta.textContent = `${recorder.ticks} ticks // seed ${core.seedHex(recorder.seed)} // state ${core.stateDigest(state)}`;
    } else if (replay) {
      replayText.value = core.encodeReplay({ version: replay.version, seed: replay.seed, difficulty: replay.difficulty, ticks: replay.ticks, runs: replay.runs.map((run) => run.slice()) });
      replayMeta.textContent = `${replayCursor.tick}/${replay.ticks} replay ticks // state ${core.stateDigest(state)}`;
    }
    replayDialog.showModal();
  }

  startButton.addEventListener("click", () => startRun(seedInput.value, Number(difficultySelect.value), "live", null));
  pauseButton.addEventListener("click", () => setPaused(!paused));
  restartButton.addEventListener("click", restartRun);
  replayButton.addEventListener("click", openReplayDialog);
  soundButton.addEventListener("click", () => {
    const enabled = audio.toggle();
    soundButton.textContent = enabled ? "AUDIO: ON" : "AUDIO: OFF";
    soundButton.setAttribute("aria-pressed", String(enabled));
  });
  fullscreenButton.addEventListener("click", () => {
    const target = document.querySelector(".station");
    if (!document.fullscreenElement) target.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  });
  copyReplayButton.addEventListener("click", async () => {
    replayText.select();
    try {
      await navigator.clipboard.writeText(replayText.value);
      replayMeta.textContent = "Receipt copied to clipboard.";
    } catch (_error) {
      document.execCommand("copy");
      replayMeta.textContent = "Receipt selected for copying.";
    }
  });
  watchReplayButton.addEventListener("click", () => {
    try {
      const decoded = core.decodeReplay(replayText.value);
      replayDialog.close();
      startRun(decoded.seed, decoded.difficulty, "replay", decoded);
    } catch (error) {
      replayMeta.textContent = `Rejected: ${error.message}`;
    }
  });

  window.addEventListener("keydown", (event) => {
    if (isInteractiveTarget(event.target)) return;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "Tab"].includes(event.code)) event.preventDefault();
    if (event.code === "KeyP" && !event.repeat) {
      setPaused(!paused);
      return;
    }
    if (event.code === "Tab") automap = true;
    keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
    if (event.code === "Tab") automap = false;
  });
  window.addEventListener("blur", releaseInput);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state && !paused) setPaused(true);
  });
  canvas.addEventListener("click", () => {
    canvas.focus();
    if (state && !paused && canvas.requestPointerLock) canvas.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => pointerHint.classList.toggle("hidden", document.pointerLockElement === canvas || !state));
  document.addEventListener("mousemove", (event) => {
    if (document.pointerLockElement !== canvas || !state || paused) return;
    mouseYaw += event.movementX * 0.28;
    mousePitch += event.movementY * 0.28;
  });
  canvas.addEventListener("mousedown", (event) => {
    if (document.pointerLockElement !== canvas) return;
    if (event.button === 0) mouseFire = true;
    if (event.button === 2) mouseMissile = true;
  });
  window.addEventListener("mouseup", (event) => {
    if (event.button === 0) mouseFire = false;
    if (event.button === 2) mouseMissile = false;
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  replayDialog.addEventListener("close", () => {
    releaseInput();
    previousTime = performance.now();
  });

  window.vectorZero = Object.freeze({
    get state() { return state; },
    get mode() { return mode; },
    get paused() { return paused; },
    get recorder() { return recorder; },
    get replayTick() { return replayCursor ? replayCursor.tick : null; },
    start: startRun,
    restart: restartRun,
    project: projectPoint,
    digest() { return state ? core.stateDigest(state) : null; },
  });

  audio = createAudio();
  render();
  requestAnimationFrame(frame);
})();
