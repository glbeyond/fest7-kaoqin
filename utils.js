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

function formatMoney(n) {
  var v = Number(n);
  if (!isFinite(v)) return "€0.00";
  var sign = v < 0 ? "−" : "";
  return sign + "€" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatHours(h) {
  var v = Number(h) || 0;
  return String(Math.round((v + Number.EPSILON) * 100) / 100);
}

function round2(n) {
  var v = Number(n);
  if (!isFinite(v)) v = 0;
  return Math.round((v + Number.EPSILON) * 100) / 100;
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

function toast(msg, kind) {
  var wrap = document.getElementById("toasts");
  if (!wrap) return;
  var el = document.createElement("div");
  el.className = "toast " + (kind || "");
  el.setAttribute("role", kind === "err" ? "alert" : "status");
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(function () {
    el.classList.add("toast-out");
    setTimeout(function () { if (el.parentNode) el.remove(); }, 280);
  }, 2500);
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
  el.innerHTML = '<div class="card card-pad"><p class="muted" style="margin:0">' + esc(message || "正在加载…") + "</p></div>";
}

function showLoadError(container, message, onRetry) {
  var el = typeof container === "string" ? document.getElementById(container) : container;
  el.innerHTML =
    '<div class="card card-pad load-error">' +
    '<p class="neg" style="margin:0 0 12px">' + esc(message) + "</p>" +
    '<button type="button" class="btn btn-primary" id="retry-btn">重试</button></div>';
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

function setFieldSaveState(key, state, text) {
  if (!setFieldSaveState.map) setFieldSaveState.map = {};
  if (!state) delete setFieldSaveState.map[key];
  else setFieldSaveState.map[key] = { state: state, text: text || "" };
  var nodes = document.querySelectorAll('[data-save-key="' + key.replace(/"/g, "") + '"]');
  Array.prototype.forEach.call(nodes, function (el) {
    applySaveStateEl(el, setFieldSaveState.map[key]);
  });
}

function saveStateHtml(key) {
  var info = setFieldSaveState.map && setFieldSaveState.map[key];
  var cls = "save-state" + (info && info.state ? " save-state-" + info.state : "");
  var text = info && info.text ? esc(info.text) : "";
  return '<span class="' + cls + '" data-save-key="' + esc(key) + '">' + text + "</span>";
}

function applySaveStateEl(el, info) {
  el.className = "save-state" + (info && info.state ? " save-state-" + info.state : "");
  el.textContent = (info && info.text) || "";
}

var TYPE_LABEL = { leave: "请假", overtime: "加班", custom: "自定义" };
var STATUS_LABEL = { pending: "待审批", approved: "已通过", rejected: "已驳回" };
