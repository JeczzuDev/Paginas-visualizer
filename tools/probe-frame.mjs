/**
 * probe-frame.mjs -- dump one harmonized frame straight from Chrome as a
 * lossless PNG, so encoder output can be compared against the true render.
 *
 *   node tools/probe-frame.mjs red_bg.html 6.6667 out.png [--loop 240]
 */
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { harmonizeAndFreeze, seekTo, hideAuthoringUI } from "./harmonize.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [file, tRaw, outPng, ...rest] = process.argv.slice(2);
const loop = rest.includes("--loop") ? Number(rest[rest.indexOf("--loop") + 1]) : 240;
const t = Number(tRaw);

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, ""));
  fs.readFile(f, (err, buf) => {
    if (err) return res.writeHead(404).end();
    const ext = path.extname(f).toLowerCase();
    res.writeHead(200, { "Content-Type": ext === ".html" ? "text/html" : ext === ".avif" ? "image/avif" : "application/octet-stream" });
    res.end(buf);
  });
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const port = server.address().port;

const browser = await chromium.launch({
  channel: "chrome", headless: true,
  args: ["--force-device-scale-factor=1", "--force-color-profile=srgb", "--hide-scrollbars"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/${file}`, { waitUntil: "load" });
await page.evaluate(hideAuthoringUI);
await page.waitForTimeout(400);
const report = await page.evaluate(harmonizeAndFreeze, loop);
await page.evaluate((src) => { window.__seek = new Function("return " + src)(); }, seekTo.toString());
await page.evaluate((tt) => window.__seek(tt), t);

const cdp = await page.context().newCDPSession(page);
const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
await fsp.writeFile(outPng, Buffer.from(shot.data, "base64"));

console.log(JSON.stringify({ maxDriftPct: report.maxDriftPct, css: report.css.length, smil: report.smil.length,
  warnings: report.warnings }, null, 2));
console.log("wrote", outPng);

await browser.close();
server.close();
