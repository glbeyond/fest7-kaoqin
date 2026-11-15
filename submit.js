/* FEST7 月结助手 · 员工提交页（v2 “FEST7 Ledger” 界面）
 * 流程：首页选类型 → 分步表单 → 提交前摘要 → 成功回执。提交接口与字段保持不变。
 */
var EMP_CACHE_KEY = "fest7_employees_cache";
var LAST_EMP_KEY = "fest7_last_employee";

var TIMES = {
  full: ["08:45", "18:15", "全天", "sun"],
  am: ["08:45", "13:00", "上午", "sunrise"],
  pm: ["14:00", "18:15", "下午", "sunset"]
};
var QUICK_HOURS = { full: "8.5", am: "4.25", pm: "4.25" };

var state = {
  employees: [],
  step: "home",
  type: "leave",
  hoursMode: "range",
  f: null,
  errors: {},
  preview: { status: "wait", hours: 0, days: [], text: "" },
  confirm: false,
  submitting: false,
  justSubmitted: null,
  refreshing: false
};

function readLastEmp() { try { return localStorage.getItem(LAST_EMP_KEY) || ""; } catch (e) { return ""; } }
function writeLastEmp(id) { try { localStorage.setItem(LAST_EMP_KEY, id || ""); } catch (e) { /* ignore */ } }

function freshForm(type, keepEmp) {
  var prev = state.f || {};
  var last = keepEmp ? prev.employeeId : readLastEmp();
  var known = state.employees.some(function (e) { return e.id === last; });
  return {
    employeeId: known ? last : "",
    otherName: keepEmp ? !!prev.otherName : false,
    employeeName: keepEmp ? prev.employeeName || "" : "",
    date: todayISO(),
    endDate: todayISO(),
    startTime: type === "overtime" ? "18:15" : "08:45",
    endTime: type === "overtime" ? "20:15" : "13:00",
    hours: "",
    amount: "",
    sign: 1,
    note: ""
  };
}

function readEmpCache() {
  try {
    var parsed = JSON.parse(localStorage.getItem(EMP_CACHE_KEY) || "null");
    return parsed && parsed.employees ? parsed.employees : null;
  } catch (err) {
    return null;
  }
}

function writeEmpCache(employees) {
  try {
    localStorage.setItem(EMP_CACHE_KEY, JSON.stringify({ employees: employees, at: Date.now() }));
  } catch (err) { /* quota / private mode */ }
}

function sameEmployeeList(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  var i;
  for (i = 0; i < a.length; i++) {
    if (a[i].id !== b[i].id || a[i].name !== b[i].name) return false;
  }
  return true;
}

function loadEmployees() {
  return run("getEmployees").then(function (data) {
    state.employees = data.employees || [];
    writeEmpCache(state.employees);
    return state.employees;
  });
}

function empOptionsHtml(current) {
  return '<option value="" disabled' + (current ? "" : " selected") + ">请选择你的姓名</option>" +
    state.employees.map(function (e) {
      return '<option value="' + esc(e.id) + '"' + (e.id === current ? " selected" : "") + ">" + esc(e.name) + "</option>";
    }).join("") + '<option value="__other__">其他（手填姓名）</option>';
}

/** 后台刷新到新名单时，只替换下拉选项，不打断正在填写的表单 */
function patchEmployeeSelect() {
  var sel = document.getElementById("emp-select");
  if (!sel) return false;
  var current = state.f ? state.f.employeeId : sel.value;
  var found = state.employees.some(function (e) { return e.id === current; });
  sel.innerHTML = empOptionsHtml(found ? current : "");
  if (!found && state.f) state.f.employeeId = "";
  return true;
}

function empName() {
  var f = state.f;
  if (!f) return "";
  if (f.otherName) return f.employeeName.trim();
  var hit = state.employees.filter(function (e) { return e.id === f.employeeId; })[0];
  return hit ? hit.name : "";
}

function shortDate(d) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || "");
  return m ? Number(m[2]) + "月" + Number(m[3]) + "日" : "";
}

function rulesHtml() {
  return "<ul>" +
    "<li>工作日为周一至周五；若法定假日落在工作日，仍按普通工作日计算。</li>" +
    "<li>标准工时：08:45–13:00、14:00–18:15，每天 8.5 小时。</li>" +
    "<li>小时费率 = 月基本工资 ÷（当月工作日数 × 8.5）。</li>" +
    "<li>请假按小时费率扣款；加班一律按小时费率 × 1.2 计发（含周末与工作时段外）。</li>" +
    "<li>自定义可正可负：垫付报销、临时补贴为正；扣款为负。</li>" +
    "</ul>";
}

/* ---------------- 渲染 ---------------- */
function render() {
  setRefreshing(!!state.refreshing);
  var app = document.getElementById("app");
  document.body.classList.toggle("emp-form", state.step === "form");
  if (state.step === "done" && state.justSubmitted) app.innerHTML = renderDone();
  else if (state.step === "form") app.innerHTML = renderForm();
  else app.innerHTML = renderHome();
  if (state.step === "form") refreshPreview();
}

function renderHome() {
  var t = todayISO();
  var wd = weekdayCN(t);
  var weekend = wd === "周六" || wd === "周日";
  function tile(type, title, desc) {
    return '<button type="button" class="card tile hover ' + type + '" data-act="start" data-type="' + type + '">' +
      '<span class="ti">' + I(TYPE_ICON[type]) + '</span><span><span class="tt" style="display:block">' + title + '</span><span class="td" style="display:block">' + desc + "</span></span>" +
      '<span class="go">' + I("chevron-right") + "</span></button>";
  }
  return '<header class="m-hero"><div class="deco"><i></i><i></i><i></i></div><div class="in">' +
    (state.refreshing ? '<span class="sync-mini" id="sync-mini"><span class="dot"></span>更新名单…</span>' : "") +
    '<img src="logo-white.png" alt="FEST7 Express" width="85" height="38"><h1>月结助手</h1><p>请假 · 加班 · 费用登记，无需登录</p></div></header>' +
    '<main class="m-body">' +
    '<div class="card today"><div class="d"><b class="num">' + Number(t.slice(8)) + "</b><span>" + Number(t.slice(5, 7)) + "月</span></div>" +
    '<div><div class="t1">今天 ' + wd + " · " + (weekend ? "周末" : "工作日") + '</div><div class="t2">标准工时 08:45–13:00 · 14:00–18:15</div></div></div>' +
    '<h2 class="m-sec"><span class="echo" style="color:var(--color-primary)"></span>选择要提交的申请</h2>' +
    '<div class="tiles">' +
    tile("leave", "请假", "按时间段、小时或日期区间 · 按小时费率扣款") +
    tile("overtime", "加班", "含周末与 18:15 之后 · 一律按费率 ×1.2") +
    tile("custom", "自定义费用", "垫付报销、临时补贴或工资扣款") +
    "</div>" +
    '<div class="card" style="margin-top:14px;overflow:hidden"><div class="m-note">' + I("info") + "<span>提交后状态为「待审批」，管理员通过后才计入当月工资结算。</span></div>" +
    '<details class="rules"><summary><span class="l">' + I("circle-help") + '计算规则说明</span><span class="chev">' + I("chevron-down", "i-sm") + "</span></summary>" + rulesHtml() + "</details></div>" +
    '<footer class="m-foot"><a href="admin.html">' + I("shield-check", "i-xs") + "管理员入口</a></footer>" +
    "</main>";
}

function errHtml(key) {
  var m = state.errors[key];
  return m ? '<span class="err" id="err-' + key + '" role="alert">' + I("circle-alert", "i-xs") + esc(m) + "</span>" : "";
}

function quickMatch() {
  var f = state.f;
  var k = null;
  Object.keys(TIMES).forEach(function (q) { if (TIMES[q][0] === f.startTime && TIMES[q][1] === f.endTime) k = q; });
  return k;
}

function dateField(name, label, value) {
  return '<label class="field"><span class="label">' + label + ' <span class="req">*</span></span>' +
    '<span class="input-lead"><span class="lead">' + I("calendar") + '</span><input class="input' + (state.errors[name] ? " invalid" : "") + '" name="' + name + '" type="date" value="' + esc(value) + '" required>' +
    '<span class="trail hint" data-wd="' + name + '">' + weekdayCN(value) + "</span></span>" + errHtml(name) + "</label>";
}

function previewBoxHtml() {
  var p = state.preview;
  var cls = p.status === "ok" ? "" : p.status === "warn" ? " warn" : " wait";
  var big = p.status === "ok" ? '<span class="pv num">' + formatHours(p.hours) + "<small>小时</small></span>" :
    '<span class="pv">' + I(p.status === "warn" ? "triangle-alert" : "hourglass") + "</span>";
  var days = "";
  if (p.status === "ok" && p.days && p.days.length) {
    days = '<div class="day-chips">' + p.days.map(function (d) {
      var ds = typeof d === "string" ? d : d.date;
      return '<span class="day-chip">' + esc(shortDate(ds) + " " + weekdayCN(ds)) + "</span>";
    }).join("") + "</div>";
  }
  return '<div class="preview' + cls + '" id="preview" aria-live="polite">' + big + '<div class="pt">' + esc(p.text || "") + days + "</div></div>";
}

function renderForm() {
  var f = state.f;
  var type = state.type;
  var mode = state.hoursMode;
  var isCustom = type === "custom";
  var title = { leave: "请假申请", overtime: "加班申请", custom: "自定义费用" }[type];

  var who = '<section class="card fcard"><div class="fh"><span class="n">1</span>申请人</div>' +
    (f.otherName ?
      '<label class="field"><span class="label">姓名 <span class="req">*</span></span><input class="input' + (state.errors.employee ? " invalid" : "") + '" name="employeeName" id="emp-name" maxlength="40" autocomplete="name" placeholder="请输入你的姓名" value="' + esc(f.employeeName) + '">' +
      errHtml("employee") + '<button type="button" class="btn btn-ghost btn-sm" data-act="pick-list" style="align-self:flex-start;padding:0">' + I("users", "i-xs") + "改回从名单选择</button></label>" :
      '<label class="field"><span class="label">姓名 <span class="req">*</span></span><select class="select' + (state.errors.employee ? " invalid" : "") + '" name="employeeId" id="emp-select">' + empOptionsHtml(f.employeeId) + "</select>" +
      errHtml("employee") + (state.employees.length ? "" : '<span class="hint">名单为空，可选择「其他」手填姓名</span>') + "</label>") +
    "</section>";

  var when = '<section class="card fcard"><div class="fh"><span class="n">2</span>' + (isCustom ? "日期与金额" : "时间") + "</div>";
  if (isCustom) {
    when += dateField("date", "日期", f.date) +
      '<div class="field gap"><span class="label">类型 <span class="req">*</span></span><div class="sign-seg" role="radiogroup">' +
      '<button type="button" role="radio" aria-checked="' + (f.sign > 0) + '" class="plus' + (f.sign > 0 ? " on" : "") + '" data-sign="1">' + I("plus", "i-sm") + "付给员工</button>" +
      '<button type="button" role="radio" aria-checked="' + (f.sign < 0) + '" class="minus' + (f.sign < 0 ? " on" : "") + '" data-sign="-1">' + I("minus", "i-sm") + "从工资扣除</button></div></div>" +
      '<label class="field gap"><span class="label">金额（欧元） <span class="req">*</span></span><span class="amount-in"><span class="sg" style="color:' + (f.sign > 0 ? "var(--green-700)" : "var(--color-danger)") + '">' + (f.sign > 0 ? "+€" : MINUS + "€") + "</span>" +
      '<input class="input' + (state.errors.amount ? " invalid" : "") + '" name="amount" id="amount-in" inputmode="decimal" placeholder="0.00" autocomplete="off" value="' + esc(f.amount) + '"></span>' +
      errHtml("amount") + '<span class="hint">垫付报销、临时补贴选「付给员工」；罚款、借支等选「从工资扣除」。</span></label>';
  } else {
    var modes = [["range", "按时间段"], ["direct", "直接填小时"]];
    if (type === "leave") modes.push(["multi-day", "日期区间"]);
    when += '<div class="seg" role="tablist" id="mode-seg" style="margin-bottom:14px">' + modes.map(function (m) {
      return '<button type="button" role="tab" aria-selected="' + (m[0] === mode) + '" class="' + (m[0] === mode ? "on" : "") + '" data-mode="' + m[0] + '">' + m[1] + "</button>";
    }).join("") + "</div>";
    if (mode === "multi-day") {
      when += '<div class="timepair">' + dateField("date", "开始日期", f.date) + '<span class="to">' + I("arrow-right", "i-sm") + "</span>" + dateField("endDate", "结束日期", f.endDate) + "</div>" +
        previewBoxHtml() + '<p class="hint" style="margin-top:8px">只计算区间内的工作日（周一至周五），每天 8.5 小时。</p>';
    } else {
      when += dateField("date", "日期", f.date);
      var qm = mode === "range" ? quickMatch() : null;
      var quick = '<div class="quick" role="group" aria-label="快捷时段">' + ["am", "pm", "full"].map(function (k) {
        var on = mode === "range" ? qm === k : f.quickHours === k;
        return '<button type="button" class="chip' + (on ? " on" : "") + '" data-quick="' + k + '">' + I(TIMES[k][3], "i-xs") + TIMES[k][2] + "</button>";
      }).join("") + "</div>";
      if (mode === "range") {
        when += '<div class="timepair gap">' +
          '<label class="field"><span class="label">开始 <span class="req">*</span></span><input class="input num' + (state.errors.time ? " invalid" : "") + '" name="startTime" type="time" step="300" value="' + esc(f.startTime) + '"></label>' +
          '<span class="to">' + I("arrow-right", "i-sm") + "</span>" +
          '<label class="field"><span class="label">结束 <span class="req">*</span></span><input class="input num' + (state.errors.time ? " invalid" : "") + '" name="endTime" type="time" step="300" value="' + esc(f.endTime) + '"></label></div>' +
          errHtml("time") + (type === "leave" ? quick : "") + previewBoxHtml() +
          '<p class="hint" style="margin-top:8px">' + (type === "leave" ? "只计算落在 08:45–13:00 与 14:00–18:15 内的时间，午休不计。" : "按实际起止时间计算，可跨越 18:15 之后，或在周末。") + "</p>";
      } else {
        when += '<label class="field gap"><span class="label">小时数 <span class="req">*</span></span><span class="input-lead"><span class="lead">' + I("clock") + '</span>' +
          '<input class="input num' + (state.errors.hours ? " invalid" : "") + '" name="hours" id="hours-in" inputmode="decimal" placeholder="例如 2.5" autocomplete="off" value="' + esc(f.hours) + '"><span class="trail hint">小时</span></span>' + errHtml("hours") + "</label>" +
          (type === "leave" ? quick : "") +
          '<p class="hint" style="margin-top:8px">' + (type === "leave" ? "全天 = 8.5 小时，上午 / 下午各 4.25 小时。" : "填写实际加班时长，最小 0.25 小时。") + "</p>";
      }
    }
  }
  when += "</section>";

  var noteReq = isCustom;
  var note = '<section class="card fcard"><div class="fh"><span class="n">3</span>说明' + (noteReq ? "" : '<span class="opt">（选填）</span>') + "</div>" +
    '<label class="field"><span class="label sr-only">说明</span><textarea class="textarea' + (state.errors.note ? " invalid" : "") + '" name="note" id="note-in" maxlength="200" rows="3" placeholder="' +
    (isCustom ? "例如：垫付快递费 3 月 12 日，附发票" : type === "leave" ? "例如：看病、家里有事" : "例如：月底盘点") + '">' + esc(f.note) + "</textarea>" +
    errHtml("note") + '<span class="counter hint num" id="note-count">' + f.note.length + " / 200</span></label></section>";

  return '<header class="appbar"><div class="in"><button type="button" class="back" data-act="home" aria-label="返回">' + I("arrow-left") + "</button>" +
    '<span class="ttl">' + typeHtml(type, false) + title + '</span><span class="r x-tag">无需登录</span></div></header>' +
    '<form class="f-wrap" id="apply-form" novalidate>' + who + when + note + "</form>" +
    '<div class="bbar"><div class="in"><div class="sum" id="bbar-sum">' + bbarSumHtml() + "</div>" +
    '<button type="button" class="btn btn-primary btn-lg btn-block" id="review-btn" data-act="review">' + I("list-checks") + "核对并提交</button></div></div>" +
    (state.confirm ? renderSheet() : "");
}

/** 当前表单对应的“计入”值：小时或金额（null 表示尚不能确定） */
function currentQuantity() {
  var f = state.f;
  if (state.type === "custom") {
    var a = parseMoneyInput(f.amount);
    return isNaN(a) || a <= 0 ? null : { amount: round2(f.sign * a) };
  }
  if (state.hoursMode === "direct") {
    var h = Number(String(f.hours).replace(",", "."));
    return f.hours !== "" && isFinite(h) && h > 0 ? { hours: h } : null;
  }
  return state.preview.status === "ok" && state.preview.hours > 0 ? { hours: state.preview.hours, days: state.preview.days } : null;
}

function bbarSumHtml() {
  var f = state.f;
  var q = currentQuantity();
  var dateTxt = state.hoursMode === "multi-day" && state.type !== "custom" ? shortDate(f.date) + "–" + shortDate(f.endDate) : shortDate(f.date) + " " + weekdayCN(f.date);
  var qty = !q ? '<span style="color:var(--color-text-4)">待填写</span>' :
    q.amount !== undefined ? moneyHtml(q.amount, { sign: true }) : "<b class=\"num\">" + formatHours(q.hours) + " 小时</b>";
  var name = empName();
  return "<span>" + esc(dateTxt) + " · " + qty + "</span><span>" + (name ? I("user-round", "i-xs") + " <b>" + esc(name) + "</b>" : '<span style="color:var(--color-text-4)">未选择申请人</span>') + "</span>";
}

function timeText() {
  var f = state.f;
  if (state.type === "custom") return "";
  if (state.hoursMode === "range") return f.startTime + "–" + f.endTime;
  if (state.hoursMode === "multi-day") return (state.preview.days || []).length + " 个工作日";
  return "直接填写小时";
}

function renderSheet() {
  var f = state.f;
  var q = currentQuantity() || {};
  var type = state.type;
  var month = (f.date || "").slice(0, 7);
  var rows = [
    ["申请人", esc(empName()) + (f.otherName ? ' <span class="tag tag-muted">手填</span>' : "")],
    ["类型", typeHtml(type)],
    [state.hoursMode === "multi-day" && type !== "custom" ? "日期区间" : "日期", '<span class="num">' + esc(state.hoursMode === "multi-day" && type !== "custom" ? f.date + " → " + f.endDate : f.date + " " + weekdayCN(f.date)) + "</span>"]
  ];
  if (type !== "custom") rows.push(["时段", '<span class="num">' + esc(timeText()) + "</span>"]);
  var big = type === "custom" ? ["金额", moneyHtml(q.amount, { sign: true })] : [type === "leave" ? "请假时长" : "加班时长", '<span class="num" style="font-size:20px">' + formatHours(q.hours) + " 小时</span>"];
  var effect = type === "leave" ? "按小时费率从工资中扣除" : type === "overtime" ? "按小时费率 × 1.2 计发" : (q.amount < 0 ? "从工资中扣除" : "随工资一起发放");
  return '<div class="sheet-bg" id="sheet-bg" data-act="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title">' +
    '<div class="grab"></div><div class="sh-h"><h3 id="sheet-title">确认提交</h3><span class="tag tag-pending">' + I("hourglass", "i-xs") + "提交后：待审批</span></div>" +
    '<div class="sum-list">' + rows.map(function (r) { return '<div class="sr"><span>' + r[0] + "</span><b>" + r[1] + "</b></div>"; }).join("") +
    '<div class="sr big"><span>' + big[0] + "</span><b>" + big[1] + "</b></div>" +
    (f.note ? '<div class="sr"><span>说明</span><b style="font-weight:500">' + esc(f.note) + "</b></div>" : "") + "</div>" +
    '<div class="m-note" style="padding:12px 2px 0">' + I("info") + "<span>审批通过后计入 <b>" + esc(formatMonthCN(month)) + "</b> 的结算，" + effect + "。</span></div>" +
    '<div class="sh-btns"><button type="button" class="btn btn-secondary btn-lg" data-act="sheet-close">' + I("pencil", "i-sm") + "返回修改</button>" +
    '<button type="button" class="btn btn-primary btn-lg" id="submit-btn" data-act="submit">' + I("send", "i-sm") + "确认提交</button></div>" +
    "</div></div>";
}

function renderDone() {
  var r = state.justSubmitted;
  return '<div class="done-wrap"><div class="ok-wrap"><div class="ok-badge"><div class="in">' + I("check") + "</div></div>" +
    "<h2>已提交</h2><p>" + (r.count > 1 ? "共 " + r.count + " 条申请，" : "") + "等待管理员审批，通过后计入当月结算。</p></div>" +
    '<div class="card receipt">' +
    '<div class="rr"><span>状态</span><b>' + statusTag("pending") + "</b></div>" +
    '<div class="rr"><span>申请人</span><b>' + esc(r.name) + "</b></div>" +
    '<div class="rr"><span>' + typeHtml(r.type) + "</span><b class=\"num\">" + esc(r.when) + "</b></div>" +
    '<div class="rr"><span>' + (r.type === "custom" ? "金额" : "时长") + "</span><b>" + r.qty + "</b></div>" +
    '<div class="rr"><span>提交时间</span><b class="num">' + esc(r.at) + "</b></div></div>" +
    '<div class="done-btns"><button type="button" class="btn btn-primary btn-lg btn-block" data-act="again">' + I("plus") + "再提交一笔" + esc(TYPE_LABEL[r.type]) + "</button>" +
    '<button type="button" class="btn btn-secondary btn-lg btn-block" data-act="home">' + I("house") + "返回首页</button></div>" +
    '<p class="hint" style="text-align:center;margin-top:16px">如需修改或撤回，请联系管理员。</p></div>';
}

/* ---------------- 工时预览（调用后端 previewHours，规则与结算一致） ---------------- */
var previewSeq = 0;
var previewTimer = null;

function setPreview(p) {
  state.preview = p;
  var box = document.getElementById("preview");
  if (box) box.outerHTML = previewBoxHtml();
  updateBbar();
}

function updateBbar() {
  var el = document.getElementById("bbar-sum");
  if (el) el.innerHTML = bbarSumHtml();
}

function refreshPreview() {
  var f = state.f;
  if (!f || state.type === "custom" || state.hoursMode === "direct") return Promise.resolve();
  var seq = ++previewSeq;
  var req;
  if (state.hoursMode === "multi-day") {
    if (!f.date || !f.endDate) { setPreview({ status: "wait", hours: 0, days: [], text: "请选择开始和结束日期" }); return Promise.resolve(); }
    req = { type: "leave", hoursMode: "multi-day", date: f.date, endDate: f.endDate };
  } else {
    if (!f.startTime || !f.endTime) { setPreview({ status: "wait", hours: 0, days: [], text: "请填写开始和结束时间" }); return Promise.resolve(); }
    req = { type: state.type, startTime: f.startTime, endTime: f.endTime };
  }
  if (state.preview.status !== "ok") setPreview({ status: "wait", hours: 0, days: [], text: "正在计算时长…" });
  return run("previewHours", req).then(function (data) {
    if (seq !== previewSeq) return;
    if (state.hoursMode === "multi-day") {
      if (!data.days || !data.days.length) setPreview({ status: "warn", hours: 0, days: [], text: "所选区间内没有工作日（周一至周五）。" });
      else setPreview({ status: "ok", hours: data.hours, days: data.days, text: "将生成 " + data.days.length + " 条全天请假（每天 8.5 小时）" });
    } else if (data.hours <= 0) {
      setPreview({ status: "warn", hours: 0, days: [], text: state.type === "overtime"
        ? "自动计算时长为 0 小时。请检查结束时间是否晚于开始时间（午休 13:00–14:00 不计入）。"
        : "自动计算时长为 0 小时。请假只统计 08:45–13:00、14:00–18:15；或改用直接填写 / 按日期区间。" });
    } else {
      setPreview({ status: "ok", hours: data.hours, days: [], text: "自动计算时长 · " + f.startTime + "–" + f.endTime + (state.type === "overtime" ? " · 按 ×1.2 计发" : " · 午休不计") });
    }
  }).catch(function (err) {
    if (seq !== previewSeq) return;
    setPreview({ status: "warn", hours: 0, days: [], text: err.message || "无法计算时长" });
  });
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(refreshPreview, 250);
}

/* ---------------- 校验与提交 ---------------- */
function validate() {
  var f = state.f;
  var e = {};
  if (f.otherName ? !f.employeeName.trim() : !f.employeeId) e.employee = f.otherName ? "请填写你的姓名" : "请选择你的姓名";
  if (!f.date) e.date = "请选择日期";
  if (state.type === "custom") {
    var a = parseMoneyInput(f.amount);
    if (!String(f.amount).trim()) e.amount = "请填写金额";
    else if (isNaN(a) || a <= 0) e.amount = "请输入大于 0 的金额，例如 25.50";
    if (!f.note.trim()) e.note = "自定义费用请写明用途";
  } else if (state.hoursMode === "direct") {
    var h = Number(String(f.hours).replace(",", "."));
    if (String(f.hours).trim() === "") e.hours = "请填写小时数";
    else if (!isFinite(h) || h <= 0) e.hours = "小时数需大于 0";
    else if (h > 24) e.hours = "单日不能超过 24 小时";
  } else if (state.hoursMode === "multi-day") {
    if (!f.endDate) e.endDate = "请选择结束日期";
    else if (f.date && f.endDate < f.date) e.endDate = "结束日期不能早于开始日期";
    else if (state.preview.status !== "ok") e.endDate = state.preview.text || "所选区间内没有工作日";
  } else {
    if (!f.startTime || !f.endTime) e.time = "请填写开始和结束时间";
    else if (state.preview.status === "warn") e.time = "时长为 0，请调整时间";
  }
  return e;
}

function buildPayload() {
  var f = state.f;
  var payload = { type: state.type, hoursMode: state.hoursMode };
  if (f.otherName) payload.employeeName = f.employeeName.trim();
  else payload.employeeId = f.employeeId;
  payload.date = f.date;
  if (state.type !== "custom" && state.hoursMode === "multi-day") payload.endDate = f.endDate;
  payload.note = f.note.trim();
  if (state.type === "custom") payload.amount = round2(f.sign * parseMoneyInput(f.amount));
  else if (state.hoursMode === "range") {
    payload.startTime = f.startTime;
    payload.endTime = f.endTime;
  } else if (state.hoursMode === "direct") {
    payload.hours = Number(String(f.hours).replace(",", "."));
  }
  return payload;
}

function review(btn) {
  var go = function () {
    state.errors = validate();
    var keys = Object.keys(state.errors);
    if (keys.length) {
      state.confirm = false;
      render();
      var first = document.querySelector("#apply-form .invalid") || document.getElementById("err-" + keys[0]);
      if (first) {
        first.scrollIntoView({ block: "center", behavior: "smooth" });
        if (first.focus) first.focus({ preventScroll: true });
      }
      toast(state.errors[keys[0]], "err");
      return;
    }
    state.confirm = true;
    Array.prototype.forEach.call(document.querySelectorAll("#toasts .toast.err"), function (t) { t.remove(); });
    render();
    var sb = document.getElementById("submit-btn");
    if (sb) sb.focus();
  };
  // 时间段 / 区间模式：确保预览是最新结果后再核对
  if (state.type !== "custom" && state.hoursMode !== "direct") {
    clearTimeout(previewTimer);
    withButtonBusy(btn, "计算中…", refreshPreview).then(go, go);
  } else go();
}

function submitNow(btn) {
  if (state.submitting) return;
  var payload = buildPayload();
  var name = empName();
  var q = currentQuantity() || {};
  var when = state.type !== "custom" && state.hoursMode === "multi-day" ? state.f.date + " → " + state.f.endDate :
    state.f.date + (state.type !== "custom" && state.hoursMode === "range" ? " " + state.f.startTime + "–" + state.f.endTime : "");
  state.submitting = true;
  withButtonBusy(btn, "提交中…", function () {
    return run("submitApplication", payload).then(function (result) {
      var n = result.count || (result.submissions && result.submissions.length) || 1;
      if (!state.f.otherName) writeLastEmp(state.f.employeeId);
      state.justSubmitted = {
        count: n, type: state.type, name: name, when: when,
        qty: state.type === "custom" ? moneyHtml(payload.amount, { sign: true }) : formatHours(q.hours) + " 小时",
        at: localStamp()
      };
      toast(n > 1 ? "已提交 " + n + " 条请假，等待审批" : "已提交，等待审批", "ok");
      state.submitting = false;
      state.confirm = false;
      state.step = "done";
      render();
      window.scrollTo(0, 0);
    });
  }).catch(function (err) {
    state.submitting = false;
    toast(err.message, "err");
  });
}

function localStamp() {
  var d = new Date();
  var p = function (n) { return (n < 10 ? "0" : "") + n; };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

function startForm(type, keepEmp) {
  state.type = type;
  state.hoursMode = "range";
  state.f = freshForm(type, keepEmp);
  state.errors = {};
  state.confirm = false;
  state.preview = { status: "wait", hours: 0, days: [], text: "正在计算时长…" };
  state.step = "form";
  render();
  window.scrollTo(0, 0);
}

function goHome() {
  state.step = "home";
  state.confirm = false;
  state.justSubmitted = null;
  render();
  window.scrollTo(0, 0);
}

function clearError(key) {
  if (!state.errors[key]) return;
  delete state.errors[key];
  var el = document.getElementById("err-" + key);
  if (el) el.remove();
  var map = { employee: ["employeeId", "employeeName"], time: ["startTime", "endTime"] };
  (map[key] || [key]).forEach(function (n) {
    var inp = document.querySelector('#apply-form [name="' + n + '"]');
    if (inp) inp.classList.remove("invalid");
  });
}

/* ---------------- 事件（全部委托在 #app 上） ---------------- */
function onClick(e) {
  var t = e.target.closest("[data-act],[data-mode],[data-quick],[data-sign]");
  if (!t || state.submitting) return;
  var f = state.f;
  if (t.hasAttribute("data-mode")) {
    state.hoursMode = t.getAttribute("data-mode");
    state.errors = {};
    state.preview = { status: "wait", hours: 0, days: [], text: "正在计算时长…" };
    render();
    return;
  }
  if (t.hasAttribute("data-quick")) {
    var k = t.getAttribute("data-quick");
    if (state.hoursMode === "range") {
      f.startTime = TIMES[k][0];
      f.endTime = TIMES[k][1];
      clearError("time");
    } else {
      f.hours = QUICK_HOURS[k];
      f.quickHours = k;
      clearError("hours");
    }
    render();
    return;
  }
  if (t.hasAttribute("data-sign")) {
    f.sign = Number(t.getAttribute("data-sign"));
    render();
    var am = document.getElementById("amount-in");
    if (am && !f.amount) am.focus();
    return;
  }
  var act = t.getAttribute("data-act");
  if (act === "start") startForm(t.getAttribute("data-type"));
  else if (act === "home") goHome();
  else if (act === "again") startForm(state.justSubmitted ? state.justSubmitted.type : "leave", true);
  else if (act === "pick-list") { f.otherName = false; f.employeeId = ""; render(); }
  else if (act === "review") review(t);
  else if (act === "submit") submitNow(t);
  else if (act === "sheet-close") { state.confirm = false; render(); }
  else if (act === "sheet-bg" && e.target === t) { state.confirm = false; render(); }
}

function onInput(e) {
  var el = e.target;
  var f = state.f;
  if (!f || !el.name) return;
  var n = el.name;
  if (n === "employeeId") {
    if (el.value === "__other__") { f.otherName = true; f.employeeId = ""; clearError("employee"); render(); var ni = document.getElementById("emp-name"); if (ni) ni.focus(); return; }
    f.employeeId = el.value;
    clearError("employee");
  } else if (n === "employeeName") { f.employeeName = el.value; clearError("employee"); }
  else if (n === "note") {
    f.note = el.value;
    clearError("note");
    var c = document.getElementById("note-count");
    if (c) c.textContent = el.value.length + " / 200";
  } else if (n === "amount") { f.amount = el.value; clearError("amount"); }
  else if (n === "hours") {
    f.hours = el.value;
    f.quickHours = null;
    clearError("hours");
    Array.prototype.forEach.call(document.querySelectorAll("[data-quick]"), function (b) { b.classList.toggle("on", QUICK_HOURS[b.getAttribute("data-quick")] === el.value && b.getAttribute("data-quick") === f.quickHours); });
  } else if (n === "date" || n === "endDate" || n === "startTime" || n === "endTime") {
    f[n] = el.value;
    var wd = document.querySelector('[data-wd="' + n + '"]');
    if (wd) wd.textContent = weekdayCN(el.value);
    clearError(n === "startTime" || n === "endTime" ? "time" : n);
    if (n === "startTime" || n === "endTime") {
      var qm = quickMatch();
      Array.prototype.forEach.call(document.querySelectorAll("[data-quick]"), function (b) { b.classList.toggle("on", b.getAttribute("data-quick") === qm); });
    }
    if (n !== "date" || state.hoursMode === "multi-day") schedulePreview();
  }
  updateBbar();
}

function onKey(e) {
  if (e.key === "Escape" && state.confirm && !state.submitting) {
    state.confirm = false;
    render();
    var rb = document.getElementById("review-btn");
    if (rb) rb.focus();
  }
}

function boot() {
  warmupApi();
  var cached = readEmpCache();
  if (cached && cached.length) {
    state.employees = cached;
    state.refreshing = true;
    render();
  } else {
    showLoading("app", "正在加载员工名单…");
  }
  var previous = cached ? cached.slice() : [];
  loadEmployees().then(function () {
    state.refreshing = false;
    setRefreshing(false);
    var mini = document.getElementById("sync-mini");
    if (mini) mini.remove();
    if (!cached || !cached.length) {
      render();
      return;
    }
    if (!sameEmployeeList(previous, state.employees)) {
      if (state.step === "form") { patchEmployeeSelect(); updateBbar(); }
      else if (state.step === "home") render();
    }
  }).catch(function (err) {
    state.refreshing = false;
    setRefreshing(false);
    var mini = document.getElementById("sync-mini");
    if (mini) mini.remove();
    if (state.employees.length) {
      toast(err.message || "名单刷新失败，先使用本地缓存", "err");
    } else {
      showLoadError("app", err.message || "无法连接服务器", boot);
    }
  });
}

(function bindOnce() {
  var app = document.getElementById("app");
  app.addEventListener("click", onClick);
  app.addEventListener("input", onInput);
  app.addEventListener("change", onInput);
  document.addEventListener("keydown", onKey);
})();
boot();
