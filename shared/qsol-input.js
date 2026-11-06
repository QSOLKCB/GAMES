/* Shared standard-gamepad input for the QSOL browser games.
 *
 * Adapted from the VANILLAJS input module (modules/input/index.js:
 * `deadzone` and `FlightGamepad`) of QSOLKCB/VANILLAJS at
 * 93ace342c11e2427ad82920c8965f16e91518fb7, Apache License 2.0.
 * See shared/NOTICE.md.
 *
 * Contract (kept from VANILLAJS):
 *  - Only pads that report the W3C "standard" mapping are read; unmapped
 *    devices are ignored rather than guessed.
 *  - After reset() (start, pause, resume, focus loss) and whenever the
 *    selected pad changes, every button and stick must return to neutral
 *    before the pad produces input again. A button held through a pause or a
 *    plug-in therefore never fires on its own.
 *  - Sticks pass through a rescaled radial-per-axis deadzone.
 *
 * Additions for these games: one poll per animation frame, edge-detected
 * buttons for menu actions such as START, a `linked` flag on the frame a pad
 * arms, and a `lost` flag on the frame an armed pad disconnects so a game can
 * pause instead of continuing without its controller.
 *
 * The reader never touches simulation state. Games translate the snapshot into
 * their own recorded input words, so replays and digests stay deterministic.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QsolInput = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /** W3C standard gamepad button indices. */
  const BUTTON = Object.freeze({
    SOUTH: 0, // A / Cross
    EAST: 1, // B / Circle
    WEST: 2, // X / Square
    NORTH: 3, // Y / Triangle
    LB: 4,
    RB: 5,
    LT: 6,
    RT: 7,
    SELECT: 8, // Back / View / Share
    START: 9, // Start / Menu / Options
    L3: 10,
    R3: 11,
    UP: 12,
    DOWN: 13,
    LEFT: 14,
    RIGHT: 15,
  });

  /** W3C standard gamepad axis indices. Positive Y is down. */
  const AXIS = Object.freeze({ LX: 0, LY: 1, RX: 2, RY: 3 });

  const NEUTRAL_BUTTON = 0.1;
  const MAX_BUTTONS = 32;

  function clamp(value, min, max) {
    return value < min ? min : value > max ? max : value;
  }

  /** Rescaled deadzone: 0 inside the zone, then linear to ±1. */
  function deadzone(value, zone = 0.16) {
    if (!Number.isFinite(value) || !Number.isFinite(zone) || zone < 0 || zone >= 1) return 0;
    // `|| 0` folds -0 so neutral sticks compare equal to 0.
    return Math.sign(value) * clamp((Math.abs(value) - zone) / (1 - zone), 0, 1) || 0;
  }

  function buttonValue(pad, index) {
    const button = pad.buttons ? pad.buttons[index] : null;
    if (!button) return 0;
    const value = typeof button === "number" ? button : button.value ?? Number(Boolean(button.pressed));
    return Number.isFinite(value) ? clamp(value, 0, 1) : 0;
  }

  /** First connected pad that reports the standard mapping, or null. */
  function selectPad(pads) {
    if (!pads) return null;
    for (const pad of Array.from(pads)) {
      if (pad && pad.connected !== false && pad.mapping === "standard") return pad;
    }
    return null;
  }

  function defaultSource() {
    try {
      return typeof navigator !== "undefined" && navigator.getGamepads ? navigator.getGamepads() : [];
    } catch (_error) {
      // Permissions policy can make getGamepads throw; treat it as no pad.
      return [];
    }
  }

  const ZERO_AXES = Object.freeze([0, 0, 0, 0]);

  class GamepadReader {
    constructor({ source = defaultSource, zone = 0.16, threshold = 0.5 } = {}) {
      if (typeof source !== "function") throw new TypeError("source must be a function");
      if (!(threshold > 0 && threshold <= 1)) throw new RangeError("threshold must be in (0, 1]");
      this.source = source;
      this.zone = zone;
      this.threshold = threshold;
      this.identity = "";
      this.connected = false;
      this.armed = false;
      this.linked = false;
      this.lost = false;
      this.axes = ZERO_AXES;
      this.values = [];
      this.heldMask = 0;
      this.pressedMask = 0;
    }

    /** Disarm: no input until every control has returned to neutral. */
    reset() {
      this.armed = false;
      this.axes = ZERO_AXES;
      this.values = [];
      this.heldMask = 0;
      this.pressedMask = 0;
    }

    /** Sample the pad once. Call once per animation frame, including while paused. */
    poll() {
      const wasArmed = this.armed;
      this.linked = false;
      this.lost = false;
      let pads;
      try {
        pads = this.source();
      } catch (_error) {
        pads = [];
      }
      const pad = selectPad(pads);
      if (!pad) {
        this.lost = wasArmed;
        this.identity = "";
        this.connected = false;
        this.reset();
        return this;
      }
      this.connected = true;
      const identity = `${pad.index}:${pad.id}`;
      if (identity !== this.identity) {
        this.identity = identity;
        this.reset();
      }
      const count = Math.min(MAX_BUTTONS, pad.buttons ? pad.buttons.length : 0);
      const rawAxes = pad.axes ? Array.from(pad.axes) : [];
      if (!this.armed) {
        let neutral = rawAxes.every((value) => deadzone(Number(value), this.zone) === 0);
        for (let i = 0; neutral && i < count; i += 1) neutral = buttonValue(pad, i) <= NEUTRAL_BUTTON;
        if (!neutral) return this;
        this.armed = true;
        this.linked = true;
        // Arming consumes this sample; nothing is held yet.
        return this;
      }
      this.axes = Object.freeze([0, 1, 2, 3].map((i) => deadzone(Number(rawAxes[i]) || 0, this.zone)));
      let held = 0;
      const values = new Array(count);
      for (let i = 0; i < count; i += 1) {
        values[i] = buttonValue(pad, i);
        if (values[i] >= this.threshold) held |= 1 << i;
      }
      this.values = values;
      held >>>= 0;
      this.pressedMask = (held & ~this.heldMask) >>> 0;
      this.heldMask = held;
      return this;
    }

    /** Button is down on this sample. */
    held(button) {
      return ((this.heldMask >>> button) & 1) === 1;
    }

    /** Button went down on this sample (edge). */
    pressed(button) {
      return ((this.pressedMask >>> button) & 1) === 1;
    }

    /** Analog button value in [0, 1] (triggers); 0 while unarmed. */
    value(button) {
      return this.values[button] || 0;
    }

    /** Deadzoned axis value in [-1, 1]. */
    axis(index) {
      return this.axes[index] || 0;
    }

    /** True when any of the given buttons is held. */
    any(...buttons) {
      for (const button of buttons) if (this.held(button)) return true;
      return false;
    }

    /** Digital directions from the d-pad or the left stick. */
    direction(threshold = 0.5) {
      const x = this.axis(AXIS.LX);
      const y = this.axis(AXIS.LY);
      return {
        left: this.held(BUTTON.LEFT) || x <= -threshold,
        right: this.held(BUTTON.RIGHT) || x >= threshold,
        up: this.held(BUTTON.UP) || y <= -threshold,
        down: this.held(BUTTON.DOWN) || y >= threshold,
      };
    }
  }

  return Object.freeze({ BUTTON, AXIS, deadzone, selectPad, GamepadReader });
});
