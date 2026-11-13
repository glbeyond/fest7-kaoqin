var TOKEN_KEY = "fest7_admin_token";

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
  editing: null
};

function refreshMe() {
  var t = getToken();
  if (!t) { ui.authed = false; return Promise.resolve(); }
  return run("adminMe", t).then(function (me) { ui.authed = !!me.authenticated; });
}

function loadSettlement() {
  return run("adminGetSettlement", getToken(), ui.month).then(function (S) { ui.settlement = S; });
}
function loadSubmissions() {
  return run("adminGetSubmissions", getToken()).then(function (data) { ui.submissions = data.submissions || []; });
}
function loadEmployees() {
  return run("adminGetEmployees", getToken(), ui.month).then(function (data) { ui.employees = data.employees || []; });
}
function loadAll() {
  return Promise.all([loadSettlement(), loadSubmissions(), loadEmployees()]);
}
function pendingCount() {
  return ui.submissions.filter(function (s) { return s.status === "pending"; }).length;
}

function render() {
  var app = document.getElementById("app");
  if (!ui.authed) {
    app.innerHTML =
      '<div class="login-wrap"><form class="card card-pad login-card stack" id="login-form">' +
      "<h2>管理后台登录</h2>" +
      '<p class="muted" style="margin:0">初始密码为 <code>admin</code>，登录后可修改。会话保存在服务器缓存中（约 6 小时），使用页面内令牌校验。</p>' +
      '<label class="field">密码<input name="password" type="password" autocomplete="current-password" required></label>' +
      (ui.loginError ? '<p class="neg" style="margin:0">' + esc(ui.loginError) + "</p>" : "") +
      '<button type="submit" class="btn btn-navy btn-block">进入后台</button></form></div>' +
      '<footer class="note">FEST7 考勤工资结算</footer>';
    document.getElementById("login-form").addEventListener("submit", onLogin);
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
    '<div class="page-intro"><h2>管理后台</h2><p>审批员工申请，维护每月基本工资，并完成银行卡与现金的月度结算。</p></div>' +
    '<div class="tabs" id="admin-tabs">' + tabs + "</div>" + body +
    '<footer class="note">FEST7 考勤工资结算 · 数据保存在本 Google 表格中。</footer>';
  bindAdmin();
}

function kpi(lbl, val, sub) {
  return '<div class="card kpi"><div class="lbl">' + esc(lbl) + '</div><div class="val num">' + val + '</div><div class="sub">' + esc(sub) + "</div></div>";
}

function renderSettle() {
  var S = ui.settlement;
  if (!S) return '<div class="card empty">正在加载结算…</div>';
  var kpis = '<div class="kpis">' +
    kpi("工作日", S.workdays + " 天", "周一至周五，假日仍计工作日") +
    kpi("标准工时", S.capacity + " 小时", "每天 8.5 小时") +
    kpi("应发合计", formatMoney(S.totals.gross), "基本工资 ± 各项调整") +
    kpi("银行卡（打卡）", formatMoney(S.totals.bank), "需手动逐人填写") +
    kpi("现金应付", formatMoney(S.totals.cash), "应发合计 − 银行卡") +
    "</div>";
  var rows = S.rows.map(function (r) {
    var active = ui.selectedEmpId === r.emp.id ? " active" : "";
    var note = r.emp.note ? '<span class="note-dot" title="' + esc(r.emp.note) + '">*</span>' : "";
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
      '<td class="num" onclick="event.stopPropagation()"><input class="bank" data-bank="' + esc(r.emp.id) + '" type="number" step="0.01" value="' + (r.bank ? String(r.bank) : "") + '" placeholder="0.00"></td>' +
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
  return '<div class="toolbar">' +
    '<label class="field" style="min-width:180px">结算月份<input id="month-input" type="month" value="' + esc(ui.month) + '"></label>' +
    '<div class="row"><button type="button" class="btn btn-ghost" id="export-csv">导出本月结算 CSV</button></div></div>' +
    kpis + unmatched +
    '<div class="table-wrap"><table class="data" id="settle-table"><thead><tr>' +
    "<th>姓名</th><th class=\"num\">基本工资</th><th class=\"num\">小时费率</th><th class=\"num\">请假(h)</th><th class=\"num\">请假扣款</th><th class=\"num\">加班(h)</th><th class=\"num\">加班费</th><th class=\"num\">自定义</th><th class=\"num\">应发合计</th><th class=\"num\">银行卡</th><th class=\"num\">现金应付</th>" +
    "</tr></thead><tbody>" + rows + "</tbody><tfoot>" + foot + "</tfoot></table></div>" +
    '<div class="legend"><strong>计算说明</strong>（金额四舍五入到分）<br>' +
    "<code>小时费率</code> = 基本工资 ÷（工作日数 × 8.5）　显示为两位小数，扣款/加班费按未四舍五入的费率计算后再取整。<br>" +
    "<code>请假扣款</code> = 请假小时 × 小时费率　　<code>加班费</code> = 加班小时 × 小时费率 × 1.2（含周末及工作时段外）<br>" +
    "<code>应发合计</code> = 基本工资 − 请假扣款 + 加班费 + 自定义合计　　<code>现金应付</code> = 应发合计 − 银行卡金额<br>" +
    "标准工作时段 08:45–13:00、14:00–18:15；" + formatMonthCN(ui.month) + "共 " + S.workdays + " 个工作日（周一至周五，假日不扣除）。点击员工行可查看并编辑已审批明细。带 * 的姓名表示有备注。</div>" +
    (ui.selectedEmpId ? renderDrawer(S) : "") +
    (ui.editing ? renderEditModal() : "");
}

function renderDrawer(S) {
  var r = null;
  S.rows.forEach(function (x) { if (x.emp.id === ui.selectedEmpId) r = x; });
  if (!r) return "";
  var items = r.details.length ? r.details.map(function (d) {
    var time = d.hoursMode === "range" && d.startTime && d.endTime ? " · " + d.startTime + "–" + d.endTime : "";
    var hours = d.type !== "custom" ? " · " + formatHours(d.hours) + " 小时" : "";
    return "<li><div><strong>" + esc(TYPE_LABEL[d.type]) + "</strong>" +
      '<div class="tiny">' + esc(d.date) + time + hours + (d.note ? " · " + esc(d.note) : "") + "</div></div>" +
      "<div><div class=\"num " + (d.effect < 0 ? "neg" : d.effect > 0 ? "pos" : "") + '">' +
      (d.effect > 0 ? "+" : d.effect < 0 ? "−" : "") + formatMoney(Math.abs(d.effect)) + "</div>" +
      '<div class="actions-row" style="justify-content:flex-end;margin-top:4px">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(d.id) + '">编辑</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-del="' + esc(d.id) + '">删除</button></div></div></li>';
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
    "</div></div></div>";
}

function renderApprove() {
  var list = ui.submissions.slice();
  if (!list.length) return '<div class="card empty">暂无申请。</div>' + (ui.editing ? renderEditModal() : "");
  var cards = list.map(function (s) {
    var actions = '<div class="actions-row">' +
      (s.status === "pending"
        ? '<button type="button" class="btn btn-forest btn-sm" data-approve="' + esc(s.id) + '">通过</button>' +
          '<button type="button" class="btn btn-danger btn-sm" data-reject="' + esc(s.id) + '">驳回</button>'
        : '<span class="tiny">审批于 ' + esc((s.reviewedAt || "").replace("T", " ").slice(0, 16)) + "</span>") +
      '<button type="button" class="btn btn-ghost btn-sm" data-edit="' + esc(s.id) + '">编辑</button>' +
      '<button type="button" class="btn btn-danger btn-sm" data-del="' + esc(s.id) + '">删除</button></div>';
    var detail = s.type === "custom"
      ? "金额 " + formatMoney(s.amount)
      : formatHours(s.hours) + " 小时" + (s.startTime && s.endTime ? "（" + esc(s.startTime) + "–" + esc(s.endTime) + "）" : "");
    return '<div class="item-card"><div><div class="item-meta"><strong>' + esc(s.employeeName) + "</strong>" +
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
  var empOpts = ui.employees.map(function (e) {
    return '<option value="' + esc(e.id) + '"' + (e.id === s.employeeId ? " selected" : "") + ">" + esc(e.name) + "</option>";
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
  var rows = ui.employees.map(function (e) {
    return "<tr><td class=\"name-cell\">" + esc(e.name) + "</td>" +
      '<td><input class="control" style="width:130px;padding:6px 8px" data-base="' + esc(e.id) + '" type="number" step="0.01" min="0" value="' + e.monthBase + '"></td>' +
      '<td><input class="control" style="min-width:220px;padding:6px 8px" data-note="' + esc(e.id) + '" value="' + esc(e.note || "") + '" placeholder="可选备注"></td>' +
      '<td><button type="button" class="btn btn-ghost btn-sm" data-del-emp="' + esc(e.id) + '">删除</button></td></tr>';
  }).join("");
  return '<div class="toolbar">' +
    '<label class="field" style="min-width:180px">工资所属月份<input id="emp-month" type="month" value="' + esc(ui.month) + '"></label>' +
    '<div class="row"><button type="button" class="btn btn-ghost" id="copy-prev">从上月复制基本工资</button>' +
    '<button type="button" class="btn btn-navy" id="add-emp">添加员工</button></div></div>' +
    '<div class="table-wrap"><table class="data emp-table"><thead><tr><th>姓名</th><th>本月基本工资 (€)</th><th>备注</th><th></th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
    '<div class="card card-pad" style="margin-top:16px"><h3 style="margin:0 0 8px;font-size:15px">导入本月基本工资</h3>' +
    '<p class="muted" style="margin:0 0 10px;font-size:13px">粘贴 CSV，每行「姓名,基本工资」。将按姓名匹配已有员工；未匹配到的姓名会新增。</p>' +
    '<textarea id="csv-paste" class="control" style="min-height:120px" placeholder="Tino,2400&#10;小杨,2200">' + esc(ui.csvDraft || "") + "</textarea>" +
    '<div class="row" style="margin-top:10px"><button type="button" class="btn btn-primary" id="import-csv">导入到本月</button></div></div>';
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
  var password = e.target.querySelector("[name=password]").value;
  run("adminLogin", password).then(function (res) {
    setToken(res.token);
    ui.loginError = "";
    ui.authed = true;
    return loadAll();
  }).then(render).catch(function (err) {
    ui.loginError = err.message;
    render();
  });
}

function bindAdmin() {
  Array.prototype.forEach.call(document.querySelectorAll("#admin-tabs button"), function (b) {
    b.addEventListener("click", function () {
      ui.tab = b.getAttribute("data-tab");
      ui.selectedEmpId = null;
      ui.editing = null;
      render();
    });
  });
  var monthInput = document.getElementById("month-input");
  if (monthInput) monthInput.addEventListener("change", function () {
    ui.month = monthInput.value || currentMonth();
    ui.selectedEmpId = null;
    loadAll().then(render).catch(function (err) { toast(err.message, "err"); });
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
      run("adminSetBank", getToken(), ui.month, inp.getAttribute("data-bank"), inp.value)
        .then(loadSettlement).then(render)
        .catch(function (err) { toast(err.message, "err"); });
    });
  });
  var close = document.getElementById("close-drawer");
  var bg = document.getElementById("drawer-bg");
  if (close) close.addEventListener("click", function () { ui.selectedEmpId = null; render(); });
  if (bg) bg.addEventListener("click", function (e) { if (e.target === bg) { ui.selectedEmpId = null; render(); } });
  var exp = document.getElementById("export-csv");
  if (exp) exp.addEventListener("click", function () {
    run("adminExportSettlementCsv", getToken(), ui.month).then(function (r) {
      downloadText(r.filename, r.csv, "text/csv;charset=utf-8");
      toast("已导出 CSV", "ok");
    }).catch(function (err) { toast(err.message, "err"); });
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-approve]"), function (b) {
    b.addEventListener("click", function () { setStatus(b.getAttribute("data-approve"), "approved"); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-reject]"), function (b) {
    b.addEventListener("click", function () { setStatus(b.getAttribute("data-reject"), "rejected"); });
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
      deleteSubmission(b.getAttribute("data-del"));
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
    ui.month = empMonth.value || currentMonth();
    loadEmployees().then(render).catch(function (err) { toast(err.message, "err"); });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-base]"), function (inp) {
    inp.addEventListener("change", function () {
      run("adminUpdateEmployee", getToken(), inp.getAttribute("data-base"), {
        month: ui.month, monthBase: inp.value, defaultBase: inp.value
      }).then(function () { toast("已更新基本工资", "ok"); })
        .catch(function (err) { toast(err.message, "err"); });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-note]"), function (inp) {
    inp.addEventListener("change", function () {
      run("adminUpdateEmployee", getToken(), inp.getAttribute("data-note"), { note: inp.value })
        .catch(function (err) { toast(err.message, "err"); });
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-del-emp]"), function (b) {
    b.addEventListener("click", function () {
      var id = b.getAttribute("data-del-emp");
      var emp = null;
      ui.employees.forEach(function (e) { if (e.id === id) emp = e; });
      if (!emp) return;
      if (!confirm("确定删除员工「" + emp.name + "」？其历史申请仍会保留，但不再出现在结算表中。")) return;
      run("adminDeleteEmployee", getToken(), id).then(function () {
        toast("已删除", "ok");
        return loadAll();
      }).then(render).catch(function (err) { toast(err.message, "err"); });
    });
  });
  var addEmp = document.getElementById("add-emp");
  if (addEmp) addEmp.addEventListener("click", function () {
    var name = (prompt("新员工姓名：") || "").trim();
    if (!name) return;
    var base = Number(prompt("月基本工资（欧元）：", "0") || "0");
    run("adminAddEmployee", getToken(), { name: name, defaultBase: base, month: ui.month }).then(function () {
      toast("已添加 " + name, "ok");
      return loadEmployees();
    }).then(render).catch(function (err) { toast(err.message, "err"); });
  });
  var copyPrev = document.getElementById("copy-prev");
  if (copyPrev) copyPrev.addEventListener("click", function () {
    run("adminCopyPreviousBases", getToken(), ui.month).then(function (r) {
      toast(r.sourceMonth ? "已从 " + r.sourceMonth + " 复制基本工资" : "没有可复制的上月数据，已使用默认基本工资", r.sourceMonth ? "ok" : "err");
      return loadEmployees();
    }).then(render).catch(function (err) { toast(err.message, "err"); });
  });
  var csvArea = document.getElementById("csv-paste");
  if (csvArea) csvArea.addEventListener("input", function () { ui.csvDraft = csvArea.value; });
  var importCsv = document.getElementById("import-csv");
  if (importCsv) importCsv.addEventListener("click", function () {
    var text = (document.getElementById("csv-paste").value || "").trim();
    if (!text) { toast("请先粘贴 CSV", "err"); return; }
    run("adminImportCsvBases", getToken(), ui.month, text).then(function (r) {
      toast("已更新 " + r.updated + " 人，新增 " + r.added + " 人", "ok");
      ui.csvDraft = "";
      return loadEmployees();
    }).then(render).catch(function (err) { toast(err.message, "err"); });
  });

  var exportJson = document.getElementById("export-json");
  if (exportJson) exportJson.addEventListener("click", function () {
    run("adminExportBackup", getToken()).then(function (data) {
      downloadText("FEST7-payroll-backup.json", JSON.stringify(data, null, 2), "application/json;charset=utf-8");
      toast("已导出 JSON", "ok");
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
          run("adminImportBackup", getToken(), parsed).then(function () {
            toast("导入成功", "ok");
            return loadAll();
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
    run("adminChangePassword", getToken(), pwForm.querySelector("[name=old]").value, pwForm.querySelector("[name=nw]").value)
      .then(function () { toast("密码已更新", "ok"); pwForm.reset(); })
      .catch(function (err) { toast(err.message, "err"); });
  });
  var logout = document.getElementById("logout");
  if (logout) logout.addEventListener("click", function () {
    run("adminLogout", getToken()).then(function () {
      setToken("");
      ui.authed = false;
      render();
    });
  });
}

function setStatus(id, status) {
  run("adminUpdateSubmission", getToken(), id, { status: status }).then(function () {
    toast(status === "approved" ? "已通过" : "已驳回", "ok");
    return loadAll();
  }).then(render).catch(function (err) { toast(err.message, "err"); });
}

function deleteSubmission(id) {
  if (!confirm("确定删除这条申请？此操作不可撤销。")) return;
  run("adminDeleteSubmission", getToken(), id).then(function () {
    toast("已删除", "ok");
    if (ui.editing && ui.editing.id === id) ui.editing = null;
    return loadAll();
  }).then(render).catch(function (err) { toast(err.message, "err"); });
}

function onSaveEdit(e) {
  e.preventDefault();
  var form = e.target;
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
  run("adminUpdateSubmission", getToken(), ui.editing.id, body).then(function () {
    toast("已保存", "ok");
    ui.editing = null;
    return loadAll();
  }).then(render).catch(function (err) { toast(err.message, "err"); });
}

function boot() {
  showLoading("app", "正在加载…");
  refreshMe().then(function () {
    if (ui.authed) return loadAll();
  }).then(render).catch(function (err) {
    showLoadError("app", err.message || "无法连接服务器", boot);
  });
}
boot();
