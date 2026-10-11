"use strict";
/* 双色球 / 大乐透 开奖号码筛选器 —— 前端逻辑 */
(function () {
  var GAMES = {
    ssq: {
      key: "ssq", name: "双色球",
      frontLabel: "红球", backLabel: "蓝球",
      frontMax: 33, backMax: 16, frontPick: 6, backPick: 1,
      weekdays: [2, 4, 7], zoneEdges: [11, 22], zoneLabels: ["一区 01-11", "二区 12-22", "三区 23-33"],
      source: "中国福利彩票官网"
    },
    dlt: {
      key: "dlt", name: "大乐透",
      frontLabel: "前区", backLabel: "后区",
      frontMax: 35, backMax: 12, frontPick: 5, backPick: 2,
      weekdays: [1, 3, 6], zoneEdges: [12, 24], zoneLabels: ["一区 01-12", "二区 13-24", "三区 25-35"],
      source: "中国体育彩票官网"
    }
  };
  var WD = { 1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 7: "周日" };
  var COUNT_HISTORY = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  var COUNT_SAME = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100];
  var COUNT_WEEKDAY = [50, 60, 70, 80, 90, 100];
  var LIST_LIMIT = 60;

  function $(id) { return document.getElementById(id); }
  function pad(n) { return n < 10 ? "0" + n : String(n); }
  function fmt(n) { try { return Number(n).toLocaleString("zh-CN"); } catch (e) { return String(n); } }

  var state = {
    game: "ssq",
    tab: "history",
    data: { ssq: null, dlt: null },
    meta: { ssq: null, dlt: null },
    historyCount: 50,
    sameCount: 10,
    sameIssue: null,
    weekday: 0,
    weekdayCount: 50,
    pools: null,
    staticMode: false
  };

  function freshPool() {
    return { front: {}, back: {}, tuo: "", fs: "" };
  }
  state.pools = { ssq: freshPool(), dlt: freshPool() };

  function game() { return GAMES[state.game]; }
  function rows() { return state.data[state.game] || []; }
  function pool() { return state.pools[state.game]; }
  function frontState(n) { var p = pool().front; return p[n] || "idle"; }
  function backState(n) { var p = pool().back; return p[n] || "idle"; }

  /* ---------------- 统计工具 ---------------- */
  function sumOf(arr) { var s = 0, i; for (i = 0; i < arr.length; i++) { s += arr[i]; } return s; }
  function zoneRatio(arr, g) {
    var e = g.zoneEdges, a = 0, b = 0, c = 0, i, v;
    for (i = 0; i < arr.length; i++) {
      v = arr[i];
      if (v <= e[0]) { a++; } else if (v <= e[1]) { b++; } else { c++; }
    }
    return a + ":" + b + ":" + c;
  }
  function oddEven(arr) {
    var o = 0, i;
    for (i = 0; i < arr.length; i++) { if (arr[i] % 2 === 1) { o++; } }
    return o + ":" + (arr.length - o);
  }
  function binom(n, k) {
    if (k < 0 || k > n) { return 0; }
    k = Math.min(k, n - k);
    var r = 1, i;
    for (i = 1; i <= k; i++) { r = r * (n - k + i) / i; }
    return Math.round(r);
  }
  function firstCombos(arr, k, limit) {
    var out = [], idx = [];
    var rec = function (start, depth) {
      if (out.length >= limit) { return; }
      if (depth === k) { out.push(idx.slice()); return; }
      for (var i = start; i < arr.length; i++) {
        idx[depth] = i;
        rec(i + 1, depth + 1);
        if (out.length >= limit) { return; }
      }
    };
    if (k === 0) { return []; }
    rec(0, 0);
    return out;
  }
  function parseNums(text, max) {
    var parts = String(text || "").split(/[^0-9]+/), out = [], seen = {}, i, v;
    for (i = 0; i < parts.length; i++) {
      if (parts[i] === "") { continue; }
      v = parseInt(parts[i], 10);
      if (v >= 1 && v <= max && !seen[v]) { seen[v] = 1; out.push(v); }
    }
    return out.sort(function (a, b) { return a - b; });
  }
  function ballsOf(arr, cls) {
    return arr.map(function (v) { return '<span class="ball ' + cls + '">' + pad(v) + "</span>"; }).join("");
  }
  function fillOptions(sel, values, current) {
    sel.innerHTML = values.map(function (v) {
      return '<option value="' + v + '"' + (Number(v) === Number(current) ? " selected" : "") + ">" + v + " 期</option>";
    }).join("");
  }

  /* ---------------- 数据加载 ---------------- */
  var loading = false;
  function setStatus(text, kind) {
    var bar = document.querySelector(".statusbar");
    $("status-text").textContent = text;
    bar.className = "statusbar" + (kind ? " is-" + kind : "");
  }
  function loadData(force) {
    if (loading) { return; }
    loading = true;
    var g = state.game;
    setStatus("正在" + (force ? "刷新" : "载入") + GAMES[g].name + "开奖数据…", "loading");

    // ① 本地服务：走后端接口（实时抓官网）
    function fromApi() {
      return fetch("api/draws?game=" + g + (force ? "&refresh=1" : ""), { cache: "no-store" })
        .then(function (r) { if (!r.ok) { throw new Error("接口 " + r.status); } return r.json(); })
        .then(function (j) { if (!j.ok) { throw new Error(j.error || "接口异常"); } return j; });
    }
    // ② 纯静态托管：直接读 data/xxx.json（由定时任务更新）
    function fromStatic() {
      state.staticMode = true;
      return fetch("data/" + g + ".json", { cache: "no-store" })
        .then(function (r) { if (!r.ok) { throw new Error("找不到数据文件 data/" + g + ".json"); } return r.json(); })
        .then(function (j) {
          if (!j.rows || !j.rows.length) { throw new Error("数据文件为空"); }
          return { ok: true, game: g, fetchedAt: j.fetchedAt, staticMode: true, fromCache: true, count: j.rows.length, rows: j.rows };
        });
    }

    (state.staticMode ? fromStatic() : fromApi().catch(function () { return fromStatic(); }))
      .then(function (j) {
        state.data[g] = j.rows;
        state.meta[g] = j;
        state.sameIssue = null;
        loading = false;
        renderAll();
        var btn = $("btn-refresh");
        if (btn) { btn.textContent = j.staticMode ? "重新加载数据" : "刷新数据"; }
        var when = new Date(j.fetchedAt);
        setStatus(GAMES[g].name + "：共 " + fmt(j.count) + " 期（" + j.rows[j.rows.length - 1].date + " 至 " + j.rows[0].date + "）"
          + " · " + (j.staticMode ? "静态数据" : (j.fromCache ? "本地缓存" : "刚刚更新")) + " " + when.toLocaleString("zh-CN")
          + (j.warning ? " · " + j.warning : ""), j.staticMode ? "" : "");
      })
      .catch(function (err) {
        loading = false;
        setStatus("数据载入失败：" + err.message, "error");
      });
  }

  /* ---------------- 数据切片 ---------------- */
  function sameSeries() {
    var issue = state.sameIssue;
    if (issue === null || issue === undefined) { issue = rows().length ? rows()[0].issue : 0; state.sameIssue = issue; }
    return rows().filter(function (r) { return r.issue === Number(issue); }).slice().reverse();   // 旧 → 新
  }
  function sameRows() {
    var a = sameSeries();
    return a.slice(Math.max(0, a.length - state.sameCount));
  }
  function sameAvailable() { return sameSeries().length; }
  function weekdaySeries() {
    return rows().filter(function (r) { return !state.weekday || r.weekday === state.weekday; }).slice().reverse();
  }
  function weekdayRows() {
    var a = weekdaySeries();
    return a.slice(Math.max(0, a.length - state.weekdayCount));
  }

  /* ---------------- 各 TAB 渲染 ---------------- */
  function renderHistory() {
    var series = allAsc();
    var disp = series.slice(Math.max(0, series.length - state.historyCount));
    renderTrendInto("history-head", "history-body", disp, series);
    $("history-hint").textContent = "共 " + fmt(series.length) + " 期可用，当前显示最近 " + disp.length + " 期";
    fillOptions($("history-count"), COUNT_HISTORY, state.historyCount);
  }

  function renderSame() {
    var series = sameSeries();
    var disp = series.slice(Math.max(0, series.length - state.sameCount));
    renderTrendInto("same-head", "same-body", disp, series);
    $("same-hint").textContent = "第 " + state.sameIssue + " 期：历史共 " + series.length + " 期可比，当前显示 " + disp.length + " 期";
    fillOptions($("same-count"), COUNT_SAME, state.sameCount);

    var sel = $("same-issue");
    if (!sel.options.length || Number(sel.value) !== Number(state.sameIssue)) {
      var counts = {};
      rows().forEach(function (r) { counts[r.issue] = (counts[r.issue] || 0) + 1; });
      var issues = Object.keys(counts).map(Number).sort(function (a, b) { return b - a; });
      sel.innerHTML = issues.map(function (it) {
        return '<option value="' + it + '"' + (it === Number(state.sameIssue) ? " selected" : "") + ">第 " + it + " 期（" + counts[it] + " 期可比）</option>";
      }).join("");
    }
    renderPool(disp);
  }

  function renderWeekday() {
    var series = weekdaySeries();
    var disp = series.slice(Math.max(0, series.length - state.weekdayCount));
    renderTrendInto("weekday-head", "weekday-body", disp, series);
    $("weekday-hint").textContent = (state.weekday ? WD[state.weekday] : "全部星期") + "共 " + fmt(series.length) + " 期，当前显示 " + disp.length + " 期";
    fillOptions($("weekday-count"), COUNT_WEEKDAY, state.weekdayCount);

    var g = game(), seg = $("weekday-seg");
    var items = [{ v: 0, label: "全部" }];
    g.weekdays.forEach(function (w) { items.push({ v: w, label: WD[w] }); });
    seg.innerHTML = items.map(function (it) {
      return '<button type="button" class="btn' + (Number(state.weekday) === it.v ? " btn-primary" : " btn-ghost")
        + '" data-weekday="' + it.v + '" aria-pressed="' + (Number(state.weekday) === it.v) + '">' + it.label + "</button>";
    }).join("");
  }

  function renderAll() {
    if (!rows().length) { return; }
    var g = game();
    $("pool-front-title").textContent = g.frontLabel + "号码池";
    $("pool-back-title").textContent = g.backLabel + "号码池";
    $("tuo-label").textContent = g.frontLabel + "拖码（空格或逗号分隔）";
    $("fs-label").textContent = g.frontLabel + "复式号（空格或逗号分隔）";
    $("fs-back-label").textContent = g.backLabel + "号码（来自上方号码池中未被排除的号）";
    $("tuo-input").placeholder = g.key === "ssq" ? "例如 05 09 18 22 26 31" : "例如 05 09 18 22 26 31";
    $("fs-input").placeholder = g.key === "ssq" ? "例如 01 05 09 13 18 22 26 31" : "例如 01 05 09 13 18 22 26 31";
    $("foot-source").textContent = "数据来源：" + g.source;

    renderHistory();
    renderSame();
    renderWeekday();
    renderTuo();
    renderFs();
  }

  /* ---------------- 号码池 ---------------- */
  function poolCounts(rs, key) {
    var g = game();
    var max = key === "front" ? g.frontMax : g.backMax;
    var counts = new Array(max + 1).fill(0);
    rs.forEach(function (r) {
      var arr = key === "front" ? r.reds : r.blues;
      arr.forEach(function (v) { if (v >= 1 && v <= max) { counts[v]++; } });
    });
    return counts;
  }

  function renderPool(rs) {
    var g = game();
    ["front", "back"].forEach(function (key) {
      var max = key === "front" ? g.frontMax : g.backMax;
      var counts = poolCounts(rs, key);
      var maxCount = 0, i2;
      for (i2 = 1; i2 <= max; i2++) { if (counts[i2] > maxCount) { maxCount = counts[i2]; } }
      var label = key === "front" ? g.frontLabel : g.backLabel;
      var html = "";
      for (var n = 1; n <= max; n++) {
        var raw = key === "front" ? frontState(n) : backState(n);
        var st = key === "front" ? raw : (raw === "ex" ? "ex" : "idle");
        var w = maxCount > 0 ? (counts[n] / maxCount) * 100 : 0;
        var stText = st === "dan" ? "胆码" : (st === "ex" ? "已排除" : "参与");
        var tip = label + " " + pad(n) + "：" + rs.length + " 期里出现 " + counts[n] + " 次，当前" + stText
          + (key === "front" ? "（点击切换）" : "（点击" + (st === "ex" ? "恢复" : "排除") + "）");
        html += '<button type="button" class="chip" data-key="' + key + '" data-n="' + n + '" data-state="' + st + '" title="' + tip + '" aria-label="' + tip + '">'
          + '<span class="n">' + pad(n) + "</span>"
          + '<span class="bar"><i style="width:' + w.toFixed(1) + '%"></i></span>'
          + '<span class="c">' + counts[n] + "次</span>"
          + "</button>";
      }
      $(key === "front" ? "pool-front" : "pool-back").innerHTML = html;
    });
    var p = pool(), dan = 0, ex = 0, exBack = 0, k;
    for (k in p.front) { if (p.front[k] === "dan") { dan++; } else if (p.front[k] === "ex") { ex++; } }
    for (k in p.back) { if (p.back[k] === "ex") { exBack++; } }
    $("pool-counts").textContent = "样本 " + rs.length + " 期 · 胆码 " + dan + " 个 · 排除 " + ex + " 个" + game().frontLabel
      + " / " + exBack + " 个" + game().backLabel;
  }

  function backAvailable() {
    var g = game(), p = pool(), out = [];
    for (var b = 1; b <= g.backMax; b++) { if (p.back[b] !== "ex") { out.push(b); } }
    return out;
  }

  function buildSummary(el, parts) {
    el.innerHTML = parts.map(function (x) {
      if (typeof x === "string") { return "<span>" + x + "</span>"; }
      return '<span class="pill">' + x.pill + "</span>";
    }).join("");
  }

  function renderList(host, combos, frontLabel, backLabel, backNums, backGroups) {
    var html = "";
    combos.forEach(function (pick, i) {
      var nums = pick.slice().sort(function (a, b) { return a - b; });
      html += '<div class="item"><span class="idx">' + (i + 1) + ".</span>"
        + ballsOf(nums, "ball-front")
        + '<span class="tag">＋' + backLabel + " " + (backGroups === 1
          ? backNums.map(pad).join(" ")
          : backNums.length + " 选 " + game().backPick) + "</span></div>";
    });
    host.innerHTML = html;
  }

  /* ---------------- 胆拖选号结果 ---------------- */
  function renderTuo() {
    var g = game(), p = pool();
    var dan = [], n;
    for (n = 1; n <= g.frontMax; n++) { if (p.front[n] === "dan") { dan.push(n); } }
    var danSet = {};
    dan.forEach(function (v) { danSet[v] = 1; });
    var typed = parseNums(p.tuo, g.frontMax);
    var ignored = typed.filter(function (v) { return danSet[v] || p.front[v] === "ex"; });
    var tuo = typed.filter(function (v) { return !danSet[v] && p.front[v] !== "ex"; });

    $("tuo-input").value = p.tuo;
    $("tuo-dan").value = dan.map(pad).join(" ");

    var need = g.frontPick - dan.length;
    var backNums = backAvailable();
    var backGroups = binom(backNums.length, g.backPick);
    var host = $("tuo-list"), sum = $("tuo-summary"), msg = $("tuo-msg");
    host.innerHTML = ""; sum.innerHTML = ""; msg.textContent = "";

    var msgs = [];
    if (dan.length === 0) { msgs.push("先在" + g.frontLabel + "号码池里把号码点两次标成「胆码」，再填" + g.frontLabel + "拖码。"); }
    if (dan.length > g.frontPick - 1) { msgs.push("胆拖的" + g.frontLabel + "胆码最多 " + (g.frontPick - 1) + " 个，当前 " + dan.length + " 个。"); }
    if (dan.length > 0 && dan.length <= g.frontPick - 1 && tuo.length < need) {
      msgs.push(g.frontLabel + "拖码至少需要 " + need + " 个，当前 " + tuo.length + " 个（胆码 " + dan.length + " 个，还需从拖码取 " + need + " 个）。");
    }
    if (backNums.length < g.backPick) { msgs.push(g.backLabel + "至少保留 " + g.backPick + " 个，当前 " + backNums.length + " 个。"); }
    if (ignored.length) { msgs.push("已忽略被排除或重复的号：" + ignored.map(pad).join(" ") + "。"); }
    if (msgs.length) { msg.textContent = msgs.join(" "); return; }

    var frontGroups = binom(tuo.length, need);
    var bets = frontGroups * backGroups;
    var money = bets * 2;
    buildSummary(sum, [
      "胆码 " + dan.length + " 个 · 拖码 " + tuo.length + " 个 · 每组从拖码取 " + need + " 个 ",
      { pill: fmt(frontGroups) + " 组" }, " × ",
      { pill: fmt(backGroups) + " 组" + g.backLabel }, " = ",
      { pill: fmt(bets) + " 注" }, "（" + fmt(money) + " 元）"
    ]);

    var combos = firstCombos(tuo, need, LIST_LIMIT).map(function (pick) {
      return dan.concat(pick.map(function (k) { return tuo[k]; }));
    });
    renderList(host, combos, g.frontLabel, g.backLabel, backNums, backGroups);
    if (frontGroups > combos.length) {
      host.innerHTML += '<div class="more">共 ' + fmt(frontGroups) + " 组" + g.frontLabel + "组合，此处显示前 " + combos.length + " 组。</div>";
    }
  }

  /* ---------------- 复式选号结果 ---------------- */
  function renderFs() {
    var g = game(), p = pool();
    var typed = parseNums(p.fs, g.frontMax);
    var ignored = typed.filter(function (v) { return p.front[v] === "ex"; });
    var front = typed.filter(function (v) { return p.front[v] !== "ex"; });
    var backNums = backAvailable();
    $("fs-input").value = p.fs;
    $("fs-back").value = backNums.map(pad).join(" ");

    var host = $("fs-list"), sum = $("fs-summary"), msg = $("fs-msg");
    host.innerHTML = ""; sum.innerHTML = ""; msg.textContent = "";

    var msgs = [];
    if (front.length === 0) {
      msgs.push("先填" + g.frontLabel + "号码：点「取号码池未排除号」可一次填入号码池里没被排除的号，也可以自己输入。");
    } else if (front.length < g.frontPick) {
      msgs.push(g.frontLabel + "复式至少 " + g.frontPick + " 个（正好 " + g.frontPick + " 个就是单式），当前 " + front.length + " 个。");
    } else if (front.length > 20) {
      msgs.push(g.frontLabel + "复式最多 20 个，当前 " + front.length + " 个，注数会超出投注限额。");
    }
    if (backNums.length < g.backPick) { msgs.push(g.backLabel + "至少保留 " + g.backPick + " 个，当前 " + backNums.length + " 个。"); }
    if (ignored.length) { msgs.push("已忽略被排除的号：" + ignored.map(pad).join(" ") + "。"); }
    if (msgs.length) { msg.textContent = msgs.join(" "); return; }

    var groups = binom(front.length, g.frontPick);
    var backGroups = binom(backNums.length, g.backPick);
    var bets = groups * backGroups;
    var money = bets * 2;
    var kind;
    if (front.length === g.frontPick) { kind = backNums.length === g.backPick ? "单式" : g.backLabel + "复式"; }
    else { kind = backNums.length === g.backPick ? g.frontLabel + "复式" : "全复式"; }

    buildSummary(sum, [
      { pill: kind }, " " + g.frontLabel + " " + front.length + " 个 · " + g.backLabel + " " + backNums.length + " 个 ",
      { pill: fmt(groups) + " 组" }, " × ",
      { pill: fmt(backGroups) + " 组" + g.backLabel }, " = ",
      { pill: fmt(bets) + " 注" }, "（" + fmt(money) + " 元）"
    ]);

    var combos = firstCombos(front, g.frontPick, LIST_LIMIT);
    renderList(host, combos, g.frontLabel, g.backLabel, backNums, backGroups);
    if (groups > combos.length) {
      host.innerHTML += '<div class="more">共 ' + fmt(groups) + " 组" + g.frontLabel + "组合，此处显示前 " + combos.length + " 组。</div>";
    }
  }

  function nonExcludedFront(excludeDan) {
    var g = game(), p = pool(), out = [];
    for (var n = 1; n <= g.frontMax; n++) {
      if (p.front[n] === "ex") { continue; }
      if (excludeDan && p.front[n] === "dan") { continue; }
      out.push(n);
    }
    return out;
  }

  /* ---------------- 走势图渲染（三个标签页共用，口径对齐走势图站） ---------------- */
  function allAsc() { return rows().slice().reverse(); }

  function buildMiss(series, g) {
    var fMap = {}, bMap = {}, n, i, v;
    var fc = new Array(g.frontMax + 1).fill(0), bc = new Array(g.backMax + 1).fill(0);
    for (i = 0; i < series.length; i++) {
      var r = series[i], fIn = {}, bIn = {};
      for (v = 0; v < r.reds.length; v++) { fIn[r.reds[v]] = 1; }
      for (v = 0; v < r.blues.length; v++) { bIn[r.blues[v]] = 1; }
      var fm = new Array(g.frontMax + 1), bm = new Array(g.backMax + 1);
      for (n = 1; n <= g.frontMax; n++) { fc[n] = fIn[n] ? 0 : fc[n] + 1; fm[n] = fc[n]; }
      for (n = 1; n <= g.backMax; n++) { bc[n] = bIn[n] ? 0 : bc[n] + 1; bm[n] = bc[n]; }
      fMap[r.code] = fm;
      bMap[r.code] = bm;
    }
    return { f: fMap, b: bMap };
  }

  function trendStat(vals) {
    var cnt = 0, maxMiss = 0, maxRun = 0, run = 0, i, v;
    for (i = 0; i < vals.length; i++) {
      v = vals[i];
      if (v === 0) { cnt++; run++; if (run > maxRun) { maxRun = run; } }
      else { run = 0; if (v > maxMiss) { maxMiss = v; } }
    }
    return {
      cnt: cnt,
      avg: cnt > 0 ? Math.round((vals.length - cnt) / (cnt + 1)) : vals.length,
      maxMiss: maxMiss,
      maxRun: maxRun >= 2 ? maxRun : 0
    };
  }

  function renderTrendInto(headId, bodyId, disp, series) {
    var g = game(), head = $(headId), body = $(bodyId);
    if (!disp.length) {
      head.innerHTML = "";
      body.innerHTML = '<tr><td class="lab">无数据</td></tr>';
      return;
    }
    var miss = buildMiss(series, g);
    var n, i;

    var e = g.zoneEdges;
    var groups = [[1, e[0]], [e[0] + 1, e[1]], [e[1] + 1, g.frontMax]];
    var names = ["一区", "二区", "三区"];
    var h1 = '<tr><th class="lab" rowspan="2">期号</th><th rowspan="2">星期</th>';
    var h2 = "<tr>";
    groups.forEach(function (gr, gi) {
      h1 += '<th class="grp" colspan="' + (gr[1] - gr[0] + 1) + '">' + names[gi] + "</th>";
    });
    h1 += '<th class="grp" colspan="' + g.backMax + '">' + g.backLabel + "</th>";
    h1 += '<th class="grp num2" rowspan="2">和值</th><th class="grp num2" rowspan="2">跨度</th>'
      + '<th class="grp num2" rowspan="2">区间比</th><th class="grp num2" rowspan="2">奇偶比</th></tr>';
    for (n = 1; n <= g.frontMax; n++) { h2 += "<th>" + pad(n) + "</th>"; }
    for (n = 1; n <= g.backMax; n++) { h2 += "<th>" + pad(n) + "</th>"; }
    h2 += "</tr>";
    head.innerHTML = h1 + h2;

    var fVals = [], bVals = [], html = "";
    for (i = 0; i < disp.length; i++) {
      var row = disp[i], fm = miss.f[row.code], bm = miss.b[row.code];
      fVals.push(fm);
      bVals.push(bm);
      html += '<tr><td class="lab">' + row.code + '</td><td class="miss">' + row.weekday + "</td>";
      for (n = 1; n <= g.frontMax; n++) {
        var mcls = (n <= e[0] || n > e[1]) ? "miss01" : "miss";
        html += (fm[n] === 0) ? '<td class="hit">' + pad(n) + "</td>" : '<td class="' + mcls + '">' + fm[n] + "</td>";
      }
      for (n = 1; n <= g.backMax; n++) {
        html += (bm[n] === 0) ? '<td class="hitb">' + pad(n) + "</td>" : '<td class="miss">' + bm[n] + "</td>";
      }
      var span = Math.max.apply(null, row.reds) - Math.min.apply(null, row.reds);
      html += '<td class="sum">' + sumOf(row.reds) + '</td><td class="sum">' + span + "</td>"
        + '<td class="sum">' + zoneRatio(row.reds, g) + '</td><td class="sum">' + oddEven(row.reds) + "</td></tr>";
    }

    var statsF = [], statsB = [];
    for (n = 1; n <= g.frontMax; n++) { statsF[n] = trendStat(fVals.map(function (m) { return m[n]; })); }
    for (n = 1; n <= g.backMax; n++) { statsB[n] = trendStat(bVals.map(function (m) { return m[n]; })); }
    [["出现总次数", "cnt"], ["平均遗漏值", "avg"], ["最大遗漏值", "maxMiss"], ["最大连出数", "maxRun"]].forEach(function (def) {
      var h = '<tr class="statrow"><td class="lab">' + def[0] + "</td><td></td>";
      for (n = 1; n <= g.frontMax; n++) { h += "<td>" + statsF[n][def[1]] + "</td>"; }
      for (n = 1; n <= g.backMax; n++) { h += "<td>" + statsB[n][def[1]] + "</td>"; }
      h += '<td class="num2"></td><td class="num2"></td><td class="num2"></td><td class="num2"></td></tr>';
      html += h;
    });
    body.innerHTML = html;
  }

  /* ---------------- 标签页与彩种切换 ---------------- */
  function switchTab(name) {
    state.tab = name;
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      var on = b.getAttribute("data-tab") === name;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-panel]"), function (pnl) {
      var on = pnl.getAttribute("data-panel") === name;
      pnl.hidden = !on;
      pnl.classList.toggle("is-active", on);
    });
  }

  function switchGame(key) {
    if (!GAMES[key] || key === state.game) { return; }
    state.game = key;
    state.sameIssue = null;
    Array.prototype.forEach.call(document.querySelectorAll(".game-btn"), function (b) {
      var on = b.getAttribute("data-game") === key;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (state.data[key]) { renderAll(); } else { setStatus("正在载入" + GAMES[key].name + "开奖数据…", "loading"); }
    loadData(false);
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll(".game-btn"), function (b) {
      b.addEventListener("click", function () { switchGame(b.getAttribute("data-game")); });
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (b) {
      b.addEventListener("click", function () { switchTab(b.getAttribute("data-tab")); });
    });
    $("btn-refresh").addEventListener("click", function () { loadData(true); });
    if ($("btn-orient")) {
      $("btn-orient").addEventListener("click", function () {
        var el = document.documentElement || document.body;
        if (!el || !el.classList) { return; }
        var on = el.classList.toggle("force-landscape");
        this.textContent = on ? "竖屏查看" : "横屏查看";
        try { window.scrollTo(0, 0); } catch (e) { /* ignore */ }
      });
    }
    $("history-count").addEventListener("change", function () { state.historyCount = Number(this.value); renderHistory(); });
    $("same-count").addEventListener("change", function () { state.sameCount = Number(this.value); renderSame(); renderTuo(); renderFs(); });
    $("same-issue").addEventListener("change", function () { state.sameIssue = Number(this.value); renderSame(); renderTuo(); renderFs(); });
    $("weekday-count").addEventListener("change", function () { state.weekdayCount = Number(this.value); renderWeekday(); });

    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) { return; }
      var chip = t.closest(".chip");
      if (chip) {
        var key = chip.getAttribute("data-key");
        var num = Number(chip.getAttribute("data-n"));
        var map = pool()[key];
        if (key === "back") { map[num] = map[num] === "ex" ? "idle" : "ex"; }
        else { var cur = map[num] || "idle"; map[num] = cur === "idle" ? "ex" : (cur === "ex" ? "dan" : "idle"); }
        renderPool(sameRows());
        renderTuo();
        renderFs();
        return;
      }
      var wb = t.closest("[data-weekday]");
      if (wb) { state.weekday = Number(wb.getAttribute("data-weekday")); renderWeekday(); }
    });

    $("tuo-input").addEventListener("input", function () { pool().tuo = this.value; renderTuo(); });
    $("tuo-fill").addEventListener("click", function () { pool().tuo = nonExcludedFront(true).map(pad).join(" "); renderTuo(); });
    $("tuo-clear").addEventListener("click", function () { pool().tuo = ""; renderTuo(); });
    $("fs-input").addEventListener("input", function () { pool().fs = this.value; renderFs(); });
    $("fs-fill").addEventListener("click", function () { pool().fs = nonExcludedFront(false).map(pad).join(" "); renderFs(); });
    $("fs-clear").addEventListener("click", function () { pool().fs = ""; renderFs(); });
  }

  /* ---------------- 启动 ---------------- */
  function init() {
    fillOptions($("history-count"), COUNT_HISTORY, state.historyCount);
    fillOptions($("same-count"), COUNT_SAME, state.sameCount);
    fillOptions($("weekday-count"), COUNT_WEEKDAY, state.weekdayCount);
    bind();
    switchTab("history");
    loadData(false);
  }
  init();
  /* 暴露内部函数，便于自动化测试与调试 */
  window.__ssqApp = {
    GAMES: GAMES, WD: WD, state: state,
    game: game, rows: rows, pool: pool, pad: pad, fmt: fmt,
    binom: binom, firstCombos: firstCombos, parseNums: parseNums, ballsOf: ballsOf,
    frontState: frontState, backState: backState, nonExcludedFront: nonExcludedFront, backAvailable: backAvailable,
    sameRows: sameRows, sameSeries: sameSeries, sameAvailable: sameAvailable, weekdayRows: weekdayRows, weekdaySeries: weekdaySeries,
    renderAll: renderAll, renderPool: renderPool, renderTuo: renderTuo, renderFs: renderFs, renderTrendInto: renderTrendInto,
    switchTab: switchTab, switchGame: switchGame, loadData: loadData, setStatus: setStatus,
    LIST_LIMIT: LIST_LIMIT
  };
})();
