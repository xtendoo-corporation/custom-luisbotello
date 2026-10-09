import assert from "node:assert/strict";
import {describe, it} from "node:test";
import {MockTransport} from "../../static/src/app/redsys/mock/mock_transport.js";
import {
  buildScenarioSpec,
  isSimConsoleRequested,
  mountSimConsole,
  shouldShowSimConsole,
} from "../../static/src/app/redsys/mock/sim_console.js";

// DOM mínimo suficiente para el panel.
class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.parentNode = null;
    this.value = "";
    this.checked = false;
    this._text = "";
  }
  set textContent(v) {
    this._text = v;
  }
  get textContent() {
    return this._text;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  appendChild(c) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  removeChild(c) {
    this.children = this.children.filter((x) => x !== c);
    c.parentNode = null;
  }
  find(role) {
    if (this.attrs["data-role"] === role) return this;
    for (const c of this.children) {
      const f = c.find(role);
      if (f) return f;
    }
    return null;
  }
}
const fakeDoc = () => ({createElement: (t) => new FakeEl(t), body: new FakeEl("body")});

describe("puerta de la consola", () => {
  const t = new MockTransport();
  it("flag de URL", () => {
    assert.ok(isSimConsoleRequested("?redsys_sim=1"));
    assert.ok(isSimConsoleRequested("?debug=assets&redsys_sim=1"));
    assert.ok(isSimConsoleRequested("#action=1&redsys_sim=1"));
    assert.ok(!isSimConsoleRequested("?redsys_sim=0"));
    assert.ok(!isSimConsoleRequested("?debug=assets"));
    assert.ok(!isSimConsoleRequested(""));
  });
  it("requiere URL + flag del método + transporte mock", () => {
    const base = {search: "?redsys_sim=1", methodSimulation: true, transport: t};
    assert.ok(shouldShowSimConsole(base));
    assert.ok(!shouldShowSimConsole({...base, search: ""}));
    assert.ok(!shouldShowSimConsole({...base, methodSimulation: false}));
    assert.ok(!shouldShowSimConsole({...base, methodSimulation: undefined}));
    assert.ok(!shouldShowSimConsole({...base, transport: {isMock: false}}));
    assert.ok(!shouldShowSimConsole({...base, transport: null}));
    assert.ok(!shouldShowSimConsole());
  });
});

describe("panel", () => {
  it("buildScenarioSpec", () => {
    assert.deepEqual(buildScenarioSpec({name: "authorized"}), {name: "authorized"});
    assert.deepEqual(
      buildScenarioSpec({name: "denied", denialCode: "116", cardRead: "500"}),
      {
        name: "denied",
        denialCode: "116",
        latency: {cardRead: 500},
      }
    );
    assert.deepEqual(buildScenarioSpec({name: "init_error", code: "-40"}), {
      name: "init_error",
      code: -40,
    });
  });

  it("forzar siguiente encola, vaciar cola y cerrar", () => {
    const t = new MockTransport();
    const doc = fakeDoc();
    const ui = mountSimConsole(t, {document: doc});
    assert.equal(doc.body.children.length, 1);
    const sel = ui.element.find("scenario");
    sel.value = "denied";
    ui.element.find("denial").value = "117";
    ui.element.find("force").onclick();
    assert.deepEqual(t.queue, [{name: "denied", denialCode: "117"}]);
    assert.match(ui.element.find("queue").textContent, /denied/);
    ui.element.find("clear").onclick();
    assert.equal(t.queue.length, 0);
    ui.element.find("close").onclick();
    assert.equal(doc.body.children.length, 0);
  });
});
