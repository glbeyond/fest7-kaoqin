var TOKEN_KEY = "fest7_admin_token";
var BOOT_CACHE_KEY = "fest7_admin_bootstrap";

function getToken() { return sessionStorage.getItem(TOKEN_KEY) || ""; }
function setToken(t) {
  if (t) sessionStorage.setItem(TOKEN_KEY, t);
  else sessionStorage.removeItem(TOKEN_KEY);
}

var ui = {
  authed: false,
  tab: "settle",
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
  slip: null
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
}

function monthOf(dateStr) { return String(dateStr || "").slice(0, 7); }

function isMonthLocked(ym) {
  if (ym === ui.month && ui.settlement && ui.settlement.locked) return true;
  return (ui.lockedMonths || []).indexOf(ym) !== -1;
}

function empDisplayName(s) { return s.displayName || s.employeeName || ""; }

function loadAll() {
  return run("adminBootstrap", getToken(), ui.month).then(function (data) {
    applyBootstrap(data);
    writeBootstrapCache(ui.month, data);
    return data;
  });
}

function refreshInBackground() {
  ui.refreshing = true;
  setRefreshing(true);
  var ind = document.getElementById("admin-sync-ind");
  if (ind) ind.hidden = false;
  return loadAll().then(function () {
    ui.refreshing = false;
    setRefreshing(false);
    renderIfIdle();
  }).catch(function (err) {
    ui.refreshing = false;
    setRefreshing(false);
    setRefreshing(false);
    var expired = /登录已过期|请先登录/.test(err && err.message || "");
    if (expired) {
      setToken("");
      clearBootstrapCache();
      ui.authed = false;
      toast(err.message, "err");
      render();
      return;
    }
    toast(err.message, "err");
    renderIfIdle();
  });
}

function renderIfIdle() {
  if (isFormFieldFocused() || ui.editing) {
    ui.pendingRender = true;
    setRefreshing(ui.refreshing);
    var ind = document.getElementById("admin-sync-ind");
    if (ind) ind.hidden = !ui.refreshing;
    return;
  }
  ui.pendingRender = false;
  render();
}

function pendingCount() {
  return ui.submissions.filter(function (s) { return s.status === "pending"; }).length;
}

function syncIndicatorHtml() {
  return '<span class="sync-indicator" id="admin-sync-ind"' + (ui.refreshing ? "" : " hidden") + '><span class="sync-dot"></span>更新中…</span>';
}

function render() {
  setRefreshing(!!ui.refreshing);
  var app = document.getElementById("app");
  if (!ui.authed) {
    app.innerHTML =
      '<div class="login-wrap"><form class="card card-pad login-card stack" id="login-form">' +
      "<h2>管理后台登录</h2>" +
      '<p class="muted" style="margin:0">初始密码为 <code>admin</code>，登录后可修改。会话保存在服务器缓存中（约 6 小时），使用页面内令牌校验。</p>' +
      '<label class="field">密码<input name="password" type="password" autocomplete="current-password" required></label>' +
      (ui.loginError ? '<p class="neg" style="margin:0">' + esc(ui.loginError) + "</p>" : "") +
      '<button type="submit" class="btn btn-navy btn-block">进入后台</button></form></div>' +
      '<footer class="note">FEST7 月结助手</footer>';
    document.getElementById("login-form").addEventListener("submit", onLogin);
    return;
  }
  if (ui.slip) {
    app.innerHTML = renderSlips();
    bindSlips();
    return;
  }
  var pending = pendingCount();
  var tabs = [["settle", "月度结算"], ["approve", "审批"], ["employees", "员工与基本工资"], ["data", "数据备份"]].map(function (t) {
    var badge = t[0] === "approve" && pending ? ' <span class="badge badge-count">' + pending + "</span>" : "";
    return '<button type="button" data-tab="' + t[0] + '" class="' + (ui.tab === t[0] ? "active" : "") + '">' + t[1] + badge + "</button>";
  }).join("");
  var body = ui.tab === "settle" ? renderSettle()
    : ui.tab === "approve" ? renderApprove()
    : ui.tab === "employees" ? renderEmployees()
    : renderData();
  app.innerHTML =
    '<div class="page-intro"><h2>管理后台' + syncIndicatorHtml() + "</h2><p>审批员工申请，维护每月基本工资，并完成银行卡与现金的月度结算。</p></div>" +
    '<div class="tabs" id="admin-tabs">' + tabs + "</div>" + body +
    '<footer class="note">FEST7 月结助手 · 数据保存在本 Google 表格中。</footer>';
  bindAdmin();
}

function kpi(lbl, val, sub) {
  return '<div class="card kpi"><div class="lbl">' + esc(lbl) + '</div><div class="val num">' + val + '</div><div class="sub">' + esc(sub) + "</div></div>";
}

function renderSettle() {
  var S = ui.settlement;
  if (!S) return '<div class="card empty">' + (ui.refreshing ? "正在加载结算…" : "正在加载结算…") + "</div>";
  var kpis = '<div class="kpis">' +
    kpi("工作日", S.workdays + " 天", "周一至周五，假日仍计工作日") +
    kpi("标准工时", S.capacity + " 小时", "每天 8.5 小时") +
    kpi("应发合计", formatMoney(S.totals.gross), "基本工资 ± 各项调整") +
    kpi("银行卡（打卡）", formatMoney(S.totals.bank), "需手动逐人填写") +
    kpi("现金应付", formatMoney(S.totals.cash), "应发合计 − 银行卡") +
    "</div>";
  var locked = !!S.locked;
  var rows = S.rows.map(function (r) {
    var active = ui.selectedEmpId === r.emp.id ? " active" : "";
    var note = r.emp.note ? '<span class="note-dot" title="' + esc(r.emp.note) + '">*</span>' : "";
    if (r.emp.active === false && !locked) note += ' <span class="badge badge-rejected">已停用</span>';
    if (locked && r.emp.currentName && r.emp.currentName !== r.emp.name) note += ' <span class="tiny">（现名 ' + esc(r.emp.currentName) + "）</span>";
    var bankKey = "bank:" + r.emp.id;
    var bankCell = locked
      ? '<td class="num">' + formatMoney(r.bank) + "</td>"
      : '<td class="num" onclick="event.stopPropagation()"><div class="input-with-state"><input class="bank" data-bank="' + esc(r.emp.id) + '" type="number" step="0.01" value="' + (r.bank ? String(r.bank) : "") + '" placeholder="0.00">' + saveStateHtml(bankKey) + "</div></td>";
    return "<tr class=\"" + active + "\" data-emp=\"" + esc(r.emp.id) + "\">" +
      '<td class="name-cell">' + esc(r.emp.name) + note + "</td>" +
      '<td class="num">' + formatMoney(r.base) + "</td>" +
      '<td class="num">' + formatMoney(r.rateRounded) + "</td>" +
      '<td class="num">' + (r.leaveHours ? formatHours(r.leaveHours) : "—") + "</td>" +
      '<td class="num' + (r.leavePay ? " neg" : "") + '">' + (r.leavePay ? "−" + formatMoney(r.leavePay).slice(1) : "—") + "</td>" +
      '<td class="num">' + (r.otHours ? formatHours(r.otHours) : "—") + "</td>" +
      '<td class="num' + (r.otPay ? " pos" : "") + '">' + (r.otPay ? formatMoney(r.otPay) : "—") + "</td>" +
      '<td class="num' + (r.customSum < 0 ? " neg" : r.customSum > 0 ? " pos" : "") + '">' + (r.customSum ? formatMoney(r.customSum) : "—") + "</td>" +
      '<td class="num"><strong>' + formatMoney(r.gross) + "</strong></td>" +
      bankCell +
      '<td class="num' + (r.cash < 0 ? " neg" : "") + '">' + formatMoney(r.cash) + "</td></tr>";
  }).join("");
  var t = S.totals;
  var foot = "<tr><td>公司总计</td>" +
    '<td class="num">' + formatMoney(t.base) + "</td><td></td>" +
    '<td class="num">' + (t.leaveHours ? formatHours(t.leaveHours) : "—") + "</td>" +
    '<td class="num">' + (t.leavePay ? "−" + formatMoney(t.leavePay).slice(1) : "—") + "</td>" +
    '<td class="num">' + (t.otHours ? formatHours(t.otHours) : "—") + "</td>" +
    '<td class="num">' + formatMoney(t.otPay) + "</td>" +
    '<td class="num">' + formatMoney(t.customSum) + "</td>" +
    '<td class="num">' + formatMoney(t.gross) + "</td>" +
    '<td class="num">' + formatMoney(t.bank) + "</td>" +
    '<td class="num">' + formatMoney(t.cash) + "</td></tr>";
  var unmatched = S.unmatched && S.unmatched.length
    ? '<p class="neg">有 ' + S.unmatched.length + " 条已通过申请无法匹配到员工名单，未计入上表。</p>" : "";
  var lockBanner = locked
    ? '<div class="banner"><span><strong>' + esc(formatMonthCN(ui.month)) + "已锁定结算</strong>（" + esc(String(S.lockedAt || "").replace("T", " ").slice(0, 16)) +
      "）。以下为锁定时保存的快照，审批、基本工资、银行卡和调整均不可修改。</span>" +
      '<button type="button" class="btn btn-danger btn-sm" id="unlock-month">解锁</button></div>'
    : "";
  var lockBtn = locked ? "" : '<button type="button" class="btn btn-navy" id="lock-month">锁定结算</button>';
  return '<div class="toolbar">' +
    '<label class="field" style="min-width:180px">结算月份<input id="month-input" type="month" value="' + esc(ui.month) + '"></label>' +
    '<div class="row"><button type="button" class="btn btn-ghost" id="export-csv">导出本月结算 CSV</button>' +
    '<button type="button" class="btn btn-ghost" id="print-all-slips">打印全部确认单</button>' + lockBtn + "</div></div>" +
    lockBanner + kpis + unmatched +
    '<div class="table-wrap"><table class="data" id="settle-table"><thead><tr>' +
    "<th>姓名</th><th class=\"num\">基本工资</th><th class=\"num\">小时费率</th><th class=\"num\">请假(h)</th><th class=\"num\">请假扣款</th><th class=\"num\">加班(h)</th><th class=\"num\">加班费</th><th class=\"num\">自定义</th><th class=\"num\">应发合计</th><th class=\"num\">银行卡</th><th class=\"num\">现金应付</th>" +
    "</tr></thead><tbody>" + rows + "</tbody><tfoot>" + foot + "</tfoot></table></div>" +
    '<div class="legend"><strong>计算说明</strong>（金额四舍五入到分）<br>' +
    "<code>小时费率</code> = 基本工资 ÷（工作日数 × 8.5）　显示为两位小数，扣款/加班费按未四舍五入的费率计算后再取整。<br>" +
    "<code>请假扣款</code> = 请假小时 × 小时费率　　<code>加班费</code> = 加班小时 × 小时费率 × 1.2（含周末及工作时段外）<br>" +
    "<code>应发合计</code> = 基本工资 − 请假扣款 + 加班费 + 自定义合计　　<code>现金应付</code> = 应发合计 − 银行卡金额<br>" +
    "标准工作时段 08:45–13:00、14:00–18:15；" + formatMonthCN(ui.month) + "共 " + S.workdays + " 个工作日（周一至周五，假日不扣除）。点击员工行可查看" + (locked ? "明细和结算确认单" : "并编辑已审批明细，或打开结算确认单") + "。带 * 的姓名表示有备注。<br>" +
    "<code>锁定结算</code> 会把本月每位员工的结果保存为快照；锁定后本月显示快照，不再随后续修改变化。如需更正，先解锁、修改，再重新锁定。</div>" +
    (ui.selectedEmpId ? renderDrawer(S) : "") +
    (ui.editing ? renderEditModal() : "");
}

function renderDrawer(S) {
  var r = null;
  S.rows.forEach(function (x) { if (x.emp.id === ui.selectedEmpId) r = x; });
  if (!r) return "";
  var locked = !!S.locked;
  var items = r.details.length ? r.details.map(function (d) {
    var time = d.hoursMode === "range" && d.startTime && d.endTime ? " · " + d.startTime + "–" + d.endTime : "";
    var hours = d.type !== "custom" ? " · " + formatHours(d.hours) + " 小时" : "";
    return "<li><div><strong>" + esc(TYPE_LABEL[d.type]) + "</strong>" +
      '<div class="tiny">' + esc(d.date) + time + hours + (d.note ? " · " + esc(d.note) : "") + "</div></div>" +
      "<div><div class=\"num " + (d.effect < 0 ? "neg" : d.effect > 0 ? "pos" : "") + '">' +
      (d.effect > 0 ? "+" : d.effect < 0 ? "−" : "") + formatMoney(Math.abs(d.effect)) + "</div>" +
      (locked ? "" : '<div class="actions-row" style="justify-content:flex-end;margin-top:4px">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(d.id) + '">编辑</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-del="' + esc(d.id) + '">删除</button></div>') + "</div></li>";
  }).join("") : '<p class="empty">本月暂无已通过的请假、加班或自定义项。</p>';
  return '<div class="drawer-bg" id="drawer-bg"><div class="drawer">' +
    '<div class="row" style="justify-content:space-between"><h3>' + esc(r.emp.name) + " · " + formatMonthCN(ui.month) + " 明细</h3>" +
    '<button type="button" class="btn btn-ghost btn-sm" id="close-drawer">关闭</button></div>' +
    (r.emp.note ? '<p class="muted" style="margin:8px 0 0">备注：' + esc(r.emp.note) + "</p>" : "") +
    '<p class="tiny" style="margin:10px 0 0">基本工资 ' + formatMoney(r.base) + " · 费率 " + formatMoney(r.rateRounded) + " / 小时（" + r.workdays + " 工作日 × 8.5）</p>" +
    '<ul class="breakdown">' + items + "</ul>" +
    '<div class="stack" style="gap:6px;font-size:14px">' +
    '<div class="row" style="justify-content:space-between"><span>应发合计</span><strong class="num">' + formatMoney(r.gross) + "</strong></div>" +
    '<div class="row" style="justify-content:space-between"><span>银行卡</span><span class="num">' + formatMoney(r.bank) + "</span></div>" +
    '<div class="row" style="justify-content:space-between"><span>现金应付</span><strong class="num">' + formatMoney(r.cash) + "</strong></div>" +
    "</div>" +
    '<div class="actions-row"><button type="button" class="btn btn-primary btn-sm" id="open-slip" data-slip="' + esc(r.emp.id) + '">结算确认单</button>' +
    (locked ? '<span class="tiny">本月已锁定，数据来自快照</span>' : "") + "</div>" +
    "</div></div>";
}

function renderApprove() {
  var list = ui.submissions.slice();
  if (!list.length) return '<div class="card empty">暂无申请。</div>' + (ui.editing ? renderEditModal() : "");
  var cards = list.map(function (s) {
    var monthLocked = isMonthLocked(monthOf(s.date));
    var actions = monthLocked
      ? '<div class="actions-row"><span class="tiny">' + esc(formatMonthCN(monthOf(s.date))) + "已锁定结算，不可修改</span></div>"
      : '<div class="actions-row">' +
      (s.status === "pending"
        ? '<button type="button" class="btn btn-forest btn-sm" data-approve="' + esc(s.id) + '">通过</button>' +
          '<button type="button" class="btn btn-danger btn-sm" data-reject="' + esc(s.id) + '">驳回</button>'
        : '<span class="tiny">审批于 ' + esc((s.reviewedAt || "").replace("T", " ").slice(0, 16)) + "</span>") +
      '<button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(s.id) + '">编辑</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-del="' + esc(s.id) + '">删除</button></div>';
    var detail = s.type === "custom"
      ? "金额 " + formatMoney(s.amount)
      : formatHours(s.hours) + " 小时" + (s.startTime && s.endTime ? "（" + esc(s.startTime) + "–" + esc(s.endTime) + "）" : "");
    var nameExtra = s.employeeActive === false ? ' <span class="badge badge-rejected">已停用</span>' : "";
    if (s.displayName && s.employeeName && s.displayName !== s.employeeName) nameExtra += ' <span class="tiny">（提交时：' + esc(s.employeeName) + "）</span>";
    return '<div class="item-card"><div><div class="item-meta"><strong>' + esc(empDisplayName(s)) + "</strong>" + nameExtra +
      ' <span class="badge badge-' + s.status + '">' + STATUS_LABEL[s.status] + "</span>" +
      ' <span class="badge" style="background:#eee;color:#444">' + TYPE_LABEL[s.type] + "</span></div>" +
      "<div>" + esc(s.date) + " · " + detail + (s.note ? " · " + esc(s.note) : "") + "</div>" +
      '<div class="tiny">提交于 ' + esc((s.createdAt || "").replace("T", " ").slice(0, 16)) + "</div></div>" + actions + "</div>";
  }).join("");
  return '<div class="card">' + cards + "</div>" + (ui.editing ? renderEditModal() : "");
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
    ? '<label class="field">金额<input name="amount" type="number" step="0.01" value="' + esc(s.amount) + '"></label>' +
      '<label class="field">说明<input name="note" value="' + esc(s.note || "") + '"></label>'
    : '<div class="grid-2"><label class="field">开始时间<input name="startTime" type="time" value="' + esc(s.startTime || "") + '"></label>' +
      '<label class="field">结束时间<input name="endTime" type="time" value="' + esc(s.endTime || "") + '"></label></div>' +
      '<label class="field">小时（留空则按时间段重算）<input name="hours" type="number" step="0.01" value="' + esc(s.hours) + '"></label>' +
      '<label class="field">说明<input name="note" value="' + esc(s.note || "") + '"></label>' +
      '<label class="field" style="flex-direction:row;align-items:center;gap:8px;font-weight:500">' +
      '<input name="recompute" type="checkbox"' + (s.hoursMode === "range" && s.startTime && s.endTime ? " checked" : "") + ' style="width:auto"> 按时间段重新计算小时</label>';
  return '<div class="modal-bg" id="edit-bg"><form class="card card-pad modal stack" id="edit-form">' +
    '<h3 style="margin:0">编辑申请</h3>' +
    '<label class="field">员工<select name="employeeId">' + empOpts + '<option value="__other__"' + (!s.employeeId ? " selected" : "") + ">其他</option></select></label>" +
    '<div class="grid-2"><label class="field">性质<select name="type">' + typeOpts + '</select></label>' +
    '<label class="field">状态<select name="status">' + statusOpts + "</select></label></div>" +
    '<label class="field">日期<input name="date" type="date" value="' + esc(s.date) + '" required></label>' + extra +
    '<div class="row" style="justify-content:flex-end">' +
    '<button type="button" class="btn btn-ghost" id="cancel-edit">取消</button>' +
    '<button type="submit" class="btn btn-primary">保存</button></div></form></div>';
}

function renderEmployees() {
  var locked = isMonthLocked(ui.month);
  var activeList = ui.employees.filter(function (e) { return e.active !== false; });
  var inactiveList = ui.employees.filter(function (e) { return e.active === false; });
  var rows = activeList.map(function (e) {
    var baseKey = "base:" + e.id;
    var noteKey = "note:" + e.id;
    return "<tr><td class=\"name-cell\">" + esc(e.name) + "</td>" +
      '<td><div class="input-with-state"><input class="control" style="width:130px;padding:6px 8px" data-base="' + esc(e.id) + '" type="number" step="0.01" min="0" value="' + e.monthBase + '"' + (locked ? " disabled title=\"本月已锁定结算\"" : "") + ">" + saveStateHtml(baseKey) + "</div></td>" +
      '<td><div class="input-with-state"><input class="control" style="min-width:220px;padding:6px 8px" data-note="' + esc(e.id) + '" value="' + esc(e.note || "") + '" placeholder="可选备注">' + saveStateHtml(noteKey) + "</div></td>" +
      '<td><div class="actions-row"><button type="button" class="btn btn-ghost btn-sm" data-rename-emp="' + esc(e.id) + '">改名</button>' +
      '<button type="button" class="btn btn-ghost btn-sm" data-deact-emp="' + esc(e.id) + '">停用</button></div></td></tr>';
  }).join("");
  var inactiveRows = inactiveList.map(function (e) {
    return "<tr><td class=\"name-cell\">" + esc(e.name) + ' <span class="badge badge-rejected">已停用</span></td>' +
      '<td class="tiny">' + esc(String(e.deactivatedAt || "").replace("T", " ").slice(0, 16) || "—") + "</td>" +
      "<td>" + esc(e.note || "") + "</td>" +
      '<td><button type="button" class="btn btn-forest btn-sm" data-react-emp="' + esc(e.id) + '">恢复</button></td></tr>';
  }).join("");
  var inactiveBlock = inactiveList.length
    ? '<div class="card card-pad" style="margin-top:16px"><h3 style="margin:0 0 8px;font-size:15px">已停用员工（' + inactiveList.length + "）</h3>" +
      '<p class="muted" style="margin:0 0 10px;font-size:13px">停用后不再出现在员工提交页和新月份的结算表中；以前的工资、申请和付款记录全部保留，历史月份仍可查看。</p>' +
      '<div class="table-wrap"><table class="data emp-table"><thead><tr><th>姓名</th><th>停用时间</th><th>备注</th><th></th></tr></thead><tbody>' + inactiveRows + "</tbody></table></div></div>"
    : "";
  return '<div class="toolbar">' +
    '<label class="field" style="min-width:180px">工资所属月份<input id="emp-month" type="month" value="' + esc(ui.month) + '"></label>' +
    '<div class="row"><button type="button" class="btn btn-ghost" id="copy-prev"' + (locked ? " disabled" : "") + '>从上月复制基本工资</button>' +
    '<button type="button" class="btn btn-navy" id="add-emp">添加员工</button></div></div>' +
    (locked ? '<div class="banner"><span>' + esc(formatMonthCN(ui.month)) + "已锁定结算，基本工资显示的是快照，不能修改。改名、备注不受影响。</span></div>" : "") +
    '<div class="table-wrap"><table class="data emp-table"><thead><tr><th>姓名</th><th>本月基本工资 (€)</th><th>备注</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
    '<p class="tiny" style="margin:8px 2px 0">员工以内部编号关联工资、银行卡和申请记录，改名不会影响历史月份。</p>' +
    inactiveBlock +
    '<div class="card card-pad" style="margin-top:16px"><h3 style="margin:0 0 8px;font-size:15px">导入本月基本工资</h3>' +
    '<p class="muted" style="margin:0 0 10px;font-size:13px">粘贴 CSV，每行「姓名,基本工资」。将按姓名匹配已有员工；未匹配到的姓名会新增；已停用员工会跳过。</p>' +
    '<textarea id="csv-paste" class="control" style="min-height:120px" placeholder="Tino,2400&#10;小杨,2200">' + esc(ui.csvDraft || "") + "</textarea>" +
    '<div class="row" style="margin-top:10px"><button type="button" class="btn btn-primary" id="import-csv"' + (locked ? " disabled" : "") + ">导入到本月</button></div></div>";
}

function renderData() {
  return '<div class="stack" style="max-width:640px">' +
    '<div class="card card-pad stack"><h3 style="margin:0;font-size:16px">备份与恢复</h3>' +
    '<p class="muted" style="margin:0">导出为 JSON 文件，可在清空或换表后重新导入。导入将覆盖当前全部业务数据（不含后台密码）。</p>' +
    '<div class="row"><button type="button" class="btn btn-primary" id="export-json">导出 JSON</button>' +
    '<button type="button" class="btn btn-ghost" id="import-json">导入 JSON</button>' +
    '<input id="import-file" type="file" accept="application/json,.json" hidden></div></div>' +
    '<div class="card card-pad stack"><h3 style="margin:0;font-size:16px">修改后台密码</h3>' +
    '<form id="pw-form" class="stack"><label class="field">当前密码<input name="old" type="password" required></label>' +
    '<label class="field">新密码<input name="nw" type="password" minlength="1" required></label>' +
    '<button type="submit" class="btn btn-navy">保存新密码</button></form></div>' +
    '<div class="card card-pad stack"><h3 style="margin:0;font-size:16px">退出</h3>' +
    '<div class="row"><button type="button" class="btn btn-ghost" id="logout">退出登录</button></div></div></div>';
}

function onLogin(e) {
  e.preventDefault();
  var form = e.target;
  var btn = form.querySelector('button[type="submit"]');
  var password = form.querySelector("[name=password]").value;
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

function changeMonth(nextMonth, preferEmployeesTab) {
  ui.month = nextMonth || currentMonth();
  ui.selectedEmpId = null;
  ui.slip = null;
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

function bindAdmin() {
  Array.prototype.forEach.call(document.querySelectorAll("#admin-tabs button"), function (b) {
    b.addEventListener("click", function () {
      ui.tab = b.getAttribute("data-tab");
      ui.slip = null;
      ui.selectedEmpId = null;
      ui.editing = null;
      render();
    });
  });
  var monthInput = document.getElementById("month-input");
  if (monthInput) monthInput.addEventListener("change", function () {
    changeMonth(monthInput.value || currentMonth());
  });
  Array.prototype.forEach.call(document.querySelectorAll("#settle-table tbody tr"), function (tr) {
    tr.addEventListener("click", function () {
      var id = tr.getAttribute("data-emp");
      ui.selectedEmpId = ui.selectedEmpId === id ? null : id;
      render();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("input.bank"), function (inp) {
    inp.addEventListener("change", function () {
      var empId = inp.getAttribute("data-bank");
      var key = "bank:" + empId;
      var amount = Number(inp.value) || 0;
      applyBankLocally(empId, amount);
      setFieldSaveState(key, "saving", "保存中…");
      inp.disabled = true;
      run("adminSetBank", getToken(), ui.month, empId, inp.value)
        .then(function (res) {
          var saved = res && res.amount != null ? res.amount : amount;
          applyBankLocally(empId, saved);
          inp.disabled = false;
          inp.value = saved ? String(saved) : "";
          setFieldSaveState(key, "saved", "已保存 ✓");
          toast("银行卡金额已保存", "ok");
          renderIfIdle();
          setTimeout(function () { setFieldSaveState(key, "", ""); }, 2000);
        })
        .catch(function (err) {
          inp.disabled = false;
          setFieldSaveState(key, "error", "失败");
          toast(err.message, "err");
        });
    });
    inp.addEventListener("blur", function () {
      if (ui.pendingRender && !isFormFieldFocused()) renderIfIdle();
    });
  });
  var close = document.getElementById("close-drawer");
  var bg = document.getElementById("drawer-bg");
  if (close) close.addEventListener("click", function () { ui.selectedEmpId = null; render(); });
  if (bg) bg.addEventListener("click", function (e) { if (e.target === bg) { ui.selectedEmpId = null; render(); } });
  var exp = document.getElementById("export-csv");
  if (exp) exp.addEventListener("click", function () {
    withButtonBusy(exp, "导出中…", function () {
      return run("adminExportSettlementCsv", getToken(), ui.month).then(function (r) {
        downloadText(r.filename, r.csv, "text/csv;charset=utf-8");
        toast("已导出 CSV", "ok");
      });
    }).catch(function (err) { toast(err.message, "err"); });
  });

  var lockBtn = document.getElementById("lock-month");
  if (lockBtn) lockBtn.addEventListener("click", function () { lockMonth(lockBtn); });
  var unlockBtn = document.getElementById("unlock-month");
  if (unlockBtn) unlockBtn.addEventListener("click", function () { unlockMonth(unlockBtn); });
  var printAll = document.getElementById("print-all-slips");
  if (printAll) printAll.addEventListener("click", function () {
    if (!ui.settlement || !ui.settlement.rows.length) { toast("本月没有可打印的员工", "err"); return; }
    ui.slip = { all: true };
    ui.selectedEmpId = null;
    render();
    window.scrollTo(0, 0);
  });
  var openSlip = document.getElementById("open-slip");
  if (openSlip) openSlip.addEventListener("click", function () {
    ui.slip = { empId: openSlip.getAttribute("data-slip") };
    ui.selectedEmpId = null;
    render();
    window.scrollTo(0, 0);
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-approve]"), function (b) {
    b.addEventListener("click", function () { setStatus(b.getAttribute("data-approve"), "approved", b); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-reject]"), function (b) {
    b.addEventListener("click", function () { setStatus(b.getAttribute("data-reject"), "rejected", b); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-edit]"), function (b) {
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      var id = b.getAttribute("data-edit");
      ui.editing = null;
      ui.submissions.forEach(function (s) { if (s.id === id) ui.editing = s; });
      if (!ui.editing && ui.settlement) {
        ui.settlement.rows.forEach(function (r) {
          r.details.forEach(function (s) { if (s.id === id) ui.editing = s; });
        });
      }
      render();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-del]"), function (b) {
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      deleteSubmission(b.getAttribute("data-del"), b);
    });
  });

  var cancel = document.getElementById("cancel-edit");
  var editBg = document.getElementById("edit-bg");
  if (cancel) cancel.addEventListener("click", function () { ui.editing = null; render(); });
  if (editBg) editBg.addEventListener("click", function (ev) { if (ev.target === editBg) { ui.editing = null; render(); } });
  var editForm = document.getElementById("edit-form");
  if (editForm) editForm.addEventListener("submit", onSaveEdit);
  var typeSel = editForm && editForm.querySelector("[name=type]");
  if (typeSel) typeSel.addEventListener("change", function () {
    ui.editing = Object.assign({}, ui.editing, { type: typeSel.value });
    render();
  });

  var empMonth = document.getElementById("emp-month");
  if (empMonth) empMonth.addEventListener("change", function () {
    changeMonth(empMonth.value || currentMonth());
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-base]"), function (inp) {
    inp.addEventListener("change", function () {
      var id = inp.getAttribute("data-base");
      var key = "base:" + id;
      var value = inp.value;
      ui.employees.forEach(function (e) {
        if (e.id === id) { e.monthBase = Number(value) || 0; e.defaultBase = Number(value) || 0; }
      });
      setFieldSaveState(key, "saving", "保存中…");
      inp.disabled = true;
      run("adminUpdateEmployee", getToken(), id, {
        month: ui.month, monthBase: value, defaultBase: value
      }).then(function () {
        inp.disabled = false;
        setFieldSaveState(key, "saved", "已保存 ✓");
        toast("已更新基本工资", "ok");
        setTimeout(function () { setFieldSaveState(key, "", ""); }, 2000);
      }).catch(function (err) {
        inp.disabled = false;
        setFieldSaveState(key, "error", "失败");
        toast(err.message, "err");
      });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-note]"), function (inp) {
    inp.addEventListener("change", function () {
      var id = inp.getAttribute("data-note");
      var key = "note:" + id;
      var value = inp.value;
      ui.employees.forEach(function (e) { if (e.id === id) e.note = value; });
      setFieldSaveState(key, "saving", "保存中…");
      inp.disabled = true;
      run("adminUpdateEmployee", getToken(), id, { note: value })
        .then(function () {
          inp.disabled = false;
          setFieldSaveState(key, "saved", "已保存 ✓");
          toast("备注已保存", "ok");
          setTimeout(function () { setFieldSaveState(key, "", ""); }, 2000);
        })
        .catch(function (err) {
          inp.disabled = false;
          setFieldSaveState(key, "error", "失败");
          toast(err.message, "err");
        });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-deact-emp]"), function (b) {
    b.addEventListener("click", function () {
      var id = b.getAttribute("data-deact-emp");
      var emp = findEmp(id);
      if (!emp) return;
      if (!confirm("确定停用员工「" + emp.name + "」？\n停用后不再出现在员工提交页和新月份结算中；以前的工资、申请和付款记录全部保留，可随时恢复。")) return;
      withButtonBusy(b, "停用中…", function () {
        return run("adminDeactivateEmployee", getToken(), id).then(function () {
          toast("已停用 " + emp.name, "ok");
          emp.active = false;
          emp.deactivatedAt = new Date().toISOString().slice(0, 16);
          render();
          return loadAll();
        });
      }).then(function () { renderIfIdle(); }).catch(function (err) { toast(err.message, "err"); });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-react-emp]"), function (b) {
    b.addEventListener("click", function () {
      var id = b.getAttribute("data-react-emp");
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
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-rename-emp]"), function (b) {
    b.addEventListener("click", function () {
      var id = b.getAttribute("data-rename-emp");
      var emp = findEmp(id);
      if (!emp) return;
      var name = (prompt("新的姓名（只改显示名，历史记录按员工编号关联，不受影响）：", emp.name) || "").trim();
      if (!name || name === emp.name) return;
      withButtonBusy(b, "保存中…", function () {
        return run("adminUpdateEmployee", getToken(), id, { name: name }).then(function () {
          toast("已改名为 " + name, "ok");
          emp.name = name;
          render();
          return loadAll();
        });
      }).then(function () { renderIfIdle(); }).catch(function (err) { toast(err.message, "err"); });
    });
  });
  var addEmp = document.getElementById("add-emp");
  if (addEmp) addEmp.addEventListener("click", function () {
    var name = (prompt("新员工姓名：") || "").trim();
    if (!name) return;
    var base = Number(prompt("月基本工资（欧元）：", "0") || "0");
    withButtonBusy(addEmp, "添加中…", function () {
      return run("adminAddEmployee", getToken(), { name: name, defaultBase: base, month: ui.month }).then(function () {
        toast("已添加 " + name, "ok");
        return loadAll();
      });
    }).then(render).catch(function (err) { toast(err.message, "err"); });
  });
  var copyPrev = document.getElementById("copy-prev");
  if (copyPrev) copyPrev.addEventListener("click", function () {
    withButtonBusy(copyPrev, "复制中…", function () {
      return run("adminCopyPreviousBases", getToken(), ui.month).then(function (r) {
        toast(r.sourceMonth ? "已从 " + r.sourceMonth + " 复制基本工资" : "没有可复制的上月数据，已使用默认基本工资", r.sourceMonth ? "ok" : "err");
        return loadAll();
      });
    }).then(render).catch(function (err) { toast(err.message, "err"); });
  });
  var csvArea = document.getElementById("csv-paste");
  if (csvArea) csvArea.addEventListener("input", function () { ui.csvDraft = csvArea.value; });
  var importCsv = document.getElementById("import-csv");
  if (importCsv) importCsv.addEventListener("click", function () {
    var text = (document.getElementById("csv-paste").value || "").trim();
    if (!text) { toast("请先粘贴 CSV", "err"); return; }
    withButtonBusy(importCsv, "导入中…", function () {
      return run("adminImportCsvBases", getToken(), ui.month, text).then(function (r) {
        toast("已更新 " + r.updated + " 人，新增 " + r.added + " 人", "ok");
        ui.csvDraft = "";
        return loadAll();
      });
    }).then(render).catch(function (err) { toast(err.message, "err"); });
  });

  var exportJson = document.getElementById("export-json");
  if (exportJson) exportJson.addEventListener("click", function () {
    withButtonBusy(exportJson, "导出中…", function () {
      return run("adminExportBackup", getToken()).then(function (data) {
        downloadText("FEST7-payroll-backup.json", JSON.stringify(data, null, 2), "application/json;charset=utf-8");
        toast("已导出 JSON", "ok");
      });
    }).catch(function (err) { toast(err.message, "err"); });
  });
  var importJson = document.getElementById("import-json");
  var importFile = document.getElementById("import-file");
  if (importJson && importFile) {
    importJson.addEventListener("click", function () { importFile.click(); });
    importFile.addEventListener("change", function () {
      var file = importFile.files && importFile.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result || ""));
          if (!confirm("导入将覆盖当前全部业务数据，确定继续？")) return;
          withButtonBusy(importJson, "导入中…", function () {
            return run("adminImportBackup", getToken(), parsed).then(function () {
              toast("导入成功", "ok");
              return loadAll();
            });
          }).then(render).catch(function (err) { toast(err.message, "err"); });
        } catch (err) {
          toast(err.message || "导入失败", "err");
        }
      };
      reader.readAsText(file, "utf-8");
      importFile.value = "";
    });
  }
  var pwForm = document.getElementById("pw-form");
  if (pwForm) pwForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var btn = pwForm.querySelector('button[type="submit"]');
    withButtonBusy(btn, "保存中…", function () {
      return run("adminChangePassword", getToken(), pwForm.querySelector("[name=old]").value, pwForm.querySelector("[name=nw]").value)
        .then(function () { toast("密码已更新", "ok"); pwForm.reset(); });
    }).catch(function (err) { toast(err.message, "err"); });
  });
  var logout = document.getElementById("logout");
  if (logout) logout.addEventListener("click", function () {
    withButtonBusy(logout, "退出中…", function () {
      return run("adminLogout", getToken()).then(function () {
        setToken("");
        clearBootstrapCache();
        ui.authed = false;
        ui.slip = null;
        ui.settlement = null;
        ui.submissions = [];
        ui.employees = [];
        render();
      });
    }).catch(function () {
      setToken("");
      clearBootstrapCache();
      ui.authed = false;
      render();
    });
  });
}

function findEmp(id) {
  var emp = null;
  ui.employees.forEach(function (e) { if (e.id === id) emp = e; });
  return emp;
}

function lockMonth(btn) {
  var S = ui.settlement;
  if (!S) return;
  var month = ui.month;
  var pending = ui.submissions.filter(function (s) { return s.status === "pending" && monthOf(s.date) === month; }).length;
  var msg = "确定锁定 " + formatMonthCN(month) + " 的结算？\n\n锁定后会保存本月每位员工的结算快照（基本工资、请假、加班、调整、银行卡、现金）。" +
    "此后本月的审批、基本工资、银行卡和调整都不能再修改，员工也不能再提交本月申请。";
  if (pending) msg += "\n\n⚠ 本月还有 " + pending + " 条待审批申请，锁定后它们不会计入结算。";
  if (S.unmatched && S.unmatched.length) msg += "\n⚠ 有 " + S.unmatched.length + " 条已通过申请无法匹配到员工，不会计入。";
  if (!confirm(msg)) return;
  withButtonBusy(btn, "锁定中…", function () {
    return run("adminLockMonth", getToken(), month).then(function (res) {
      if (ui.month === month && res && res.settlement) {
        ui.settlement = res.settlement;
        ui.lock = res.lock;
        if (ui.lockedMonths.indexOf(month) === -1) ui.lockedMonths = ui.lockedMonths.concat([month]);
      }
      toast(formatMonthCN(month) + "已锁定结算", "ok");
      render();
      return loadAll();
    });
  }).then(function () { renderIfIdle(); }).catch(function (err) { toast(err.message, "err"); });
}

function unlockMonth(btn) {
  var month = ui.month;
  if (!confirm("确定解锁 " + formatMonthCN(month) + "？\n\n解锁后本月将重新按当前数据实时计算，可以再修改；已保存的快照仍保留在表格中作为记录。修改完成后请重新锁定。")) return;
  var typed = prompt("请输入月份 " + month + " 以确认解锁：", "");
  if (typed == null) return;
  if (String(typed).trim() !== month) { toast("输入的月份不一致，未解锁", "err"); return; }
  withButtonBusy(btn, "解锁中…", function () {
    return run("adminUnlockMonth", getToken(), month, String(typed).trim()).then(function () {
      ui.lockedMonths = ui.lockedMonths.filter(function (m) { return m !== month; });
      toast(formatMonthCN(month) + "已解锁", "ok");
      return loadAll();
    });
  }).then(function () { render(); }).catch(function (err) { toast(err.message, "err"); });
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
    ? "<tr><th>日期</th><th>说明</th><th class=\"num\">金额</th></tr>"
    : "<tr><th>日期</th><th>时间</th><th class=\"num\">小时</th><th>说明</th><th class=\"num\">" + (kind === "leave" ? "扣款" : "加班费（×1.2）") + "</th></tr>";
  if (!list.length) {
    return '<table class="data slip-table"><thead>' + head + '</thead><tbody><tr><td colspan="' + (isCustom ? 3 : 5) + '" class="tiny">无</td></tr></tbody></table>';
  }
  var body = list.map(function (d) {
    var money = (d.effect < 0 ? "−" : d.effect > 0 && isCustom ? "+" : "") + formatMoney(Math.abs(d.effect)).replace("−", "");
    if (isCustom) {
      return "<tr><td>" + esc(d.date) + "</td><td>" + esc(d.note || "") + '</td><td class="num">' + money + "</td></tr>";
    }
    return "<tr><td>" + esc(d.date) + "</td><td>" + slipTimeText(d) + '</td><td class="num">' + formatHours(d.hours) + "</td><td>" + esc(d.note || "") + '</td><td class="num">' + money + "</td></tr>";
  }).join("");
  var foot;
  if (kind === "leave") foot = '<tr><td colspan="2">合计</td><td class="num">' + formatHours(r.leaveHours) + '</td><td></td><td class="num">' + (r.leavePay ? "−" + formatMoney(r.leavePay) : formatMoney(0)) + "</td></tr>";
  else if (kind === "overtime") foot = '<tr><td colspan="2">合计</td><td class="num">' + formatHours(r.otHours) + '</td><td></td><td class="num">' + formatMoney(r.otPay) + "</td></tr>";
  else foot = '<tr><td colspan="2">合计</td><td class="num">' + formatMoney(r.customSum) + "</td></tr>";
  return '<table class="data slip-table"><thead>' + head + "</thead><tbody>" + body + "</tbody><tfoot>" + foot + "</tfoot></table>";
}

function renderSlip(r, S) {
  var leaves = r.details.filter(function (d) { return d.type === "leave"; });
  var ots = r.details.filter(function (d) { return d.type === "overtime"; });
  var customs = r.details.filter(function (d) { return d.type === "custom"; });
  var locked = !!S.locked;
  var status = locked
    ? '<span class="badge badge-approved">已锁定 · 快照 ' + esc(String(S.lockedAt || "").replace("T", " ").slice(0, 16)) + "</span>"
    : '<span class="badge badge-pending">未锁定 · 实时计算，仅供核对</span>';
  var line = function (label, value, cls) {
    return '<div class="slip-line' + (cls ? " " + cls : "") + '"><span>' + label + '</span><span class="num">' + value + "</span></div>";
  };
  var capacity = r.capacity || r.workdays * 8.5;
  return '<section class="card card-pad slip">' +
    '<header class="slip-head"><div class="brand"><div class="logo">F7</div><div><h2 class="slip-title">员工结算确认单</h2>' +
    '<div class="tiny">FEST7 · ' + esc(formatMonthCN(S.ym || ui.month)) + "</div></div></div>" + status + "</header>" +
    '<div class="slip-meta grid-3">' +
    '<div><div class="tiny">员工</div><strong>' + esc(r.emp.name) + "</strong></div>" +
    '<div><div class="tiny">结算月份</div><strong>' + esc(S.ym || ui.month) + "</strong></div>" +
    '<div><div class="tiny">员工编号</div><span class="num">' + esc(r.emp.id) + "</span></div></div>" +
    '<h3 class="slip-h">一、基本工资与小时费率</h3>' +
    '<table class="data slip-table"><tbody>' +
    '<tr><td>月基本工资</td><td class="num">' + formatMoney(r.base) + "</td></tr>" +
    "<tr><td>本月工作日（周一至周五，假日不扣除）</td><td class=\"num\">" + r.workdays + " 天</td></tr>" +
    "<tr><td>标准工时（工作日 × 8.5）</td><td class=\"num\">" + formatHours(capacity) + " 小时</td></tr>" +
    "<tr><td>小时费率（基本工资 ÷ 标准工时）</td><td class=\"num\">" + formatMoney(r.rateRounded) + " / 小时</td></tr>" +
    "</tbody></table>" +
    '<h3 class="slip-h">二、请假明细（按小时费率扣款）</h3>' + slipItemsTable(leaves, "leave", r) +
    '<h3 class="slip-h">三、加班明细（小时费率 × 1.2）</h3>' + slipItemsTable(ots, "overtime", r) +
    '<h3 class="slip-h">四、自定义调整</h3>' + slipItemsTable(customs, "custom", r) +
    '<h3 class="slip-h">五、汇总</h3>' +
    '<div class="slip-sum">' +
    line("月基本工资", formatMoney(r.base)) +
    line("− 请假扣款", r.leavePay ? "−" + formatMoney(r.leavePay) : formatMoney(0)) +
    line("+ 加班费", formatMoney(r.otPay)) +
    line("± 自定义调整", formatMoney(r.customSum)) +
    line("<strong>应发合计</strong>", "<strong>" + formatMoney(r.gross) + "</strong>", "slip-total") +
    line("其中：银行卡转账", formatMoney(r.bank)) +
    line("其中：现金支付", formatMoney(r.cash)) +
    "</div>" +
    '<p class="tiny" style="margin:8px 0 0">扣款与加班费按未取整的小时费率、以合计小时计算后取整到分，逐项金额相加可能与合计有 €0.01 的尾差。</p>' +
    '<div class="slip-sign grid-2">' +
    '<div><div class="slip-sign-line"></div><div class="tiny">员工签字</div><div class="slip-sign-line short"></div><div class="tiny">日期</div></div>' +
    '<div><div class="slip-sign-line"></div><div class="tiny">管理员签字</div><div class="slip-sign-line short"></div><div class="tiny">日期</div></div>' +
    "</div>" +
    '<footer class="slip-foot">内部对账确认单，不替代正式工资单（busta paga）</footer>' +
    "</section>";
}

function renderSlips() {
  var S = ui.settlement;
  if (!S) return '<div class="card empty">正在加载结算…</div>';
  var rows = ui.slip.all ? S.rows : S.rows.filter(function (r) { return r.emp.id === ui.slip.empId; });
  var title = ui.slip.all ? "全部员工结算确认单（" + rows.length + " 份）" : "结算确认单";
  return '<div class="toolbar no-print"><div class="page-intro" style="margin:0"><h2>' + esc(title) + "</h2>" +
    "<p>" + esc(formatMonthCN(S.ym || ui.month)) + (S.locked ? " · 已锁定，数据来自快照" : " · 未锁定，数据为实时计算") + "。打印时每位员工单独一页。</p></div>" +
    '<div class="row"><button type="button" class="btn btn-ghost" id="slip-back">返回</button>' +
    '<button type="button" class="btn btn-primary" id="slip-print">打印</button></div></div>' +
    (rows.length ? '<div class="slips">' + rows.map(function (r) { return renderSlip(r, S); }).join("") + "</div>" : '<div class="card empty">没有找到该员工的结算数据。</div>');
}

function bindSlips() {
  var back = document.getElementById("slip-back");
  if (back) back.addEventListener("click", function () {
    var empId = ui.slip && ui.slip.empId;
    ui.slip = null;
    ui.selectedEmpId = empId || null;
    render();
  });
  var print = document.getElementById("slip-print");
  if (print) print.addEventListener("click", function () { window.print(); });
}

function setStatus(id, status, btn) {
  withButtonBusy(btn, status === "approved" ? "通过中…" : "驳回中…", function () {
    return run("adminUpdateSubmission", getToken(), id, { status: status }).then(function (res) {
      var next = res && res.submission ? res.submission : null;
      ui.submissions = ui.submissions.map(function (s) {
        if (s.id !== id) return s;
        return next || Object.assign({}, s, { status: status, reviewedAt: s.reviewedAt });
      });
      toast(status === "approved" ? "已通过" : "已驳回", "ok");
      render();
      return loadAll();
    });
  }).then(function () {
    renderIfIdle();
  }).catch(function (err) { toast(err.message, "err"); });
}

function deleteSubmission(id, btn) {
  if (!confirm("确定删除这条申请？此操作不可撤销。")) return;
  withButtonBusy(btn, "删除中…", function () {
    return run("adminDeleteSubmission", getToken(), id).then(function () {
      toast("已删除", "ok");
      if (ui.editing && ui.editing.id === id) ui.editing = null;
      ui.submissions = ui.submissions.filter(function (s) { return s.id !== id; });
      render();
      return loadAll();
    });
  }).then(function () {
    renderIfIdle();
  }).catch(function (err) { toast(err.message, "err"); });
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
    return loadAll();
  }).then(function () {
    if (!ui.authed) return;
    ui.refreshing = false;
    render();
  }).catch(function (err) {
    ui.refreshing = false;
    setRefreshing(false);
    if (ui.settlement || ui.employees.length) {
      toast(err.message || "刷新失败，先显示本地缓存", "err");
      render();
    } else {
      showLoadError("app", err.message || "无法连接服务器", boot);
    }
  });
}
boot();
