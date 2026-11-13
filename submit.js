var EMP_CACHE_KEY = "fest7_employees_cache";

var state = {
  employees: [],
  type: "leave",
  hoursMode: "range",
  otherName: false,
  submitting: false,
  justSubmitted: null,
  refreshing: false
};

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

function patchEmployeeSelect() {
  var sel = document.querySelector("#submit-form [name=employeeId]");
  if (!sel) return false;
  var current = sel.value;
  var names = state.employees.map(function (e) {
    return '<option value="' + esc(e.id) + '">' + esc(e.name) + "</option>";
  }).join("");
  sel.innerHTML = '<option value="" disabled>请选择</option>' + names + '<option value="__other__">其他（手填姓名）</option>';
  var found = false;
  var i;
  for (i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === current) { found = true; break; }
  }
  if (found && current) sel.value = current;
  else {
    sel.value = "";
    sel.options[0].selected = true;
  }
  return true;
}

function render() {
  setRefreshing(!!state.refreshing);
  var app = document.getElementById("app");
  if (state.justSubmitted) {
    var n = state.justSubmitted.count || 1;
    var label = TYPE_LABEL[state.justSubmitted.type] || "申请";
    app.innerHTML =
      '<div class="page-intro"><h2>提交申请</h2><p>无需登录。填写姓名与申请内容后提交，等待管理后台审批通过后才会计入当月结算。</p></div>' +
      '<div class="submit-layout"><div class="card card-pad success-panel" role="status">' +
      '<div class="success-mark">✓</div>' +
      "<h3>提交成功</h3>" +
      "<p>" + (n > 1 ? "已提交 " + n + " 条" + label + "，" : "已提交 " + label + "，") +
      "状态为「待审批」。通过后才会进入月度结算。</p>" +
      '<button type="button" class="btn btn-primary" id="submit-again">再提交一笔</button>' +
      "</div>" +
      '<aside class="card side-help"><h3>规则说明</h3><ul>' +
      "<li>工作日为周一至周五；若法定假日落在工作日，仍按普通工作日计算。</li>" +
      "<li>标准工时：08:45–13:00、14:00–18:15，每天 8.5 小时。</li>" +
      "<li>小时费率 = 月基本工资 ÷（当月工作日数 × 8.5）。</li>" +
      "<li>请假按小时费率扣款；加班一律按小时费率 × 1.2 计发（含周末与工作时段外）。</li>" +
      "<li>自定义可正可负：垫付报销、临时补贴为正；扣款为负。</li>" +
      "</ul></aside></div>";
    document.getElementById("submit-again").addEventListener("click", function () {
      state.justSubmitted = null;
      render();
    });
    return;
  }

  var f = state;
  var names = f.employees.map(function (e) {
    return '<option value="' + esc(e.id) + '">' + esc(e.name) + "</option>";
  }).join("");
  var typeBtns = ["leave", "overtime", "custom"].map(function (t) {
    return '<button type="button" data-type="' + t + '" class="' + (f.type === t ? "active" : "") + '">' + TYPE_LABEL[t] + "</button>";
  }).join("");

  var body = "";
  if (f.type === "custom") {
    body =
      '<label class="field">日期<input name="date" type="date" value="' + todayISO() + '" required></label>' +
      '<label class="field">金额（欧元）' +
      '<input name="amount" type="number" step="0.01" placeholder="正数为付给员工，负数为扣款">' +
      '<span class="hint">例如垫付报销、临时补贴填正数；扣款填负数。</span></label>' +
      '<label class="field">说明<input name="note" maxlength="200" placeholder="必填，例如：垫付快递费 / 临时补贴"></label>';
  } else {
    var modes = f.type === "leave"
      ? [["range", "按时间段"], ["direct", "直接填写小时"], ["multi-day", "按日期区间（全天）"]]
      : [["range", "按时间段"], ["direct", "直接填写小时"]];
    if (f.type === "overtime" && f.hoursMode === "multi-day") f.hoursMode = "range";
    var modeBtns = '<div class="seg" id="hours-mode">' + modes.map(function (m) {
      return '<button type="button" data-mode="' + m[0] + '" class="' + (f.hoursMode === m[0] ? "active" : "") + '">' + m[1] + "</button>";
    }).join("") + "</div>";
    if (f.hoursMode === "multi-day") {
      body = modeBtns +
        '<div class="grid-2" style="margin-top:12px">' +
        '<label class="field">开始日期<input name="date" type="date" value="' + todayISO() + '" required></label>' +
        '<label class="field">结束日期<input name="endDate" type="date" value="' + todayISO() + '" required></label>' +
        "</div>" +
        '<div id="hours-preview" class="hours-preview">将按区间内每个工作日（周一至周五）计 8.5 小时。</div>' +
        '<p class="hint">周末自动跳过。例如跨周一至周三，会生成 3 条全天请假，待审批通过后计入结算。</p>' +
        '<label class="field">说明（选填）<input name="note" maxlength="200" placeholder="例如：回家探亲"></label>';
    } else if (f.hoursMode === "range") {
      var hint = f.type === "overtime"
        ? "加班按时段计算时，会计入开始至结束的全部时长，仅扣除午休 13:00–14:00；周末与 18:15 之后同样有效，费率均为 ×1.2。"
        : "请假按时段计算时，只统计工作时段 08:45–13:00 与 14:00–18:15 内的重叠时长，午休不计入。全天请假也可用「按日期区间」。";
      var st = f.type === "overtime" ? "18:15" : "08:45";
      var et = f.type === "overtime" ? "20:15" : "13:00";
      body = modeBtns +
        '<label class="field" style="margin-top:12px">日期<input name="date" type="date" value="' + todayISO() + '" required></label>' +
        '<div class="grid-2">' +
        '<label class="field">开始时间<input name="startTime" type="time" value="' + st + '"></label>' +
        '<label class="field">结束时间<input name="endTime" type="time" value="' + et + '"></label>' +
        "</div>" +
        '<div id="hours-preview" class="hours-preview">自动计算时长…</div>' +
        (f.type === "leave" ? '<div class="row"><button type="button" class="btn btn-ghost btn-sm" id="full-day">填入全天（08:45–18:15，8.5小时）</button></div>' : "") +
        '<p class="hint">' + hint + "</p>" +
        '<label class="field">说明（选填）<input name="note" maxlength="200" placeholder="' + (f.type === "overtime" ? "例如：出货加班" : "例如：上午请假") + '"></label>';
    } else {
      body = modeBtns +
        '<label class="field" style="margin-top:12px">日期<input name="date" type="date" value="' + todayISO() + '" required></label>' +
        '<label class="field">小时小时<input name="hours" type="number" step="0.01" min="0.01" placeholder="例如 4.25 或 8.5"></label>' +
        (f.type === "leave" ? '<div class="row"><button type="button" class="btn btn-ghost btn-sm" id="full-day-h">填入全天 8.5 小时</button></div>' : "") +
        '<label class="field">说明（选填）<input name="note" maxlength="200" placeholder="' + (f.type === "overtime" ? "例如：出货加班" : "例如：上午请假") + '"></label>';
    }
  }

  app.innerHTML =
    '<div class="page-intro"><h2>提交申请' +
    (f.refreshing ? '<span class="sync-indicator"><span class="sync-dot"></span>更新中…</span>' : "") +
    "</h2><p>无需登录。填写姓名与申请内容后提交，等待管理后台审批通过后才会计入当月结算。</p></div>" +
    '<div class="submit-layout"><form class="card card-pad stack" id="submit-form">' +
    '<div class="seg" id="type-seg">' + typeBtns + "</div>" +
    '<label class="field">申请人姓名' +
    (f.otherName
      ? '<input name="employeeName" maxlength="40" placeholder="请输入姓名" required>'
      : '<select name="employeeId" required><option value="" disabled selected>请选择</option>' + names + '<option value="__other__">其他（手填姓名）</option></select>') +
    '<span class="hint">' + (f.otherName ? '<a href="#" id="use-list">改回从名单选择</a>' : "名单来自公司员工表；若不在名单中可选择「其他」。") + "</span></label>" +
    body +
    '<button type="submit" class="btn btn-primary btn-block">提交申请</button>' +
    '<p class="tiny">提交后状态为「待审批」，通过后才会进入月度结算。</p>' +
    "</form>" +
    '<aside class="card side-help"><h3>规则说明</h3><ul>' +
    "<li>工作日为周一至周五；若法定假日落在工作日，仍按普通工作日计算。</li>" +
    "<li>标准工时：08:45–13:00、14:00–18:15，每天 8.5 小时。</li>" +
    "<li>小时费率 = 月基本工资 ÷（当月工作日数 × 8.5）。</li>" +
    "<li>请假按小时费率扣款；加班一律按小时费率 × 1.2 计发（含周末与工作时段外）。</li>" +
    "<li>自定义可正可负：垫付报销、临时补贴为正；扣款为负。</li>" +
    "</ul></aside></div>";
  bind();
}

function refreshPreview(form) {
  var box = document.getElementById("hours-preview");
  if (!box) return Promise.resolve();
  if (state.hoursMode === "multi-day") {
    var date = form.querySelector("[name=date]") && form.querySelector("[name=date]").value;
    var endDate = form.querySelector("[name=endDate]") && form.querySelector("[name=endDate]").value;
    if (!date || !endDate) return Promise.resolve();
    return run("previewHours", { type: "leave", hoursMode: "multi-day", date: date, endDate: endDate }).then(function (data) {
      if (!data.days.length) {
        box.className = "hours-preview warn";
        box.textContent = "所选区间内没有工作日（周一至周五）。";
      } else {
        box.className = "hours-preview";
        box.innerHTML = "将生成 <strong>" + data.days.length + "</strong> 条全天请假，共计 " + formatHours(data.hours) + " 小时。" +
          '<div class="day-chips">' + data.days.map(function (d) { return '<span class="day-chip">' + esc(d) + "</span>"; }).join("") + "</div>";
      }
    }).catch(function (err) {
      box.className = "hours-preview warn";
      box.textContent = err.message;
    });
  }
  var startTime = form.querySelector("[name=startTime]") && form.querySelector("[name=startTime]").value;
  var endTime = form.querySelector("[name=endTime]") && form.querySelector("[name=endTime]").value;
  if (!startTime || !endTime) return Promise.resolve();
  return run("previewHours", { type: state.type, startTime: startTime, endTime: endTime }).then(function (data) {
    if (data.hours <= 0) {
      box.className = "hours-preview warn";
      box.textContent = state.type === "overtime"
        ? "自动计算时长为 0 小时。请检查结束时间是否晚于开始时间（午休 13:00–14:00 不计入）。"
        : "自动计算时长为 0 小时。请假只统计 08:45–13:00、14:00–18:15；或改用直接填写 / 按日期区间。";
    } else {
      box.className = "hours-preview";
      box.textContent = "自动计算时长：" + formatHours(data.hours) + " 小时";
    }
  }).catch(function (err) {
    box.className = "hours-preview warn";
    box.textContent = err.message;
  });
}

function bind() {
  var form = document.getElementById("submit-form");
  Array.prototype.forEach.call(document.querySelectorAll("#type-seg button"), function (b) {
    b.addEventListener("click", function () {
      if (state.submitting) return;
      state.type = b.getAttribute("data-type");
      if (state.type !== "leave" && state.hoursMode === "multi-day") state.hoursMode = "range";
      render();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll("#hours-mode button"), function (b) {
    b.addEventListener("click", function () {
      if (state.submitting) return;
      state.hoursMode = b.getAttribute("data-mode");
      render();
    });
  });
  var empSel = form.querySelector("[name=employeeId]");
  if (empSel) empSel.addEventListener("change", function () {
    if (empSel.value === "__other__") { state.otherName = true; render(); }
  });
  var back = document.getElementById("use-list");
  if (back) back.addEventListener("click", function (e) { e.preventDefault(); state.otherName = false; render(); });
  var fd = document.getElementById("full-day");
  if (fd) fd.addEventListener("click", function () {
    var s = form.querySelector("[name=startTime]");
    var e = form.querySelector("[name=endTime]");
    if (s) s.value = "08:45";
    if (e) e.value = "18:15";
    refreshPreview(form);
  });
  var fdh = document.getElementById("full-day-h");
  if (fdh) fdh.addEventListener("click", function () {
    var h = form.querySelector("[name=hours]");
    if (h) h.value = "8.5";
  });
  ["startTime", "endTime", "date", "endDate"].forEach(function (name) {
    var el = form.querySelector("[name=" + name + "]");
    if (el) el.addEventListener("change", function () { refreshPreview(form); });
  });
  refreshPreview(form);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (state.submitting) return;
    var payload = { type: state.type, hoursMode: state.hoursMode };
    if (state.otherName) payload.employeeName = form.querySelector("[name=employeeName]").value.trim();
    else payload.employeeId = form.querySelector("[name=employeeId]").value;
    var date = form.querySelector("[name=date]");
    if (date) payload.date = date.value;
    var endDate = form.querySelector("[name=endDate]");
    if (endDate) payload.endDate = endDate.value;
    var note = form.querySelector("[name=note]");
    if (note) payload.note = note.value.trim();
    if (state.type === "custom") payload.amount = Number(form.querySelector("[name=amount]").value);
    else if (state.hoursMode === "range") {
      payload.startTime = form.querySelector("[name=startTime]").value;
      payload.endTime = form.querySelector("[name=endTime]").value;
    } else if (state.hoursMode === "direct") {
      payload.hours = Number(form.querySelector("[name=hours]").value);
    }
    var btn = form.querySelector('button[type="submit"]');
    state.submitting = true;
    withButtonBusy(btn, "提交中…", function () {
      return run("submitApplication", payload).then(function (result) {
        var n = result.count || (result.submissions && result.submissions.length) || 1;
        state.justSubmitted = { count: n, type: state.type };
        toast(n > 1 ? "已提交 " + n + " 条请假，等待审批" : "已提交，等待审批", "ok");
        state.submitting = false;
        render();
      });
    }).catch(function (err) {
      state.submitting = false;
      toast(err.message, "err");
    });
  });
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
    var wasRefreshing = state.refreshing;
    state.refreshing = false;
    setRefreshing(false);
    if (!cached || !cached.length || !document.getElementById("submit-form")) {
      render();
      return;
    }
    if (!sameEmployeeList(previous, state.employees)) {
      if (isFormFieldFocused() || state.submitting) patchEmployeeSelect();
      else render();
      return;
    }
    var ind = document.querySelector(".page-intro .sync-indicator");
    if (ind) ind.remove();
  }).catch(function (err) {
    state.refreshing = false;
    setRefreshing(false);
    if (state.employees.length) {
      toast(err.message || "名单刷新失败，先使用本地缓存", "err");
      var ind = document.querySelector(".page-intro .sync-indicator");
      if (ind) ind.remove();
    } else {
      showLoadError("app", err.message || "无法连接服务器", boot);
    }
  });
}
boot();
