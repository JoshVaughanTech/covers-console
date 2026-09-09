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

  /* Open the shift this notification is about.

     The id has been in the payload since push was built and was thrown away
     here, because until /m/shifts/[id] existed the board was the only address
     there was. So "Bartender · Fri, 28 Aug" woke a phone and then handed over
     a list to search — which is worst exactly when it matters most, on a busy
     board where the shift somebody was told about is hardest to find.

     Falling back to the board when there is no id: a notification that opens
     nothing is worse than one that opens something general. */
  const id = event.notification.data && event.notification.data.postingId;
  const url = id ? "/m/shifts/" + encodeURIComponent(id) : "/m/shifts";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((all) => {
      for (const client of all) {
        if (client.url.includes("/m/shifts") && "focus" in client) {
          /* Focus AND navigate. Focusing alone would surface a tab still
             showing the board — dropping the one thing this notification
             knew. navigate() can reject (a client this worker does not
             control), so a failure still leaves them on the app rather than
             on nothing. */
          if ("navigate" in client) {
            return client.navigate(url).then(
              (c) => (c || client).focus(),
              () => client.focus(),
            );
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
