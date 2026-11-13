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
  var el = document.createElement("div");
  el.className = "toast " + (kind || "");
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(function () { el.remove(); }, 2800);
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

var TYPE_LABEL = { leave: "请假", overtime: "加班", custom: "自定义" };
var STATUS_LABEL = { pending: "待审批", approved: "已通过", rejected: "已驳回" };
