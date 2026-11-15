/* FEST7 月结助手 · 通用工具（员工端与后台共用）。依赖 icons.js 提供的 I()。 */
function esc(s) {
  var lt = String.fromCharCode(60);
  var gt = String.fromCharCode(62);
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(new RegExp(lt, "g"), "&lt;")
    .replace(new RegExp(gt, "g"), "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

var MINUS = "\u2212"; // 真正的减号 “−”，与连字符区分

function round2(n) {
  var v = Number(n);
  if (!isFinite(v)) v = 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** 1234.5 → "1,234.50"（无符号、无货币） */
function formatNum2(n) {
  var v = Math.abs(Number(n) || 0);
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 金额文本：€1,234.56；负数一律 “−€57.14”（减号在 € 前）；opts.sign=true 时正数带 “+”。
 * 只负责展示，不参与计算。
 */
function formatMoney(n, opts) {
  var v = Number(n);
  if (!isFinite(v)) v = 0;
  v = round2(v);
  var sign = v < 0 ? MINUS : (opts && opts.sign && v > 0 ? "+" : "");
  return sign + "€" + formatNum2(v);
}

/** 金额 HTML：带颜色语义与弱化的 € 符号。opts: sign / zeroDash / cls / mask / plain */
function moneyHtml(n, opts) {
  opts = opts || {};
  var v = round2(Number(n) || 0);
  if (opts.mask) return '<span class="amt masked ' + (opts.cls || "") + '">€ ••••</span>';
  if (opts.zeroDash && Math.abs(v) < 0.005) return '<span class="zero">—</span>';
  var pre = "";
  var c = "";
  if (v < 0) { pre = MINUS; c = opts.plain ? "" : "neg"; }
  else if (opts.sign && v > 0) { pre = "+"; c = opts.plain ? "" : "pos"; }
  return '<span class="amt ' + c + " " + (opts.cls || "") + '">' + pre + '<span class="cur">€</span>' + formatNum2(v) + "</span>";
}

function formatHours(h) {
  var v = Number(h) || 0;
  return String(Math.round((v + Number.EPSILON) * 100) / 100);
}

function hoursHtml(h, unit) {
  var v = Number(h) || 0;
  if (Math.abs(v) < 0.005) return '<span class="zero">—</span>';
  return '<span class="num">' + formatHours(v) + "</span>" + (unit ? '<span class="u">' + esc(unit) + "</span>" : "");
}

/** 解析用户输入的金额："1,500.00" / "1500" / "1.500,50" / "€ 1500" → 数字；空 → 0；非法 → NaN */
function parseMoneyInput(str) {
  var s = String(str == null ? "" : str).replace(/[€\s\u00A0]/g, "").replace(/\u2212/g, "-");
  if (!s) return 0;
  var hasComma = s.indexOf(",") !== -1;
  var hasDot = s.indexOf(".") !== -1;
  if (hasComma && hasDot) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasComma) {
    var parts = s.split(",");
    if (parts.length === 2 && parts[1].length !== 3) s = parts[0] + "." + parts[1];
    else s = s.replace(/,/g, "");
  }
  if (!/^-?\d*(\.\d*)?$/.test(s)) return NaN;
  var v = Number(s);
  return isFinite(v) ? v : NaN;
}

/** 本地时间 "YYYY-MM-DDTHH:MM:SS"（与后端记录的本地时间格式一致；不要用 toISOString，它是 UTC） */
function localISO() {
  var d = new Date();
  var p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}

function todayISO() {
  var d = new Date();
  var p = function (n) { return String(n).padStart(2, "0"); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

function currentMonth() {
  return todayISO().slice(0, 7);
}

function formatMonthCN(ym) {
  var parts = String(ym || "").split("-");
  return parts[0] + "年" + Number(parts[1]) + "月";
}

function shiftMonth(ym, delta) {
  var parts = String(ym || currentMonth()).split("-");
  var y = Number(parts[0]);
  var m = Number(parts[1]) - 1 + delta;
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  return y + "-" + String(m + 1).padStart(2, "0");
}

var WEEK_CN = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function weekdayCN(dateStr) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ""));
  if (!m) return "";
  return WEEK_CN[new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay()];
}

/** "2026-11-14T18:32:10" → "11-14 18:32"（withYear → "2026-11-14 18:32"） */
function formatStamp(iso, withYear) {
  var s = String(iso || "").replace("T", " ");
  if (!s) return "";
  return withYear ? s.slice(0, 16) : s.slice(5, 16);
}

function initials(name) {
  var s = String(name || "").trim();
  if (!s) return "?";
  if (/^[\x00-\x7F]+$/.test(s)) return s.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || s.slice(0, 2);
  return s.slice(-1);
}

function avatarHtml(name, cls) {
  return '<span class="avatar' + (cls ? " " + cls : "") + '" aria-hidden="true">' + esc(initials(name)) + "</span>";
}

var TYPE_LABEL = { leave: "请假", overtime: "加班", custom: "自定义" };
var STATUS_LABEL = { pending: "待审批", approved: "已通过", rejected: "已驳回" };
var TYPE_ICON = { leave: "calendar-minus", overtime: "clock-arrow-up", custom: "receipt-euro" };
var STATUS_ICON = { pending: "hourglass", approved: "circle-check", rejected: "circle-x" };
var MODE_LABEL = { range: "按时间段", direct: "直接填写小时", "multi-day": "日期区间（全天）" };

function typeHtml(type, withLabel) {
  return '<span class="type ' + esc(type) + '"><span class="ti">' + I(TYPE_ICON[type] || "file-text") + "</span>" +
    (withLabel === false ? "" : esc(TYPE_LABEL[type] || type)) + "</span>";
}

function statusTag(status) {
  return '<span class="tag tag-' + esc(status) + '">' + I(STATUS_ICON[status] || "circle-dot") + esc(STATUS_LABEL[status] || status) + "</span>";
}

/* ---------------- Toast（支持「撤销」动作） ---------------- */
function toast(msg, kind, opts) {
  opts = opts || {};
  var wrap = document.getElementById("toasts");
  if (!wrap) return { close: function () {} };
  var el = document.createElement("div");
  var k = kind === "err" ? "err" : kind === "info" ? "info" : "ok";
  el.className = "toast " + k;
  el.setAttribute("role", k === "err" ? "alert" : "status");
  var icon = k === "err" ? "x" : k === "info" ? "info" : "check";
  var duration = opts.duration || (opts.action ? 5000 : k === "err" ? 4000 : 2500);
  el.innerHTML = '<span class="t-ic">' + I(icon) + '</span><span class="t-msg"></span>' +
    (opts.action ? '<button type="button" class="t-act">' + I("undo-2", "i-xs") + esc(opts.action.label || "撤销") + "</button>" +
      '<span class="t-bar" style="animation-duration:' + duration + 'ms"></span>' : "");
  el.querySelector(".t-msg").textContent = msg;
  wrap.appendChild(el);
  var closed = false;
  var timer = null;
  function close() {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    el.classList.add("toast-out");
    setTimeout(function () { if (el.parentNode) el.remove(); }, 260);
  }
  if (opts.action) {
    el.querySelector(".t-act").addEventListener("click", function () {
      close();
      if (opts.action.onClick) opts.action.onClick();
    });
  }
  timer = setTimeout(close, duration);
  return { close: close, el: el };
}

function downloadText(filename, text, mime) {
  var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function showLoading(container, message) {
  var el = typeof container === "string" ? document.getElementById(container) : container;
  el.innerHTML = '<div class="emp-load"><div class="card loading-card"><span class="btn-spinner"></span>' + esc(message || "正在加载…") + "</div></div>";
}

function showLoadError(container, message, onRetry) {
  var el = typeof container === "string" ? document.getElementById(container) : container;
  el.innerHTML =
    '<div class="emp-load"><div class="card load-error"><div class="empty" style="padding:8px 0 4px"><div class="e-ic">' + I("circle-alert") + "</div></div>" +
    "<p>" + esc(message) + "</p>" +
    '<button type="button" class="btn btn-primary" id="retry-btn">' + I("refresh-cw", "i-sm") + "重试</button></div></div>";
  var btn = document.getElementById("retry-btn");
  if (btn && onRetry) {
    btn.addEventListener("click", function () {
      showLoading(el);
      onRetry();
    });
  }
}

function setRefreshing(on) {
  document.body.classList.toggle("is-refreshing", !!on);
}

function isFormFieldFocused() {
  var ae = document.activeElement;
  if (!ae) return false;
  var tag = (ae.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

/* ---------------- 按钮忙碌态 ---------------- */
function setButtonBusy(btn, busyText) {
  if (!btn || btn._busy) return btn;
  btn._busy = true;
  btn._busyOrigHtml = btn.innerHTML;
  btn._busyOrigDisabled = btn.disabled;
  btn.disabled = true;
  btn.classList.add("is-busy");
  btn.setAttribute("aria-busy", "true");
  btn.innerHTML = '<span class="btn-spinner" aria-hidden="true"></span><span>' + esc(busyText || "处理中…") + "</span>";
  return btn;
}

function clearButtonBusy(btn) {
  if (!btn || !btn._busy) return btn;
  btn._busy = false;
  btn.disabled = !!btn._busyOrigDisabled;
  btn.classList.remove("is-busy");
  btn.removeAttribute("aria-busy");
  if (btn._busyOrigHtml != null) btn.innerHTML = btn._busyOrigHtml;
  return btn;
}

function withButtonBusy(btn, busyText, work) {
  setButtonBusy(btn, busyText);
  return Promise.resolve()
    .then(work)
    .then(function (value) {
      clearButtonBusy(btn);
      return value;
    }, function (err) {
      clearButtonBusy(btn);
      throw err;
    });
}

/* ---------------- 字段保存状态（失焦即保存） ---------------- */
function setFieldSaveState(key, state, text) {
  if (!setFieldSaveState.map) setFieldSaveState.map = {};
  if (!state) delete setFieldSaveState.map[key];
  else setFieldSaveState.map[key] = { state: state, text: text || "" };
  var nodes = document.querySelectorAll('[data-save-key="' + key.replace(/"/g, "") + '"]');
  Array.prototype.forEach.call(nodes, function (el) {
    applySaveStateEl(el, setFieldSaveState.map[key]);
  });
}

function saveStateHtml(key, idleIcon) {
  var info = setFieldSaveState.map && setFieldSaveState.map[key];
  var cls = "save-state" + (info && info.state ? " save-state-" + info.state : "");
  var label = info && info.text ? esc(info.text) : "";
  return '<span class="' + cls + '" data-save-key="' + esc(key) + '" role="status" aria-label="' + label + '" title="' + label + '">' + (idleIcon || "") + "</span>";
}

function applySaveStateEl(el, info) {
  el.className = "save-state" + (info && info.state ? " save-state-" + info.state : "");
  var t = (info && info.text) || "";
  el.setAttribute("aria-label", t);
  el.setAttribute("title", t);
}

/* ---------------- 弹窗（替代原生 confirm / prompt） ---------------- */
var dialogDepth = 0;
function isDialogOpen() { return dialogDepth > 0; }

/**
 * openDialog({ title, sub, icon, tone:'primary'|'danger'|'ink'|'warn', body(html), confirmText, cancelText,
 *              input:{ label, value, placeholder, type, hint, match, validate(v)->错误文本 },
 *              onConfirm(value)->Promise（可选；失败时弹窗保持打开并显示错误） })
 * 返回 Promise：确认 → 输入值（无输入框时为 true）；取消 → null
 */
function openDialog(o) {
  o = o || {};
  return new Promise(function (resolve) {
    var prevFocus = document.activeElement;
    var root = document.createElement("div");
    root.className = "overlay dlg";
    var tone = o.tone || "primary";
    var btnCls = tone === "danger" ? "btn-danger-solid" : tone === "ink" ? "btn-ink" : "btn-primary";
    var icCls = tone === "danger" ? "danger" : tone === "ink" ? "ink" : tone === "warn" ? "warn" : "";
    var inp = o.input;
    var titleId = "dlg-t-" + Date.now();
    root.innerHTML =
      '<div class="modal sm" role="' + (tone === "danger" ? "alertdialog" : "dialog") + '" aria-modal="true" aria-labelledby="' + titleId + '">' +
      '<div class="modal-h">' + (o.icon ? '<span class="m-ic ' + icCls + '">' + I(o.icon) + "</span>" : "") +
      '<div style="min-width:0"><h3 id="' + titleId + '">' + esc(o.title || "请确认") + "</h3>" + (o.sub ? '<div class="m-sub">' + o.sub + "</div>" : "") + "</div>" +
      '<button type="button" class="btn btn-ghost btn-sm btn-icon modal-x" data-dlg="cancel" aria-label="关闭">' + I("x", "i-sm") + "</button></div>" +
      ((o.body || inp) ? '<div class="modal-b">' + (o.body || "") +
        (inp ? '<label class="field"><span class="label">' + esc(inp.label || "") + "</span>" +
          '<input class="input" data-dlg="input" type="' + esc(inp.type || "text") + '" value="' + esc(inp.value || "") + '" placeholder="' + esc(inp.placeholder || "") + '" autocomplete="off"' + (inp.inputmode ? ' inputmode="' + esc(inp.inputmode) + '"' : "") + ">" +
          (inp.hint ? '<span class="hint">' + inp.hint + "</span>" : "") + '<span class="err" data-dlg="err" hidden></span></label>' : '<span class="err" data-dlg="err" hidden></span>') +
        "</div>" : '<div class="modal-b" style="padding-top:8px;padding-bottom:8px"><span class="err" data-dlg="err" hidden></span></div>') +
      '<div class="modal-f"><button type="button" class="btn btn-secondary" data-dlg="cancel">' + esc(o.cancelText || "取消") + "</button>" +
      '<button type="button" class="btn ' + btnCls + '" data-dlg="ok">' + (o.confirmIcon ? I(o.confirmIcon, "i-sm") : "") + esc(o.confirmText || "确定") + "</button></div></div>";
    document.body.appendChild(root);
    dialogDepth++;
    var input = root.querySelector('[data-dlg="input"]');
    var okBtn = root.querySelector('[data-dlg="ok"]');
    var errEl = root.querySelector('[data-dlg="err"]');
    var done = false;
    function showErr(t) {
      if (!errEl) return;
      errEl.hidden = !t;
      errEl.innerHTML = t ? I("circle-alert", "i-xs") + esc(t) : "";
      if (input) input.classList.toggle("invalid", !!t);
    }
    function syncMatch() {
      if (inp && inp.match != null) okBtn.disabled = String(input.value).trim() !== String(inp.match);
    }
    function finish(val) {
      if (done) return;
      done = true;
      dialogDepth = Math.max(0, dialogDepth - 1);
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus(); } catch (e) { /* ignore */ }
      resolve(val);
    }
    function confirmNow() {
      if (okBtn.disabled) return;
      var val = input ? String(input.value).trim() : true;
      if (inp && inp.validate) {
        var msg = inp.validate(val);
        if (msg) { showErr(msg); input.focus(); return; }
      }
      if (o.onConfirm) {
        showErr("");
        withButtonBusy(okBtn, o.busyText || "处理中…", function () { return o.onConfirm(val); })
          .then(function () { finish(val); })
          .catch(function (err) { showErr((err && err.message) || "操作失败"); syncMatch(); });
        return;
      }
      finish(val);
    }
    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); if (!okBtn._busy) finish(null); }
      else if (e.key === "Enter" && input && document.activeElement === input) { e.preventDefault(); confirmNow(); }
      else if (e.key === "Tab") {
        var f = root.querySelectorAll("button:not([disabled]),input,select,textarea");
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    document.addEventListener("keydown", onKey, true);
    Array.prototype.forEach.call(root.querySelectorAll('[data-dlg="cancel"]'), function (b) {
      b.addEventListener("click", function () { if (!okBtn._busy) finish(null); });
    });
    root.addEventListener("mousedown", function (e) { if (e.target === root && !okBtn._busy) finish(null); });
    okBtn.addEventListener("click", confirmNow);
    if (input) {
      input.addEventListener("input", function () { showErr(""); syncMatch(); });
      syncMatch();
      setTimeout(function () { input.focus(); if (input.select) input.select(); }, 30);
    } else {
      setTimeout(function () { (tone === "danger" ? root.querySelector('.modal-f [data-dlg="cancel"]') : okBtn).focus(); }, 30);
    }
  });
}

function confirmDialog(o) { return openDialog(o).then(function (v) { return v !== null; }); }
function promptDialog(o) { return openDialog(o); }
