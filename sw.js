/* FEST7 考勤 PWA service worker（v11 · 界面 v2）.
 * 静态资源：cache-first，后台更新。
 * script.google.com API（含 POST）走网络，不写入缓存。
 */
var CACHE_VER = "fest7-kaoqin-v11-ui2";
var V = "?v=11";
var PRECACHE = [
  "./",
  "./index.html",
  "./admin.html",
  "./tokens.css" + V,
  "./app.css" + V,
  "./config.js" + V,
  "./icons.js" + V,
  "./utils.js" + V,
  "./api.js" + V,
  "./submit.js" + V,
  "./admin.js" + V,
  "./pwa.js" + V,
  "./fonts/inter-latin.woff2",
  "./logo-white.png",
  "./manifest.webmanifest" + V,
  "./manifest-admin.webmanifest" + V,
  "./favicon.svg" + V,
  "./favicon-32.png" + V,
  "./admin-favicon.svg" + V,
  "./admin-favicon-32.png" + V,
  "./apple-touch-icon.png" + V,
  "./admin-apple-touch-icon.png" + V,
  "./icon-192.png" + V,
  "./admin-icon-192.png" + V,
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./admin-icon-192.png",
  "./admin-icon-512.png",
  "./admin-icon-maskable-512.png"
];

function isApiRequest(url) {
  var host = url.hostname || "";
  return host === "script.google.com" ||
    host.slice(-17) === ".script.google.com" ||
    host.indexOf("googleusercontent.com") !== -1;
}

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_VER).then(function (cache) {
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: "reload" })).catch(function () { /* 单文件失败不阻断安装 */ });
      }));
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        if (key !== CACHE_VER) return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  if (request.method !== "GET" || isApiRequest(url) || url.origin !== self.location.origin) {
    return;
  }

  // 页面（HTML）走网络优先，保证每次打开都是最新版本；离线时才用缓存。
  var isPage = request.mode === "navigate" || /\.html?$/.test(url.pathname) || url.pathname.slice(-1) === "/";
  if (isPage) {
    event.respondWith(
      fetch(new Request(request, { cache: "no-cache" })).then(function (response) {
        if (response && response.ok) {
          var copy = response.clone();
          caches.open(CACHE_VER).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () {
        return caches.open(CACHE_VER).then(function (cache) {
          return cache.match(request, { ignoreSearch: true });
        });
      })
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_VER).then(function (cache) {
      return cache.match(request).then(function (cached) {
        var network = fetch(request).then(function (response) {
          if (response && response.ok) {
            cache.put(request, response.clone());
          }
          return response;
        }).catch(function () {
          return cached;
        });
        return cached || network;
      });
    })
  );
});
