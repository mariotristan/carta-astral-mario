const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

class Element {
  constructor() {
    this.attributes = {};
    this.dataset = {};
    this.children = [];
    this.events = {};
    const classes = new Set();
    this.classList = {
      add: name => classes.add(name),
      contains: name => classes.has(name),
      toggle: (name, force = !classes.has(name)) => {
        if (force) classes.add(name);
        else classes.delete(name);
        return force;
      }
    };
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "data-house") this.dataset.house = String(value);
  }
  getAttribute(name) { return this.attributes[name]; }
  appendChild(child) { this.children.push(child); }
  prepend(child) { this.children.unshift(child); }
  after(element) { this.next = element; }
  addEventListener(name, handler) { this.events[name] = handler; }
  focus() { this.focused = true; }
  scrollIntoView() { this.scrolled = true; }
  querySelectorAll() { return this.children.filter(child => child.dataset.house); }
  querySelector(selector) { return this.parts[selector]; }
}

function load(hash = "") {
  const ids = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  const directions = [...html.matchAll(/class="direction" aria-pressed="false"><b>(.*?)<\/b><span>(.*?)<\/span>/g)].map(match => {
    const element = new Element();
    element.parts = { b: { textContent: match[1] }, span: { textContent: match[2] } };
    return element;
  });
  const selectors = Object.fromEntries([".orbit", "#qi-compass .center", "#casas .explorer", ".house-controls", ".qi-controls", ".explorer-body"].map(selector => [selector, new Element()]));
  const themes = [new Element(), new Element(), new Element()];
  themes[2].open = true;
  const body = new Element();
  const document = {
    body,
    getElementById: id => ids[id],
    createElement: () => new Element(),
    createElementNS: () => new Element(),
    querySelector: selector => selectors[selector],
    querySelectorAll: selector => selector === ".house-btn" ? ids["house-list"].children : selector === "#qi-compass button" ? directions : themes.filter(theme => !theme.open),
    addEventListener() {}
  };
  let url = new URL(`https://example.test/carta/${hash}`);
  const location = {
    get href() { return url.href; },
    get hash() { return url.hash; }
  };
  const events = {};
  const window = { addEventListener: (name, handler) => { events[name] = handler; }, print() { this.printed = true; } };
  const entries = [{ url: url.href, state: null }];
  let position = 0;
  const history = {
    pushState(state, _, href) {
      url = new URL(href, url);
      entries.splice(++position);
      entries.push({ url: url.href, state });
    },
    replaceState(state, _, href) {
      url = new URL(href, url);
      entries[position] = { url: url.href, state };
    }
  };
  const context = vm.createContext({ document, window, history, location, URL });
  vm.runInContext(script, context);
  return {
    ids, directions, body, themes, window, events, location, selectors,
    run: code => vm.runInContext(code, context),
    navigate(hash) { url.hash = hash; events.hashchange(); },
    back() { const entry = entries[--position]; url = new URL(entry.url); events.popstate({ state: entry.state }); },
    forward() { const entry = entries[++position]; url = new URL(entry.url); events.popstate({ state: entry.state }); }
  };
}

test("direct links restore houses and Qi Men with synchronized controls", () => {
  const house = load("#casa-10");
  assert.equal(house.ids["house-count"].textContent, "10 / 12");
  assert.equal(house.ids["house-list"].children[9].getAttribute("aria-pressed"), "true");
  assert.ok(house.ids["house-detail"].innerHTML.includes("Aries / Virgo, pendiente de confirmar"));
  assert.equal(house.selectors[".explorer-body"].scrolled, true);
  const qi = load("#qi-norte");
  assert.equal(qi.ids["qi-direction"].textContent, "Norte");
  assert.equal(qi.ids["qi-selection"].dataset.element, "water");
  assert.equal(qi.directions[6].getAttribute("aria-pressed"), "true");
});

test("history restores both selections, including the original section link", () => {
  const page = load("#casas");
  page.run("selectHouse(5)");
  assert.equal(page.location.hash, "#casa-5");
  page.run("selectDirection(7)");
  assert.equal(page.location.hash, "#qi-noroeste");
  page.back();
  assert.equal(page.ids["house-count"].textContent, "5 / 12");
  assert.equal(page.ids["qi-direction"].textContent, "Sureste");
  page.back();
  assert.equal(page.ids["house-count"].textContent, "1 / 12");
  page.forward();
  assert.equal(page.ids["house-count"].textContent, "5 / 12");
});

test("every house and direction has a reloadable direct link", () => {
  const page = load();
  for (let number = 1; number <= 12; number++) {
    page.run(`selectHouse(${number})`);
    const href = page.run("houseLink.href");
    assert.equal(href, `#casa-${number}`);
    assert.equal(load(href).ids["house-count"].textContent, `${number} / 12`);
  }
  for (let index = 0; index < 8; index++) {
    page.run(`selectDirection(${index})`);
    const href = page.run("qiLink.href");
    assert.equal(load(href).ids["qi-direction"].textContent, page.ids["qi-direction"].textContent);
  }
});

test("invalid direct links show an error instead of claiming a matching selection", () => {
  for (const hash of ["#casa-99", "#casa-abc", "#qi-desconocido"]) {
    const page = load(hash);
    assert.match(page.ids["utility-bar"].next.textContent, /no existe|no es válido/);
  }
});

test("reading mode contains all houses and print restores closed reflections", () => {
  const page = load();
  const reading = page.selectors["#casas .explorer"].next;
  assert.equal((reading.innerHTML.match(/class="reading-house"/g) || []).length, 12);
  assert.ok(reading.innerHTML.includes("Medio Cielo pendiente de confirmar"));
  page.ids["reading-toggle"].events.click();
  assert.equal(page.body.classList.contains("reading-mode"), true);
  assert.equal(page.ids["reading-toggle"].getAttribute("aria-pressed"), "true");
  page.navigate("#casa-7");
  assert.equal(reading.scrolled, true);
  page.events.beforeprint();
  assert.ok(page.themes.every(theme => theme.open));
  page.events.afterprint();
  assert.equal(page.themes[0].open, false);
  assert.equal(page.themes[2].open, true);
  page.ids["print-page"].events.click();
  assert.equal(page.window.printed, true);
  page.ids["reading-toggle"].events.click();
  assert.equal(page.body.classList.contains("reading-mode"), false);
});
