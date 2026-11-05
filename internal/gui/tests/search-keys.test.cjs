// Run with Node's test runner and Playwright on the module path; see README.md.
// Settings' Web search section, a search API with several keys
// (SlouchyQuill on Discord, after dsh-tavily-pool): under it a row of its
// keys, In turn (the default) or In order, sent as pick "turns" or "order";
// for Tavily, what each key has used of its limit, read once as the page
// is drawn and again, fresh, on Check again. Each key is shown masked; a
// read that failed says Unknown and why, never 0; a key used up says so,
// and one asked last says until when and why. Single keys also have a
// card and an Add another key row. In five languages, Chromium and WebKit,
// 1100px and 420px wide at 800px high, with the API faked.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");
const { watchSettingsReads, settingsDrawn, reach } = require("./reader.cjs");

const assets = path.resolve(__dirname, "../assets");
const LANGS = ["en", "zh", "zh-TW", "ja", "de"];
// the words as i18n.js has them
const I18N = (() => {
  const src = require("node:fs").readFileSync(path.join(assets, "i18n.js"), "utf8");
  return new Function(src.slice(0, src.indexOf("\n};") + 3) + "; return I18N;")();
})();
const tr = (lang, s, vars = {}) => {
  const got = lang === "en" ? s : I18N[lang][s];
  assert(got, `"${s}" has no ${lang} translation`);
  return got.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
};

const vendors = [
  { id: "tavily", name: "Tavily", keysURL: "https://app.tavily.com/home", base: "https://api.tavily.com" },
  { id: "exa", name: "Exa", keysURL: "https://dashboard.exa.ai/api-keys", base: "https://api.exa.ai" },
  { id: "brave", name: "Brave Search", keysURL: "https://api-dashboard.search.brave.com/app/keys", base: "https://api.search.brave.com" },
  { id: "searxng", name: "SearXNG", needURL: true },
];
const restUntil = new Date(Date.now() + 50 * 60 * 1000).toISOString();
const quotas = (used) => [
  { id: "tavily-0", key: "tvly-…aaaa", known: true, used, limit: 1000, of: "key" },
  { id: "tavily-1", key: "tvly-…bbbb", known: true, used: 1000, limit: 1000, of: "plan", plan: "Researcher", usedUp: true, resting: "used up", restUntil },
  { id: "tavily-2", key: "tvly-…cccc", known: false, used: 0, limit: 0, err: "401 Unauthorized" },
];

function serve(lang, posted) {
  let pick = "";
  let reads = 0;
  let exaKeys = [
    { id: "exa-0", key: "728f…63b0", resting: "out of credit", restUntil },
    { id: "exa-1", key: "c724…d188" },
  ];
  let braveKeys = [{ id: "brave-0", key: "BSA…wxyz" }];
  const mask = (k) => k.slice(0, 4) + "…" + k.slice(-4);
  const settings = () => ({
    lang, theme: "light", searchVendors: vendors,
    searchAPIs: [
      { vendor: "tavily", name: "Tavily", key: "tvly-…aaaa, tvly-…bbbb, tvly-…cccc", keys: 3, keyList: quotas(0).map(({ id, key }) => ({ id, key })), quota: true, pick, ready: true },
      { vendor: "exa", name: "Exa", key: exaKeys.map((k) => k.key).join(", "), keys: exaKeys.length, keyList: exaKeys, ready: true },
      { vendor: "brave", name: "Brave Search", key: braveKeys.map((k) => k.key).join(", "), keys: braveKeys.length, keyList: braveKeys, ready: true },
      { vendor: "searxng", name: "SearXNG", url: "https://sx.example.com", ready: true },
    ],
  });
  return async (r) => {
    const url = new URL(r.request().url());
    const json = (data, status = 200) => r.fulfill({ status, json: data });
    if (url.pathname === "/boot.js") return r.fulfill({ contentType: "text/javascript", body: `window.bootPrefs = {lang:"${lang}",theme:"light",web:true};` });
    if (url.pathname === "/wails/runtime.js") return r.fulfill({ contentType: "text/javascript", body: "export const Window = {};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings: settings() });
    if (url.pathname === "/api/settings") return json(settings());
    if (url.pathname === "/api/settings/search-api") {
      const b = JSON.parse(r.request().postData());
      posted.push(b);
      if (b.pick) pick = b.pick === "turns" ? "" : b.pick;
      else if (b.vendor === "exa" && b.remove && b.ref) exaKeys = exaKeys.filter(k => k.id !== b.ref);
      else if (b.vendor === "exa" && b.ref) exaKeys = exaKeys.map(k => (k.id === b.ref ? { id: "exa-new", key: mask(b.key) } : k));
      else if (b.vendor === "brave" && b.key) braveKeys = [...braveKeys, { id: "brave-new", key: mask(b.key) }];
      return json(settings());
    }
    if (url.pathname === "/api/settings/search-key") {
      posted.push({ reveal: r.request().postDataJSON() });
      return json({ key: "fixture-copied-key" });
    }
    if (url.pathname === "/api/settings/search-quota") {
      const b = JSON.parse(r.request().postData());
      posted.push({ quota: b });
      reads++;
      return json({ keys: quotas(reads > 1 ? 813 : 812) });
    }
    if (url.pathname === "/api/plugins") return json({ plugins: [] });
    if (url.pathname === "/api/groups") return json({ models: [], groups: [], pools: [] });
    if (url.pathname === "/api/providers") return json({ providers: [], presets: [], excluded: [], gateway: { running: true, window: true, url: "http://127.0.0.1:3999" } });
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    const contentType = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" }[path.extname(file)];
    await r.fulfill({ body: await fs.readFile(file), contentType });
  };
}

for (const engine of (process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"])) {
  for (const lang of LANGS) for (const width of [1100, 420]) {
    test(`${engine} ${lang} ${width}px: a search API's keys take turns and say what each has used`, async (t) => {
      const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
      t.after(() => browser.close());
      const page = await (await browser.newContext({ viewport: { width, height: 800 }, reducedMotion: "reduce" })).newPage();
      page.setDefaultTimeout(5000);
      page.setDefaultNavigationTimeout(60000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const posted = [];
      await page.route("**/*", serve(lang, posted));
      await watchSettingsReads(page);
      await page.goto("http://magpie.test/?view=settings&tab=models");
      await settingsDrawn(page);
      const allKeys = page.locator("#searchList .row.search-keys");
      await allKeys.first().waitFor();
      // Tavily, Exa and Brave each have keys; SearXNG (no key) has no keys row
      assert.equal(await allKeys.count(), 3);
      const keys = allKeys.first(), exaKeysRow = allKeys.nth(1), braveKeysRow = allKeys.nth(2);
      assert.equal(await keys.getAttribute("data-vendor"), "tavily");
      assert.equal(await keys.locator(".name").innerText(), tr(lang, "Keys of {name}", { name: "Tavily" }));
      assert.equal(await exaKeysRow.getAttribute("data-vendor"), "exa");
      assert.equal(await exaKeysRow.locator(".name").innerText(), tr(lang, "Keys of {name}", { name: "Exa" }));
      assert.equal(await braveKeysRow.getAttribute("data-vendor"), "brave");

      const lines = keys.locator(".search-quota .quota-key");
      await page.waitForFunction(() => document.querySelectorAll('#searchList .search-keys[data-vendor="tavily"] .quota-key').length === 3);
      assert.deepEqual(await lines.locator("code").allInnerTexts(), ["tvly-…aaaa", "tvly-…bbbb", "tvly-…cccc"]);
      const exaLines = exaKeysRow.locator(".search-quota .quota-key");
      assert.deepEqual(await exaLines.locator("code").allInnerTexts(), ["728f…63b0", "c724…d188"]);
      assert.equal(await lines.nth(0).locator(".used").innerText(), tr(lang, "{used} of {limit} used", { used: "812", limit: await page.evaluate(() => (1000).toLocaleString(intlLang())) }));
      // used up: said, with the plan it is of and why it is asked last
      assert.equal(await lines.nth(1).locator(".warn").last().innerText(), tr(lang, "used up"));
      const note = await lines.nth(1).locator(".faint").innerText();
      assert(note.includes(tr(lang, "{plan} plan, shared by its account's keys", { plan: "Researcher" })), note);
      const until = await page.evaluate((u) => new Date(u).toLocaleTimeString(intlLang(), { hour: "2-digit", minute: "2-digit" }), restUntil);
      assert(note.includes(tr(lang, "asked last until {time}: {why}", { time: until, why: tr(lang, "used up") })), note);
      const exaNote = await exaLines.nth(0).locator(".faint").innerText();
      assert(exaNote.includes(tr(lang, "asked last until {time}: {why}", { time: until, why: tr(lang, "out of credit") })), exaNote);
      // a failed read: unknown and why, never 0
      const unknown = await lines.nth(2).locator(".used").innerText();
      assert.equal(unknown, tr(lang, "Unknown: {why}", { why: "401 Unauthorized" }));
      assert(!/(^|\D)0(\D|$)/.test(unknown.replace("401", "")), unknown);
      assert.equal(await lines.nth(2).locator(".used.err").count(), 1);
      assert.deepEqual(posted, [{ quota: { vendor: "tavily", fresh: false } }]);
      assert(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), "nothing wider than the window");
      // the page clips what is past its edge, so each control is measured
      const past = await keys.evaluate((r) => [...r.querySelectorAll("button, code, .used")]
        .filter((e) => e.getBoundingClientRect().right > innerWidth + 0.5).map((e) => e.textContent));
      assert.deepEqual(past, [], "nothing past the window's edge");

      const where = () => page.evaluate(() => [scrollX, scrollY, document.scrollingElement.scrollTop, document.querySelector("#view-settings")?.scrollTop]);
      // Settings is drawn again after each change: a box is taken from the
      // row that stays
      const click = async (loc) => {
        await reach(page, loc);
        const before = await where();
        const b = await loc.boundingBox();
        assert(b, "the button is in the page");
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        return before;
      };
      const beforeCheck = await click(keys.locator("button.search-quota-again", { hasText: tr(lang, "Check again") }));
      await page.waitForFunction(() => /813/.test(document.querySelector("#searchList .search-keys .quota-key .used")?.innerText || ""));
      assert.deepEqual(posted.at(-1), { quota: { vendor: "tavily", fresh: true } });
      assert.deepEqual(await where(), beforeCheck, "checking quotas doesn't scroll");
      // In order, then In turn again
      const segs = keys.locator(".segs .opt");
      assert.deepEqual(await segs.allInnerTexts(), [tr(lang, "In turn"), tr(lang, "In order")]);
      assert.equal(await segs.nth(0).getAttribute("aria-pressed"), "true");
      const beforeOrder = await click(segs.nth(1));
      await page.waitForFunction(() => document.querySelectorAll('#searchList .search-keys[data-vendor="tavily"] .segs .opt')[1]?.getAttribute("aria-pressed") === "true");
      assert.deepEqual(posted.filter((p) => p.pick), [{ vendor: "tavily", pick: "order" }]);
      assert.deepEqual(await where(), beforeOrder, "changing the key order doesn't scroll");
      const beforeTurns = await click(keys.locator(".segs .opt").nth(0));
      await page.waitForFunction(() => document.querySelectorAll('#searchList .search-keys[data-vendor="tavily"] .segs .opt')[0]?.getAttribute("aria-pressed") === "true");
      assert.deepEqual(posted.filter((p) => p.pick), [{ vendor: "tavily", pick: "order" }, { vendor: "tavily", pick: "turns" }]);
      // redrawn with the same keys, it isn't read again
      assert.equal(posted.filter((p) => p.quota).length, 2);
      assert.equal(await keys.locator(".quota-key").count(), 3);
      assert.deepEqual(await where(), beforeTurns, "changing to turns doesn't scroll");

      // Change key (pencil) and Remove under Keys of Exa (#4597)
      await reach(page, exaLines.nth(0).locator("button.copy"));
      const copied = page.waitForResponse(r => new URL(r.url()).pathname === "/api/settings/search-key");
      await click(exaLines.nth(0).locator("button.copy"));
      await copied;
      assert.deepEqual(posted.at(-1), { reveal: { vendor: "exa", ref: "exa-0" } });
      const beforeExa = await click(exaLines.nth(0).locator("button.quota-key-edit"));
      assert.equal(await exaLines.nth(0).locator("input.search-key-edit").count(), 1);
      await page.keyboard.press("Escape");
      assert.equal(await exaLines.nth(0).locator("input.search-key-edit").count(), 0);
      assert.deepEqual(await where(), beforeExa, "opening or cancelling an edit doesn't scroll");
      const beforeEdit = await click(exaLines.nth(0).locator("button.quota-key-edit"));
      await page.keyboard.type("exa1-000000001111");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => document.querySelector('#searchList .search-keys[data-vendor="exa"] .quota-key code')?.textContent === "exa1…1111");
      assert.deepEqual(posted.at(-1), { vendor: "exa", ref: "exa-0", key: "exa1-000000001111" });
      assert.deepEqual(await exaLines.locator("code").allInnerTexts(), ["exa1…1111", "c724…d188"]);
      assert.deepEqual(await where(), beforeEdit, "editing a key doesn't scroll");
      const beforeRemove = await click(exaLines.nth(1).locator("button.quota-key-rm", { hasText: tr(lang, "Remove") }));
      await page.waitForFunction(() => document.querySelectorAll('#searchList .search-keys[data-vendor="exa"] .quota-key').length === 1);
      assert.deepEqual(posted.at(-1), { vendor: "exa", ref: "exa-1", remove: true });
      assert.equal(await exaLines.nth(0).locator(".using").innerText(), tr(lang, "In use"));
      assert.deepEqual(await where(), beforeRemove, "removing a key doesn't scroll");

      // Add another key at the foot of .accts.keys (as on Providers)
      await click(braveKeysRow.locator("button.acc.add", { hasText: tr(lang, "Add another key") }));
      await click(braveKeysRow.locator("input.search-key-add"));
      await page.keyboard.type("bsa2-000000009999");
      const beforeBrave = await click(braveKeysRow.locator(".acc.adding button.primary", { hasText: tr(lang, "Add") }));
      await page.waitForFunction(() => document.querySelectorAll('#searchList .search-keys[data-vendor="brave"] .quota-key').length === 2);
      assert.deepEqual(posted.at(-1), { vendor: "brave", key: "bsa2-000000009999", url: "" });
      assert.deepEqual(await braveKeysRow.locator(".quota-key code").allInnerTexts(), ["BSA…wxyz", "bsa2…9999"]);
      assert.deepEqual(await where(), beforeBrave, "adding a key doesn't scroll");

      assert(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth), "nothing wider than the window");
      assert.deepEqual(errors, []);
    });
  }
}
