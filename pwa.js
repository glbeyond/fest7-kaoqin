(function () {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function () { /* 离线或无权限时忽略 */ });
    });
  }

  var DISMISS_KEY = "fest7_pwa_hint_dismissed";
  var deferredPrompt = null;
  var hintTimer = null;

  function isStandalone() {
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
    if (window.navigator.standalone === true) return true;
    return false;
  }

  function isIosSafari() {
    var ua = window.navigator.userAgent || "";
    var iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var webkit = /WebKit/.test(ua) && !/CriOS|FxiOS|OPiOS|EdgiOS|Android/.test(ua);
    return iOS && webkit;
  }

  function dismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === "1"; } catch (err) { return false; }
  }

  function dismiss() {
    try { localStorage.setItem(DISMISS_KEY, "1"); } catch (err) { /* ignore */ }
    hideHint();
  }

  function hideHint() {
    var el = document.getElementById("pwa-hint");
    if (el) el.hidden = true;
  }

  function showHint(mode) {
    if (isStandalone() || dismissed()) return;
    var el = document.getElementById("pwa-hint");
    if (!el) return;
    var text = el.querySelector(".pwa-hint-text");
    var installBtn = el.querySelector("#pwa-install");
    if (mode === "ios") {
      if (text) text.textContent = "在 Safari 点底部分享按钮，再选择「添加到主屏幕」。";
      if (installBtn) installBtn.hidden = true;
    } else {
      if (text) text.textContent = "安装到桌面，打开更方便。";
      if (installBtn) installBtn.hidden = false;
    }
    el.hidden = false;
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferredPrompt = e;
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { showHint("android"); }, 1800);
  });

  window.addEventListener("appinstalled", function () {
    deferredPrompt = null;
    dismiss();
  });

  function onReady(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }
  onReady(function () {
    var el = document.getElementById("pwa-hint");
    if (!el) return;
    var installBtn = document.getElementById("pwa-install");
    var dismissBtn = document.getElementById("pwa-dismiss");
    if (dismissBtn) dismissBtn.addEventListener("click", dismiss);
    if (installBtn) {
      installBtn.addEventListener("click", function () {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        Promise.resolve(deferredPrompt.userChoice).then(function () {
          deferredPrompt = null;
        }).catch(function () {});
      });
    }
    if (isIosSafari() && !isStandalone() && !dismissed()) {
      hintTimer = setTimeout(function () { showHint("ios"); }, 2200);
    }
  });
})();
