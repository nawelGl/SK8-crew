# Skate Sessions · v1

Une page pour proposer des sessions de skate et dire qui vient. Sans compte : chacun donne juste son prénom, qui reste sur son téléphone.

## Contenu

```
index.html            la page (liste + formulaire)
style.css             le style, mobile d'abord
app.js                la logique (Supabase, temps réel, autocomplétion)
config.js             l'URL et la clé publique de ton projet Supabase
supabase/schema.sql   les tables, la sécurité et les fonctions
```

## Qui peut faire quoi

| Action | Qui |
|---|---|
| Voir les sessions, spots et participants | Tout le monde |
| Proposer une session, rejoindre, ajouter un spot | Tout le monde |
| Quitter une session | La personne qui l'a rejointe, depuis son téléphone |
| Supprimer une session | Son créateur, depuis son téléphone |
| Supprimer un spot, modérer n'importe quoi | Créateur, via le tableau de bord Supabase |

Ça marche avec des **jetons secrets** : quand on crée ou rejoint une session, le serveur renvoie un jeton gardé dans le `localStorage` du téléphone. Sans ce jeton, impossible de supprimer. Les jetons sont dans une table que l'appli ne peut jamais lire.


## Bon à savoir

- Seules les sessions d'aujourd'hui et des jours suivants s'affichent.
- Supprimer un spot ne supprime pas ses sessions : elles s'affichent avec « Spot supprimé ».
- Deux spots ne peuvent pas avoir le même nom (majuscules et minuscules comprises) : si quelqu'un ajoute un spot qui existe déjà, l'appli sélectionne l'existant.
