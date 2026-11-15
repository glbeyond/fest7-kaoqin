/**
 * 调用 Apps Script JSON API。
 * Content-Type 使用 text/plain，避免浏览器发出 CORS 预检；
 * credentials:omit，不携带 Google 登录 Cookie，从而避开多账号无法打开 /exec 的问题。
 */
function run(name) {
  var args = Array.prototype.slice.call(arguments, 1);
  if (!API_URL) {
    return Promise.reject(new Error("未配置 API_URL"));
  }
  return fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action: name, args: args }),
    credentials: "omit",
    redirect: "follow"
  }).then(function (res) {
    if (!res.ok) {
      throw new Error("网络错误（HTTP " + res.status + "），请稍后重试");
    }
    return res.text();
  }).then(function (text) {
    var json;
    try {
      json = JSON.parse(text);
    } catch (err) {
      throw new Error("服务器返回了无法解析的内容，请稍后重试");
    }
    if (!json || json.ok !== true) {
      throw new Error((json && json.error) || "请求失败");
    }
    return json.data;
  }).catch(function (err) {
    if (err && err.message && /请求失败|网络错误|无法解析|未配置|不允许/.test(err.message)) throw err;
    if (err && (err.name === "TypeError" || /Failed to fetch|NetworkError|Load failed/i.test(String(err.message || err)))) {
      throw new Error("网络连接失败，请检查网络后重试");
    }
    throw err instanceof Error ? err : new Error(String(err));
  });
}

/** 轻量 GET 预热，减少随后第一次 POST 的冷启动等待。失败可忽略。 */
function warmupApi() {
  if (!API_URL) return;
  var sep = API_URL.indexOf("?") >= 0 ? "&" : "?";
  fetch(API_URL + sep + "api=1", {
    method: "GET",
    credentials: "omit",
    redirect: "follow"
  }).catch(function () {});
}

/**
 * 页面关闭 / 切到后台时发送（撤销窗口内的待执行操作）。
 * fetch keepalive 允许请求在页面卸载后继续完成；不等待结果。失败时退回 sendBeacon。
 */
function runKeepalive(name) {
  var args = Array.prototype.slice.call(arguments, 1);
  if (!API_URL) return false;
  var body = JSON.stringify({ action: name, args: args });
  try {
    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: body,
      credentials: "omit",
      redirect: "follow",
      keepalive: true
    }).catch(function () {});
    return true;
  } catch (err) {
    try {
      return navigator.sendBeacon(API_URL, new Blob([body], { type: "text/plain;charset=utf-8" }));
    } catch (e) {
      return false;
    }
  }
}
