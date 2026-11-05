const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { test } = require("node:test");
const { chromium, webkit } = require("playwright");
const { reach, settingsDrawn, watchSettingsReads } = require("./reader.cjs");

const assets = path.resolve(__dirname, "../assets");
async function fixture(t, engine) {
  const browser = await (engine === "webkit" ? webkit.launch() : chromium.launch({ channel: "chromium" }));
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 420, height: 800 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(5000);
  const errors = [], reads = [], posts = [];
  page.on("pageerror", e => errors.push(e.message));
  let keys = [{ id: "first", key: "tvly-…same" }, { id: "second", key: "tvly-…same" }];
  const settings = () => ({ lang: "en", theme: "light", searchVendors: [{ id: "tavily", name: "Tavily", base: "https://api.tavily.com" }],
    searchAPIs: [{ vendor: "tavily", name: "Tavily", ready: true, quota: true, keys: keys.length, key: keys.map(k => k.key).join(", "), keyList: keys }] });
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    const json = data => route.fulfill({ json: data });
    if (url.pathname === "/boot.js") return route.fulfill({ contentType: "text/javascript", body: 'window.bootPrefs={lang:"en",theme:"light",web:true};' });
    if (url.pathname === "/wails/runtime.js") return route.fulfill({ contentType: "text/javascript", body: "export const Window={};" });
    if (url.pathname === "/api/state") return json({ agents: [], profiles: [], settings: settings() });
    if (url.pathname === "/api/settings") return json(settings());
    if (url.pathname === "/api/settings/search-quota") { reads.push({ route, keys: keys.map(k => ({ ...k })) }); return; }
    if (url.pathname === "/api/settings/search-api") {
      const body = route.request().postDataJSON();
      posts.push(body);
      if (body.key && !body.ref) keys = [...keys, { id: "third", key: "tvly-…0003" }];
      return json(settings());
    }
    if (url.pathname === "/api/plugins") return json({ plugins: [] });
    if (url.pathname === "/api/groups") return json({ models: [], groups: [], pools: [] });
    if (url.pathname === "/api/providers") return json({ providers: [], presets: [], excluded: [], gateway: { running: true, window: true, url: "http://127.0.0.1:3999" } });
    if (url.pathname.startsWith("/api/")) return json({});
    const file = path.join(assets, url.pathname === "/" ? "index.html" : url.pathname);
    return route.fulfill({ body: await fs.readFile(file), contentType: { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".svg": "image/svg+xml" }[path.extname(file)] });
  });
  await watchSettingsReads(page);
  await page.goto("http://magpie.test/?view=settings&tab=models");
  await settingsDrawn(page);
  const list = page.locator('.search-keys[data-vendor="tavily"]');
  await list.waitFor();
  const click = async locator => { await reach(page, locator); await locator.click(); };
  return { page, list, reads, posts, errors, click };
}

for (const engine of process.env.BROWSER ? [process.env.BROWSER] : ["chromium", "webkit"]) {
  test(`${engine}: saved search keys remain editable while quotas load or fail`, async t => {
    const { page, list, reads, errors, click } = await fixture(t, engine);
    assert.equal(await list.locator(".quota-key").count(), 2, "loading must not hide saved keys");
    assert.equal(await list.locator("button.quota-key-rm").count(), 2);
    assert.equal(await list.locator("button.acc.add").count(), 1);
    await click(list.locator(".quota-key-edit").first());
    const editor = list.locator("input.search-key-edit");
    await editor.fill("fixture-new-value");
    await reads[0].route.fulfill({ status: 503, json: { error: "quota unavailable" } });
    await list.locator(".err").first().waitFor();
    assert.equal(await list.locator(".quota-key").count(), 2, "a quota request error must not hide saved keys");
    assert.equal(await editor.inputValue(), "fixture-new-value", "a quota result must keep the editor's value");
    assert(await editor.evaluate(e => document.activeElement === e), "a quota result must keep keyboard focus");
    await page.keyboard.press("Escape");
    await click(list.locator(".search-quota-again"));
    assert.equal(await list.locator(".quota-key").count(), 2);
    await reads[1].route.fulfill({ json: { keys: [
      { id: "second", key: "tvly-…same", known: true, used: 20, limit: 100 },
      { id: "first", key: "tvly-…same", known: true, used: 10, limit: 100 },
    ] } });
    await page.waitForFunction(() => document.querySelector(".search-quota .used")?.textContent === "10 of 100 used");
    assert.deepEqual(await list.locator(".used").allTextContents(), ["10 of 100 used", "20 of 100 used"], "quotas follow identity, even with identical masked keys");
    assert.deepEqual(errors, []);
  });

  test(`${engine}: an older quota response cannot replace newly added keys`, async t => {
    const { page, list, reads, posts, errors, click } = await fixture(t, engine);
    await click(page.locator("input.search-key"));
    await page.keyboard.type("fixture-third-key");
    await click(page.locator(".search-add").getByRole("button", { name: "Add", exact: true }));
    await page.waitForFunction(() => document.querySelector(".search-api .sub")?.textContent.includes("0003"));
    assert.equal(posts.length, 1);
    assert.equal(reads.length, 2);
    const release = (at, used) => reads[at].route.fulfill({ json: { keys: reads[at].keys.map(k => ({ ...k, known: true, used, limit: 100 })) } });
    await release(1, 20);
    await page.waitForFunction(() => document.querySelectorAll(".search-quota .used").length === 3);
    await release(0, 10);
    await page.waitForLoadState("networkidle");
    assert.equal(await list.locator(".quota-key").count(), 3, "late quota replies cannot drop the new key");
    assert.deepEqual(await list.locator(".used").allTextContents(), ["20 of 100 used", "20 of 100 used", "20 of 100 used"]);
    assert.deepEqual(errors, []);
  });
}
