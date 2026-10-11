"use strict";
/*
 * 双色球 / 大乐透 开奖号码筛选器 —— 本地服务端
 * 职责：从官方渠道抓取开奖数据、缓存到磁盘、向前端提供 JSON 接口与静态页面。
 * 依赖：仅 Node.js 内置模块（无 npm 依赖）。
 *
 *   双色球 数据源：中国福利彩票官网  www.cwl.gov.cn
 *   大乐透 数据源：中国体育彩票官网  webapi.sporttery.cn
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = __dirname;
const PUB = path.join(ROOT, "public");
const DATA = path.join(ROOT, "data");
const PORT_START = Number(process.env.PORT || 8788);
const TTL_MS = 6 * 60 * 60 * 1000; // 缓存 6 小时

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const GAMES = {
  ssq: {
    key: "ssq",
    name: "双色球",
    frontLabel: "红球", backLabel: "蓝球",
    frontMax: 33, backMax: 16,
    frontPick: 6, backPick: 1,
    source: "中国福利彩票官网",
    homepage: "https://www.cwl.gov.cn/"
  },
  dlt: {
    key: "dlt",
    name: "大乐透",
    frontLabel: "前区", backLabel: "后区",
    frontMax: 35, backMax: 12,
    frontPick: 5, backPick: 2,
    source: "中国体育彩票官网",
    homepage: "https://www.lottery.gov.cn/"
  }
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fetchJson(target, headers, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const req = https.get(
      { hostname: u.hostname, path: u.pathname + u.search, headers, timeout: 25000 },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
          res.resume();
          resolve(fetchJson(new URL(res.headers.location, target).href, headers, redirects + 1));
          return;
        }
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (d) => { buf += d; });
        res.on("end", () => {
          if (res.statusCode !== 200) { reject(new Error("HTTP " + res.statusCode)); return; }
          try { resolve(JSON.parse(buf)); } catch (e) { reject(new Error("响应不是合法 JSON: " + buf.slice(0, 100))); }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
  });
}

function numOf(v) {
  if (v === null || v === undefined || v === "") { return null; }
  const n = Number(String(v).replace(/[,\s]/g, ""));
  return isFinite(n) ? n : null;
}

function weekdayOf(iso) { // 1=周一 … 7=周日
  const d = new Date(iso + "T00:00:00Z");
  if (isNaN(d.getTime())) { return 0; }
  const w = d.getUTCDay();
  return w === 0 ? 7 : w;
}

function parseCode(code) {
  const s = String(code || "");
  if (s.length >= 7) { return { year: Number(s.slice(0, 4)), issue: Number(s.slice(4)) }; }
  if (s.length >= 5) { return { year: 2000 + Number(s.slice(0, 2)), issue: Number(s.slice(2)) }; }
  return { year: 0, issue: 0 };
}

async function fetchText(target, headers, redirects) {
  redirects = redirects || 0;
  return new Promise((resolve, reject) => {
    const u = new URL(target);
    const req = https.get({ hostname: u.hostname, path: u.pathname + u.search, headers, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        resolve(fetchText(new URL(res.headers.location, target).href, headers, redirects + 1));
        return;
      }
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { buf += d; });
      res.on("end", () => resolve(buf));
    });
    req.on("timeout", () => req.destroy(new Error("请求超时")));
    req.on("error", reject);
  });
}

// 双色球：官网按年抓取（官网接口仅回溯到 2013 年），更早年份用历史开奖库补齐
async function fetchSsq() {
  const HEADERS = { "User-Agent": UA, "Referer": "https://www.cwl.gov.cn/", "Accept": "application/json, text/javascript, */*; q=0.01" };
  const HIST_HEADERS = { "User-Agent": UA, "Referer": "https://datachart.500.com/ssq/", "Accept": "text/html,application/xhtml+xml" };
  const out = [];
  const thisYear = new Date().getFullYear();

  // 官网按年抓取（官网接口仅回溯到 2013 年）
  for (let y = thisYear; y >= 2013; y--) {
    try {
      const api = "https://www.cwl.gov.cn/cwl_admin/front/cwlkj/search/kjxx/findDrawNotice"
        + "?name=ssq&issueCount=&pageNo=1&pageSize=500&dayStart=" + y + "-01-01&dayEnd=" + y + "-12-31&systemType=PC";
      const j = await fetchJson(api, HEADERS);
      for (const d of (j.result || [])) {
        const reds = String(d.red || "").split(",").map(Number).filter((v) => v >= 1 && v <= 33).sort((x, y2) => x - y2);
        const blue = Number(d.blue);
        if (reds.length !== 6 || !(blue >= 1 && blue <= 16)) { continue; }
        const grades = Array.isArray(d.prizegrades) ? d.prizegrades : [];
        const g1 = grades.find((x) => Number(x.type) === 1) || {};
        const g2 = grades.find((x) => Number(x.type) === 2) || {};
        out.push({
          code: String(d.code), codeShow: String(d.code),
          date: String(d.date || "").slice(0, 10),
          reds, blues: [blue],
          pool: numOf(d.poolmoney), sales: numOf(d.sales),
          p1c: numOf(g1.typenum), p1m: numOf(g1.typemoney),
          p2c: numOf(g2.typenum), p2m: numOf(g2.typemoney),
          notice: d.detailsLink ? "https://www.cwl.gov.cn" + d.detailsLink : ""
        });
      }
    } catch (e) { /* 单年失败不影响整体 */ }
    await sleep(150);
  }

  // 补齐 2013 年之前的期次（同时带回官网口径的奖池/一等奖/二等奖/销售额）
  try {
    const end = String(thisYear).slice(2) + "999";
    const html = await fetchText("https://datachart.500.com/ssq/history/newinc/history.php?start=03001&end=" + end, HIST_HEADERS);
    const rows = [...html.matchAll(/<tr[^>]*class="t_tr1"[^>]*>([\s\S]*?)<\/tr>/g)];
    for (const row of rows) {
      const c = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1].replace(/<[^>]*>/g, "").replace(/&nbsp;/g, "").trim());
      if (c.length < 17) { continue; }
      const reds = c.slice(2, 8).map(Number).filter((v) => v >= 1 && v <= 33).sort((x, y2) => x - y2);
      const blue = Number(c[8]);
      if (reds.length !== 6 || !(blue >= 1 && blue <= 16)) { continue; }
      out.push({
        code: c[1], codeShow: c[1], date: c[16],
        reds, blues: [blue],
        pool: numOf(c[10]), sales: numOf(c[15]),
        p1c: numOf(c[11]), p1m: numOf(c[12]),
        p2c: numOf(c[13]), p2m: numOf(c[14]),
        notice: ""
      });
    }
  } catch (e) { /* 补齐失败时仍保留官网数据 */ }

  return out;
}

async function fetchDlt() {
  const HEADERS = { "User-Agent": UA, "Referer": "https://www.lottery.gov.cn/", "Accept": "application/json, text/plain, */*" };
  const SIZE = 100;
  const out = [];
  let total = Infinity;
  for (let page = 1; page <= 60; page++) {
    const api = "https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry"
      + "?gameNo=85&provinceId=0&pageSize=" + SIZE + "&isVerify=1&pageNo=" + page;
    const j = await fetchJson(api, HEADERS);
    const v = j.value || {};
    if (page === 1) { total = Number(v.total) || Infinity; }
    const list = v.list || [];
    for (const d of list) {
      const nums = String(d.lotteryDrawResult || "").trim().split(/\s+/).map(Number);
      if (nums.length < 7) { continue; }
      const front = nums.slice(0, 5).filter((x) => x >= 1 && x <= 35).sort((a2, b2) => a2 - b2);
      const back = nums.slice(5, 7).filter((x) => x >= 1 && x <= 12).sort((a2, b2) => a2 - b2);
      if (front.length !== 5 || back.length !== 2) { continue; }
      const lv = Array.isArray(d.prizeLevelList) ? d.prizeLevelList : [];
      const pick = (name) => lv.find((x) => String(x.prizeLevel || "").trim() === name) || {};
      const a1 = pick("一等奖"), a1a = pick("一等奖(追加)"), a2 = pick("二等奖");
      out.push({
        code: String(d.lotteryDrawNum), codeShow: String(d.lotteryDrawNum),
        date: String(d.lotteryDrawTime || "").slice(0, 10),
        reds: front, blues: back,
        pool: numOf(d.poolBalanceAfterdraw != null ? d.poolBalanceAfterdraw : d.poolBalance),
        sales: numOf(d.totalSaleAmount),
        p1c: numOf(a1.stakeCount), p1m: numOf(a1.stakeAmountFormat != null ? a1.stakeAmountFormat : a1.stakeAmount),
        p1ac: numOf(a1a.stakeCount), p1am: numOf(a1a.stakeAmountFormat != null ? a1a.stakeAmountFormat : a1a.stakeAmount),
        p2c: numOf(a2.stakeCount), p2m: numOf(a2.stakeAmountFormat != null ? a2.stakeAmountFormat : a2.stakeAmount),
        notice: String(d.drawPdfUrl || "")
      });
    }
    if (list.length < SIZE) { break; }
    if (out.length >= total) { break; }
    await sleep(200);
  }
  return out;
}

function normalize(raw) {
  // 期号统一成 7 位 YYYYNNN（官网 2026116 / 体彩 26115 / 历史库 07001 都归一）
  const seen = new Set();
  const rows = [];
  for (const d of raw) {
    if (!d.code || !d.date) { continue; }
    const meta = parseCode(d.code);
    if (!meta.year || !meta.issue) { continue; }
    const canonical = String(meta.year) + String(meta.issue).padStart(3, "0");
    if (seen.has(canonical)) { continue; }
    seen.add(canonical);
    rows.push({
      code: canonical,
      codeShow: d.codeShow && String(d.codeShow).length >= 5 ? String(d.codeShow) : canonical,
      year: meta.year,
      issue: meta.issue,
      date: d.date,
      weekday: weekdayOf(d.date),
      reds: d.reds.slice(),
      blues: d.blues.slice(),
      pool: d.pool === undefined ? null : d.pool,
      sales: d.sales === undefined ? null : d.sales,
      p1c: d.p1c === undefined ? null : d.p1c,
      p1m: d.p1m === undefined ? null : d.p1m,
      p1ac: d.p1ac === undefined ? null : d.p1ac,
      p1am: d.p1am === undefined ? null : d.p1am,
      p2c: d.p2c === undefined ? null : d.p2c,
      p2m: d.p2m === undefined ? null : d.p2m,
      notice: d.notice || ""
    });
  }
  rows.sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : (b.code < a.code ? -1 : 1)));
  return rows;
}

const mem = new Map();

async function getData(game, force) {
  const key = GAMES[game] ? game : "ssq";
  const file = path.join(DATA, key + ".json");
  let cache = mem.get(key) || null;
  if (!cache) {
    try { cache = JSON.parse(fs.readFileSync(file, "utf8")); mem.set(key, cache); } catch (e) { cache = null; }
  }
  const fresh = cache && cache.rows && cache.rows.length > 0 && Date.now() - Number(cache.fetchedAt || 0) < TTL_MS;
  if (!force && fresh) { return { payload: cache, fromCache: true, refreshed: false }; }
  try {
    const raw = key === "ssq" ? await fetchSsq() : await fetchDlt();
    const rows = normalize(raw);
    if (rows.length === 0) { throw new Error("抓取结果为空"); }
    const next = { game: key, fetchedAt: Date.now(), count: rows.length, rows };
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(next));
    mem.set(key, next);
    return { payload: next, fromCache: false, refreshed: true };
  } catch (err) {
    if (cache && cache.rows && cache.rows.length > 0) {
      return { payload: cache, fromCache: true, refreshed: false, warning: "抓取失败，已使用本地缓存：" + err.message };
    }
    throw err;
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": body.length, "Cache-Control": "no-store" });
  res.end(body);
}

function serveStatic(res, pathname) {
  let rel = pathname === "/" ? "/index.html" : pathname;
  rel = rel.replace(/\.\.+/g, "");
  const file = path.join(PUB, rel);
  if (!file.startsWith(PUB)) { res.writeHead(403); res.end("forbidden"); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }); res.end("404 Not Found"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  let parsed;
  try { parsed = new URL(req.url, "http://localhost"); } catch (e) { sendJson(res, 400, { ok: false, error: "bad url" }); return; }
  const pathname = decodeURIComponent(parsed.pathname);

  if (pathname === "/api/games") {
    sendJson(res, 200, { ok: true, games: Object.keys(GAMES).map((k) => GAMES[k]) });
    return;
  }

  if (pathname === "/api/draws") {
    const game = parsed.searchParams.get("game") === "dlt" ? "dlt" : "ssq";
    const force = parsed.searchParams.get("refresh") === "1";
    try {
      const out = await getData(game, force);
      const p = out.payload;
      sendJson(res, 200, {
        ok: true,
        game,
        meta: GAMES[game],
        fetchedAt: p.fetchedAt,
        fromCache: out.fromCache,
        refreshed: out.refreshed,
        warning: out.warning || null,
        count: p.rows.length,
        rows: p.rows
      });
    } catch (err) {
      sendJson(res, 502, { ok: false, error: "无法获取开奖数据：" + err.message });
    }
    return;
  }

  if (pathname === "/api/health") {
    sendJson(res, 200, { ok: true, uptime: Math.round(process.uptime()), cache: Object.keys(GAMES).map((k) => {
      const c = mem.get(k);
      return { game: k, rows: c ? c.rows.length : 0 };
    }) });
    return;
  }

  serveStatic(res, pathname);
});

function lanAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] || []) {
      if (info.family === "IPv4" && !info.internal) { out.push({ name, address: info.address }); }
    }
  }
  return out;
}

let port = PORT_START;
let attempts = 0;
server.on("error", (err) => {
  if (err.code === "EADDRINUSE" && attempts < 12) {
    attempts++;
    port++;
    setTimeout(() => server.listen(port, "0.0.0.0"), 50);
    return;
  }
  console.error("服务启动失败：", err.message);
  process.exit(1);
});

if (process.argv.indexOf("--sync") >= 0) {
  (async () => {
    for (const key of Object.keys(GAMES)) {
      const t0 = Date.now();
      const out = await getData(key, true);
      const rows = out.payload.rows;
      console.log("  " + GAMES[key].name + "：" + rows.length + " 期，耗时 " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
      const n = rows[0];
      console.log("    最新 " + n.code + " " + n.date + "  " + n.reds.map((v) => String(v).padStart(2, "0")).join(" ") + " + " + n.blues.map((v) => String(v).padStart(2, "0")).join(" "));
      const o = rows[rows.length - 1];
      console.log("    最早 " + o.code + " " + o.date);
    }
    process.exit(0);
  })().catch((e) => { console.error("同步失败：" + e.message); process.exit(1); });
} else server.listen(port, "0.0.0.0", () => {
  const lines = [];
  lines.push("");
  lines.push("  双色球 / 大乐透 开奖号码筛选器 已启动");
  lines.push("  ------------------------------------------------");
  lines.push("  电脑访问：  http://localhost:" + port);
  for (const a of lanAddresses()) {
    lines.push("  手机访问：  http://" + a.address + ":" + port + "   (" + a.name + "，需与电脑在同一 Wi-Fi)");
  }
  lines.push("");
  lines.push("  数据来源：中国福利彩票官网 / 中国体育彩票官网");
  lines.push("  首次打开页面会自动抓取历史开奖数据（约需 10-30 秒），之后走本地缓存。");
  lines.push("  按 Ctrl+C 停止服务。");
  lines.push("");
  console.log(lines.join("\n"));
});

process.on("unhandledRejection", (e) => { console.error("未处理的异步错误：", e && e.message); });