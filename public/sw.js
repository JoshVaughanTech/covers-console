/* ============================================================
   Service worker — the only thing that runs when the app is shut.

   Plain JS in public/ rather than anything built: a service worker
   is fetched by URL and must be served from the site root to control
   the whole scope, and a bundler is one more thing between a browser
   and a file it caches aggressively.

   Deliberately small. Everything it needs is in the push payload,
   because the alternative is fetching on wake — which needs the
   session cookie, may be offline, and turns a notification into a
   request that can fail silently.
   ============================================================ */

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* Anything undecodable still shows something. A push that arrives and
       renders nothing is worse than a vague one: the browser counts it as
       delivered and some platforms revoke permission from apps that receive
       pushes without notifying. */
  }

  const title = data.title || "New shift";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "A shift you can take has been posted.",
      // one tag per posting: a second push about the same shift replaces the
      // first rather than stacking two identical rows on a lock screen
      tag: data.postingId ? `shift-${data.postingId}` : "shift",
      data: { postingId: data.postingId || null },
      icon: "/icon.png",
      badge: "/icon.png",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  /* Focus a tab that is already open rather than opening a second one.
     Somebody who taps a notification while the app is open in the background
     expects the app, not another copy of it. */
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
      for (const client of all) {
        if (client.url.includes("/m/shifts") && "focus" in client) return client.focus();
      }
      return self.clients.openWindow("/m/shifts");
    }),
  );
});
