/* FEST7 考勤 PWA service worker.
 * 静态资源：cache-first，后台更新。
 * script.google.com API（含 POST）走网络，不写入缓存。
 */
var CACHE_VER = "fest7-kaoqin-v6";
var PRECACHE = [
  "./",
  "./index.html",
  "./admin.html",
  "./app.css?v=5",
  "./config.js?v=5",
  "./utils.js?v=5",
  "./api.js?v=5",
  "./submit.js?v=5",
  "./admin.js?v=5",
  "./pwa.js?v=5",
  "./manifest.webmanifest",
  "./manifest-admin.webmanifest",
  "./favicon.svg",
  "./favicon-32.png",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
  "./admin-icon-192.png",
  "./admin-icon-512.png",
  "./admin-icon-maskable-512.png",
  "./admin-apple-touch-icon.png",
  "./logo.png"
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
        return cache.add(url).catch(function () { /* 单文件失败不阻断安装 */ });
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
