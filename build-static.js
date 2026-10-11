"use strict";
/*
 * 构建纯静态站点：把 public/ 与 data/ 组装到 _site/
 * 用法：node build-static.js
 * 产物 _site/ 可直接托管到 GitHub Pages / Cloudflare Pages / Netlify / Vercel / 任意静态空间
 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const OUT = path.join(ROOT, "_site");
const SKIP = ["server.log", "server.err.log"];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (SKIP.indexOf(name) >= 0) { continue; }
    const s = path.join(src, name), d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) { copyDir(s, d); } else { fs.copyFileSync(s, d); }
  }
}

function dirSize(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
}

fs.rmSync(OUT, { recursive: true, force: true });
copyDir(path.join(ROOT, "public"), OUT);
copyDir(path.join(ROOT, "data"), path.join(OUT, "data"));
fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

console.log("静态站点已生成：" + OUT);
console.log("  总大小 " + (dirSize(OUT) / 1024 / 1024).toFixed(2) + " MB");
console.log("  入口文件：index.html / app.js / style.css / data/ssq.json / data/dlt.json");