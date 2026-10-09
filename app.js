import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_CLE, VAPID_CLE_PUBLIQUE, EN_DEV } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_CLE);

// En dev, la page passe en rose (voir « Thème de la version dev » dans style.css)
if (EN_DEV) document.documentElement.classList.add("dev");
const $ = (id) => document.getElementById(id);

/* =========================================================
   Stockage local (prénom + jetons secrets)
   ========================================================= */
// La dev et la prod sont sur le même domaine (nawelgl.github.io), donc partagent
// le même stockage local : on préfixe les clés en dev pour ne jamais les mélanger.
const PREFIXE = EN_DEV ? "dev." : "";
const CLES = {
  prenom: `${PREFIXE}skate.prenom`,
  participations: `${PREFIXE}skate.participations`, // { sessionId: { id, jeton } }
  creations: `${PREFIXE}skate.creations`,           // { sessionId: jeton }
  abonnement: `${PREFIXE}skate.abonnement`,         // id de l'abonnement push de ce téléphone
  encartMasque: `${PREFIXE}skate.encartMasque`,     // dernier encart que la personne a fermé
};
const stock = {
  lire(cle, defaut) {
    try {
      const v = localStorage.getItem(cle);
      return v === null ? defaut : JSON.parse(v);
    } catch {
      return defaut;
    }
  },
  ecrire(cle, valeur) {
    try {
      localStorage.setItem(cle, JSON.stringify(valeur));
    } catch {
      /* navigation privée ou stockage plein : on continue sans */
    }
  },
};

let prenom = stock.lire(CLES.prenom, "");
let participations = stock.lire(CLES.participations, {});
let creations = stock.lire(CLES.creations, {});
let sessions = [];
let spots = [];
let spotChoisi = null;

function sauverJetons() {
  stock.ecrire(CLES.participations, participations);
  stock.ecrire(CLES.creations, creations);
}

/* =========================================================
   Utilitaires
   ========================================================= */
function aujourdhui() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function dateLocale(iso) {
  const [a, m, j] = iso.split("-").map(Number);
  return new Date(a, m - 1, j);
}
const fmtJour = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const fmtMois = new Intl.DateTimeFormat("fr-FR", { month: "short" });
const fmtLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const sansPoint = (t) => t.replace(".", "");
const formatHeure = (h) => h.slice(0, 5).replace(":", "h");
const normaliser = (t) => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// Crée un élément en mettant le texte via textContent (protège des injections HTML)
function el(tag, props = {}, ...enfants) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of enfants.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
}

const ICONES = {
  horloge: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
  plus: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  route: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M12 19h4.5a3.5 3.5 0 0 0 0-7h-8a3.5 3.5 0 0 1 0-7H12"/></svg>',
  croix: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  crayon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  repere: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
};

// Lien vers l'appli de cartes du téléphone : Plans sur iPhone, Google Maps ailleurs
function lienCarte(spot) {
  const recherche = encodeURIComponent([spot.nom, spot.adresse].filter(Boolean).join(", "));
  const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return iphone
    ? `https://maps.apple.com/?q=${recherche}`
    : `https://www.google.com/maps/search/?api=1&query=${recherche}`;
}
function icone(nom) {
  const s = document.createElement("span");
  s.className = "ico";
  s.setAttribute("aria-hidden", "true");
  s.innerHTML = ICONES[nom]; // contenu fixe, pas de donnée utilisateur
  return s;
}

let minuteurToast;
function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(minuteurToast);
  minuteurToast = setTimeout(() => (t.hidden = true), 3500);
}

// Désactive un bouton pendant une action réseau
async function pendant(bouton, action) {
  if (bouton.disabled) return;
  bouton.disabled = true;
  try {
    await action();
  } finally {
    bouton.disabled = false;
  }
}

/* =========================================================
   Prénom
   ========================================================= */
function afficherPrenom() {
  $("prenom-affiche").textContent = prenom ? `${prenom} · changer` : "Ton prénom";
}

function demanderPrenom() {
  return new Promise((resolve) => {
    const dialogue = $("dialog-prenom");
    const form = $("form-prenom");
    const champ = $("d-prenom");
    const annuler = $("d-annuler");
    champ.value = prenom;

    const terminer = (valeur) => {
      form.removeEventListener("submit", valider);
      annuler.removeEventListener("click", fermer);
      dialogue.removeEventListener("cancel", fermer);
      dialogue.close();
      resolve(valeur);
    };
    const valider = (e) => {
      e.preventDefault();
      const v = champ.value.trim();
      if (!v) return champ.focus();
      prenom = v;
      stock.ecrire(CLES.prenom, v);
      afficherPrenom();
      terminer(v);
    };
    const fermer = (e) => {
      e.preventDefault();
      terminer(null);
    };

    form.addEventListener("submit", valider);
    annuler.addEventListener("click", fermer);
    dialogue.addEventListener("cancel", fermer);
    dialogue.showModal();
    champ.focus();
  });
}

async function assurerPrenom() {
  return prenom || (await demanderPrenom());
}

/* =========================================================
   Sessions
   ========================================================= */
async function chargerSessions() {
  const { data, error } = await supabase
    .from("sessions")
    .select("id, date, heure, heure_fin, propose_par, balade, arrivee, description, annulee_le, spot:spots(id, nom, adresse, type), participants(id, prenom, statut, heure_arrivee, created_at)")
    .gte("date", aujourdhui())
    .order("date")
    .order("heure");

  $("etat-chargement").hidden = true;
  if (error) {
    console.error(error);
    toast("Impossible de charger les sessions. Vérifie ta connexion.");
    return;
  }
  sessions = data;
  nettoyerJetons();
  afficherSessions();
}

// Oublie les jetons des sessions passées ou des participations supprimées
function nettoyerJetons() {
  const ids = new Set(sessions.map((s) => s.id));
  for (const [sid, part] of Object.entries(participations)) {
    const s = sessions.find((x) => x.id === sid);
    if (!s || !s.participants.some((p) => p.id === part.id)) delete participations[sid];
  }
  for (const sid of Object.keys(creations)) {
    if (!ids.has(sid)) delete creations[sid];
  }
  sauverJetons();
}

function afficherSessions() {
  const liste = $("liste-sessions");
  liste.replaceChildren(...sessions.map(carteSession));
  $("liste-vide").hidden = sessions.length > 0;

  // « Voir plus » n'apparaît que si la description dépasse deux lignes
  for (const desc of liste.querySelectorAll(".description-session")) {
    desc.nextElementSibling.hidden = desc.scrollHeight <= desc.clientHeight + 1;
  }
}

// Version réduite et grisée d'une session annulée : on la voit encore jusqu'à minuit,
// pour comprendre qu'elle a été annulée plutôt que croire à un bug
function carteAnnulee(s) {
  const d = dateLocale(s.date);
  const spotNom = s.spot?.nom ?? (s.balade ? "Départ supprimé" : "Spot supprimé");
  const titre = s.balade && s.arrivee ? `${spotNom} → ${s.arrivee}` : spotNom;
  const plage = s.heure_fin ? `${formatHeure(s.heure)} – ${formatHeure(s.heure_fin)}` : formatHeure(s.heure);
  const lieu = s.spot && (s.balade ? `Départ : ${s.spot.adresse || s.spot.nom}` : s.spot.adresse);

  return el("article", { class: "carte carte-annulee" },
    el("div", { class: "carte-haut" },
      el("div", { class: "bloc-date", "aria-hidden": "true" },
        el("span", { class: "bloc-date-petit" }, sansPoint(fmtJour.format(d))),
        el("span", { class: "bloc-date-num" }, d.getDate()),
        el("span", { class: "bloc-date-petit" }, sansPoint(fmtMois.format(d))),
      ),
      el("div", { class: "infos" },
        el("span", { class: "sr" }, fmtLong.format(d)),
        el("span", { class: "badge-annulee" }, icone("croix"), s.balade ? "Balade annulée" : "Session annulée"),
        el("h2", { class: "spot" }, titre),
        el("span", { class: "meta" }, icone("horloge"), plage),
        lieu && el("span", { class: "meta" }, icone("repere"), lieu),
        el("span", { class: "auteur" }, `Proposée par ${s.propose_par}`),
      ),
    ),
  );
}

function carteSession(s) {
  if (s.annulee_le) return carteAnnulee(s);
  const d = dateLocale(s.date);
  const maPart = participations[s.id];
  const estAujourdhui = s.date === aujourdhui();

  // Tri : ceux qui sont là dès le début d'abord, puis par heure d'arrivée
  const gens = [...s.participants]
    .sort((a, b) => (a.heure_arrivee || "").localeCompare(b.heure_arrivee || "")
      || a.created_at.localeCompare(b.created_at))
    .map((p) => {
      const moi = Boolean(maPart && p.id === maPart.id);
      return { nom: moi ? "Toi" : p.prenom, moi, statut: p.statut || "dispo", arrivee: p.heure_arrivee };
    });
  const monArrivee = gens.find((g) => g.moi)?.arrivee ?? null;
  const dispos = gens.filter((g) => g.statut === "dispo");
  const pasDispos = gens.filter((g) => g.statut === "pas_dispo");
  const maReponse = gens.find((g) => g.moi)?.statut ?? null; // "dispo", "pas_dispo" ou null

  const spotNom = s.spot?.nom ?? (s.balade ? "Départ supprimé" : "Spot supprimé");
  const titre = s.balade && s.arrivee ? `${spotNom} → ${s.arrivee}` : spotNom;
  const plage = s.heure_fin ? `${formatHeure(s.heure)} – ${formatHeure(s.heure_fin)}` : formatHeure(s.heure);
  const meta = [estAujourdhui ? "Aujourd'hui" : null, plage]
    .filter(Boolean)
    .join(" · ");

  const boutons = el("div", { class: "boutons-reponse" },
    el("button", {
      type: "button", class: maReponse === "dispo" ? "bouton-reponse viens actif" : "bouton-reponse viens",
      "aria-pressed": String(maReponse === "dispo"),
      onclick: (e) => pendant(e.currentTarget, () => repondre(s, "dispo", maReponse)),
    }, maReponse === "dispo" && icone("check"), maReponse === "dispo" ? "J'y vais" : "Je viens"),
    el("button", {
      type: "button", class: maReponse === "pas_dispo" ? "bouton-reponse pas-dispo actif" : "bouton-reponse pas-dispo",
      "aria-pressed": String(maReponse === "pas_dispo"),
      onclick: (e) => pendant(e.currentTarget, () => repondre(s, "pas_dispo", maReponse)),
    }, maReponse === "pas_dispo" && icone("croix"), "Pas dispo"),
  );

  const groupe = (titre, liste, classe, nomIcone) => liste.length > 0 && el("div", { class: "groupe-reponses" },
    el("span", { class: "titre-groupe" }, `${titre} (${liste.length})`),
    el("div", { class: "pastilles" },
      liste.map((g) => el("span", { class: `pastille ${classe}${g.moi ? " moi" : ""}` },
        icone(nomIcone), g.nom,
        g.arrivee && el("span", { class: "pastille-arrivee" }, icone("horloge"), `dès ${formatHeure(g.arrivee)}`),
      ))),
  );

  return el("article", { class: "carte" },
    el("div", { class: "carte-haut" },
      el("div", { class: estAujourdhui ? "bloc-date aujourdhui" : "bloc-date", "aria-hidden": "true" },
        el("span", { class: "bloc-date-petit" }, sansPoint(fmtJour.format(d))),
        el("span", { class: "bloc-date-num" }, d.getDate()),
        el("span", { class: "bloc-date-petit" }, sansPoint(fmtMois.format(d))),
      ),
      el("div", { class: "infos" },
        el("span", { class: "sr" }, fmtLong.format(d)),
        s.balade && el("span", { class: "badge-balade" }, icone("route"), "Balade"),
        el("h2", { class: "spot" }, titre),
        el("span", { class: "meta" }, icone("horloge"), meta),
        s.spot && el("div", { class: "ligne-adresse" },
          el("a", {
            class: "lien-carte", href: lienCarte(s.spot), target: "_blank", rel: "noopener",
            "aria-label": `Ouvrir ${s.spot.nom} dans les cartes`,
          }, icone("repere"),
            s.balade ? `Départ : ${s.spot.adresse || s.spot.nom}` : (s.spot.adresse || "Voir sur la carte")),
        ),
        el("span", { class: "auteur" }, `Proposée par ${s.propose_par}`),
      ),
    ),
    s.description && el("p", { class: "description-session" }, s.description),
    s.description && el("button", {
      type: "button", class: "voir-plus", "aria-expanded": "false",
      onclick: (e) => {
        const desc = e.currentTarget.previousElementSibling;
        const ouverte = desc.classList.toggle("ouverte");
        e.currentTarget.textContent = ouverte ? "Voir moins" : "Voir plus";
        e.currentTarget.setAttribute("aria-expanded", String(ouverte));
      },
    }, "Voir plus"),
    el("div", { class: "reponses" },
      dispos.length === 0 && el("span", { class: "compte" }, "Personne de dispo pour l'instant"),
      groupe("Dispo", dispos, "dispo", "check"),
      groupe("Pas dispo", pasDispos, "pas-dispo", "croix"),
    ),
    boutons,
    maReponse === "dispo" && zoneArrivee(s, monArrivee),
    creations[s.id] && el("div", { class: "actions-createur" },
      el("button", { type: "button", class: "bouton-lien bouton-modifier",
        onclick: () => ouvrirModification(s) },
        icone("crayon"), "Modifier"),
      el("button", { type: "button", class: "bouton-lien",
        onclick: (e) => pendant(e.currentTarget, () => supprimerSession(s)) },
        "Annuler la session"),
    ),
  );
}

/* ---------- « J'arrive plus tard » ---------- */

// Sessions dont l'encart de saisie est ouvert (gardé entre deux rafraîchissements)
const arriveesEnEdition = new Set();

function zoneArrivee(s, monArrivee) {
  const debut = s.heure.slice(0, 5);
  const fin = s.heure_fin ? s.heure_fin.slice(0, 5) : null;

  if (arriveesEnEdition.has(s.id)) {
    const idChamp = `arrivee-${s.id}`;
    const champ = el("input", {
      id: idChamp, type: "time", class: "champ-arrivee", min: debut, max: fin,
      value: monArrivee ? monArrivee.slice(0, 5) : "",
    });
    const message = el("p", { class: "aide" },
      fin ? `Entre ${formatHeure(debut)} et ${formatHeure(fin)}.` : `Après ${formatHeure(debut)}.`);

    const valider = async (e) => {
      const v = champ.value;
      if (!v || v <= debut || (fin && v >= fin)) {
        message.textContent = fin
          ? `Choisis une heure après ${formatHeure(debut)} et avant ${formatHeure(fin)}.`
          : `Choisis une heure après ${formatHeure(debut)}.`;
        message.className = "aide aide-erreur";
        return champ.focus();
      }
      await pendant(e.currentTarget, () => enregistrerArrivee(s, v));
    };

    return el("div", { class: "zone-arrivee" },
      el("label", { for: idChamp, class: "titre-zone-arrivee" }, "J'arrive à partir de"),
      el("div", { class: "ligne-arrivee" },
        champ,
        el("button", { type: "button", class: "bouton-sombre bouton-ok", onclick: valider }, "OK"),
      ),
      message,
      el("button", { type: "button", class: "bouton-discret", onclick: () => {
        arriveesEnEdition.delete(s.id);
        afficherSessions();
      } }, "Annuler"),
    );
  }

  const ouvrir = () => {
    arriveesEnEdition.add(s.id);
    afficherSessions();
    document.getElementById(`arrivee-${s.id}`)?.focus();
  };

  if (monArrivee) {
    return el("div", { class: "liens-arrivee" },
      el("button", { type: "button", class: "lien-arrivee", onclick: ouvrir },
        icone("horloge"), `J'arrive à ${formatHeure(monArrivee)} · modifier`),
      el("button", { type: "button", class: "bouton-discret",
        onclick: (e) => pendant(e.currentTarget, () => enregistrerArrivee(s, null)) },
        "J'arrive à l'heure"),
    );
  }
  return el("button", { type: "button", class: "lien-arrivee", onclick: ouvrir },
    icone("horloge"), "J'arrive plus tard ?");
}

async function enregistrerArrivee(s, heure) {
  const part = participations[s.id];
  const { data, error } = await supabase.rpc("modifier_arrivee", {
    p_id: part.id, p_jeton: part.jeton, p_heure: heure,
  });
  if (error || data === false) {
    console.error(error);
    toast("Impossible d'enregistrer ton heure d'arrivée.");
    return;
  }
  arriveesEnEdition.delete(s.id);
  toast(heure ? `C'est noté, tu arrives à ${formatHeure(heure)}.` : "C'est noté, tu arrives à l'heure.");
  await chargerSessions();
}

// Clic sur « Je viens » ou « Pas dispo » :
// même bouton que la réponse actuelle → on retire sa réponse ;
// autre bouton → on change de réponse ; aucune réponse → on répond.
async function repondre(s, statut, reponseActuelle) {
  if (reponseActuelle === statut) return quitter(s);
  if (reponseActuelle) {
    const retire = await quitter(s, { recharger: false });
    if (!retire) return;
  }
  await rejoindre(s, statut);
}

async function rejoindre(s, statut = "dispo") {
  const p = await assurerPrenom();
  if (!p) return;
  const { data, error } = await supabase.rpc("rejoindre_session", {
    p_session: s.id, p_prenom: p, p_statut: statut,
    p_abonnement: stock.lire(CLES.abonnement, null), // pour que le créateur soit prévenu
  });
  if (error) {
    console.error(error);
    toast("Impossible de rejoindre cette session.");
    return;
  }
  const r = data[0];
  participations[s.id] = { id: r.nouvel_id, jeton: r.nouveau_jeton };
  sauverJetons();
  await chargerSessions();
}

async function quitter(s, { recharger = true } = {}) {
  const part = participations[s.id];
  const { data, error } = await supabase.rpc("quitter_session", { p_id: part.id, p_jeton: part.jeton });
  if (error || data === false) {
    console.error(error);
    toast("Impossible de modifier ta réponse.");
    return false;
  }
  delete participations[s.id];
  sauverJetons();
  if (recharger) await chargerSessions();
  return true;
}

async function supprimerSession(s) {
  if (!confirm("Annuler cette session ? Les personnes inscrites seront prévenues.")) return;
  const { data, error } = await supabase.rpc("supprimer_session", { p_id: s.id, p_jeton: creations[s.id] });
  if (error || data === false) {
    console.error(error);
    toast("Impossible d'annuler cette session.");
    return;
  }
  delete creations[s.id];
  delete participations[s.id];
  sauverJetons();
  toast("Session annulée. Les inscrits sont prévenus.");
  await chargerSessions();
}

/* =========================================================
   Spots et autocomplétion
   ========================================================= */
async function chargerSpots() {
  const { data, error } = await supabase.from("spots").select("id, nom, adresse, type").order("nom");
  if (error) return console.error(error);
  spots = data;
}

function fermerSuggestions() {
  $("suggestions").hidden = true;
  $("f-spot").setAttribute("aria-expanded", "false");
}

// Type de lieu attendu par le formulaire : départ pour une balade, spot sinon
const typeLieu = () => ($("f-balade").checked ? "depart" : "spot");
const lieuxDuType = () => spots.filter((sp) => (sp.type || "spot") === typeLieu());
const motLieu = () => (typeLieu() === "depart" ? "départ" : "spot");

function majSuggestions() {
  const champ = $("f-spot");
  const tape = champ.value.trim();
  const q = normaliser(tape);
  const lieux = lieuxDuType();
  const resultats = q
    ? lieux.filter((sp) => normaliser(sp.nom).includes(q) || normaliser(sp.adresse).includes(q))
    : lieux;
  const existeDeja = q && lieux.some((sp) => normaliser(sp.nom) === q);

  const boite = $("suggestions");
  boite.replaceChildren(
    ...resultats.slice(0, 6).map((sp) =>
      el("div", { class: "suggestion-ligne" },
        el("button", { type: "button", class: "suggestion", role: "option", onclick: () => choisirSpot(sp) },
          el("span", { class: "suggestion-nom" }, sp.nom),
          sp.adresse && el("span", { class: "suggestion-adresse" }, sp.adresse),
        ),
        boutonCorriger(sp),
      )),
  );
  if (q && resultats.length === 0) {
    boite.append(el("p", { class: "suggestion-vide" }, `Aucun ${motLieu()} connu ne correspond.`));
  }
  if (!existeDeja) {
    boite.append(el("button", { type: "button", class: "suggestion suggestion-ajout", onclick: ouvrirNouveauSpot },
      icone("plus"),
      tape ? `Ajouter « ${tape} » comme nouveau ${motLieu()}` : `Ajouter un nouveau ${motLieu()}`));
  }
  boite.hidden = false;
  champ.setAttribute("aria-expanded", "true");
}

function choisirSpot(sp) {
  spotChoisi = sp;
  $("f-spot").value = sp.nom;
  fermerSuggestions();
  const info = $("spot-choisi");
  const connu = sp.type === "depart" ? "Départ connu" : "Spot connu";
  info.replaceChildren(icone("check"), sp.adresse ? `${connu} · ${sp.adresse}` : connu, boutonCorriger(sp));
  info.hidden = false;
  $("erreur-form").hidden = true;
}

function ouvrirNouveauSpot() {
  fermerSuggestions();
  $("ns-nom").value = $("f-spot").value.trim();
  $("ns-adresse").value = "";
  $("nouveau-spot").hidden = false;
  ($("ns-nom").value ? $("ns-adresse") : $("ns-nom")).focus();
}

async function ajouterSpot() {
  const nom = $("ns-nom").value.trim();
  const adresse = $("ns-adresse").value.trim();
  if (!nom) return $("ns-nom").focus();

  const { data, error } = await supabase.rpc("ajouter_spot", { p_nom: nom, p_adresse: adresse, p_type: typeLieu() });
  if (error) {
    console.error(error);
    toast(`Impossible d'ajouter ce ${motLieu()}.`);
    return;
  }
  const sp = Array.isArray(data) ? data[0] : data;
  const existait = spots.some((x) => x.id === sp.id);
  if (!existait) {
    spots.push(sp);
    spots.sort((a, b) => a.nom.localeCompare(b.nom, "fr"));
  }
  $("nouveau-spot").hidden = true;
  choisirSpot(sp);
  toast(existait ? `Ce ${motLieu()} existait déjà, il est sélectionné.` : (typeLieu() === "depart" ? "Départ ajouté." : "Spot ajouté."));
}

/* =========================================================
   Correction de l'adresse d'un spot
   ========================================================= */
function boutonCorriger(spot) {
  return el("button", {
    type: "button", class: "bouton-crayon",
    "aria-label": `Corriger l'adresse de ${spot.nom}`, title: "Corriger l'adresse",
    onclick: () => corrigerAdresse(spot),
  }, icone("crayon"));
}

// Ouvre la fenêtre et renvoie le spot mis à jour (ou null si annulé)
function fenetreAdresse(spot) {
  return new Promise((resolve) => {
    const dialogue = $("dialog-adresse");
    const form = $("form-adresse");
    const champ = $("a-adresse");
    const annuler = $("a-annuler");
    const erreur = $("a-erreur");
    $("a-spot").textContent = spot.nom;
    champ.value = spot.adresse || "";
    erreur.hidden = true;

    const terminer = (valeur) => {
      form.removeEventListener("submit", valider);
      annuler.removeEventListener("click", fermer);
      dialogue.removeEventListener("cancel", fermer);
      dialogue.close();
      resolve(valeur);
    };
    const valider = async (e) => {
      e.preventDefault();
      const adresse = champ.value.trim();
      if (!adresse) return champ.focus();

      const bouton = $("a-valider");
      bouton.disabled = true;
      const { data, error } = await supabase.rpc("modifier_adresse_spot", {
        p_spot: spot.id, p_adresse: adresse, p_prenom: prenom,
      });
      bouton.disabled = false;

      if (error) {
        console.error(error);
        erreur.textContent = "L'adresse n'a pas pu être enregistrée. Réessaie dans un instant.";
        erreur.hidden = false;
        return;
      }
      terminer(Array.isArray(data) ? data[0] : data);
    };
    const fermer = (e) => {
      e.preventDefault();
      terminer(null);
    };

    form.addEventListener("submit", valider);
    annuler.addEventListener("click", fermer);
    dialogue.addEventListener("cancel", fermer);
    dialogue.showModal();
    champ.focus();
    champ.select();
  });
}

async function corrigerAdresse(spot) {
  // Le prénom est enregistré dans l'historique des corrections
  const p = await assurerPrenom();
  if (!p) return;

  const majSpot = await fenetreAdresse(spot);
  if (!majSpot) return;

  const i = spots.findIndex((x) => x.id === majSpot.id);
  if (i >= 0) spots[i] = majSpot;
  if (spotChoisi?.id === majSpot.id) choisirSpot(majSpot);

  if (!$("suggestions").hidden || !spotChoisi) majSuggestions();
  toast("Adresse mise à jour, merci !");
  await chargerSessions();
}

/* =========================================================
   Formulaire de session
   ========================================================= */
// Adapte le formulaire selon que la case « Balade » est cochée ou non
function majModeBalade() {
  const balade = $("f-balade").checked;
  $("aide-type").textContent = balade
    ? "Un départ, une potentielle arrivée et un itinéraire street."
    : "Un lieu, une heure, une session.";
  $("label-spot").textContent = balade ? "Départ" : "Spot";
  $("f-spot").placeholder = balade ? "Commence à taper un lieu de départ…" : "Commence à taper un spot…";
  $("suggestions").setAttribute("aria-label", balade ? "Départs de balade" : "Spots");
  $("champ-arrivee").hidden = !balade;
  $("ns-titre").textContent = balade ? "Nouveau départ" : "Nouveau spot";
  $("ns-label-nom").textContent = balade ? "Nom du lieu de départ" : "Nom du spot";
  $("ns-aide").textContent = balade
    ? "Il sera proposé à tout le crew pour les prochaines balades."
    : "Il sera proposé à tout le crew pour les prochaines sessions.";
  $("ns-nom").placeholder = balade ? "Ex. Métro Bastille" : "Ex. Skatepark couvert";

  // Le lieu choisi n'est plus du bon type : on le retire
  if (spotChoisi && (spotChoisi.type || "spot") !== typeLieu()) {
    spotChoisi = null;
    $("f-spot").value = "";
    $("spot-choisi").hidden = true;
  }
  $("nouveau-spot").hidden = true;
  fermerSuggestions();
}

function majCompteur() {
  $("compteur-description").textContent = `${$("f-description").value.length} / 280`;
}

// Session en cours de modification (null = on crée une nouvelle session)
let sessionEnEdition = null;

function preparerFormulaire() {
  const edition = Boolean(sessionEnEdition);
  $("titre-form").textContent = edition ? "Modifier la session" : "Nouvelle session";
  $("btn-publier").textContent = edition ? "Enregistrer les modifications" : "Publier la session";
  $("champ-pseudo").hidden = edition; // le créateur ne change pas

  const date = $("f-date");
  date.min = aujourdhui();
  if (!date.value) date.value = aujourdhui();
  if (!$("f-pseudo").value) $("f-pseudo").value = prenom;
}

function ouvrirModification(s) {
  reinitialiserFormulaire();
  sessionEnEdition = s;
  $("f-date").value = s.date;
  $("f-heure").value = s.heure.slice(0, 5);
  $("f-heure-fin").value = s.heure_fin ? s.heure_fin.slice(0, 5) : "";
  $("f-balade").checked = Boolean(s.balade);
  $("f-type-spot").checked = !s.balade;
  majModeBalade();
  $("f-arrivee").value = s.arrivee || "";
  $("f-description").value = s.description || "";
  majCompteur();
  const spot = s.spot && (spots.find((sp) => sp.id === s.spot.id) || s.spot);
  if (spot) choisirSpot(spot);
  location.hash = "modifier";
}

function reinitialiserFormulaire() {
  $("form-session").reset();
  majCompteur();
  sessionEnEdition = null;
  spotChoisi = null;
  $("spot-choisi").hidden = true;
  $("nouveau-spot").hidden = true;
  $("erreur-form").hidden = true;
  majModeBalade(); // la case Balade revient décochée
}

function afficherErreur(message) {
  const e = $("erreur-form");
  e.textContent = message;
  e.hidden = false;
}

async function publier() {
  const date = $("f-date").value;
  const heure = $("f-heure").value;
  const heureFin = $("f-heure-fin").value; // vide si non renseignée
  const pseudo = $("f-pseudo").value.trim();
  const balade = $("f-balade").checked;
  const arrivee = balade ? $("f-arrivee").value.trim() : "";
  const description = $("f-description").value.trim();

  // Si le nom tapé correspond exactement à un lieu connu du bon type, on le prend
  if (!spotChoisi) {
    const q = normaliser($("f-spot").value);
    spotChoisi = lieuxDuType().find((sp) => normaliser(sp.nom) === q) || null;
  }

  const erreur =
    !date ? "Choisis une date." :
    date < aujourdhui() ? "Cette date est déjà passée." :
    !heure ? "Choisis une heure de début." :
    heureFin && heureFin <= heure ? "L'heure de fin doit être après le début." :
    !spotChoisi ? `Choisis un ${motLieu()} dans la liste, ou ajoute-le comme nouveau ${motLieu()}.` :
    !pseudo && !sessionEnEdition ? "Indique ton prénom." :
    null;
  if (erreur) return afficherErreur(erreur);

  const extras = { balade, arrivee, description };
  if (sessionEnEdition) return enregistrerModification(date, heure, heureFin, extras);

  const { data, error } = await supabase.rpc("creer_session", {
    p_date: date, p_heure: heure, p_spot: spotChoisi.id, p_propose_par: pseudo,
    p_abonnement: stock.lire(CLES.abonnement, null), // pour ne pas se notifier soi-même
    p_heure_fin: heureFin || null,
    p_balade: balade, p_arrivee: arrivee || null, p_description: description || null,
  });
  if (error) {
    console.error(error);
    return afficherErreur("La session n'a pas pu être publiée. Réessaie dans un instant.");
  }
  const r = data[0];
  creations[r.nouvel_id] = r.nouveau_jeton;

  if (!prenom) {
    prenom = pseudo;
    stock.ecrire(CLES.prenom, pseudo);
    afficherPrenom();
  }

  // Le créateur rejoint automatiquement sa session
  const rej = await supabase.rpc("rejoindre_session", {
    p_session: r.nouvel_id, p_prenom: pseudo,
    p_abonnement: stock.lire(CLES.abonnement, null),
  });
  if (!rej.error) {
    participations[r.nouvel_id] = { id: rej.data[0].nouvel_id, jeton: rej.data[0].nouveau_jeton };
  }
  sauverJetons();

  reinitialiserFormulaire();
  location.hash = "";
  toast(balade ? "Balade publiée, le crew la voit déjà." : "Session publiée, le crew la voit déjà.");
  await chargerSessions();
}

async function enregistrerModification(date, heure, heureFin, { balade, arrivee, description }) {
  const s = sessionEnEdition;
  const { data, error } = await supabase.rpc("modifier_session", {
    p_id: s.id, p_jeton: creations[s.id],
    p_date: date, p_heure: heure, p_heure_fin: heureFin || null, p_spot: spotChoisi.id,
    // Texte vide = effacer l'arrivée ou la description
    p_balade: balade, p_arrivee: arrivee, p_description: description,
  });
  if (error || data === false) {
    console.error(error);
    return afficherErreur("La session n'a pas pu être modifiée. Réessaie dans un instant.");
  }
  reinitialiserFormulaire();
  location.hash = "";
  toast("Session modifiée. Les inscrits sont prévenus.");
  await chargerSessions();
}

/* =========================================================
   Navigation entre les deux vues
   ========================================================= */
function afficherVue() {
  // Après un rechargement de page, la session à modifier est perdue : retour à la liste
  if (location.hash === "#modifier" && !sessionEnEdition) {
    location.hash = "";
    return;
  }
  // En quittant le formulaire de modification sans enregistrer, on l'oublie
  if (location.hash !== "#modifier" && sessionEnEdition) reinitialiserFormulaire();

  const formulaire = location.hash === "#proposer" || location.hash === "#modifier";
  $("vue-liste").hidden = formulaire;
  $("vue-formulaire").hidden = !formulaire;
  window.scrollTo(0, 0);
  if (formulaire) preparerFormulaire();
}

/* =========================================================
   Temps réel
   ========================================================= */
let minuteurRechargement;
function rechargerBientot() {
  clearTimeout(minuteurRechargement);
  minuteurRechargement = setTimeout(chargerSessions, 300);
}

supabase
  .channel("crew")
  .on("postgres_changes", { event: "*", schema: "public", table: "sessions" }, rechargerBientot)
  .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, rechargerBientot)
  .on("postgres_changes", { event: "*", schema: "public", table: "spots" }, () => {
    chargerSpots();
    rechargerBientot(); // les cartes de session affichent aussi l'adresse
  })
  .subscribe();

// Sur mobile, la connexion temps réel peut se couper en arrière-plan : on recharge au retour
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    chargerSessions();
    chargerSpots();
    majNotifs(); // la personne a pu changer l'autorisation dans les réglages
  }
});

/* =========================================================
   Notifications push
   ========================================================= */
const ua = navigator.userAgent;
const estIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const dansInstagram = /Instagram|FBAN|FBAV/i.test(ua);
const estInstallee = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const pushDispo = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
  && !VAPID_CLE_PUBLIQUE.startsWith("TA_");

const ENCARTS = {
  instagram: {
    titre: "Ouvre le lien dans ton navigateur",
    detail: "Menu ⋯ en haut à droite, puis « Ouvrir dans le navigateur ». Tu pourras y installer l'appli et activer les notifs.",
  },
  "installer-ios": {
    titre: "Installe l'appli pour les notifs",
    detail: "Dans Safari : bouton Partager, puis « Sur l'écran d'accueil ». Ouvre ensuite l'appli depuis son icône.",
  },
  "a-activer": {
    titre: "Ne rate aucune session",
    detail: "Reçois une notif dès qu'une session est proposée.",
    bouton: true,
  },
  bloquees: {
    titre: "Notifs bloquées",
    detail: "Réactive-les dans les réglages de ton navigateur ou de ton téléphone pour être prévenu des nouvelles sessions.",
  },
};

// Convertit la clé VAPID (texte base64url) dans le format attendu par le navigateur
function cleVersOctets(base64url) {
  const base64 = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

async function abonnementActuel() {
  if (!pushDispo) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function etatNotifs() {
  if (dansInstagram) return "instagram";
  if (estIOS && !estInstallee) return "installer-ios";
  if (!pushDispo) return "indisponible";
  if (Notification.permission === "denied") return "bloquees";
  const sub = await abonnementActuel();
  return sub && Notification.permission === "granted" ? "actives" : "a-activer";
}

async function majNotifs() {
  const etat = await etatNotifs();
  const encart = ENCARTS[etat];
  const masque = stock.lire(CLES.encartMasque, null) === etat;

  $("encart-notifs").hidden = !encart || masque;
  if (encart) {
    $("encart-titre").textContent = encart.titre;
    $("encart-detail").textContent = encart.detail;
    $("btn-notifs").hidden = !encart.bouton;
  }
  $("ligne-notifs").hidden = etat !== "actives";
}

// Envoie l'abonnement à Supabase et retient son id
async function enregistrerAbonnement(sub) {
  const { endpoint, keys } = sub.toJSON();
  const { data, error } = await supabase.rpc("enregistrer_abonnement", {
    p_endpoint: endpoint, p_p256dh: keys.p256dh, p_auth: keys.auth,
  });
  if (error) throw error;
  stock.ecrire(CLES.abonnement, data);
}

async function activerNotifs() {
  // La demande d'autorisation doit suivre un clic : c'est le cas ici
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return majNotifs();

  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: cleVersOctets(VAPID_CLE_PUBLIQUE),
      }));
    await enregistrerAbonnement(sub);
    toast("Notifs activées. Tu seras prévenu des nouvelles sessions.");
  } catch (erreur) {
    console.error(erreur);
    toast("Impossible d'activer les notifs pour l'instant.");
  }
  await majNotifs();
}

async function desactiverNotifs() {
  const sub = await abonnementActuel();
  if (sub) {
    await supabase.rpc("supprimer_abonnement", { p_endpoint: sub.endpoint });
    await sub.unsubscribe();
  }
  stock.ecrire(CLES.abonnement, null);
  toast("Notifs désactivées.");
  await majNotifs();
}

// Au lancement : on renvoie l'abonnement existant à Supabase,
// au cas où il aurait changé ou été nettoyé entre-temps
async function synchroniserAbonnement() {
  if (!pushDispo || Notification.permission !== "granted") return;
  const sub = await abonnementActuel();
  if (sub) await enregistrerAbonnement(sub).catch(console.error);
}

async function demarrerNotifs() {
  if ("serviceWorker" in navigator) {
    await navigator.serviceWorker.register("sw.js").catch(console.error);
  }
  await majNotifs();
  synchroniserAbonnement();
}

/* =========================================================
   Branchements
   ========================================================= */
$("btn-prenom").addEventListener("click", demanderPrenom);
$("btn-proposer").addEventListener("click", () => (location.hash = "proposer"));
$("btn-retour").addEventListener("click", () => (location.hash = ""));
window.addEventListener("hashchange", afficherVue);

$("form-session").addEventListener("submit", (e) => {
  e.preventDefault();
  pendant($("btn-publier"), publier);
});

const champSpot = $("f-spot");
champSpot.addEventListener("input", () => {
  spotChoisi = null;
  $("spot-choisi").hidden = true;
  majSuggestions();
});
champSpot.addEventListener("focus", majSuggestions);
champSpot.addEventListener("keydown", (e) => {
  if (e.key === "Escape") fermerSuggestions();
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".champ-spot")) fermerSuggestions();
});

$("ns-annuler").addEventListener("click", () => {
  $("nouveau-spot").hidden = true;
  champSpot.focus();
});
$("ns-ajouter").addEventListener("click", (e) => pendant(e.currentTarget, ajouterSpot));

// Les deux boutons du sélecteur de type
for (const radio of document.querySelectorAll('input[name="type-session"]')) {
  radio.addEventListener("change", majModeBalade);
}
$("f-description").addEventListener("input", majCompteur);

$("btn-notifs").addEventListener("click", (e) => pendant(e.currentTarget, activerNotifs));
$("btn-desactiver").addEventListener("click", (e) => pendant(e.currentTarget, desactiverNotifs));
$("btn-encart-fermer").addEventListener("click", async () => {
  stock.ecrire(CLES.encartMasque, await etatNotifs());
  $("encart-notifs").hidden = true;
});

/* =========================================================
   Démarrage
   ========================================================= */
afficherPrenom();
afficherVue();
chargerSpots();
chargerSessions();
demarrerNotifs();