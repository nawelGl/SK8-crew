// Service worker : tourne en arrière-plan, séparé de la page.
const VERSION = "skate-v1";
const FICHIERS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./config.js",
  "./manifest.json",
  "./icones/icone-192.png",
];

// Installation : on met les fichiers du site en cache
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(FICHIERS)));
  self.skipWaiting();
});

// Activation : on supprime les anciens caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((c) => c !== VERSION).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  );
});

// Requêtes : réseau d'abord (pour toujours avoir la dernière version),
// cache seulement si hors ligne. Les appels à Supabase ne sont pas touchés.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((reponse) => {
        const copie = reponse.clone();
        caches.open(VERSION).then((cache) => cache.put(req, copie));
        return reponse;
      })
      .catch(() => caches.match(req))
  );
});

// Réception d'une notification envoyée par l'Edge Function
self.addEventListener("push", (event) => {
  let data = { titre: "Sessions skate", texte: "Il y a du nouveau." };
  try {
    data = event.data.json();
  } catch {
    /* message vide ou invalide : on garde le texte par défaut */
  }

  event.waitUntil(
    self.registration.showNotification(data.titre, {
      body: data.texte,
      icon: "icones/icone-192.png",
      badge: "icones/badge-96.png",
      tag: data.tag, // une seule notif par session, même si reçue deux fois
      data: { url: self.registration.scope },
    })
  );
});

// Clic sur la notification : on ouvre l'appli (ou on revient dessus si déjà ouverte)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || self.registration.scope;

  event.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const fenetre of fenetres) {
      if (fenetre.url.startsWith(self.registration.scope) && "focus" in fenetre) {
        return fenetre.focus();
      }
    }
    return self.clients.openWindow(url);
  })());
});