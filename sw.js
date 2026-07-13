/*
 * Service Worker：对页面导航请求（HTML）采用「网络优先」策略，绕过 GitHub Pages
 * 给 HTML 设定的 `Cache-Control: max-age=600`，解决用户冷启动（关标签页后再打开）
 * 时命中旧 HTML 缓存导致更新滞后的问题。
 *
 * 只拦截导航请求（`request.mode === "navigate"`）：
 *   - 带哈希的 `_next/static/*`、图片等不拦截——文件名随内容变化，HTTP 缓存本就正确高效。
 *   - API 请求不拦截——有各自的鉴权/缓存逻辑。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 下线（自毁）步骤：SW 一旦注册会常驻，直接删除本文件不会让已安装的旧 SW 失效。
 * 若未来要彻底移除 SW，请把本文件内容替换为下面这段自毁脚本并部署一次：
 *
 *   self.addEventListener("install", () => self.skipWaiting());
 *   self.addEventListener("activate", async () => {
 *     await self.registration.unregister();
 *     const keys = await caches.keys();
 *     await Promise.all(keys.map((k) => caches.delete(k)));
 *     const clients = await self.clients.matchAll();
 *     clients.forEach((c) => c.navigate(c.url));
 *   });
 *
 * 同时移除 VersionChecker.tsx 里的 `navigator.serviceWorker.register(...)` 调用。
 * ─────────────────────────────────────────────────────────────────────────────
 */

const HTML_CACHE = "html-cache-v1";

self.addEventListener("install", () => {
  // 新 SW 立即进入 activating，不等旧 SW 释放所有页面。
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 清理非当前版本的缓存，避免旧策略残留。
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== HTML_CACHE).map((k) => caches.delete(k))
      );
      // 立刻接管已打开的页面（否则要等下一次导航才生效）。
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  // 只接管页面导航（打开/刷新页面），其余请求不调用 respondWith，
  // 完全走浏览器默认行为（含正常的 HTTP 缓存）。
  if (request.mode !== "navigate") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(HTML_CACHE);
      try {
        // 网络优先：no-store 强制直连服务器，绕过 HTTP 缓存拿到最新 HTML。
        const fresh = await fetch(request, { cache: "no-store" });
        // 存一份供离线回退（clone，因为响应体只能读一次）。
        cache.put(request, fresh.clone());
        return fresh;
      } catch {
        // 网络失败/离线：回退到上一份缓存的 HTML；连缓存都没有则报网络错误。
        const cached = await cache.match(request);
        return cached ?? Response.error();
      }
    })()
  );
});
