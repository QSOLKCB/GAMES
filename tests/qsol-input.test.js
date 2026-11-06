"use strict";
const assert = require("node:assert/strict");
const { BUTTON, AXIS, deadzone, selectPad, GamepadReader } = require("../shared/qsol-input.js");

let passed = 0;
function test(name, body) {
  body();
  passed += 1;
  process.stdout.write(`ok ${passed} - ${name}\n`);
}

function pad({ id = "Test pad", index = 0, mapping = "standard", axes = [0, 0, 0, 0], held = [], values = {} } = {}) {
  const buttons = Array.from({ length: 17 }, (_, i) => {
    const value = values[i] ?? (held.includes(i) ? 1 : 0);
    return { value, pressed: value > 0.5 };
  });
  return { id, index, mapping, connected: true, axes, buttons };
}

function harness(initial = []) {
  let pads = initial;
  const reader = new GamepadReader({ source: () => pads });
  return { reader, set(next) { pads = next; return reader.poll(); } };
}

test("deadzone rescales and rejects invalid input", () => {
  assert.equal(deadzone(0.1), 0);
  assert.equal(deadzone(-0.16), 0);
  assert.equal(deadzone(1), 1);
  assert.equal(deadzone(-1), -1);
  assert.ok(Math.abs(deadzone(0.58) - 0.5) < 1e-12);
  assert.equal(deadzone(Number.NaN), 0);
  assert.equal(deadzone(0.5, 1), 0);
  assert.equal(deadzone(2), 1);
});

test("only connected standard-mapping pads are selected", () => {
  assert.equal(selectPad(null), null);
  assert.equal(selectPad([null, pad({ mapping: "" })]), null);
  const disconnected = Object.assign(pad({ index: 0 }), { connected: false });
  const standard = pad({ index: 1 });
  assert.equal(selectPad([disconnected, standard]), standard);
});

test("a pad must return to neutral before it produces input", () => {
  const h = harness();
  h.set([pad({ held: [BUTTON.SOUTH], axes: [0.9, 0, 0, 0] })]);
  assert.equal(h.reader.connected, true);
  assert.equal(h.reader.armed, false);
  assert.equal(h.reader.held(BUTTON.SOUTH), false);
  assert.equal(h.reader.axis(AXIS.LX), 0);
  h.set([pad({ axes: [0.05, -0.1, 0, 0] })]);
  assert.equal(h.reader.armed, true);
  assert.equal(h.reader.linked, true);
  h.set([pad({ held: [BUTTON.SOUTH], axes: [0.9, 0, 0, 0] })]);
  assert.equal(h.reader.linked, false);
  assert.equal(h.reader.held(BUTTON.SOUTH), true);
  assert.equal(h.reader.pressed(BUTTON.SOUTH), true);
  assert.ok(h.reader.axis(AXIS.LX) > 0.8);
});

test("pressed is a single-sample edge; held persists", () => {
  const h = harness();
  h.set([pad()]);
  h.set([pad({ held: [BUTTON.START] })]);
  assert.equal(h.reader.pressed(BUTTON.START), true);
  h.set([pad({ held: [BUTTON.START] })]);
  assert.equal(h.reader.pressed(BUTTON.START), false);
  assert.equal(h.reader.held(BUTTON.START), true);
  h.set([pad()]);
  h.set([pad({ held: [BUTTON.START] })]);
  assert.equal(h.reader.pressed(BUTTON.START), true);
});

test("reset disarms until the held button is released", () => {
  const h = harness();
  h.set([pad()]);
  h.set([pad({ held: [BUTTON.START] })]);
  h.reader.reset();
  h.set([pad({ held: [BUTTON.START] })]);
  assert.equal(h.reader.armed, false);
  assert.equal(h.reader.pressed(BUTTON.START), false);
  h.set([pad()]);
  assert.equal(h.reader.armed, true);
  h.set([pad({ held: [BUTTON.START] })]);
  assert.equal(h.reader.pressed(BUTTON.START), true);
});

test("analog triggers use the threshold", () => {
  const h = harness();
  h.set([pad()]);
  h.set([pad({ values: { [BUTTON.RT]: 0.3 } })]);
  assert.equal(h.reader.held(BUTTON.RT), false);
  h.set([pad({ values: { [BUTTON.RT]: 0.75 } })]);
  assert.equal(h.reader.held(BUTTON.RT), true);
  assert.equal(h.reader.any(BUTTON.LT, BUTTON.RT), true);
});

test("direction merges the d-pad and left stick", () => {
  const h = harness();
  h.set([pad()]);
  h.set([pad({ held: [BUTTON.UP], axes: [-0.95, 0, 0, 0] })]);
  assert.deepEqual(h.reader.direction(), { left: true, right: false, up: true, down: false });
  h.set([pad({ axes: [0.3, 0.95, 0, 0] })]);
  assert.deepEqual(h.reader.direction(), { left: false, right: false, up: false, down: true });
});

test("losing an armed pad is reported once", () => {
  const h = harness();
  h.set([pad()]);
  h.set([pad({ held: [BUTTON.RT] })]);
  h.set([]);
  assert.equal(h.reader.lost, true);
  assert.equal(h.reader.connected, false);
  assert.equal(h.reader.held(BUTTON.RT), false);
  h.set([]);
  assert.equal(h.reader.lost, false);
});

test("an unarmed pad disconnecting is not reported as lost", () => {
  const h = harness();
  h.set([pad({ held: [BUTTON.SOUTH] })]);
  h.set([]);
  assert.equal(h.reader.lost, false);
});

test("switching pads rearms", () => {
  const h = harness();
  h.set([pad({ id: "first" })]);
  h.set([pad({ id: "first", held: [BUTTON.SOUTH] })]);
  assert.equal(h.reader.held(BUTTON.SOUTH), true);
  h.set([pad({ id: "second", held: [BUTTON.SOUTH] })]);
  assert.equal(h.reader.armed, false);
  assert.equal(h.reader.held(BUTTON.SOUTH), false);
});

test("a throwing source or missing API reads as no pad", () => {
  const reader = new GamepadReader({ source: () => { throw new Error("blocked"); } });
  reader.poll();
  assert.equal(reader.connected, false);
  assert.equal(new GamepadReader().poll().connected, false);
  assert.throws(() => new GamepadReader({ threshold: 0 }), RangeError);
});

process.stdout.write(`# ${passed} shared gamepad input tests passed\n`);
