/* FEST7 月结助手 · 管理后台（v2 “FEST7 Ledger” 界面）
 * 只改前端：接口、计算公式与表格结构保持不变。计算一律以服务端 settlement 为准，
 * 前端仅做展示、筛选与「预估」提示。
 */
var TOKEN_KEY = "fest7_admin_token";
var BOOT_CACHE_KEY = "fest7_admin_bootstrap";
var HIDE_MONEY_KEY = "fest7_hide_money";
var UNDO_MS = 5000;

function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ""; }
function setToken(t) {
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}
function readHideMoney() { try { return localStorage.getItem(HIDE_MONEY_KEY) === "1"; } catch (e) { return false; } }

var ui = {
  authed: false,
  tab: "dash",
  month: currentMonth(),
  settlement: null,
  submissions: [],
  employees: [],
  selectedEmpId: null,
  csvDraft: "",
  loginError: "",
  editing: null,
  refreshing: false,
  pendingRender: false,
  lock: null,
  lockedMonths: [],
  slip: null,
  slipPicker: null,
  hideMoney: readHideMoney(),
  lastSync: null,
  syncError: false,
  navOpen: false,
  settleFilter: "all",
  settleQ: "",
  mOpen: null,
  addEmp: { name: "", base: "", error: "", baseError: "" },
  ap: { status: "pending", month: "", emp: "", type: "", q: "", limit: 30, sel: null, open: false, menu: null },
  counts: {}
};

function readBootstrapCache(month) {
  try {
    var parsed = JSON.parse(sessionStorage.getItem(BOOT_CACHE_KEY) || "null");
    if (!parsed || parsed.month !== month || !parsed.data) return null;
    return parsed.data;
  } catch (err) {
    return null;
  }
}

function writeBootstrapCache(month, data) {
  try {
    sessionStorage.setItem(BOOT_CACHE_KEY, JSON.stringify({ month: month, data: data, at: Date.now() }));
  } catch (err) { /* quota / private mode */ }
}

function clearBootstrapCache() {
  try { sessionStorage.removeItem(BOOT_CACHE_KEY); } catch (err) { /* ignore */ }
}

function applyBootstrap(data) {
  if (!data) return;
  ui.settlement = data.settlement || null;
  ui.submissions = (data.submissions && data.submissions.submissions) || data.submissions || [];
  ui.employees = (data.employees && data.employees.employees) || data.employees || [];
  ui.lock = data.lock || null;
  ui.lockedMonths = data.lockedMonths || [];
  overlayPendingOps();
}

function monthOf(dateStr) { return String(dateStr || "").slice(0, 7); }

function isMonthLocked(ym) {
  if (ym === ui.month && ui.settlement && ui.settlement.locked) return true;
  return (ui.lockedMonths || []).indexOf(ym) !== -1;
}

function empDisplayName(s) { return s.displayName || s.employeeName || ""; }

function loadAll() {
  var month = ui.month;
  return run("adminBootstrap", getToken(), month).then(function (data) {
    if (month !== ui.month) return data; // 期间切换了月份，丢弃旧结果
    applyBootstrap(data);
    writeBootstrapCache(month, data);
    ui.lastSync = new Date();
    ui.syncError = false;
    return data;
  });
}

/* 多个操作连续完成时合并为一次刷新 */
var reloadTimer = null;
var reloadInFlight = false;
var reloadAgain = false;
function reloadSoon(delay) {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(function () {
    reloadTimer = null;
    if (reloadInFlight) { reloadAgain = true; return; }
    refreshInBackground();
  }, delay == null ? 250 : delay);
}

function refreshInBackground() {
  reloadInFlight = true;
  ui.refreshing = true;
  setRefreshing(true);
  updateSyncChip();
  return loadAll().then(function () {
    reloadInFlight = false;
    ui.refreshing = false;
    setRefreshing(false);
    renderIfIdle();
    updateSyncChip();
    if (reloadAgain) { reloadAgain = false; reloadSoon(0); }
  }).catch(function (err) {
    reloadInFlight = false;
    ui.refreshing = false;
    ui.syncError = true;
    setRefreshing(false);
    if (handleExpired(err)) return;
    toast(err.message, "err");
    renderIfIdle();
    updateSyncChip();
  });
}

function handleExpired(err) {
  var expired = /登录已过期|请先登录/.test((err && err.message) || "");
  if (!expired) return false;
  setToken("");
  clearBootstrapCache();
  ui.authed = false;
  toast(err.message, "err");
  render();
  return true;
}

function renderIfIdle() {
  if (isFormFieldFocused() || ui.editing || ui.slipPicker || isDialogOpen()) {
    ui.pendingRender = true;
    setRefreshing(ui.refreshing);
    updateSyncChip();
    return;
  }
  ui.pendingRender = false;
  render();
}

function pendingCount() {
  return ui.submissions.filter(function (s) { return s.status === "pending"; }).length;
}

function fmtTime(d) {
  if (!d) return "";
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

function syncChipHtml() {
  var cls = ui.refreshing ? "sync ing" : ui.syncError ? "sync err" : "sync";
  var t = ui.refreshing ? "同步中…" : ui.syncError ? "同步失败 · 显示缓存" : ui.lastSync ? "已同步 · " + fmtTime(ui.lastSync) : "本地缓存";
  return '<span class="' + cls + '" id="sync-chip" role="status"><span class="dot"></span><span class="t">' + esc(t) + "</span></span>";
}

function updateSyncChip() {
  var chip = document.getElementById("sync-chip");
  if (chip) chip.outerHTML = syncChipHtml();
  var rb = document.getElementById("refresh-btn");
  if (rb) rb.classList.toggle("ing", !!ui.refreshing);
}

/* 大号金额：总览「隐藏金额」开启时打码 */
function mny(v, opts) {
  opts = opts || {};
  if (ui.hideMoney && opts.hideable) opts.mask = true;
  return moneyHtml(v, opts);
}

/* ---------------- 外壳：侧栏 + 顶栏 ---------------- */
var TABS = {
  dash: "总览",
  settle: "月度结算",
  approve: "审批",
  employees: "员工与基本工资",
  data: "数据备份与密码"
};

function sidebarHtml() {
  var pending = pendingCount();
  function item(key, icon, label, extra) {
    var on = ui.tab === key && !ui.slip ? " on" : (key === "settle" && ui.slip ? " on" : "");
    return '<button type="button" class="nav-i' + on + '" data-act="tab" data-tab="' + key + '" title="' + esc(label) + '"' + (on ? ' aria-current="page"' : "") + ">" +
      I(icon) + '<span class="lbl">' + esc(label) + "</span>" + (extra || "") + "</button>";
  }
  return '<aside class="side" id="side" aria-label="主导航">' +
    '<a class="brandblk" href="admin.html" aria-label="FEST7 月结后台"><img src="logo-white.png" alt="FEST7 Express" width="76" height="34"><span class="f7">F7</span>' +
    '<span class="app"><b>月结助手</b><span>管理后台</span></span></a>' +
    '<nav id="admin-tabs">' +
    '<div class="nav-g"><div class="gt">概览</div>' + item("dash", "layout-dashboard", "总览") + "</div>" +
    '<div class="nav-g"><div class="gt">月结业务</div>' + item("settle", "calculator", "月度结算") +
    item("approve", "clipboard-check", "审批", pending ? '<span class="badge" aria-label="' + pending + ' 条待审批">' + pending + "</span>" : "") + "</div>" +
    '<div class="nav-g"><div class="gt">基础资料</div>' + item("employees", "users", "员工与基本工资") + item("data", "database", "数据备份与密码") + "</div>" +
    '<div class="nav-g"><div class="gt">快捷</div><a class="nav-i" href="index.html" title="员工提交页">' + I("smartphone") + '<span class="lbl">员工提交页</span><span class="ext">' + I("external-link", "i-xs") + "</span></a></div>" +
    "</nav>" +
    '<div class="foot"><span class="avatar ink">管</span><div class="who"><b>管理员</b><span>会话约 6 小时有效</span></div>' +
    '<button type="button" class="btn btn-ghost btn-sm btn-icon" data-act="logout" title="退出登录" aria-label="退出登录">' + I("log-out", "i-sm") + "</button></div>" +
    "</aside>" +
    '<div class="side-bg" data-act="nav-close"></div>';
}

function topbarHtml() {
  var crumb = ui.slip ? "结算确认单" : TABS[ui.tab] || "";
  return '<header class="topbar">' +
    '<button type="button" class="btn btn-ghost btn-icon menu-btn" data-act="nav-toggle" aria-label="打开导航" aria-expanded="' + (ui.navOpen ? "true" : "false") + '">' + I("menu") + "</button>" +
    '<div class="crumb"><span class="c-root">管理后台</span><span class="c-sep">' + I("chevron-right", "i-xs") + "</span><b>" + esc(crumb) + "</b></div>" +
    '<div class="tb-r">' + syncChipHtml() +
    '<button type="button" class="btn btn-ghost btn-sm btn-icon refresh-btn' + (ui.refreshing ? " ing" : "") + '" id="refresh-btn" data-act="refresh" title="刷新数据" aria-label="刷新数据">' + I("refresh-cw", "i-sm") + "</button></div>" +
    "</header>";
}

function monthsHtml() {
  var cur = ui.month;
  var list = [-2, -1, 0, 1].map(function (d) { return shiftMonth(cur, d); });
  var h = '<div class="months" role="group" aria-label="选择月份">' +
    '<button type="button" class="nav" data-act="month" data-v="' + shiftMonth(cur, -1) + '" aria-label="上个月">' + I("chevron-left", "i-sm") + "</button>";
  list.forEach(function (ym) {
    var lk = isMonthLocked(ym);
    var on = ym === cur;
    h += '<button type="button" class="mb' + (on ? " on" : "") + (lk ? " lk" : "") + '" data-act="month" data-v="' + ym + '"' + (on ? ' aria-current="true"' : "") +
      ' title="' + esc(formatMonthCN(ym)) + (lk ? "（已锁定）" : "") + '">' + (lk ? I("lock") : "") + Number(ym.slice(5)) + "月</button>";
  });
  h += '<button type="button" class="nav" data-act="month" data-v="' + shiftMonth(cur, 1) + '" aria-label="下个月">' + I("chevron-right", "i-sm") + "</button>" +
    '<label class="nav pick" title="选择任意月份">' + I("calendar", "i-sm") + '<input id="month-input" type="month" value="' + esc(cur) + '" aria-label="选择任意月份"></label></div>';
  return h;
}

function pageHead(title, tagHtml, sub, right) {
  return '<div class="ph-row"><div><h1 class="ph-title">' + esc(title) + (tagHtml || "") + "</h1>" +
    (sub ? '<p class="ph-sub">' + sub + "</p>" : "") + "</div>" +
    '<div class="actions">' + (right == null ? monthsHtml() : right) + "</div></div>";
}

function loadingCard(text) {
  return '<div class="card loading-card"><span class="btn-spinner"></span>' + esc(text || "正在加载…") + "</div>";
}

/* ---------------- 登录 ---------------- */
function renderLogin() {
  return '<div class="login-page">' +
    '<section class="login-brand"><div class="deco"><i></i><i></i><i></i></div>' +
    '<div><img src="logo-white.png" alt="FEST7 Express" width="116" height="52"><h1>月结助手 · 管理后台</h1>' +
    "<p>审批员工申请，维护每月基本工资，完成银行卡与现金的月度结算。</p></div>" +
    '<div class="lb-foot">数据保存在公司 Google 表格中 · 会话约 6 小时有效</div></section>' +
    '<main class="login-main"><div class="card login-card">' +
    "<h2>管理员登录</h2>" +
    '<p class="sub">请输入后台密码。会话保存在服务器缓存中，使用页面内令牌校验。</p>' +
    '<form id="login-form" novalidate>' +
    '<label class="field"><span class="label">密码</span>' +
    '<span class="input-lead"><span class="lead">' + I("key-round", "i-sm") + "</span>" +
    '<input class="input' + (ui.loginError ? " invalid" : "") + '" name="password" type="password" autocomplete="current-password" required autofocus aria-invalid="' + (ui.loginError ? "true" : "false") + '"></span>' +
    (ui.loginError ? '<span class="err" role="alert">' + I("circle-alert", "i-xs") + esc(ui.loginError) + "</span>" : "") + "</label>" +
    '<button type="submit" class="btn btn-primary btn-lg btn-block">' + I("log-in", "i-sm") + "进入后台</button></form>" +
    '<div class="back"><a href="index.html">' + I("arrow-left", "i-xs") + "返回员工提交页</a></div>" +
    "</div></main></div>";
}

/* ---------------- 主渲染 ---------------- */
function render() {
  setRefreshing(!!ui.refreshing);
  var app = document.getElementById("app");
  document.body.classList.add("admin-page");
  if (!ui.authed) {
    document.body.classList.remove("has-bbar", "nav-open");
    app.innerHTML = renderLogin();
    document.getElementById("login-form").addEventListener("submit", onLogin);
    return;
  }
  // 记住搜索框焦点与光标，重绘后恢复
  var ae = document.activeElement;
  var keepFocus = ae && ae.id && /^(settle-q|ap-q)$/.test(ae.id) ? { id: ae.id, s: ae.selectionStart, e: ae.selectionEnd } : null;

  var body;
  if (ui.slip) body = renderSlips();
  else if (ui.tab === "dash") body = renderDash();
  else if (ui.tab === "settle") body = renderSettle();
  else if (ui.tab === "approve") body = renderApprove();
  else if (ui.tab === "employees") body = renderEmployees();
  else body = renderData();

  document.body.classList.toggle("has-bbar", !ui.slip && ui.tab === "settle" && !!ui.settlement);
  document.body.classList.toggle("nav-open", !!ui.navOpen);
  app.innerHTML = '<div class="shell">' + sidebarHtml() + '<div class="main">' + topbarHtml() +
    '<main class="content" id="view">' + body + "</main></div></div>" + overlaysHtml();

  if (keepFocus) {
    var el = document.getElementById(keepFocus.id);
    if (el) { el.focus(); try { el.setSelectionRange(keepFocus.s, keepFocus.e); } catch (e) { /* ignore */ } }
  }
  if (ui.tab === "settle" && !ui.slip) applySettleSearch();
  animateCounts();
}

/* 抽屉 / 弹窗（依附于 #app，随状态重绘） */
function overlaysHtml() {
  var S = ui.settlement;
  var h = "";
  if (S && ui.selectedEmpId && !ui.slip) h += renderDrawer(S);
  if (ui.editing) h += renderEditModal();
  if (S && ui.slipPicker) h += renderSlipPicker(S);
  return h;
}

/* 数字滚动：结算等式与手机汇总里的金额变化时平滑过渡（减少动态效果时直接跳变） */
function animateCounts() {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  Array.prototype.forEach.call(document.querySelectorAll("[data-count]"), function (el) {
    var key = el.getAttribute("data-count");
    var to = Number(el.getAttribute("data-val")) || 0;
    var from = ui.counts[key];
    ui.counts[key] = to;
    if (reduce || from == null || Math.abs(from - to) < 0.005 || ui.hideMoney && el.hasAttribute("data-hideable")) return;
    var start = null;
    var dur = 600;
    function step(ts) {
      if (!document.contains(el)) return;
      if (start == null) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.innerHTML = moneyHtml(from + (to - from) * e, { cls: el.getAttribute("data-cls") || "" });
      if (p < 1) requestAnimationFrame(step);
      else el.innerHTML = moneyHtml(to, { cls: el.getAttribute("data-cls") || "" });
    }
    requestAnimationFrame(step);
  });
}

function countHtml(key, v, cls) {
  return '<span data-count="' + key + '" data-val="' + round2(v) + '" data-cls="' + (cls || "") + '">' + moneyHtml(v, { cls: cls || "" }) + "</span>";
}

function settleStatusTag(S) {
  if (!S) return "";
  return S.locked
    ? '<span class="tag tag-lock">' + I("lock") + "已锁定 · 快照</span>"
    : '<span class="tag tag-info">' + I("refresh-cw") + "未锁定 · 实时计算</span>";
}

/* ---------------- 总览 ---------------- */
function renderDash() {
  var S = ui.settlement;
  var head = pageHead("总览", "", "月结前一眼看清：还有什么没处理、钱怎么构成、哪里有异常。");
  if (!S) return head + loadingCard("正在加载结算…");
  var T = S.totals;
  var rows = S.rows;
  var n = rows.length;
  var hide = ui.hideMoney;
  var bankFilled = rows.filter(function (r) { return r.bank > 0; }).length;
  var bankPct = T.gross > 0 ? Math.max(0, Math.min(100, T.bank / T.gross * 100)) : 0;
  var cashPct = T.gross > 0 ? Math.max(0, Math.min(100 - bankPct, T.cash / T.gross * 100)) : 0;
  var adjNet = round2(T.gross - T.base);
  var pendAll = pendingCount();
  var pendMonth = ui.submissions.filter(function (s) { return s.status === "pending" && monthOf(s.date) === ui.month; }).length;
  var active = ui.employees.filter(function (e) { return e.active !== false; }).length;
  var inactive = ui.employees.length - active;
  var leaveN = rows.filter(function (r) { return r.leaveHours > 0; }).length;
  var otN = rows.filter(function (r) { return r.otHours > 0; }).length;
  var baseSet = rows.filter(function (r) { return r.base > 0; }).length;
  var customN = 0;
  rows.forEach(function (r) { r.details.forEach(function (d) { if (d.type === "custom") customN++; }); });

  var hero = '<div class="card hero span2 hero-c">' +
    '<div class="glow"></div><div class="echo-deco"><i></i><i></i><i></i></div>' +
    '<div class="hero-top"><span class="x-tag">' + esc(formatMonthCN(ui.month)) + '</span><span class="eyebrow">结算概览</span>' + settleStatusTag(S) +
    '<button type="button" class="btn btn-ghost btn-sm" data-act="toggle-money" aria-pressed="' + (hide ? "true" : "false") + '">' + I(hide ? "eye" : "eye-off", "i-sm") + (hide ? "显示金额" : "隐藏金额") + "</button></div>" +
    '<div class="eyebrow" style="margin-top:18px;position:relative">应发合计（' + n + " 人）</div>" +
    '<div class="hero-val num">' + (hide ? '<span class="masked">€ ••••••</span>' : '<span class="cur">€</span>' + formatNum2(T.gross)) + "</div>" +
    '<div class="hero-cap"><span>基本工资合计 <b class="num">' + (hide ? "€ ••••" : formatMoney(T.base)) + "</b></span>" +
    "<span>调整净额 " + mny(adjNet, { sign: true, hideable: true, cls: "num" }) + "</span></div>" +
    '<div class="split"><div class="bar" role="img" aria-label="银行卡占 ' + bankPct.toFixed(1) + '%"><i class="b1" style="width:' + bankPct.toFixed(1) + '%"></i><i class="b2" style="width:' + cashPct.toFixed(1) + '%"></i></div>' +
    '<div class="lg"><div class="it"><span class="k"><i style="background:var(--n-800)"></i>银行卡（手动填写 · ' + bankFilled + "/" + n + " 人）</span><span class=\"v\">" + mny(T.bank, { hideable: true }) + "</span></div>" +
    '<div class="it"><span class="k"><i style="background:var(--f7-600)"></i>现金应付（自动 = 应发 − 银行卡）</span><span class="v">' + mny(T.cash, { hideable: true }) + "</span></div>" +
    '<div class="it" style="text-align:right"><span class="k" style="justify-content:flex-end">银行卡占比</span><span class="v num">' + (hide ? "••" : bankPct.toFixed(1)) + "%</span></div></div></div></div>";

  function k(cls, icon, lbl, val, sub) {
    return '<div class="card kpi ' + cls + '"><div class="k-top"><span class="k-lbl">' + lbl + '</span><span class="k-ic">' + I(icon) + '</span></div><div class="k-val num">' + val + '</div><div class="k-sub">' + sub + "</div></div>";
  }
  var kpis = '<div class="kpi-grid span2 kpi-c">' +
    k("warn", "hourglass", "待审批申请", String(pendAll),
      (pendMonth ? '<span class="tag tag-pending">' + I("clock") + "本月 " + pendMonth + " 条</span>" : '<span class="tag tag-approved">' + I("circle-check") + "本月已清空</span>") +
      '<button type="button" class="link" data-act="tab" data-tab="approve">去审批 ' + I("arrow-right", "i-xs") + "</button>") +
    k("", "users", "在职员工", active + '<span class="u">人</span>', inactive ? "已停用 " + inactive + " 人 · 历史记录保留" : "无停用员工") +
    k("", "calendar-days", "本月工作日", S.workdays + '<span class="u">天</span>', '标准工时 <b class="num" style="color:var(--color-text)">' + formatHours(S.capacity) + " h</b> · 周一至周五") +
    k("brand", "timer", "请假 / 加班工时", formatHours(T.leaveHours) + '<span class="u">h</span><span style="color:var(--n-300);margin:0 6px;font-weight:400">/</span>' + formatHours(T.otHours) + '<span class="u">h</span>',
      "请假 " + leaveN + " 人 · 加班 " + otN + " 人（已通过）") +
    "</div>";

  var s1 = pendMonth ? "now" : "done";
  var s2 = n && baseSet === n ? "done" : baseSet ? "part" : "";
  var s3 = n && bankFilled === n ? "done" : bankFilled ? "part" : "";
  var s4 = S.locked ? "done" : "";
  var doneN = [s1, s2, s3, s4].filter(function (x) { return x === "done"; }).length;
  function dot(st, num) { return '<div class="dot">' + (st === "done" ? I("check") : num === 4 ? I("lock") : num) + "</div>"; }
  var steps = '<div class="card span2"><div class="card-h"><h2 class="card-t"><span class="echo" style="color:var(--color-primary)"></span>' + Number(ui.month.slice(5)) + ' 月月结进度</h2><span class="hint">完成 ' + doneN + " / 4</span></div>" +
    '<div class="card-b" style="padding-top:22px"><div class="steps">' +
    '<div class="step ' + s1 + '">' + dot(s1, 1) + '<div class="st">处理待审批</div><div class="sd">' + (pendMonth ? "本月仍有 " + pendMonth + " 条待审批" : "本月没有待审批") + "</div></div>" +
    '<div class="step ' + s2 + '">' + dot(s2, 2) + '<div class="st">基本工资</div><div class="sd">' + baseSet + " / " + n + ' 人已设置</div><div class="pg"><i style="width:' + (n ? baseSet / n * 100 : 0) + '%"></i></div></div>' +
    '<div class="step ' + s3 + '">' + dot(s3, 3) + '<div class="st">银行卡金额</div><div class="sd">' + bankFilled + " / " + n + ' 人已填写</div><div class="pg"><i style="width:' + (n ? bankFilled / n * 100 : 0) + '%"></i></div></div>' +
    '<div class="step ' + s4 + '">' + dot(s4, 4) + '<div class="st">锁定结算</div><div class="sd">' + (S.locked ? "已锁定 " + esc(formatStamp(S.lockedAt)) : "生成快照后不可修改") + "</div></div>" +
    '</div><div class="actions" style="margin-top:22px"><button type="button" class="btn btn-primary btn-sm" data-act="tab" data-tab="settle">' + I("calculator", "i-sm") + "前往月度结算</button>" +
    (pendAll ? '<button type="button" class="btn btn-secondary btn-sm" data-act="tab" data-tab="approve">' + I("clipboard-check", "i-sm") + "处理 " + pendAll + " 条待审批</button>" : "") + "</div></div></div>";

  var mx = Math.max(T.leavePay, T.otPay, Math.abs(T.customSum), 0.01);
  function bar(v, neg) {
    var w = Math.min(50, Math.abs(v) / mx * 50);
    return '<div class="bar"><span class="mid"></span><i style="' + (neg ? "right:50%;background:var(--red-500)" : "left:50%;background:var(--green-600)") + ";width:" + w.toFixed(1) + '%"></i></div>';
  }
  var recon = '<div class="card span2"><div class="card-h"><h2 class="card-t"><span class="echo" style="color:var(--color-primary)"></span>本月对账构成</h2><span class="hint">基本工资 → 应发合计</span></div>' +
    '<div class="card-b recon" style="padding-top:8px">' +
    '<div class="ln"><span class="op">∑</span><span class="lbl">基本工资合计<small>' + n + ' 人 · 按员工 ID 关联</small></span><span class="bar-ph"></span><span class="val">' + mny(T.base, { hideable: true }) + "</span></div>" +
    '<div class="ln"><span class="op">−</span><span class="lbl">请假扣款<small>' + leaveN + " 人 · " + formatHours(T.leaveHours) + " h × 小时费率</small></span>" + bar(T.leavePay, true) + '<span class="val">' + mny(-T.leavePay, { hideable: true }) + "</span></div>" +
    '<div class="ln"><span class="op">+</span><span class="lbl">加班费<small>' + otN + " 人 · " + formatHours(T.otHours) + " h × 费率 × 1.2</small></span>" + bar(T.otPay, false) + '<span class="val">' + mny(T.otPay, { sign: true, hideable: true }) + "</span></div>" +
    '<div class="ln"><span class="op">±</span><span class="lbl">自定义调整<small>' + customN + " 笔 · 报销 / 补贴 / 扣款</small></span>" + bar(T.customSum, T.customSum < 0) + '<span class="val">' + mny(T.customSum, { sign: true, hideable: true }) + "</span></div>" +
    '<div class="ln tot"><span class="op" style="background:var(--n-800);color:#fff">=</span><span class="lbl">应发合计</span><span class="bar-ph"></span><span class="val">' + mny(T.gross, { hideable: true }) + "</span></div>" +
    "</div></div>";

  var recentList = ui.submissions.slice().sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); }).slice(0, 5);
  var rr = recentList.map(function (s) {
    var val = s.type === "custom" ? mny(s.amount, { sign: true, hideable: true }) : '<span class="num" style="font-weight:600">' + formatHours(s.hours) + " h</span>";
    var sub = s.type === "custom" ? (s.note || "") : s.hoursMode === "multi-day" ? "全天" : s.startTime && s.endTime ? s.startTime + "–" + s.endTime : weekdayCN(s.date);
    return '<button type="button" class="list-row recent-row" data-act="goto-sub" data-id="' + esc(s.id) + '">' +
      '<span class="emp r-emp">' + avatarHtml(empDisplayName(s)) + '<span class="nm">' + esc(empDisplayName(s)) + "</span></span>" +
      '<span class="r-type">' + typeHtml(s.type) + "</span>" +
      '<span class="r-info"><span class="num">' + esc(s.date) + '</span> <span class="hint" style="margin-left:6px">' + esc(sub) + "</span></span>" +
      '<span class="r-val">' + val + '</span><span class="r-st">' + statusTag(s.status) + '</span><span class="hint num ts">' + esc(formatStamp(s.createdAt)) + "</span></button>";
  }).join("");
  var recent = '<div class="card span3" style="overflow:hidden"><div class="card-h" style="padding-bottom:14px"><h2 class="card-t"><span class="echo" style="color:var(--color-primary)"></span>最近申请</h2>' +
    '<button type="button" class="btn btn-ghost btn-sm" data-act="tab" data-tab="approve">查看全部 ' + I("arrow-right", "i-sm") + "</button></div>" +
    (rr || '<div class="empty" style="border-top:1px solid var(--color-divider)">暂无申请</div>') + "</div>";

  var alerts = [];
  if (S.unmatched && S.unmatched.length) alerts.push(["red", "link-2-off", S.unmatched.length + " 条已通过申请未匹配员工", "提交姓名不在员工名单中，未计入结算。", '<button type="button" class="link aa" data-act="ap-unmatched">去审批页处理 →</button>']);
  if (pendMonth) alerts.push(["amber", "hourglass", "本月 " + pendMonth + " 条待审批", "锁定前建议全部处理，否则不计入快照。", ""]);
  var noBank = rows.filter(function (r) { return !(r.bank > 0) && r.gross > 0; });
  if (noBank.length && !S.locked) alerts.push(["blue", "landmark", noBank.length + " 人银行卡金额未填", noBank.slice(0, 4).map(function (r) { return esc(r.emp.name); }).join("、") + (noBank.length > 4 ? " 等" : "") + " —— 未填时现金应付 = 应发合计。", ""]);
  var negCash = rows.filter(function (r) { return r.cash < 0; });
  if (negCash.length) alerts.push(["red", "triangle-alert", negCash.length + " 人现金应付为负数", negCash.map(function (r) { return esc(r.emp.name); }).join("、") + " —— 银行卡金额超过应发合计，请核对。", ""]);
  var zeroBase = rows.filter(function (r) { return !(r.base > 0); });
  if (zeroBase.length) alerts.push(["amber", "banknote", zeroBase.length + " 人本月基本工资为 0", zeroBase.map(function (r) { return esc(r.emp.name); }).join("、"), '<button type="button" class="link aa" data-act="tab" data-tab="employees">去设置基本工资 →</button>']);
  var alertHtml = alerts.length ? alerts.map(function (a) {
    return '<div class="alert-i"><span class="ai ' + a[0] + '">' + I(a[1]) + '</span><div style="min-width:0"><div class="at">' + a[2] + '</div><div class="ad">' + a[3] + "</div>" + (a[4] ? '<div class="aa">' + a[4] + "</div>" : "") + "</div></div>";
  }).join("") : '<div class="alert-i"><span class="ai green">' + I("circle-check") + '</span><div><div class="at">一切就绪</div><div class="ad">没有待处理的异常。</div></div></div>';
  var alertCard = '<div class="card span1" style="overflow:hidden"><div class="card-h" style="padding-bottom:6px"><h2 class="card-t">' + I("triangle-alert", "i-sm") + '需要注意</h2><span class="tag tag-muted">' + alerts.length + "</span></div>" + alertHtml + "</div>";

  return head + '<div class="grid dash-grid">' + hero + kpis + steps + recon + recent + alertCard + "</div>" +
    '<p class="footnote">' + I("shield-check", "i-sm") + "全部指标由现有结算、申请与员工数据在前端汇总；金额以月度结算页为准。</p>";
}

/* ---------------- 月度结算 ---------------- */
function rowAdjusted(r) { return r.leaveHours > 0 || r.otHours > 0 || Math.abs(r.customSum) > 0.004; }
function settleMatches(r) {
  var f = ui.settleFilter;
  if (f === "nobank" && r.bank > 0) return false;
  if (f === "adj" && !rowAdjusted(r)) return false;
  if (f === "note" && !r.emp.note) return false;
  return true;
}

function bankInputHtml(r, lg) {
  var key = "bank:" + r.emp.id;
  return '<span class="money-cell"><span class="money-input' + (lg ? " lg" : "") + '"><span class="cur">€</span>' +
    '<input class="bank" data-bank="' + esc(r.emp.id) + '" type="text" inputmode="decimal" autocomplete="off" value="' + (r.bank ? formatNum2(r.bank) : "") + '" placeholder="' + (lg ? "未填写" : "0.00") + '" aria-label="' + esc(r.emp.name) + ' 银行卡金额"></span>' +
    saveStateHtml(key, r.bank > 0 ? "" : I("circle-dot", "i-xs")) + "</span>";
}

function renderSettle() {
  var S = ui.settlement;
  var head = pageHead("月度结算", ' <span class="x-tag">' + esc(formatMonthCN(ui.month)) + "</span>", "点击员工行查看明细与结算确认单；银行卡金额失焦即保存，现金应付自动计算。");
  if (!S) return head + loadingCard("正在加载结算…");
  var locked = !!S.locked;
  var T = S.totals;
  var rows = S.rows;
  var n = rows.length;
  var bankFilled = rows.filter(function (r) { return r.bank > 0; }).length;
  var pendMonth = ui.submissions.filter(function (s) { return s.status === "pending" && monthOf(s.date) === ui.month; }).length;
  var unmatched = (S.unmatched || []).length;
  var cnt = {
    all: n,
    nobank: n - bankFilled,
    adj: rows.filter(rowAdjusted).length,
    note: rows.filter(function (r) { return !!r.emp.note; }).length
  };

  var lockBanner = locked
    ? '<div class="banner lock"><span class="b-ic">' + I("lock") + '</span><div class="b-txt"><b>' + esc(formatMonthCN(ui.month)) + "已锁定结算</b>" +
      '<span class="hint">锁定于 ' + esc(formatStamp(S.lockedAt, true)) + "。以下为锁定时保存的快照，审批、基本工资、银行卡和调整均不可修改。</span></div>" +
      '<button type="button" class="btn btn-secondary btn-sm" id="unlock-month" data-act="unlock">' + I("lock-open", "i-sm") + "解锁</button></div>"
    : "";
  var unmatchedBanner = unmatched
    ? '<div class="banner danger"><span class="b-ic">' + I("link-2-off") + '</span><div class="b-txt"><b>有 ' + unmatched + " 条已通过申请无法匹配到员工名单，未计入下表。</b></div>" +
      '<button type="button" class="btn btn-danger btn-sm" data-act="ap-unmatched">去审批页处理</button></div>'
    : "";

  var eq = '<div class="card eq d-only">' +
    '<div class="cell meta"><div class="mrow"><span>工作日</span><b class="num">' + S.workdays + " 天</b></div>" +
    '<div class="mrow"><span>标准工时</span><b class="num">' + formatHours(S.capacity) + " h</b></div>" +
    '<div class="mrow"><span>费率公式</span><b>基本 ÷ ' + formatHours(S.capacity) + "</b></div></div>" +
    '<div class="cell"><span class="k">' + I("calculator", "i-xs") + '应发合计</span><span class="v">' + countHtml("gross", T.gross) + '</span><span class="s">基本 − 请假 + 加班 ± 自定义</span></div>' +
    '<div class="opx" aria-hidden="true">−</div>' +
    '<div class="cell"><span class="k">' + I("landmark", "i-xs") + '银行卡（打卡）</span><span class="v">' + countHtml("bank", T.bank) + '</span><span class="s"><span class="mini-pg"><i style="width:' + (n ? bankFilled / n * 100 : 0) + '%"></i></span>已填 ' + bankFilled + " / " + n + " 人</span></div>" +
    '<div class="opx" aria-hidden="true">=</div>' +
    '<div class="cell cash"><span class="k">' + I("banknote", "i-xs") + '现金应付</span><span class="v">' + countHtml("cash", T.cash, "inh") + '</span><span class="s">' + (locked ? "锁定快照" : "自动计算，随银行卡金额实时更新") + "</span></div>" +
    '<div class="cell stat">' + settleStatusTag(S) +
    (pendMonth ? '<span class="s">' + I("hourglass", "i-xs") + "本月仍有 <b>" + pendMonth + " 条待审批</b></span>" : '<span class="s">' + I("circle-check", "i-xs") + "本月没有待审批</span>") +
    (unmatched ? '<span class="s">' + I("link-2-off", "i-xs") + unmatched + " 条申请未匹配员工</span>" : "") + "</div></div>";

  function chip(key, label, icon) {
    return '<button type="button" class="chip' + (ui.settleFilter === key ? " on" : "") + '" data-act="settle-filter" data-v="' + key + '" aria-pressed="' + (ui.settleFilter === key) + '">' + (icon ? I(icon, "i-xs") : "") + label + ' <span class="cnt">' + cnt[key] + "</span></button>";
  }
  var chips = chip("all", "全部") + chip("nobank", "银行卡未填", "circle-dot") + chip("adj", "有调整") + chip("note", "有备注", "sticky-note");
  var tbar = '<div class="tbar d-only"><label class="search">' + I("search", "i-sm") + '<input id="settle-q" type="search" placeholder="搜索员工" value="' + esc(ui.settleQ) + '" aria-label="搜索员工"></label>' + chips +
    '<div class="actions"><button type="button" class="btn btn-secondary btn-sm" id="export-csv" data-act="export-csv">' + I("file-spreadsheet", "i-sm") + "导出 CSV</button>" +
    '<button type="button" class="btn btn-secondary btn-sm" id="pick-slips" data-act="pick-slips">' + I("printer", "i-sm") + "生成确认单</button>" +
    (locked ? "" : '<button type="button" class="btn btn-ink btn-sm" id="lock-month" data-act="lock">' + I("lock", "i-sm") + "锁定本月结算</button>") + "</div></div>";

  var visible = rows.filter(settleMatches);
  var trs = visible.map(function (r) {
    var sel = ui.selectedEmpId === r.emp.id ? " sel" : "";
    var extra = "";
    if (r.emp.note) extra += ' <span class="note-ic" title="' + esc(r.emp.note) + '">' + I("sticky-note", "i-xs") + "</span>";
    if (r.emp.active === false && !locked) extra += ' <span class="tag tag-muted">已停用</span>';
    var sub = locked && r.emp.currentName && r.emp.currentName !== r.emp.name ? '<div class="sub">现名 ' + esc(r.emp.currentName) + "</div>" : "";
    return '<tr class="click' + sel + '" data-act="emp-open" data-emp="' + esc(r.emp.id) + '" data-name="' + esc((r.emp.name + " " + (r.emp.currentName || "")).toLowerCase()) + '" tabindex="0">' +
      '<td class="stick"><div class="emp">' + avatarHtml(r.emp.name) + '<div style="min-width:0"><span class="nm">' + esc(r.emp.name) + "</span>" + extra + sub + "</div></div></td>" +
      '<td class="r" data-k="base">' + moneyHtml(r.base) + "</td>" +
      '<td class="r" data-k="rate"><span class="num" style="color:var(--color-text-2)">' + Number(r.rateRounded).toFixed(2) + "</span></td>" +
      '<td class="r sep-l" data-k="leaveHours">' + hoursHtml(r.leaveHours) + "</td>" +
      '<td class="r" data-k="leavePay">' + moneyHtml(-r.leavePay, { zeroDash: true }) + "</td>" +
      '<td class="r sep-l" data-k="otHours">' + hoursHtml(r.otHours) + "</td>" +
      '<td class="r" data-k="otPay">' + moneyHtml(r.otPay, { sign: true, zeroDash: true }) + "</td>" +
      '<td class="r sep-l" data-k="customSum">' + moneyHtml(r.customSum, { sign: true, zeroDash: true }) + "</td>" +
      '<td class="r sep-l set-col gross" data-k="gross">' + moneyHtml(r.gross) + "</td>" +
      '<td class="r set-col bank-td" data-k="bank">' + (locked ? moneyHtml(r.bank) : bankInputHtml(r)) + "</td>" +
      '<td class="r set-col" data-k="cash" style="font-weight:650">' + moneyHtml(r.cash) + "</td></tr>";
  }).join("");
  if (!visible.length) trs = '<tr><td colspan="11" class="empty" style="height:auto">' + (n ? "没有符合筛选条件的员工" : "本月没有结算数据") + "</td></tr>";
  var foot = '<tr class="ledger-total"><td class="stick">公司总计 <span class="hint" style="font-weight:500">' + n + " 人</span></td>" +
    '<td class="r">' + moneyHtml(T.base) + "</td><td></td>" +
    '<td class="r sep-l">' + hoursHtml(T.leaveHours) + '</td><td class="r">' + moneyHtml(-T.leavePay, { zeroDash: true }) + "</td>" +
    '<td class="r sep-l">' + hoursHtml(T.otHours) + '</td><td class="r">' + moneyHtml(T.otPay, { sign: true, zeroDash: true }) + "</td>" +
    '<td class="r sep-l">' + moneyHtml(T.customSum, { sign: true, zeroDash: true }) + '</td><td class="r sep-l">' + moneyHtml(T.gross) + "</td>" +
    '<td class="r" style="padding-right:' + (locked ? 12 : 36) + 'px">' + moneyHtml(T.bank) + '</td><td class="r" style="color:var(--f7-700)">' + moneyHtml(T.cash, { cls: "inh" }) + "</td></tr>";
  var table = '<div class="tbl-wrap d-only"><table class="tbl" id="settle-table"><thead>' +
    '<tr class="grp"><th class="stick"></th><th colspan="2"><div class="gl">基础</div></th><th colspan="2"><div class="gl">请假 · 扣款</div></th><th colspan="2"><div class="gl">加班 · ×1.2</div></th><th><div class="gl">调整</div></th><th colspan="3" class="g-set"><div class="gl">' + I("scale", "i-xs") + "月末结算</div></th></tr>" +
    '<tr><th class="stick">员工</th><th class="r">基本工资</th><th class="r">费率 €/h</th><th class="r sep-l">小时</th><th class="r">请假扣款</th><th class="r sep-l">小时</th><th class="r">加班费</th><th class="r sep-l">自定义</th><th class="r sep-l set-col" style="color:var(--n-800)">应发合计</th><th class="r set-col" style="padding-right:' + (locked ? 12 : 36) + 'px">银行卡' + (locked ? "" : "（手填）") + '</th><th class="r set-col">现金应付</th></tr></thead>' +
    "<tbody>" + trs + "</tbody><tfoot>" + foot + "</tfoot></table></div>";

  var legend = '<div class="legend2 d-only"><div class="lc"><b>小时费率</b><code>基本工资 ÷ (工作日 × 8.5)</code> 显示 2 位小数，计算用未取整值</div>' +
    '<div class="lc"><b>请假扣款 / 加班费</b><code>小时 × 费率</code> / <code>小时 × 费率 × 1.2</code>，含周末与工作时段外</div>' +
    '<div class="lc"><b>应发合计</b><code>基本 − 请假扣款 + 加班费 + 自定义</code> 四舍五入到分</div>' +
    '<div class="lc"><b>现金应付</b><code>应发合计 − 银行卡</code>；锁定后显示快照，修改需先解锁</div></div>' +
    '<p class="footnote d-only">' + I("info", "i-sm") + "标准工作时段 08:45–13:00、14:00–18:15；" + esc(formatMonthCN(ui.month)) + "共 " + S.workdays + " 个工作日（周一至周五，假日不扣除）。锁定会保存每位员工的结果为快照；如需更正，先解锁、修改，再重新锁定。</p>";

  // 手机端：汇总卡 + 员工卡片 + 底部操作栏
  var mcards = visible.map(function (r) {
    var open = ui.mOpen === r.emp.id;
    var bd = "";
    if (open) {
      bd = '<div class="bd"><div class="bl"><span>基本工资</span>' + moneyHtml(r.base) + "</div>" +
        '<div class="bl"><span>小时费率<small>€' + Number(r.rateRounded).toFixed(2) + '/h</small></span><span class="hint num">' + r.workdays + " 天 × 8.5 h</span></div>" +
        '<div class="bl"><span>请假扣款<small>' + formatHours(r.leaveHours) + " h</small></span>" + moneyHtml(-r.leavePay, { zeroDash: true }) + "</div>" +
        '<div class="bl"><span>加班费<small>' + formatHours(r.otHours) + " h × 1.2</small></span>" + moneyHtml(r.otPay, { sign: true, zeroDash: true }) + "</div>" +
        '<div class="bl"><span>自定义</span>' + moneyHtml(r.customSum, { sign: true, zeroDash: true }) + "</div>" +
        '<div class="bl t"><span>应发合计</span>' + moneyHtml(r.gross) + "</div></div>" +
        '<div class="two-btn"><button type="button" class="btn btn-secondary btn-sm" data-act="emp-open" data-emp="' + esc(r.emp.id) + '">' + I("file-text", "i-sm") + "明细 " + r.details.length + " 条</button>" +
        '<button type="button" class="btn btn-secondary btn-sm" data-act="open-slip" data-slip="' + esc(r.emp.id) + '">' + I("printer", "i-sm") + "确认单</button></div>";
    }
    return '<div class="card ecard' + (open ? " open" : "") + '" data-ecard="' + esc(r.emp.id) + '">' +
      '<button type="button" class="r1" data-act="m-toggle" data-emp="' + esc(r.emp.id) + '" aria-expanded="' + open + '">' + avatarHtml(r.emp.name) +
      '<div style="min-width:0"><div style="font-weight:650">' + esc(r.emp.name) + (r.emp.note ? ' <span class="note-ic">' + I("sticky-note", "i-xs") + "</span>" : "") + '</div><div class="hint">基本 ' + moneyHtml(r.base) + "</div></div>" +
      '<div class="g"><div class="kk">应发合计</div><div style="font-weight:700;font-size:16px">' + moneyHtml(r.gross) + "</div></div>" +
      '<span class="chev">' + I(open ? "chevron-down" : "chevron-right", "i-sm") + "</span></button>" + bd +
      '<div class="r2"><div><div class="kk" style="margin-bottom:4px">银行卡' + (locked ? "" : "（手填）") + "</div>" + (locked ? '<div style="font-weight:650">' + moneyHtml(r.bank) + "</div>" : bankInputHtml(r, true)) + "</div>" +
      '<div style="text-align:right"><div class="kk" style="margin-bottom:4px">现金应付</div><div style="font-weight:700;font-size:16px;color:var(--f7-700)">' + moneyHtml(r.cash, { cls: "inh" }) + "</div></div></div></div>";
  }).join("");
  var mobile = '<div class="m-only">' +
    '<div class="card m-sum"><div style="display:flex;align-items:center;justify-content:space-between;gap:8px"><span class="eyebrow">应发合计 · ' + n + " 人</span>" + settleStatusTag(S) + "</div>" +
    '<div class="big num">' + countHtml("m-gross", T.gross) + "</div>" +
    '<div class="two"><div><div class="eyebrow">银行卡 · ' + bankFilled + "/" + n + '</div><div class="mv">' + countHtml("m-bank", T.bank) + "</div></div>" +
    '<div><div class="eyebrow" style="color:var(--f7-700)">现金应付</div><div class="mv" style="color:var(--f7-700)">' + countHtml("m-cash", T.cash, "inh") + "</div></div></div></div>" +
    '<div class="m-chips">' + chip("all", "全部") + chip("nobank", "未填银行卡", "circle-dot") + chip("adj", "有调整") + chip("note", "有备注", "sticky-note") + "</div>" +
    (mcards || '<div class="card empty" style="margin-top:10px">没有符合筛选条件的员工</div>') +
    '<div class="m-bbar"><div class="row3"><button type="button" class="btn btn-secondary" data-act="export-csv">' + I("file-spreadsheet", "i-sm") + "CSV</button>" +
    '<button type="button" class="btn btn-secondary" data-act="pick-slips">' + I("printer", "i-sm") + "确认单</button>" +
    (locked ? '<button type="button" class="btn btn-secondary" data-act="unlock">' + I("lock-open", "i-sm") + "解锁</button>"
      : '<button type="button" class="btn btn-ink" data-act="lock">' + I("lock", "i-sm") + "锁定结算</button>") + "</div></div></div>";

  return head + lockBanner + unmatchedBanner + eq + tbar + table + legend + mobile;
}

function applySettleSearch() {
  var q = String(ui.settleQ || "").trim().toLowerCase();
  Array.prototype.forEach.call(document.querySelectorAll("#settle-table tbody tr[data-name]"), function (tr) {
    tr.hidden = !!q && tr.getAttribute("data-name").indexOf(q) === -1;
  });
}

function detailTimeText(d) {
  if (d.type === "custom") return "";
  if (d.hoursMode === "multi-day") return "全天";
  if (d.startTime && d.endTime) return d.startTime + "–" + d.endTime;
  return "直接填写";
}

function renderDrawer(S) {
  var r = null;
  S.rows.forEach(function (x) { if (x.emp.id === ui.selectedEmpId) r = x; });
  if (!r) return "";
  var locked = !!S.locked;
  var items = r.details.length ? r.details.map(function (d) {
    var meta = [esc(d.date) + " " + weekdayCN(d.date)];
    var t = detailTimeText(d);
    if (t) meta.push(esc(t));
    if (d.type !== "custom") meta.push(formatHours(d.hours) + " 小时");
    return '<div class="d-item">' + typeHtml(d.type, false) + '<div class="di-main"><div style="font-weight:650">' + esc(TYPE_LABEL[d.type]) + (d.note ? ' <span class="hint" style="font-weight:500">· ' + esc(d.note) + "</span>" : "") + "</div>" +
      '<div class="di-sub num">' + meta.join(" · ") + "</div></div>" +
      '<div class="di-r">' + moneyHtml(d.effect, { sign: true }) +
      (locked ? "" : '<div class="di-ops"><button type="button" class="btn btn-ghost btn-sm btn-icon" data-edit="' + esc(d.id) + '" title="编辑" aria-label="编辑">' + I("pencil", "i-sm") + "</button>" +
        '<button type="button" class="btn btn-ghost btn-sm btn-icon danger" data-del="' + esc(d.id) + '" title="删除" aria-label="删除">' + I("trash-2", "i-sm") + "</button></div>") + "</div></div>";
  }).join("") : '<div class="empty" style="padding:24px 8px">本月暂无已通过的请假、加班或自定义项。</div>';
  return '<div class="drawer-bg" id="drawer-bg" data-act="drawer-bg"><aside class="drawer" role="dialog" aria-modal="true" aria-label="' + esc(r.emp.name) + ' 明细">' +
    '<div class="drawer-h">' + avatarHtml(r.emp.name, "lg") + '<div style="min-width:0"><h3>' + esc(r.emp.name) + '</h3><div class="hint">' + esc(formatMonthCN(ui.month)) + " 明细 · ID " + esc(r.emp.id) + "</div></div>" +
    '<button type="button" class="btn btn-ghost btn-sm btn-icon" id="close-drawer" data-act="drawer-close" aria-label="关闭">' + I("x") + "</button></div>" +
    '<div class="drawer-b">' +
    (r.emp.note ? '<div class="warn-item info" style="margin-bottom:12px">' + I("sticky-note", "i-xs") + "<span>备注：" + esc(r.emp.note) + "</span></div>" : "") +
    '<div class="d-meta"><div><div class="k">基本工资</div><div class="v">' + moneyHtml(r.base) + '</div></div><div><div class="k">小时费率</div><div class="v num">€' + Number(r.rateRounded).toFixed(2) + '</div></div><div><div class="k">工作日</div><div class="v num">' + r.workdays + " × 8.5</div></div></div>" +
    '<div class="eyebrow" style="margin-top:6px">已通过明细（' + r.details.length + "）</div>" +
    '<div class="d-list">' + items + "</div>" +
    '<div class="d-sum"><div class="bl"><span>基本工资</span>' + moneyHtml(r.base) + "</div>" +
    '<div class="bl"><span>请假扣款<small>' + formatHours(r.leaveHours) + " h</small></span>" + moneyHtml(-r.leavePay, { zeroDash: true }) + "</div>" +
    '<div class="bl"><span>加班费<small>' + formatHours(r.otHours) + " h × 1.2</small></span>" + moneyHtml(r.otPay, { sign: true, zeroDash: true }) + "</div>" +
    '<div class="bl"><span>自定义</span>' + moneyHtml(r.customSum, { sign: true, zeroDash: true }) + "</div>" +
    '<div class="bl t"><span>应发合计</span>' + moneyHtml(r.gross) + "</div>" +
    '<div class="bl"><span>银行卡</span>' + moneyHtml(r.bank) + "</div>" +
    '<div class="bl cash"><span>现金应付</span>' + moneyHtml(r.cash, { cls: "inh" }) + "</div></div></div>" +
    '<div class="drawer-f"><button type="button" class="btn btn-primary" id="open-slip" data-act="open-slip" data-slip="' + esc(r.emp.id) + '">' + I("printer", "i-sm") + "结算确认单</button>" +
    (locked ? '<span class="hint">本月已锁定，数据来自快照</span>' : "") + "</div></aside></div>";
}

function renderEditModal() {
  var s = ui.editing;
  if (!s) return "";
  var empOpts = ui.employees.filter(function (e) {
    return e.active !== false || e.id === s.employeeId;
  }).map(function (e) {
    return '<option value="' + esc(e.id) + '"' + (e.id === s.employeeId ? " selected" : "") + ">" + esc(e.name) + (e.active === false ? "（已停用）" : "") + "</option>";
  }).join("");
  var typeOpts = ["leave", "overtime", "custom"].map(function (t) {
    return '<option value="' + t + '"' + (s.type === t ? " selected" : "") + ">" + TYPE_LABEL[t] + "</option>";
  }).join("");
  var statusOpts = ["pending", "approved", "rejected"].map(function (t) {
    return '<option value="' + t + '"' + (s.status === t ? " selected" : "") + ">" + STATUS_LABEL[t] + "</option>";
  }).join("");
  var extra = s.type === "custom"
    ? '<label class="field"><span class="label">金额（€，负数为扣款）</span><input class="input num" name="amount" type="number" step="0.01" value="' + esc(s.amount) + '"></label>' +
      '<label class="field"><span class="label">说明</span><input class="input" name="note" value="' + esc(s.note || "") + '"></label>'
    : '<div class="grid-2"><label class="field"><span class="label">开始时间</span><input class="input" name="startTime" type="time" value="' + esc(s.startTime || "") + '"></label>' +
      '<label class="field"><span class="label">结束时间</span><input class="input" name="endTime" type="time" value="' + esc(s.endTime || "") + '"></label></div>' +
      '<label class="field"><span class="label">小时（不按时间段重算时使用）</span><input class="input num" name="hours" type="number" step="0.01" value="' + esc(s.hours) + '"></label>' +
      '<label class="field"><span class="label">说明</span><input class="input" name="note" value="' + esc(s.note || "") + '"></label>' +
      '<label class="check"><input name="recompute" type="checkbox"' + (s.hoursMode === "range" && s.startTime && s.endTime ? " checked" : "") + "> 按时间段重新计算小时</label>";
  return '<div class="overlay" id="edit-bg" data-act="edit-bg"><form class="modal" id="edit-form" role="dialog" aria-modal="true" aria-labelledby="edit-title" novalidate>' +
    '<div class="modal-h"><span class="m-ic">' + I("square-pen") + '</span><div><h3 id="edit-title">编辑申请</h3><div class="m-sub">' + esc(empDisplayName(s) || "") + " · 提交于 " + esc(formatStamp(s.createdAt, true)) + "</div></div>" +
    '<button type="button" class="btn btn-ghost btn-sm btn-icon modal-x" id="cancel-edit-x" data-act="edit-cancel" aria-label="关闭">' + I("x", "i-sm") + "</button></div>" +
    '<div class="modal-b">' +
    '<label class="field"><span class="label">员工</span><select class="select" name="employeeId">' + empOpts + '<option value="__other__"' + (!s.employeeId ? " selected" : "") + ">其他</option></select></label>" +
    '<div class="grid-2"><label class="field"><span class="label">性质</span><select class="select" name="type">' + typeOpts + "</select></label>" +
    '<label class="field"><span class="label">状态</span><select class="select" name="status">' + statusOpts + "</select></label></div>" +
    '<label class="field"><span class="label">日期</span><input class="input" name="date" type="date" value="' + esc(s.date) + '" required></label>' + extra + "</div>" +
    '<div class="modal-f"><button type="button" class="btn btn-secondary" id="cancel-edit" data-act="edit-cancel">取消</button>' +
    '<button type="submit" class="btn btn-primary">' + I("check", "i-sm") + "保存</button></div></form></div>";
}

/* ---------------- 结算确认单：选择员工 ---------------- */
function pickerSelectedIds() {
  var S = ui.settlement;
  if (!S || !ui.slipPicker) return [];
  return S.rows.filter(function (r) { return ui.slipPicker.selected[r.emp.id]; }).map(function (r) { return r.emp.id; });
}

function renderSlipPicker(S) {
  var sel = ui.slipPicker.selected;
  var count = pickerSelectedIds().length;
  var items = S.rows.map(function (r) {
    var extra = r.emp.active === false && !S.locked ? ' <span class="tag tag-muted">已停用</span>' : "";
    return '<label class="pick-item"><input type="checkbox" data-pick="' + esc(r.emp.id) + '"' + (sel[r.emp.id] ? " checked" : "") + ">" +
      avatarHtml(r.emp.name) + '<span class="nm">' + esc(r.emp.name) + extra + "</span>" +
      '<span class="hint">应发 ' + moneyHtml(r.gross) + "</span></label>";
  }).join("");
  return '<div class="overlay" id="pick-bg" data-act="pick-bg"><div class="modal" id="pick-modal" role="dialog" aria-modal="true" aria-labelledby="pick-title">' +
    '<div class="modal-h"><span class="m-ic">' + I("printer") + '</span><div><h3 id="pick-title">生成结算确认单 · ' + esc(formatMonthCN(S.ym || ui.month)) + "</h3>" +
    '<div class="m-sub">勾选要生成确认单的员工，打印时每人单独一页。' + (S.locked ? "本月已锁定，数据来自快照。" : "本月未锁定，数据为实时计算。") + "</div></div>" +
    '<button type="button" class="btn btn-ghost btn-sm btn-icon modal-x" data-act="pick-cancel" aria-label="关闭">' + I("x", "i-sm") + "</button></div>" +
    '<div class="modal-b"><div class="actions"><button type="button" class="btn btn-secondary btn-sm" id="pick-all">' + I("square-check", "i-sm") + "全选</button>" +
    '<button type="button" class="btn btn-ghost btn-sm" id="pick-none">' + I("square", "i-sm") + "全不选</button>" +
    '<span class="hint" id="pick-count" style="margin-left:auto">已选 ' + count + " / " + S.rows.length + " 人</span></div>" +
    '<div class="pick-list">' + items + "</div></div>" +
    '<div class="modal-f"><button type="button" class="btn btn-secondary" id="pick-cancel" data-act="pick-cancel">取消</button>' +
    '<button type="button" class="btn btn-primary" id="pick-go"' + (count ? "" : " disabled") + ">" + I("file-text", "i-sm") + "生成确认单</button></div>" +
    "</div></div>";
}

function updatePickerCount() {
  var n = pickerSelectedIds().length;
  var total = ui.settlement ? ui.settlement.rows.length : 0;
  var c = document.getElementById("pick-count");
  if (c) c.textContent = "已选 " + n + " / " + total + " 人";
  var go = document.getElementById("pick-go");
  if (go) go.disabled = !n;
}

/* ---------------- 审批 ---------------- */
function subKeyEmp(s) { return s.employeeId ? "id:" + s.employeeId : "name:" + (s.employeeName || ""); }

function apMatches(s, ignoreStatus) {
  var f = ui.ap;
  if (!ignoreStatus && f.status !== "all" && s.status !== f.status) return false;
  if (f.month && monthOf(s.date) !== f.month) return false;
  if (f.emp && subKeyEmp(s) !== f.emp) return false;
  if (f.type && s.type !== f.type) return false;
  var q = String(f.q || "").trim().toLowerCase();
  if (q) {
    var hay = [empDisplayName(s), s.employeeName, s.note, s.date, TYPE_LABEL[s.type]].join(" ").toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  return true;
}

function findSub(id) {
  var hit = null;
  ui.submissions.forEach(function (s) { if (s.id === id) hit = s; });
  return hit;
}

/** 通过后的结算影响（预估）：只用当前已加载月份的费率；以结算页计算为准 */
function impactOf(s) {
  var S = ui.settlement;
  var ym = monthOf(s.date);
  if (s.type === "custom") return { value: round2(Number(s.amount) || 0), formula: "自定义金额直接计入" };
  if (!S || ym !== ui.month) return { value: null, reason: "切换到 " + formatMonthCN(ym) + " 后可预估" };
  var row = null;
  S.rows.forEach(function (r) { if (r.emp.id === s.employeeId) row = r; });
  if (!row) return { value: null, reason: s.employeeId ? "该员工不在本月结算中" : "未匹配员工，不计入结算" };
  var h = Number(s.hours) || 0;
  if (s.type === "leave") return { value: -round2(h * row.rate), formula: formatHours(h) + " h × €" + Number(row.rateRounded).toFixed(2) + "/h" };
  return { value: round2(h * row.rate * 1.2), formula: formatHours(h) + " h × €" + Number(row.rateRounded).toFixed(2) + "/h × 1.2" };
}

function subValueHtml(s) {
  if (s.type === "custom") return '<span class="v">' + moneyHtml(s.amount, { sign: true, cls: "num" }) + "</span>";
  return '<span class="v"><span class="num" style="font-weight:650;font-size:14px">' + formatHours(s.hours) + '</span><span class="u"> h</span></span>';
}

function subWhenSub(s) {
  var parts = [weekdayCN(s.date)];
  if (s.type !== "custom") {
    if (s.hoursMode === "multi-day") parts.push("全天");
    else if (s.startTime && s.endTime) parts.push(s.startTime + "–" + s.endTime);
    else parts.push("直接填写");
  }
  return parts.join(" · ");
}

function apRowHtml(s) {
  var ym = monthOf(s.date);
  var locked = isMonthLocked(ym);
  var pending = s.status === "pending";
  var sel = ui.ap.sel === s.id ? " sel" : "";
  var nameExtra = "";
  if (!s.employeeId) nameExtra += ' <span class="tag tag-rejected">' + I("link-2-off") + "未匹配</span>";
  else if (s.employeeActive === false) nameExtra += ' <span class="tag tag-muted">已停用</span>';
  var imp = "";
  if (pending) {
    var im = impactOf(s);
    if (im.value != null && s.type !== "custom") imp = '<span class="imp">预估 ' + moneyHtml(im.value, { sign: true, plain: true }) + "</span>";
  }
  var menu = '<span class="menu-wrap"><button type="button" class="btn btn-ghost btn-sm btn-icon" data-act="ap-menu" data-id="' + esc(s.id) + '" aria-label="更多操作" aria-haspopup="menu" aria-expanded="' + (ui.ap.menu === s.id) + '">' + I("ellipsis", "i-sm") + "</button>" +
    (ui.ap.menu === s.id ? '<span class="menu" role="menu"><button type="button" role="menuitem" data-edit="' + esc(s.id) + '">' + I("square-pen", "i-sm") + "编辑申请</button>" +
      '<button type="button" role="menuitem" class="danger" data-del="' + esc(s.id) + '">' + I("trash-2", "i-sm") + "删除</button></span>" : "") + "</span>";
  var ops;
  if (locked) ops = '<span class="tag tag-lock">' + I("lock") + "已锁定</span>" + (pending ? "" : statusTag(s.status));
  else if (pending) ops = '<button type="button" class="btn btn-success btn-sm" data-approve="' + esc(s.id) + '">' + I("check", "i-sm") + '<span class="lbl">通过</span></button>' +
    '<button type="button" class="btn btn-danger btn-sm" data-reject="' + esc(s.id) + '">' + I("x", "i-sm") + '<span class="lbl">驳回</span></button>' + menu;
  else ops = '<span class="hint num d-only">' + esc(formatStamp(s.reviewedAt)) + "</span>" + statusTag(s.status) + menu;
  return '<div class="ap-row' + (pending ? "" : " done") + sel + '" data-act="ap-select" data-id="' + esc(s.id) + '" tabindex="0">' +
    '<div class="emp">' + avatarHtml(empDisplayName(s)) + '<div style="min-width:0"><div class="nm">' + esc(empDisplayName(s)) + nameExtra + '</div><div class="sub num">提交 ' + esc(formatStamp(s.createdAt)) + "</div></div></div>" +
    typeHtml(s.type) +
    '<div class="when"><b>' + esc(s.date) + '</b><span class="note2">' + esc(subWhenSub(s)) + (s.note ? "<em> · " + esc(s.note) + "</em>" : "") + "</span></div>" +
    '<div class="val">' + subValueHtml(s) + imp + "</div>" +
    '<div class="ops">' + ops + "</div></div>";
}

function renderApprove() {
  var f = ui.ap;
  var base = ui.submissions.filter(function (s) { return apMatches(s, true); });
  var cnt = { pending: 0, approved: 0, rejected: 0, all: base.length };
  base.forEach(function (s) { cnt[s.status] = (cnt[s.status] || 0) + 1; });
  var pendTotal = pendingCount();
  var head = pageHead("审批", pendTotal ? ' <span class="x-tag">' + pendTotal + " 条待处理</span>" : ' <span class="x-tag ok">已全部处理</span>',
    "谁 · 申请什么 · 多少时间或金额 · 当前状态 · 下一步，一行看清。通过 / 驳回 / 删除后 5 秒内可撤销。", "");

  var months = {};
  ui.submissions.forEach(function (s) { months[monthOf(s.date)] = true; });
  var monthOpts = Object.keys(months).sort().reverse().map(function (m) {
    return '<option value="' + m + '"' + (f.month === m ? " selected" : "") + ">" + esc(formatMonthCN(m)) + "</option>";
  }).join("");
  var emps = {};
  ui.submissions.forEach(function (s) { emps[subKeyEmp(s)] = empDisplayName(s) + (s.employeeId ? "" : "（未匹配）"); });
  var empOpts = Object.keys(emps).sort(function (a, b) { return emps[a].localeCompare(emps[b], "zh"); }).map(function (k) {
    return '<option value="' + esc(k) + '"' + (f.emp === k ? " selected" : "") + ">" + esc(emps[k]) + "</option>";
  }).join("");
  function seg(key, label, icon, warn) {
    return '<button type="button" class="' + (f.status === key ? "on" : "") + '" data-act="ap-status" data-v="' + key + '" aria-pressed="' + (f.status === key) + '">' + (icon ? I(icon, "i-xs") : "") + label +
      ' <span class="cnt' + (warn ? " warn" : "") + '">' + (cnt[key] || 0) + "</span></button>";
  }
  function tchip(t) {
    return '<button type="button" class="chip' + (f.type === t ? " on" : "") + '" data-act="ap-type" data-v="' + t + '" aria-pressed="' + (f.type === t) + '">' + esc(TYPE_LABEL[t]) + "</button>";
  }
  var filters = '<div class="ap-filters"><div class="seg inline" role="group" aria-label="按状态筛选">' + seg("pending", "待审批", "hourglass", true) + seg("approved", "已通过") + seg("rejected", "已驳回") + seg("all", "全部") + "</div>" +
    '<select class="chip' + (f.month ? " on" : "") + '" id="ap-month" aria-label="按月份筛选"><option value="">全部月份</option>' + monthOpts + "</select>" +
    '<select class="chip' + (f.emp ? " on" : "") + '" id="ap-emp" aria-label="按员工筛选"><option value="">全部员工</option>' + empOpts + "</select>" +
    tchip("leave") + tchip("overtime") + tchip("custom") +
    ((f.month || f.emp || f.type || f.q) ? '<button type="button" class="btn btn-ghost btn-sm" data-act="ap-clear">' + I("x", "i-xs") + "清除筛选</button>" : "") +
    '<label class="search">' + I("search", "i-sm") + '<input id="ap-q" type="search" placeholder="搜索姓名 / 说明 / 日期" value="' + esc(f.q) + '" aria-label="搜索申请"></label></div>';

  var listHead = '<div class="ap-head"><span>员工</span><span>类型</span><span>日期 / 时段 · 说明</span><span>时长 / 金额</span><span>操作</span></div>';
  var list = "";
  var visibleIds = [];
  if (f.status === "pending") {
    var pend = ui.submissions.filter(function (s) { return apMatches(s); });
    var shownPend = pend.slice(0, f.limit);
    shownPend.forEach(function (s) { visibleIds.push(s.id); });
    list += '<div class="ap-sec">' + I("hourglass", "i-sm") + "待处理 " + '<span class="tag tag-pending">' + I("clock") + pend.length + ' 条</span><span class="hint">按提交时间排序 · 通过后进入当月结算</span></div>' +
      (pend.length ? listHead + shownPend.map(apRowHtml).join("") : '<div class="empty" style="border-top:1px solid var(--color-divider)"><div class="e-ic">' + I("circle-check") + "</div><b>没有待处理的申请</b>符合当前筛选条件的申请都已处理。</div>");
    if (pend.length > shownPend.length) list += '<div class="ap-more"><span class="hint">显示 ' + shownPend.length + " / " + pend.length + ' 条</span><button type="button" class="btn btn-secondary btn-sm" data-act="ap-more">加载更多</button></div>';
    var done = ui.submissions.filter(function (s) { return s.status !== "pending" && apMatches(s, true); })
      .sort(function (a, b) { return String(b.reviewedAt || b.createdAt).localeCompare(String(a.reviewedAt || a.createdAt)); }).slice(0, 8);
    if (done.length) {
      done.forEach(function (s) { visibleIds.push(s.id); });
      list += '<div class="ap-sec bt">' + I("history", "i-sm") + '最近已处理<span class="hint">锁定月份的记录只读</span></div>' + done.map(apRowHtml).join("") +
        '<div class="ap-more"><span class="hint">只显示最近 ' + done.length + ' 条</span><button type="button" class="btn btn-ghost btn-sm" data-act="ap-status" data-v="all">查看全部 ' + I("arrow-right", "i-sm") + "</button></div>";
    }
  } else {
    var all = ui.submissions.filter(function (s) { return apMatches(s); });
    var shown = all.slice(0, f.limit);
    shown.forEach(function (s) { visibleIds.push(s.id); });
    list = '<div class="ap-sec">' + I(f.status === "approved" ? "circle-check" : f.status === "rejected" ? "circle-x" : "list-checks", "i-sm") +
      (f.status === "all" ? "全部申请" : STATUS_LABEL[f.status]) + ' <span class="tag tag-muted">' + all.length + ' 条</span><span class="hint">待审批在前，其余按提交时间倒序</span></div>' +
      (all.length ? listHead + shown.map(apRowHtml).join("") : '<div class="empty" style="border-top:1px solid var(--color-divider)"><div class="e-ic">' + I("search") + "</div><b>没有符合条件的申请</b>试试清除筛选。</div>") +
      (all.length > shown.length ? '<div class="ap-more"><span class="hint">显示 ' + shown.length + " / " + all.length + ' 条</span><button type="button" class="btn btn-secondary btn-sm" data-act="ap-more">加载更多</button></div>' : (all.length ? '<div class="ap-more"><span class="hint">共 ' + all.length + " 条</span></div>" : ""));
  }
  if (!ui.submissions.length) list = '<div class="empty"><div class="e-ic">' + I("clipboard-check") + "</div><b>暂无申请</b>员工在提交页提交后会出现在这里。</div>";

  // 详情：选中项不在当前列表时，默认第一条
  if (!ui.ap.sel || visibleIds.indexOf(ui.ap.sel) === -1) {
    if (ui.ap.sel && !findSub(ui.ap.sel)) ui.ap.open = false;
    ui.ap.sel = visibleIds[0] || null;
  }
  var sel = ui.ap.sel ? findSub(ui.ap.sel) : null;
  return head + filters + '<div class="ap-grid"><div class="card" style="overflow:visible" id="ap-list">' + list + "</div>" +
    '<div class="detail-bg' + (ui.ap.open ? " open" : "") + '" data-act="ap-close"></div>' +
    '<aside class="card detail' + (ui.ap.open ? " open" : "") + '" id="ap-detail" aria-label="申请详情">' + (sel ? renderApDetail(sel) : '<div class="detail-empty">选择左侧一条申请查看详情</div>') + "</aside></div>";
}

function renderApDetail(s) {
  var ym = monthOf(s.date);
  var locked = isMonthLocked(ym);
  var pending = s.status === "pending";
  var im = impactOf(s);
  var impact;
  if (pending) {
    impact = '<div class="impact"><div class="row1"><span class="k">通过后结算影响（预估）</span>' +
      (im.value != null ? moneyHtml(im.value, { sign: true }) : '<span class="hint">—</span>') + "</div>" +
      '<div class="f">' + esc(im.value != null ? im.formula + " · 以结算页计算为准" : im.reason) + "</div></div>";
  } else {
    impact = '<div class="impact"><div class="row1"><span class="k">' + (s.status === "approved" ? "已计入当月结算" : "已驳回，不计入结算") + "</span>" +
      (s.status === "approved" && im.value != null ? moneyHtml(im.value, { sign: true }) : "") + "</div>" +
      (s.status === "approved" && im.value != null ? '<div class="f">' + esc(im.formula) + " · 预估值，以结算页为准</div>" : "") + "</div>";
  }
  var timeRow = s.type === "custom" ? "" : "<dt>计时方式</dt><dd>" + esc(MODE_LABEL[s.hoursMode] || "—") + "</dd>" +
    (s.startTime && s.endTime ? '<dt>时段</dt><dd class="num">' + esc(s.startTime) + " – " + esc(s.endTime) + "</dd>" : "");
  var actions = "";
  if (!locked) {
    actions = '<div class="da">' +
      (pending ? '<div class="two"><button type="button" class="btn btn-success" data-approve="' + esc(s.id) + '">' + I("check", "i-sm") + "通过</button>" +
        '<button type="button" class="btn btn-danger" data-reject="' + esc(s.id) + '">' + I("x", "i-sm") + "驳回</button></div>" : "") +
      '<div class="sec"><button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(s.id) + '">' + I("square-pen", "i-sm") + "编辑申请</button>" +
      '<button type="button" class="btn btn-ghost btn-sm danger" data-del="' + esc(s.id) + '">' + I("trash-2", "i-sm") + "删除</button></div>" +
      '<div class="hint" style="display:flex;gap:6px">' + I("info", "i-xs") + "<span>通过 / 驳回 / 删除后 5 秒内可在提示条中撤销；删除会先二次确认。</span></div></div>";
  } else {
    actions = '<div class="da"><div class="warn-item info">' + I("lock", "i-xs") + "<span>" + esc(formatMonthCN(ym)) + "已锁定结算，此申请只读。如需修改请先在结算页解锁。</span></div></div>";
  }
  return '<div class="dh">' + avatarHtml(empDisplayName(s), "lg") + '<div style="min-width:0"><div style="font-size:16px;font-weight:700">' + esc(empDisplayName(s)) + " · " + esc(TYPE_LABEL[s.type]) + "申请</div>" +
    '<div class="hint num">提交于 ' + esc(formatStamp(s.createdAt, true)) + "</div></div>" + statusTag(s.status) +
    '<button type="button" class="btn btn-ghost btn-sm btn-icon d-close" data-act="ap-close" aria-label="关闭">' + I("x") + "</button></div>" +
    '<dl class="dg"><dt>员工</dt><dd>' + esc(empDisplayName(s)) + (s.employeeId ? ' <span class="hint">· ID ' + esc(s.employeeId) + "</span>" : ' <span class="tag tag-rejected">' + I("link-2-off") + "未匹配</span>") +
    (s.displayName && s.employeeName && s.displayName !== s.employeeName ? '<div class="hint">提交时姓名：' + esc(s.employeeName) + "</div>" : "") + "</dd>" +
    "<dt>类型</dt><dd>" + typeHtml(s.type) + "</dd>" +
    '<dt>日期</dt><dd class="num">' + esc(s.date) + "（" + weekdayCN(s.date) + "）</dd>" + timeRow +
    "<dt>" + (s.type === "custom" ? "金额" : "时长") + "</dt><dd>" + (s.type === "custom" ? moneyHtml(s.amount, { sign: true, cls: "num" }) : '<span class="num" style="font-size:18px;font-weight:700">' + formatHours(s.hours) + '</span><span class="u">小时</span>') + "</dd>" +
    "<dt>说明</dt><dd>" + (s.note ? esc(s.note) : '<span class="hint">—</span>') + "</dd>" +
    "<dt>所属月份</dt><dd>" + (locked ? '<span class="tag tag-lock">' + I("lock") + esc(formatMonthCN(ym)) + " · 已锁定</span>" : '<span class="tag tag-info">' + I("lock-open") + esc(formatMonthCN(ym)) + " · 未锁定</span>") + "</dd>" +
    (s.reviewedAt && !pending ? '<dt>审批时间</dt><dd class="num">' + esc(formatStamp(s.reviewedAt, true)) + "</dd>" : "") +
    "</dl>" + impact + actions;
}

/* ---------------- 撤销队列：通过 / 驳回 / 删除延迟 5 秒执行 ---------------- */
var undoOps = [];

function applyOpLocally(op) {
  if (op.kind === "delete") {
    ui.submissions = ui.submissions.filter(function (s) { return s.id !== op.id; });
  } else {
    ui.submissions = ui.submissions.map(function (s) {
      return s.id === op.id ? Object.assign({}, s, { status: op.status, reviewedAt: op.at }) : s;
    });
  }
}

function overlayPendingOps() {
  undoOps.forEach(function (op) {
    if (op.done) return;
    var cur = findSub(op.id);
    if (cur) { op.prev = cur; op.index = ui.submissions.indexOf(cur); }
    applyOpLocally(op);
  });
}

function restoreOp(op) {
  if (!op.prev) return;
  if (op.kind === "delete") {
    if (!findSub(op.id)) {
      var list = ui.submissions.slice();
      list.splice(Math.min(op.index, list.length), 0, op.prev);
      ui.submissions = list;
    }
  } else {
    ui.submissions = ui.submissions.map(function (s) { return s.id === op.id ? op.prev : s; });
  }
}

function opLabel(s) {
  if (!s) return "";
  return empDisplayName(s) + " 的" + TYPE_LABEL[s.type] + " " + (s.type === "custom" ? formatMoney(s.amount, { sign: true }) : formatHours(s.hours) + " h");
}

function queueOp(kind, id, status) {
  var cur = findSub(id);
  if (!cur) return;
  // 同一条申请已有待执行操作：先立即执行旧的
  undoOps.filter(function (o) { return o.id === id && !o.done; }).forEach(function (o) { commitOp(o); });
  var op = { kind: kind, id: id, status: status, prev: cur, index: ui.submissions.indexOf(cur), at: localISO(), done: false };
  applyOpLocally(op);
  undoOps.push(op);
  op.timer = setTimeout(function () { commitOp(op); }, UNDO_MS);
  var verb = kind === "delete" ? "已删除" : status === "approved" ? "已通过" : "已驳回";
  op.toast = toast(verb + " " + opLabel(cur), kind === "delete" ? "info" : "ok", {
    duration: UNDO_MS,
    action: { label: "撤销", onClick: function () { undoOp(op); } }
  });
  if (ui.ap.menu === id) ui.ap.menu = null;
  render();
}

function undoOp(op) {
  if (op.done) { toast("已提交到服务器，无法撤销", "err"); return; }
  op.done = true;
  clearTimeout(op.timer);
  undoOps = undoOps.filter(function (o) { return o !== op; });
  restoreOp(op);
  if (op.kind === "delete") ui.ap.sel = op.id;
  toast("已撤销", "info");
  renderIfIdle();
}

function commitOp(op) {
  if (op.done) return Promise.resolve();
  op.done = true;
  clearTimeout(op.timer);
  if (op.toast) op.toast.close();
  undoOps = undoOps.filter(function (o) { return o !== op; });
  var p = op.kind === "delete"
    ? run("adminDeleteSubmission", getToken(), op.id)
    : run("adminUpdateSubmission", getToken(), op.id, { status: op.status });
  return p.then(function () {
    reloadSoon();
  }).catch(function (err) {
    restoreOp(op);
    toast((err && err.message) || "操作失败", "err");
    renderIfIdle();
    reloadSoon();
  });
}

/** 立即执行全部待执行操作。keepalive=true 用于页面关闭 / 切到后台，不等待结果。 */
function flushOps(keepalive) {
  var ops = undoOps.filter(function (o) { return !o.done; });
  if (!ops.length) return Promise.resolve();
  if (keepalive) {
    ops.forEach(function (op) {
      op.done = true;
      clearTimeout(op.timer);
      if (op.toast) op.toast.close();
      if (op.kind === "delete") runKeepalive("adminDeleteSubmission", getToken(), op.id);
      else runKeepalive("adminUpdateSubmission", getToken(), op.id, { status: op.status });
    });
    undoOps = [];
    flushOps.sentInBackground = true;
    return Promise.resolve();
  }
  return Promise.all(ops.map(commitOp));
}

/* ---------------- 员工与基本工资 ---------------- */
function renderEmployees() {
  var locked = isMonthLocked(ui.month);
  var activeList = ui.employees.filter(function (e) { return e.active !== false; });
  var inactiveList = ui.employees.filter(function (e) { return e.active === false; });
  var rateMap = {};
  if (ui.settlement) ui.settlement.rows.forEach(function (r) { rateMap[r.emp.id] = r.rateRounded; });
  var head = pageHead("员工与基本工资", ' <span class="x-tag">在职 ' + activeList.length + " · 停用 " + inactiveList.length + "</span>",
    "按员工 ID 关联工资、银行卡与申请；改名不影响历史月份。基本工资与备注失焦即保存。");
  var rows = activeList.map(function (e) {
    var baseKey = "base:" + e.id;
    var noteKey = "note:" + e.id;
    var base = Number(e.monthBase) || 0;
    return "<tr>" +
      '<td class="stick"><div class="emp">' + avatarHtml(e.name) + '<div style="min-width:0"><div class="nm">' + esc(e.name) + '</div><div class="sub num">ID ' + esc(e.id) + "</div></div></div></td>" +
      '<td class="st-col"><span class="tag tag-approved">' + I("user-check") + "在职</span></td>" +
      '<td class="r"><span class="money-cell"><span class="money-input"><span class="cur">€</span>' +
      '<input data-base="' + esc(e.id) + '" type="text" inputmode="decimal" autocomplete="off" value="' + (base ? formatNum2(base) : "") + '" placeholder="0.00" aria-label="' + esc(e.name) + ' 本月基本工资"' + (locked ? ' disabled title="本月已锁定结算"' : "") + "></span>" +
      saveStateHtml(baseKey) + "</span></td>" +
      '<td class="r rate-col"><span class="num" style="color:var(--color-text-2)">' + (rateMap[e.id] != null ? Number(rateMap[e.id]).toFixed(2) : "—") + "</span></td>" +
      '<td><span class="note-cell"><input class="note-in" data-note="' + esc(e.id) + '" value="' + esc(e.note || "") + '" placeholder="添加备注" aria-label="' + esc(e.name) + ' 备注">' + saveStateHtml(noteKey) + "</span></td>" +
      '<td class="r"><div class="actions" style="justify-content:flex-end;flex-wrap:nowrap;gap:4px">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-rename-emp="' + esc(e.id) + '">' + I("pencil", "i-sm") + "改名</button>" +
      '<button type="button" class="btn btn-ghost btn-sm danger" data-deact-emp="' + esc(e.id) + '">' + I("user-x", "i-sm") + "停用</button></div></td></tr>";
  }).join("");
  if (!activeList.length) rows = '<tr><td colspan="6" class="empty" style="height:auto">还没有在职员工，在右侧添加。</td></tr>';
  var table = '<div class="tbl-wrap"><table class="tbl emp-tbl"><thead><tr><th class="stick">员工</th><th class="st-col">状态</th>' +
    '<th class="r" style="padding-right:36px">' + Number(ui.month.slice(5)) + '月基本工资</th><th class="r rate-col">费率 €/h</th><th>备注</th><th class="r">操作</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  var inactive = inactiveList.length
    ? '<div class="card" style="margin-top:16px;overflow:hidden"><div class="card-h" style="padding-bottom:12px"><h2 class="card-t">' + I("user-x", "i-sm") + '已停用员工 <span class="tag tag-muted">' + inactiveList.length + '</span></h2><span class="hint">历史月份仍可查看</span></div>' +
      inactiveList.map(function (e) {
        return '<div class="list-row inactive-row"><div class="emp"><span style="opacity:.6">' + avatarHtml(e.name) + '</span><div style="min-width:0"><div class="nm" style="color:var(--color-text-2)">' + esc(e.name) + '</div><div class="sub">ID ' + esc(e.id) + "</div></div></div>" +
          '<span class="ir-tag"><span class="tag tag-muted">' + I("user-x") + "已停用</span></span>" +
          '<span class="hint num ir-when">停用于 ' + esc(formatStamp(e.deactivatedAt, true) || "—") + (e.note ? " · " + esc(e.note) : "") + "</span>" +
          '<button type="button" class="btn btn-secondary btn-sm" data-react-emp="' + esc(e.id) + '">' + I("undo-2", "i-sm") + "恢复</button></div>";
      }).join("") +
      '<div class="hint" style="padding:12px 20px;border-top:1px solid var(--color-divider)">停用后不再出现在员工提交页和新月份的结算表中；以前的工资、申请和付款记录全部保留。</div></div>'
    : "";
  var a = ui.addEmp;
  var addCard = '<div class="card"><div class="card-h"><h2 class="card-t">' + I("user-plus", "i-sm") + "添加员工</h2></div>" +
    '<form class="card-b form-stack" id="add-emp-form" novalidate>' +
    '<label class="field"><span class="label">姓名 <span class="req">*</span></span><input class="input' + (a.error ? " invalid" : "") + '" name="name" maxlength="40" placeholder="例如 Marco" value="' + esc(a.name) + '" autocomplete="off">' +
    (a.error ? '<span class="err">' + I("circle-alert", "i-xs") + esc(a.error) + "</span>" : "") + "</label>" +
    '<label class="field"><span class="label">月基本工资 <span class="req">*</span></span><span class="input-lead"><span class="lead">€</span><input class="input num' + (a.baseError ? " invalid" : "") + '" name="base" inputmode="decimal" placeholder="0.00" value="' + esc(a.base) + '" autocomplete="off"></span>' +
    (a.baseError ? '<span class="err">' + I("circle-alert", "i-xs") + esc(a.baseError) + "</span>" : '<span class="hint">写入 ' + esc(formatMonthCN(ui.month)) + "；之后月份自动沿用</span>") + "</label>" +
    '<button type="submit" class="btn btn-primary" id="add-emp">' + I("plus", "i-sm") + "添加员工</button></form></div>";
  var csvCard = '<div class="card"><div class="card-h"><h2 class="card-t">' + I("file-spreadsheet", "i-sm") + "批量导入基本工资</h2></div>" +
    '<div class="card-b form-stack"><p class="hint">每行「姓名,基本工资」，按姓名匹配已有员工；未匹配到的姓名会新增；已停用员工会跳过。</p>' +
    '<textarea id="csv-paste" class="textarea csv-area" placeholder="Tino,2400&#10;小杨,2200" aria-label="粘贴 CSV">' + esc(ui.csvDraft || "") + "</textarea>" +
    '<div class="actions"><button type="button" class="btn btn-secondary btn-sm" id="import-csv"' + (locked ? " disabled" : "") + ">" + I("upload", "i-sm") + "导入到 " + Number(ui.month.slice(5)) + " 月</button>" +
    '<button type="button" class="btn btn-ghost btn-sm" id="copy-prev"' + (locked ? " disabled" : "") + ">" + I("history", "i-sm") + "从上月复制</button></div></div></div>";
  return head +
    (locked ? '<div class="banner lock"><span class="b-ic">' + I("lock") + '</span><div class="b-txt"><b>' + esc(formatMonthCN(ui.month)) + '已锁定结算</b><span class="hint">基本工资显示的是快照，不能修改；改名、备注不受影响。</span></div></div>' : "") +
    '<div class="grid emp-grid"><div style="min-width:0">' + table + inactive + "</div>" +
    '<div class="side-col">' + addCard + csvCard + "</div></div>";
}

/* ---------------- 数据备份与密码 ---------------- */
function renderData() {
  return pageHead("数据备份与密码", "", "导出 / 导入全部业务数据，修改后台密码。", "") +
    '<div class="grid data-grid">' +
    '<div class="card data-card"><div class="card-h"><h2 class="card-t"><span class="ic-lg">' + I("database") + "</span>备份与恢复</h2></div>" +
    '<div class="card-b form-stack"><p>导出为 JSON 文件，可在清空或换表后重新导入。导入将<b style="color:var(--color-danger)">覆盖当前全部业务数据</b>（不含后台密码）。</p>' +
    '<div class="actions"><button type="button" class="btn btn-primary" id="export-json">' + I("download", "i-sm") + "导出 JSON</button>" +
    '<button type="button" class="btn btn-secondary" id="import-json">' + I("upload", "i-sm") + "导入 JSON</button>" +
    '<input id="import-file" type="file" accept="application/json,.json" hidden></div></div></div>' +
    '<div class="card data-card"><div class="card-h"><h2 class="card-t"><span class="ic-lg ink">' + I("key-round") + "</span>修改后台密码</h2></div>" +
    '<form id="pw-form" class="card-b form-stack" novalidate>' +
    '<label class="field"><span class="label">当前密码</span><input class="input" name="old" type="password" autocomplete="current-password" required></label>' +
    '<label class="field"><span class="label">新密码</span><input class="input" name="nw" type="password" autocomplete="new-password" required></label>' +
    '<label class="field"><span class="label">再次输入新密码</span><input class="input" name="nw2" type="password" autocomplete="new-password" required><span class="err" id="pw-err" hidden></span></label>' +
    '<div><button type="submit" class="btn btn-ink">' + I("shield-check", "i-sm") + "保存新密码</button></div></form></div>" +
    '<div class="card data-card"><div class="card-h"><h2 class="card-t"><span class="ic-lg">' + I("log-out") + "</span>会话</h2></div>" +
    '<div class="card-b form-stack"><p>会话保存在服务器缓存中，约 6 小时有效；在共用设备上用完请退出。</p>' +
    '<div><button type="button" class="btn btn-secondary" id="logout" data-act="logout">' + I("log-out", "i-sm") + "退出登录</button></div></div></div>" +
    "</div>";
}

/* ---------------- 员工结算确认单 ---------------- */
function slipTimeText(d) {
  if (d.type === "custom") return "—";
  if (d.hoursMode === "multi-day") return "全天";
  if (d.startTime && d.endTime) return esc(d.startTime) + "–" + esc(d.endTime);
  return "—";
}

function slipItemsTable(list, kind, r) {
  var isCustom = kind === "custom";
  var head = isCustom
    ? '<tr><th>日期</th><th>说明</th><th class="r">金额</th></tr>'
    : '<tr><th>日期</th><th>时间</th><th class="r">小时</th><th>说明</th><th class="r">' + (kind === "leave" ? "扣款" : "加班费（×1.2）") + "</th></tr>";
  if (!list.length) {
    return '<table class="slip-table"><thead>' + head + '</thead><tbody><tr><td colspan="' + (isCustom ? 3 : 5) + '" class="none">无</td></tr></tbody></table>';
  }
  var body = list.map(function (d) {
    var money = formatMoney(d.effect, { sign: isCustom });
    if (isCustom) {
      return "<tr><td class=\"num\">" + esc(d.date) + "</td><td>" + esc(d.note || "") + '</td><td class="r num">' + money + "</td></tr>";
    }
    return '<tr><td class="num">' + esc(d.date) + '</td><td class="num">' + slipTimeText(d) + '</td><td class="r num">' + formatHours(d.hours) + "</td><td>" + esc(d.note || "") + '</td><td class="r num">' + money + "</td></tr>";
  }).join("");
  var foot;
  if (kind === "leave") foot = '<tr><td colspan="2">合计</td><td class="r num">' + formatHours(r.leaveHours) + '</td><td></td><td class="r num">' + formatMoney(-r.leavePay) + "</td></tr>";
  else if (kind === "overtime") foot = '<tr><td colspan="2">合计</td><td class="r num">' + formatHours(r.otHours) + '</td><td></td><td class="r num">' + formatMoney(r.otPay) + "</td></tr>";
  else foot = '<tr><td colspan="2">合计</td><td class="r num">' + formatMoney(r.customSum, { sign: true }) + "</td></tr>";
  return '<table class="slip-table"><thead>' + head + "</thead><tbody>" + body + "</tbody><tfoot>" + foot + "</tfoot></table>";
}

function renderSlip(r, S) {
  var leaves = r.details.filter(function (d) { return d.type === "leave"; });
  var ots = r.details.filter(function (d) { return d.type === "overtime"; });
  var customs = r.details.filter(function (d) { return d.type === "custom"; });
  var locked = !!S.locked;
  var status = locked
    ? '<span class="tag tag-approved">' + I("lock") + "已锁定 · 快照 " + esc(formatStamp(S.lockedAt, true)) + "</span>"
    : '<span class="tag tag-pending">' + I("refresh-cw") + "未锁定 · 实时计算，仅供核对</span>";
  var line = function (label, value, cls) {
    return '<div class="slip-line' + (cls ? " " + cls : "") + '"><span>' + label + '</span><span class="num">' + value + "</span></div>";
  };
  var capacity = r.capacity || r.workdays * 8.5;
  return '<section class="card slip" data-slip-emp="' + esc(r.emp.id) + '">' +
    '<header class="slip-head"><div class="slip-brand"><img class="slip-logo" src="logo-white.png" alt="FEST7 Express" width="67" height="30"><div><h2 class="slip-title">员工结算确认单</h2>' +
    '<div class="hint">FEST7 · ' + esc(formatMonthCN(S.ym || ui.month)) + "</div></div></div>" + status + "</header>" +
    '<div class="slip-meta">' +
    '<div><div class="k">员工</div><strong>' + esc(r.emp.name) + "</strong></div>" +
    '<div><div class="k">结算月份</div><strong class="num">' + esc(S.ym || ui.month) + "</strong></div>" +
    '<div><div class="k">员工编号</div><span class="num">' + esc(r.emp.id) + "</span></div></div>" +
    '<h3 class="slip-h">一、基本工资与小时费率</h3>' +
    '<table class="slip-table"><tbody>' +
    '<tr><td>月基本工资</td><td class="r num">' + formatMoney(r.base) + "</td></tr>" +
    '<tr><td>本月工作日（周一至周五，假日不扣除）</td><td class="r num">' + r.workdays + " 天</td></tr>" +
    '<tr><td>标准工时（工作日 × 8.5）</td><td class="r num">' + formatHours(capacity) + " 小时</td></tr>" +
    '<tr><td>小时费率（基本工资 ÷ 标准工时）</td><td class="r num">' + formatMoney(r.rateRounded) + " / 小时</td></tr>" +
    "</tbody></table>" +
    '<h3 class="slip-h">二、请假明细（按小时费率扣款）</h3>' + slipItemsTable(leaves, "leave", r) +
    '<h3 class="slip-h">三、加班明细（小时费率 × 1.2）</h3>' + slipItemsTable(ots, "overtime", r) +
    '<h3 class="slip-h">四、自定义调整</h3>' + slipItemsTable(customs, "custom", r) +
    '<h3 class="slip-h">五、汇总</h3>' +
    '<div class="slip-sum">' +
    line("月基本工资", formatMoney(r.base)) +
    line("− 请假扣款", formatMoney(-r.leavePay)) +
    line("+ 加班费", formatMoney(r.otPay)) +
    line("± 自定义调整", formatMoney(r.customSum, { sign: true })) +
    line("<strong>应发合计</strong>", "<strong>" + formatMoney(r.gross) + "</strong>", "slip-total") +
    line("其中：银行卡转账", formatMoney(r.bank)) +
    line("其中：现金支付", formatMoney(r.cash)) +
    "</div>" +
    '<p class="slip-note">扣款与加班费按未取整的小时费率、以合计小时计算后取整到分，逐项金额相加可能与合计有 €0.01 的尾差。</p>' +
    '<div class="slip-sign">' +
    '<div><div class="slip-sign-line"></div><div class="hint">员工签字</div><div class="slip-sign-line short"></div><div class="hint">日期</div></div>' +
    '<div><div class="slip-sign-line"></div><div class="hint">管理员签字</div><div class="slip-sign-line short"></div><div class="hint">日期</div></div>' +
    "</div>" +
    '<footer class="slip-foot">内部对账确认单，不替代正式工资单（busta paga）</footer>' +
    "</section>";
}

function renderSlips() {
  var S = ui.settlement;
  if (!S) return loadingCard("正在加载结算…");
  var rows = ui.slip.all ? S.rows
    : ui.slip.ids ? S.rows.filter(function (r) { return ui.slip.ids.indexOf(r.emp.id) !== -1; })
    : S.rows.filter(function (r) { return r.emp.id === ui.slip.empId; });
  var title = ui.slip.empId ? "结算确认单"
    : (rows.length === S.rows.length ? "全部员工结算确认单" : "所选员工结算确认单") + "（" + rows.length + " 份）";
  return '<div class="slip-bar no-print"><div><h1 class="ph-title">' + esc(title) + ' <span class="x-tag">' + esc(formatMonthCN(S.ym || ui.month)) + "</span></h1>" +
    '<p class="ph-sub">' + (S.locked ? "已锁定，数据来自快照" : "未锁定，数据为实时计算") + "。打印时每位员工单独一页（A4）。</p></div>" +
    '<div class="actions"><button type="button" class="btn btn-secondary" id="slip-back">' + I("arrow-left", "i-sm") + "返回</button>" +
    '<button type="button" class="btn btn-primary" id="slip-print">' + I("printer", "i-sm") + "打印</button></div></div>" +
    (rows.length ? '<div class="slips">' + rows.map(function (r) { return renderSlip(r, S); }).join("") + "</div>" : '<div class="card empty">没有找到该员工的结算数据。</div>');
}

/* ---------------- 事件（委托到 #app，渲染后无需重新绑定） ---------------- */
function closestAttr(el, sel) { return el && el.closest ? el.closest(sel) : null; }

function onAppClick(e) {
  var t = e.target;
  if (ui.ap.menu && !closestAttr(t, ".menu-wrap")) {
    ui.ap.menu = null;
    if (!closestAttr(t, "[data-act],[data-approve],[data-reject],[data-edit],[data-del]")) { render(); return; }
  }
  var b;
  if ((b = closestAttr(t, "[data-approve]"))) { e.stopPropagation(); queueOp("status", b.getAttribute("data-approve"), "approved"); return; }
  if ((b = closestAttr(t, "[data-reject]"))) { e.stopPropagation(); queueOp("status", b.getAttribute("data-reject"), "rejected"); return; }
  if ((b = closestAttr(t, "[data-edit]"))) { e.stopPropagation(); openEdit(b.getAttribute("data-edit")); return; }
  if ((b = closestAttr(t, "[data-del]"))) { e.stopPropagation(); deleteSubmission(b.getAttribute("data-del")); return; }
  if ((b = closestAttr(t, "[data-rename-emp]"))) { renameEmp(b.getAttribute("data-rename-emp"), b); return; }
  if ((b = closestAttr(t, "[data-deact-emp]"))) { deactivateEmp(b.getAttribute("data-deact-emp"), b); return; }
  if ((b = closestAttr(t, "[data-react-emp]"))) { reactivateEmp(b.getAttribute("data-react-emp"), b); return; }
  if ((b = closestAttr(t, "#pick-all"))) { setPickAll(true); return; }
  if ((b = closestAttr(t, "#pick-none"))) { setPickAll(false); return; }
  if ((b = closestAttr(t, "#pick-go"))) { pickGo(); return; }
  if ((b = closestAttr(t, "#slip-back"))) {
    var empId = ui.slip && ui.slip.empId;
    ui.slip = null;
    ui.selectedEmpId = empId || null;
    render();
    return;
  }
  if ((b = closestAttr(t, "#slip-print"))) { window.print(); return; }
  if ((b = closestAttr(t, "#export-json"))) { exportJson(b); return; }
  if ((b = closestAttr(t, "#import-json"))) { var f = document.getElementById("import-file"); if (f) f.click(); return; }
  if ((b = closestAttr(t, "#import-csv"))) { importCsv(b); return; }
  if ((b = closestAttr(t, "#copy-prev"))) { copyPrev(b); return; }

  var el = closestAttr(t, "[data-act]");
  if (!el) return;
  var act = el.getAttribute("data-act");
  // 行级点击：点在行内输入框 / 按钮上时不触发
  if (act === "emp-open" || act === "ap-select") {
    var inner = closestAttr(t, "input,button,select,textarea,a,label,.money-cell");
    if (inner && inner !== el && el.contains(inner)) return;
  }
  if (/-bg$/.test(act) && t !== el) return;
  var v = el.getAttribute("data-v");
  switch (act) {
    case "tab":
      ui.tab = el.getAttribute("data-tab");
      ui.slip = null; ui.slipPicker = null; ui.selectedEmpId = null; ui.editing = null;
      ui.navOpen = false; ui.ap.open = false; ui.ap.menu = null;
      render();
      window.scrollTo(0, 0);
      break;
    case "nav-toggle": ui.navOpen = !ui.navOpen; document.body.classList.toggle("nav-open", ui.navOpen); el.setAttribute("aria-expanded", String(ui.navOpen)); break;
    case "nav-close": ui.navOpen = false; document.body.classList.remove("nav-open"); break;
    case "refresh": if (!ui.refreshing) refreshInBackground(); break;
    case "month": changeMonth(v); break;
    case "toggle-money":
      ui.hideMoney = !ui.hideMoney;
      try { localStorage.setItem(HIDE_MONEY_KEY, ui.hideMoney ? "1" : "0"); } catch (err) { /* ignore */ }
      render();
      break;
    case "goto-sub": {
      var s = findSub(el.getAttribute("data-id"));
      ui.tab = "approve";
      ui.ap = Object.assign(ui.ap, { status: s && s.status === "pending" ? "pending" : "all", month: "", emp: "", type: "", q: "", sel: s ? s.id : null, open: true, menu: null });
      render();
      window.scrollTo(0, 0);
      break;
    }
    case "ap-unmatched": {
      var um = ui.submissions.filter(function (x) { return !x.employeeId && x.status === "approved"; })[0];
      ui.tab = "approve";
      ui.ap = Object.assign(ui.ap, { status: "approved", month: "", emp: um ? subKeyEmp(um) : "", type: "", q: "", sel: um ? um.id : null, open: !!um, menu: null });
      render();
      window.scrollTo(0, 0);
      break;
    }
    case "settle-filter": ui.settleFilter = v; render(); break;
    case "export-csv": exportCsv(el); break;
    case "pick-slips": openSlipPicker(); break;
    case "lock": lockMonth(el); break;
    case "unlock": unlockMonth(el); break;
    case "open-slip":
      ui.slip = { empId: el.getAttribute("data-slip") };
      ui.selectedEmpId = null;
      render();
      window.scrollTo(0, 0);
      break;
    case "emp-open": {
      var id = el.getAttribute("data-emp");
      ui.selectedEmpId = ui.selectedEmpId === id && el.tagName === "TR" ? null : id;
      render();
      var cl = document.getElementById("close-drawer");
      if (cl) cl.focus();
      break;
    }
    case "drawer-close": case "drawer-bg": ui.selectedEmpId = null; render(); break;
    case "m-toggle": { var mid = el.getAttribute("data-emp"); ui.mOpen = ui.mOpen === mid ? null : mid; render(); break; }
    case "edit-cancel": case "edit-bg": ui.editing = null; render(); break;
    case "pick-cancel": case "pick-bg": ui.slipPicker = null; render(); break;
    case "ap-status": ui.ap.status = v; ui.ap.limit = 30; render(); break;
    case "ap-type": ui.ap.type = ui.ap.type === v ? "" : v; ui.ap.limit = 30; render(); break;
    case "ap-clear": ui.ap.month = ""; ui.ap.emp = ""; ui.ap.type = ""; ui.ap.q = ""; render(); break;
    case "ap-more": ui.ap.limit += 30; render(); break;
    case "ap-select": ui.ap.sel = el.getAttribute("data-id"); ui.ap.open = true; render(); break;
    case "ap-close": ui.ap.open = false; render(); break;
    case "ap-menu": { var mi = el.getAttribute("data-id"); ui.ap.menu = ui.ap.menu === mi ? null : mi; render(); break; }
    case "logout": logout(el); break;
  }
}

function onAppChange(e) {
  var t = e.target;
  if (t.id === "month-input") { changeMonth(t.value || currentMonth()); return; }
  if (t.matches("input.bank")) { saveBank(t); return; }
  if (t.hasAttribute("data-base")) { saveBase(t); return; }
  if (t.hasAttribute("data-note")) { saveNote(t); return; }
  if (t.hasAttribute("data-pick")) {
    if (ui.slipPicker) ui.slipPicker.selected[t.getAttribute("data-pick")] = t.checked;
    updatePickerCount();
    return;
  }
  if (t.id === "ap-month") { ui.ap.month = t.value; ui.ap.limit = 30; t.blur(); render(); return; }
  if (t.id === "ap-emp") { ui.ap.emp = t.value; ui.ap.limit = 30; t.blur(); render(); return; }
  if (t.id === "import-file") { importJsonFile(t); return; }
  if (t.name === "type" && t.form && t.form.id === "edit-form") {
    ui.editing = Object.assign({}, ui.editing, readEditForm(t.form), { type: t.value });
    render();
  }
}

function onAppInput(e) {
  var t = e.target;
  if (t.id === "settle-q") { ui.settleQ = t.value; applySettleSearch(); return; }
  if (t.id === "ap-q") { ui.ap.q = t.value; ui.ap.limit = 30; render(); return; }
  if (t.id === "csv-paste") { ui.csvDraft = t.value; return; }
  if (t.form && t.form.id === "add-emp-form") {
    if (t.name === "name") { ui.addEmp.name = t.value; if (ui.addEmp.error) { ui.addEmp.error = ""; t.classList.remove("invalid"); } }
    if (t.name === "base") { ui.addEmp.base = t.value; if (ui.addEmp.baseError) { ui.addEmp.baseError = ""; t.classList.remove("invalid"); } }
  }
}

function isMoneyField(t) { return t && t.matches && (t.matches("input.bank") || t.hasAttribute("data-base")); }

function onAppFocusIn(e) {
  var t = e.target;
  if (isMoneyField(t)) {
    var v = parseMoneyInput(t.value);
    if (!isNaN(v)) t.value = v ? String(round2(v)) : "";
    t._orig = t.value;
    setTimeout(function () { try { t.select(); } catch (err) { /* ignore */ } }, 0);
  }
}

function onAppFocusOut(e) {
  var t = e.target;
  if (isMoneyField(t)) {
    var v = parseMoneyInput(t.value);
    if (!isNaN(v)) t.value = v ? formatNum2(v) : "";
  }
  setTimeout(function () {
    if (ui.pendingRender && !isFormFieldFocused() && !isDialogOpen()) renderIfIdle();
  }, 0);
}

function onAppSubmit(e) {
  var f = e.target;
  if (f.id === "edit-form") onSaveEdit(e);
  else if (f.id === "add-emp-form") onAddEmp(e);
  else if (f.id === "pw-form") onChangePassword(e);
}

function onDocKey(e) {
  if (isDialogOpen()) return;
  if (e.key === "Escape") {
    if (ui.ap.menu) { ui.ap.menu = null; render(); }
    else if (ui.editing) { ui.editing = null; render(); }
    else if (ui.slipPicker) { ui.slipPicker = null; render(); }
    else if (ui.selectedEmpId) { ui.selectedEmpId = null; render(); }
    else if (ui.ap.open && ui.tab === "approve") { ui.ap.open = false; render(); }
    else if (ui.navOpen) { ui.navOpen = false; document.body.classList.remove("nav-open"); }
    return;
  }
  if ((e.key === "Enter" || e.key === " ") && e.target && e.target.matches && e.target.matches("tr[data-act], .ap-row[data-act]")) {
    e.preventDefault();
    e.target.click();
  }
}

/* ---------------- 操作 ---------------- */
function changeMonth(nextMonth) {
  if (!nextMonth || nextMonth === ui.month && ui.settlement) return;
  flushOps();
  ui.month = nextMonth || currentMonth();
  ui.selectedEmpId = null;
  ui.slip = null;
  ui.slipPicker = null;
  ui.mOpen = null;
  var cached = readBootstrapCache(ui.month);
  if (cached) applyBootstrap(cached);
  else ui.settlement = null;
  ui.refreshing = true;
  render();
  loadAll().then(function () {
    ui.refreshing = false;
    render();
  }).catch(function (err) {
    ui.refreshing = false;
    ui.syncError = true;
    if (handleExpired(err)) return;
    toast(err.message, "err");
    render();
  });
}

function applyBankLocally(empId, amount) {
  if (!ui.settlement || !ui.settlement.rows) return;
  var saved = round2(amount);
  var t = ui.settlement.totals;
  ui.settlement.rows.forEach(function (r) {
    if (r.emp.id !== empId) return;
    t.bank = round2((t.bank - r.bank) + saved);
    t.cash = round2((t.cash - r.cash) + (r.gross - saved));
    r.bank = saved;
    r.cash = round2(r.gross - saved);
  });
}

function saveBank(inp) {
  var empId = inp.getAttribute("data-bank");
  var key = "bank:" + empId;
  var month = ui.month;
  var amount = parseMoneyInput(inp.value);
  if (isNaN(amount)) {
    setFieldSaveState(key, "error", "金额无效");
    toast("请输入有效的金额，例如 1500 或 1,500.00", "err");
    return;
  }
  amount = round2(amount);
  applyBankLocally(empId, amount);
  setFieldSaveState(key, "saving", "保存中…");
  inp.disabled = true;
  run("adminSetBank", getToken(), month, empId, amount ? String(amount) : "")
    .then(function (res) {
      var saved = res && res.amount != null ? res.amount : amount;
      if (ui.month === month) applyBankLocally(empId, saved);
      inp.disabled = false;
      setFieldSaveState(key, "saved", "已保存");
      toast("银行卡金额已保存", "ok");
      renderIfIdle();
      setTimeout(function () { setFieldSaveState(key, "", ""); }, 2000);
    })
    .catch(function (err) {
      inp.disabled = false;
      setFieldSaveState(key, "error", "保存失败");
      toast(err.message, "err");
      reloadSoon(600);
    });
}

function saveBase(inp) {
  var id = inp.getAttribute("data-base");
  var key = "base:" + id;
  var v = parseMoneyInput(inp.value);
  if (isNaN(v) || v < 0) {
    setFieldSaveState(key, "error", "金额无效");
    toast("请输入有效的基本工资", "err");
    return;
  }
  v = round2(v);
  ui.employees.forEach(function (e) {
    if (e.id === id) { e.monthBase = v; e.defaultBase = v; }
  });
  setFieldSaveState(key, "saving", "保存中…");
  inp.disabled = true;
  run("adminUpdateEmployee", getToken(), id, {
    month: ui.month, monthBase: String(v), defaultBase: String(v)
  }).then(function () {
    inp.disabled = false;
    setFieldSaveState(key, "saved", "已保存");
    toast("已更新基本工资", "ok");
    setTimeout(function () { setFieldSaveState(key, "", ""); }, 2000);
    reloadSoon(800);
  }).catch(function (err) {
    inp.disabled = false;
    setFieldSaveState(key, "error", "保存失败");
    toast(err.message, "err");
  });
}

function saveNote(inp) {
  var id = inp.getAttribute("data-note");
  var key = "note:" + id;
  var value = inp.value;
  ui.employees.forEach(function (e) { if (e.id === id) e.note = value; });
  setFieldSaveState(key, "saving", "保存中…");
  inp.disabled = true;
  run("adminUpdateEmployee", getToken(), id, { note: value })
    .then(function () {
      inp.disabled = false;
      setFieldSaveState(key, "saved", "已保存");
      toast("备注已保存", "ok");
      setTimeout(function () { setFieldSaveState(key, "", ""); }, 2000);
    })
    .catch(function (err) {
      inp.disabled = false;
      setFieldSaveState(key, "error", "保存失败");
      toast(err.message, "err");
    });
}

function findEmp(id) {
  var emp = null;
  ui.employees.forEach(function (e) { if (e.id === id) emp = e; });
  return emp;
}

function nameTaken(name, exceptId) {
  var n = String(name || "").trim().toLowerCase();
  return ui.employees.some(function (e) { return e.id !== exceptId && String(e.name || "").trim().toLowerCase() === n; });
}

function exportCsv(btn) {
  withButtonBusy(btn, "导出中…", function () {
    return run("adminExportSettlementCsv", getToken(), ui.month).then(function (r) {
      downloadText(r.filename, r.csv, "text/csv;charset=utf-8");
      toast("已导出 CSV", "ok");
    });
  }).catch(function (err) { toast(err.message, "err"); });
}

function openSlipPicker() {
  if (!ui.settlement || !ui.settlement.rows.length) { toast("本月没有可生成确认单的员工", "err"); return; }
  var sel = {};
  ui.settlement.rows.forEach(function (r) { sel[r.emp.id] = true; });
  ui.slipPicker = { selected: sel };
  ui.selectedEmpId = null;
  render();
}

function setPickAll(on) {
  if (!ui.slipPicker) return;
  (ui.settlement ? ui.settlement.rows : []).forEach(function (r) { ui.slipPicker.selected[r.emp.id] = on; });
  Array.prototype.forEach.call(document.querySelectorAll("[data-pick]"), function (cb) { cb.checked = on; });
  updatePickerCount();
}

function pickGo() {
  var ids = pickerSelectedIds();
  if (!ids.length) { toast("请至少选择一名员工", "err"); return; }
  ui.slipPicker = null;
  ui.slip = { ids: ids };
  render();
  window.scrollTo(0, 0);
}

function lockMonth(btn) {
  var S = ui.settlement;
  if (!S) return;
  var month = ui.month;
  flushOps().then(function () {
    var pending = ui.submissions.filter(function (s) { return s.status === "pending" && monthOf(s.date) === month; }).length;
    var warns = "";
    if (pending) warns += '<div class="warn-item">' + I("hourglass", "i-xs") + "<span>本月还有 <b>" + pending + " 条待审批</b>申请，锁定后它们不会计入结算。</span></div>";
    if (S.unmatched && S.unmatched.length) warns += '<div class="warn-item danger">' + I("link-2-off", "i-xs") + "<span>有 " + S.unmatched.length + " 条已通过申请无法匹配到员工，不会计入。</span></div>";
    return confirmDialog({
      title: "锁定 " + formatMonthCN(month) + " 的结算？",
      icon: "lock",
      tone: "ink",
      body: "<p>锁定后会保存本月每位员工的结算快照（基本工资、请假、加班、调整、银行卡、现金）。此后本月的审批、基本工资、银行卡和调整都不能再修改，员工也不能再提交本月申请。</p>" + warns +
        '<p class="hint">应发合计 ' + formatMoney(S.totals.gross) + " · 银行卡 " + formatMoney(S.totals.bank) + " · 现金 " + formatMoney(S.totals.cash) + "</p>",
      confirmText: "确认锁定",
      confirmIcon: "lock",
      busyText: "锁定中…",
      onConfirm: function () {
        return run("adminLockMonth", getToken(), month).then(function (res) {
          if (ui.month === month && res && res.settlement) {
            ui.settlement = res.settlement;
            ui.lock = res.lock;
            if (ui.lockedMonths.indexOf(month) === -1) ui.lockedMonths = ui.lockedMonths.concat([month]);
          }
        });
      }
    });
  }).then(function (ok) {
    if (!ok) return;
    toast(formatMonthCN(month) + "已锁定结算", "ok");
    render();
    return loadAll().then(function () { renderIfIdle(); });
  }).catch(function (err) { if (err) toast(err.message, "err"); });
}

function unlockMonth(btn) {
  var month = ui.month;
  confirmDialog({
    title: "解锁 " + formatMonthCN(month) + "？",
    icon: "lock-open",
    tone: "danger",
    body: "<p>解锁后本月将重新按当前数据实时计算，可以再修改；已保存的快照仍保留在表格中作为记录。修改完成后请重新锁定。</p>",
    input: { label: "请输入月份 " + month + " 以确认解锁", placeholder: month, match: month, inputmode: "numeric" },
    confirmText: "解锁",
    confirmIcon: "lock-open",
    busyText: "解锁中…",
    onConfirm: function (typed) {
      return run("adminUnlockMonth", getToken(), month, String(typed).trim());
    }
  }).then(function (ok) {
    if (!ok) return;
    ui.lockedMonths = ui.lockedMonths.filter(function (m) { return m !== month; });
    toast(formatMonthCN(month) + "已解锁", "ok");
    return loadAll().then(function () { render(); });
  }).catch(function (err) { toast(err.message, "err"); });
}

function openEdit(id) {
  undoOps.filter(function (o) { return o.id === id && !o.done; }).forEach(function (o) { commitOp(o); });
  ui.editing = null;
  ui.ap.menu = null;
  ui.submissions.forEach(function (s) { if (s.id === id) ui.editing = s; });
  if (!ui.editing && ui.settlement) {
    ui.settlement.rows.forEach(function (r) {
      r.details.forEach(function (s) { if (s.id === id) ui.editing = s; });
    });
  }
  render();
  var first = document.querySelector("#edit-form select, #edit-form input");
  if (first) first.focus();
}

function deleteSubmission(id) {
  ui.ap.menu = null;
  var s = findSub(id);
  var label = s ? opLabel(s) : "这条申请";
  if (!s && ui.settlement) {
    ui.settlement.rows.forEach(function (r) { r.details.forEach(function (d) { if (d.id === id) { s = d; label = r.emp.name + " 的" + TYPE_LABEL[d.type]; } }); });
  }
  confirmDialog({
    title: "删除这条申请？",
    icon: "trash-2",
    tone: "danger",
    body: "<p><b>" + esc(label) + "</b>" + (s && s.date ? "（" + esc(s.date) + "）" : "") + "</p><p>删除后 5 秒内可在提示条中撤销；之后无法恢复。</p>",
    confirmText: "删除",
    confirmIcon: "trash-2"
  }).then(function (ok) {
    if (!ok) return;
    if (ui.editing && ui.editing.id === id) ui.editing = null;
    if (findSub(id)) { queueOp("delete", id); return; }
    // 申请不在当前列表（极少见）：直接删除
    run("adminDeleteSubmission", getToken(), id).then(function () {
      toast("已删除", "ok");
      return loadAll().then(renderIfIdle);
    }).catch(function (err) { toast(err.message, "err"); });
  });
}

function readEditForm(form) {
  var q = function (n) { var el = form.querySelector("[name=" + n + "]"); return el ? el.value : undefined; };
  var out = { employeeId: q("employeeId"), status: q("status"), date: q("date"), note: q("note") };
  if (q("amount") !== undefined) out.amount = q("amount");
  if (q("startTime") !== undefined) { out.startTime = q("startTime"); out.endTime = q("endTime"); out.hours = q("hours"); }
  if (out.employeeId === "__other__") out.employeeId = "";
  return out;
}

function onSaveEdit(e) {
  e.preventDefault();
  var form = e.target;
  var btn = form.querySelector('button[type="submit"]');
  var body = {
    employeeId: form.querySelector("[name=employeeId]").value,
    type: form.querySelector("[name=type]").value,
    status: form.querySelector("[name=status]").value,
    date: form.querySelector("[name=date]").value,
    note: (form.querySelector("[name=note]") && form.querySelector("[name=note]").value) || ""
  };
  if (body.type === "custom") {
    body.amount = Number(form.querySelector("[name=amount]").value);
  } else {
    body.startTime = (form.querySelector("[name=startTime]") && form.querySelector("[name=startTime]").value) || "";
    body.endTime = (form.querySelector("[name=endTime]") && form.querySelector("[name=endTime]").value) || "";
    var recompute = form.querySelector("[name=recompute]") && form.querySelector("[name=recompute]").checked;
    if (recompute && body.startTime && body.endTime) body.hoursMode = "range";
    else {
      body.hours = Number(form.querySelector("[name=hours]").value);
      body.hoursMode = "direct";
    }
  }
  withButtonBusy(btn, "保存中…", function () {
    return run("adminUpdateSubmission", getToken(), ui.editing.id, body).then(function () {
      toast("已保存", "ok");
      ui.editing = null;
      render();
      return loadAll();
    });
  }).then(function () {
    renderIfIdle();
  }).catch(function (err) { toast(err.message, "err"); });
}

function renameEmp(id) {
  var emp = findEmp(id);
  if (!emp) return;
  promptDialog({
    title: "修改「" + emp.name + "」的姓名",
    sub: "只改显示名，历史记录按员工编号关联，不受影响。",
    icon: "pencil",
    input: {
      label: "新的姓名", value: emp.name,
      validate: function (v) {
        if (!v) return "请填写姓名";
        if (v !== emp.name && nameTaken(v, id)) return "已有同名员工（含已停用），请换一个";
        return "";
      }
    },
    confirmText: "保存",
    busyText: "保存中…",
    onConfirm: function (name) {
      if (name === emp.name) return Promise.resolve();
      return run("adminUpdateEmployee", getToken(), id, { name: name });
    }
  }).then(function (name) {
    if (!name || name === emp.name) return;
    toast("已改名为 " + name, "ok");
    emp.name = name;
    render();
    return loadAll().then(renderIfIdle);
  }).catch(function (err) { toast(err.message, "err"); });
}

function deactivateEmp(id, b) {
  var emp = findEmp(id);
  if (!emp) return;
  confirmDialog({
    title: "停用员工「" + emp.name + "」？",
    icon: "user-x",
    tone: "danger",
    body: "<p>停用后不再出现在员工提交页和新月份结算中；以前的工资、申请和付款记录全部保留，可随时恢复。</p>",
    confirmText: "确认停用",
    confirmIcon: "user-x",
    busyText: "停用中…",
    onConfirm: function () { return run("adminDeactivateEmployee", getToken(), id); }
  }).then(function (ok) {
    if (!ok) return;
    toast("已停用 " + emp.name, "ok");
    emp.active = false;
    emp.deactivatedAt = localISO().slice(0, 16);
    render();
    return loadAll().then(renderIfIdle);
  }).catch(function (err) { toast(err.message, "err"); });
}

function reactivateEmp(id, b) {
  var emp = findEmp(id);
  if (!emp) return;
  withButtonBusy(b, "恢复中…", function () {
    return run("adminReactivateEmployee", getToken(), id).then(function () {
      toast("已恢复 " + emp.name, "ok");
      emp.active = true;
      emp.deactivatedAt = "";
      render();
      return loadAll();
    });
  }).then(function () { renderIfIdle(); }).catch(function (err) { toast(err.message, "err"); });
}

function onAddEmp(e) {
  e.preventDefault();
  var form = e.target;
  var name = String(form.querySelector("[name=name]").value || "").trim();
  var baseText = String(form.querySelector("[name=base]").value || "").trim();
  var base = parseMoneyInput(baseText);
  ui.addEmp.name = name;
  ui.addEmp.base = baseText;
  ui.addEmp.error = !name ? "请填写姓名" : nameTaken(name) ? "不可与在职或已停用员工重名" : "";
  ui.addEmp.baseError = !baseText ? "请填写月基本工资（可填 0）" : isNaN(base) || base < 0 ? "请输入有效金额，例如 2000" : "";
  if (ui.addEmp.error || ui.addEmp.baseError) {
    render();
    var bad = document.querySelector("#add-emp-form .invalid");
    if (bad) bad.focus();
    return;
  }
  var btn = form.querySelector('button[type="submit"]');
  withButtonBusy(btn, "添加中…", function () {
    return run("adminAddEmployee", getToken(), { name: name, defaultBase: round2(base), month: ui.month }).then(function () {
      toast("已添加 " + name, "ok");
      ui.addEmp = { name: "", base: "", error: "", baseError: "" };
      return loadAll();
    });
  }).then(render).catch(function (err) { toast(err.message, "err"); });
}

function copyPrev(btn) {
  withButtonBusy(btn, "复制中…", function () {
    return run("adminCopyPreviousBases", getToken(), ui.month).then(function (r) {
      toast(r.sourceMonth ? "已从 " + r.sourceMonth + " 复制基本工资" : "没有可复制的上月数据，已使用默认基本工资", r.sourceMonth ? "ok" : "err");
      return loadAll();
    });
  }).then(render).catch(function (err) { toast(err.message, "err"); });
}

function importCsv(btn) {
  var text = (document.getElementById("csv-paste").value || "").trim();
  if (!text) { toast("请先粘贴 CSV", "err"); return; }
  withButtonBusy(btn, "导入中…", function () {
    return run("adminImportCsvBases", getToken(), ui.month, text).then(function (r) {
      toast("已更新 " + r.updated + " 人，新增 " + r.added + " 人", "ok");
      ui.csvDraft = "";
      return loadAll();
    });
  }).then(render).catch(function (err) { toast(err.message, "err"); });
}

function exportJson(btn) {
  withButtonBusy(btn, "导出中…", function () {
    return run("adminExportBackup", getToken()).then(function (data) {
      downloadText("FEST7-payroll-backup.json", JSON.stringify(data, null, 2), "application/json;charset=utf-8");
      toast("已导出 JSON", "ok");
    });
  }).catch(function (err) { toast(err.message, "err"); });
}

function importJsonFile(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function () {
    var parsed;
    try {
      parsed = JSON.parse(String(reader.result || ""));
    } catch (err) {
      toast("文件不是有效的 JSON：" + (err.message || ""), "err");
      return;
    }
    confirmDialog({
      title: "导入并覆盖全部业务数据？",
      icon: "triangle-alert",
      tone: "danger",
      body: "<p>将用「" + esc(file.name) + "」覆盖当前全部业务数据（员工、基本工资、银行卡、申请、锁定快照），不含后台密码。</p><p>建议先导出一份当前备份。</p>",
      confirmText: "覆盖导入",
      busyText: "导入中…",
      onConfirm: function () { return run("adminImportBackup", getToken(), parsed); }
    }).then(function (ok) {
      if (!ok) return;
      toast("导入成功", "ok");
      return loadAll().then(render);
    }).catch(function (err) { toast(err.message, "err"); });
  };
  reader.readAsText(file, "utf-8");
  input.value = "";
}

function onChangePassword(e) {
  e.preventDefault();
  var form = e.target;
  var oldPw = form.querySelector("[name=old]").value;
  var nw = form.querySelector("[name=nw]").value;
  var nw2 = form.querySelector("[name=nw2]").value;
  var errEl = document.getElementById("pw-err");
  var msg = !oldPw || !nw ? "请填写当前密码与新密码" : nw !== nw2 ? "两次输入的新密码不一致" : "";
  if (errEl) { errEl.hidden = !msg; errEl.innerHTML = msg ? I("circle-alert", "i-xs") + esc(msg) : ""; }
  if (msg) return;
  var btn = form.querySelector('button[type="submit"]');
  withButtonBusy(btn, "保存中…", function () {
    return run("adminChangePassword", getToken(), oldPw, nw)
      .then(function () { toast("密码已更新", "ok"); form.reset(); });
  }).catch(function (err) { toast(err.message, "err"); });
}

function resetSession() {
  setToken("");
  clearBootstrapCache();
  ui.authed = false;
  ui.slip = null;
  ui.settlement = null;
  ui.submissions = [];
  ui.employees = [];
  ui.navOpen = false;
  render();
}

function logout(btn) {
  flushOps().then(function () {
    return withButtonBusy(btn, "退出中…", function () { return run("adminLogout", getToken()); });
  }).then(resetSession, resetSession);
}

function onLogin(e) {
  e.preventDefault();
  var form = e.target;
  var btn = form.querySelector('button[type="submit"]');
  var password = form.querySelector("[name=password]").value;
  if (!password) {
    ui.loginError = "请输入密码";
    render();
    return;
  }
  ui.loginError = "";
  withButtonBusy(btn, "登录中…", function () {
    return run("adminLogin", password).then(function (res) {
      setToken(res.token);
      ui.authed = true;
      ui.refreshing = true;
      var cached = readBootstrapCache(ui.month);
      if (cached) applyBootstrap(cached);
      render();
      return loadAll();
    });
  }).then(function () {
    ui.refreshing = false;
    render();
  }).catch(function (err) {
    if (ui.authed && getToken()) {
      ui.refreshing = false;
      ui.syncError = true;
      toast(err.message || "数据加载失败", "err");
      render();
      return;
    }
    ui.loginError = err.message;
    ui.authed = false;
    toast(err.message, "err");
    render();
  });
}

function bindGlobal() {
  var app = document.getElementById("app");
  app.addEventListener("click", onAppClick);
  app.addEventListener("change", onAppChange);
  app.addEventListener("input", onAppInput);
  app.addEventListener("focusin", onAppFocusIn);
  app.addEventListener("focusout", onAppFocusOut);
  app.addEventListener("submit", onAppSubmit);
  document.addEventListener("keydown", onDocKey);
  // 撤销窗口内的操作：页面关闭或切到后台时立即发送，不丢失
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") flushOps(true);
    else if (flushOps.sentInBackground) { flushOps.sentInBackground = false; reloadSoon(1200); }
  });
  window.addEventListener("pagehide", function () { flushOps(true); });
}

function boot() {
  warmupApi();
  var token = getToken();
  if (!token) {
    ui.authed = false;
    render();
    return;
  }
  var cached = readBootstrapCache(ui.month);
  if (cached) {
    ui.authed = true;
    applyBootstrap(cached);
    ui.refreshing = true;
    render();
  } else {
    showLoading("app", "正在加载…");
  }
  run("adminMe", token).then(function (me) {
    ui.authed = !!me.authenticated;
    if (!ui.authed) {
      setToken("");
      ui.refreshing = false;
      render();
      return;
    }
    ui.refreshing = true;
    setRefreshing(true);
    updateSyncChip();
    return loadAll();
  }).then(function () {
    if (!ui.authed) return;
    ui.refreshing = false;
    render();
  }).catch(function (err) {
    ui.refreshing = false;
    ui.syncError = true;
    setRefreshing(false);
    if (ui.settlement || ui.employees.length) {
      toast(err.message || "刷新失败，先显示本地缓存", "err");
      render();
    } else {
      showLoadError("app", err.message || "无法连接服务器", boot);
    }
  });
}
bindGlobal();
boot();
