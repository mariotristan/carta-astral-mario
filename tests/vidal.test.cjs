const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "vidal", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const ids = ["sureste", "sur", "suroeste", "oeste", "noroeste", "norte", "noreste", "este"];

function load(hash = "") {
  const events = {};
  const palaces = ids.map(id => ({ id, open: false }));
  const directions = ids.map(id => ({
    href: `#${id}`, attributes: {}, events: {},
    getAttribute(name) { return name === "href" ? this.href : this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener(name, callback) { this.events[name] = callback; }
  }));
  const controls = Object.fromEntries(["reading-toggle", "print", "actions"].map(id => [id, {
    events: {}, attributes: {}, addEventListener(name, callback) { this.events[name] = callback; },
    setAttribute(name, value) { this.attributes[name] = value; }
  }]));
  const location = { hash };
  const window = { addEventListener(name, callback) { events[name] = callback; }, print() { this.printed = true; } };
  const document = {
    querySelectorAll(selector) { return selector === ".palace" ? palaces : directions; },
    getElementById(id) { return controls[id]; }
  };
  vm.runInNewContext(script, { document, window, location });
  return { palaces, directions, controls, events, location, window };
}

test("the source contains eight distinct linked palaces and preserves ambiguous source data", () => {
  for (const id of ids) {
    assert.match(html, new RegExp(`<details class="palace[^"]*" id="${id}"`));
    assert.match(html, new RegExp(`href="#${id}"`));
  }
  assert.equal((html.match(/<details class="palace/g) || []).length, 8);
  assert.match(html, /Perro de tierra yang/);
  assert.match(html, /no especifica un elemento para el suroeste/);
  assert.match(html, /sin aclarar qué posición ocupa/);
});

test("direct links open the selected palace and update the compass", () => {
  for (const id of ids) {
    const page = load(`#${id}`);
    assert.equal(page.palaces.find(palace => palace.id === id).open, true);
    assert.equal(page.directions.find(direction => direction.href === `#${id}`).attributes["aria-current"], "location");
  }
  const page = load("#sur");
  page.location.hash = "#este";
  page.events.hashchange();
  assert.equal(page.palaces.find(palace => palace.id === "este").open, true);
  assert.equal(page.directions.find(direction => direction.href === "#sur").attributes["aria-current"], undefined);
});

test("reading and printing restore the previous open state", () => {
  const page = load("#sur");
  page.controls["reading-toggle"].events.click();
  assert.ok(page.palaces.every(palace => palace.open));
  assert.equal(page.controls["reading-toggle"].attributes["aria-pressed"], "true");
  page.controls["reading-toggle"].events.click();
  assert.deepEqual(page.palaces.filter(palace => palace.open).map(palace => palace.id), ["sur"]);
  page.events.beforeprint();
  assert.ok(page.palaces.every(palace => palace.open));
  page.events.afterprint();
  assert.deepEqual(page.palaces.filter(palace => palace.open).map(palace => palace.id), ["sur"]);
  page.controls.print.events.click();
  assert.equal(page.window.printed, true);
});
