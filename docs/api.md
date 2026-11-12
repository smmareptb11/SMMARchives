# L'API

L'API sert ce qu'une construction a gelé. Elle lit à travers le port de
stockage, jamais par du SQL à elle.

L'API ne porte **aucun en-tête CORS** : l'interface est servie depuis la même
origine, et lui ouvrir une origine tierce n'aurait aucune raison d'être.

## Les routes

| Méthode | Chemin | Réponses |
|---|---|---|
| `GET` | `/health` | `200 { "status": "ok" }` |
| `GET` | `/session` | `200 { "authenticated": true }` ou `false` |
| `POST` | `/session` | `204` et le cookie de session · `400` · `401` · `413` |
| `DELETE` | `/session` | `204` sans corps |
| `GET` | `/replays` | `200`, le tableau des manifestes |
| `POST` | `/replays` | `201` · `400` · `401` · `413` · `500` |
| `GET` | `/replays/:id` | `200` le manifeste · `400` · `404` |
| `DELETE` | `/replays/:id` | `204` sans corps · `400` · `401` · `404` · `409` |
| `PUT` | `/replays/:id/publication` | `200` le manifeste · `400` · `401` · `404` · `409` |
| `DELETE` | `/replays/:id/publication` | `200` le manifeste · `400` · `401` · `404` |
| `POST` | `/replays/:id/events` | `201` l'événement · `400` · `401` · `404` · `409` · `413` · `415` |
| `PUT` | `/replays/:id/events/:eventId` | `200` l'événement · `400` · `401` · `404` · `409` · `413` · `415` |
| `DELETE` | `/replays/:id/events/:eventId` | `204` sans corps · `400` · `401` · `404` · `409` |
| `GET` | `/replays/:id/journal` | `200` en NDJSON · `400` · `404` |
| `GET` | `/replays/:id/progress` | `200` en flux d'événements · `400` · `404` |
| `GET` | `/replays/:id/media/*path` | `200` les octets · `304` · `400` · `404` |
| `GET` | `/replays/:id/:dataset` | `200` en JSON · `304` · `400` · `404` |

Un identifiant de rejeu qui ne passe pas son schéma rend `400` avant que le
stockage soit touché. Une route inconnue rend `404 no route here`. Toute
requête qui n'est pas une lecture (`GET`, `HEAD`, `OPTIONS`) peut aussi rendre
`403` : voir plus bas.

**Un instant porte son fuseau** : une date et une heure ISO 8601 suivies de `Z`
ou d'un décalage, comme `2019-10-22T06:00:00Z` ou `2019-10-22T08:00+02:00`.
L'API le ramène en UTC. Une heure sans fuseau, ou une date seule, rend `400` :
lue dans le fuseau de la machine, elle désignerait un instant différent d'un
hôte à l'autre.

## La session de l'administrateur

Un seul compte, sans identifiant : le mot de passe dont `ADMIN_PASSWORD_HASH`
tient l'empreinte.

```json
POST /session
{ "password": "…" }
```

Le bon mot de passe rend `204` et pose le cookie `smmarchives_session`,
valable douze heures : `HttpOnly`, `SameSite=Strict`, et `Secure` quand le
reverse proxy annonce HTTPS par `X-Forwarded-Proto`. Un mauvais mot de passe
rend `401`, après une seconde d'attente. Les tentatives passent une à une :
envoyées ensemble, elles s'attendent l'une l'autre, si bien qu'on n'essaie pas
plus d'un mot de passe faux par seconde. `DELETE /session` ferme la session : le
cookie, même conservé, n'ouvre plus rien.

La base ne garde de la session que l'empreinte de son jeton, calculée avec
`SESSION_SECRET` : changer ce secret ferme toutes les sessions.

**Toute requête qui change quelque chose demande cette session**, hormis
l'ouverture et la fermeture de la session elle-même. Sans elle, elle rend `401`
avant toute autre vérification, et la réponse ne dit donc pas si le rejeu
existe — une route inconnue comprise.

**Un changement demandé par un autre site est refusé**, session ou non : une
requête qui n'est pas une lecture et dont l'en-tête `Sec-Fetch-Site` vaut
autre chose que `same-origin` rend `403`, avant même la session.
`SameSite=Strict` ne suffit pas : un sous-domaine voisin est le même site, et
son formulaire emporterait le cookie. Un client qui n'est pas un navigateur
n'envoie pas cet en-tête, et passe.

## Publier un rejeu

**Sans session, un rejeu non publié n'existe pas.** `GET /replays` ne liste que
les rejeux publiés, et toute route de lecture d'un rejeu non publié — manifeste,
jeux de données, médias, journal, progression — rend `404 no replay <id>`, les
mots mêmes d'un rejeu inconnu. L'administrateur voit tout.

`PUT /replays/:id/publication` publie, `DELETE` retire la publication ; toutes
deux rendent le manifeste, dont `publishedAt` porte l'instant de la
publication, absent tant que le rejeu n'est pas publié. Toutes deux sont
idempotentes : publier deux fois garde la première date.

**Seul un rejeu complet se publie.** Un rejeu `running`, `partial` ou `failed`
rend `409`, et le `detail` nomme son état. Un rejeu publié reste modifiable :
l'administrateur y saisit, modifie et supprime ses événements manuels, et peut
le supprimer.

## Lancer un rejeu

`POST /replays`, corps JSON, **limite 64 ko**.

| Champ | Contrainte |
|---|---|
| `label` | Chaîne de 200 caractères au plus, sans caractère de contrôle. Nullable |
| `extent` | Emprise en WGS84, contenue dans le territoire du SMMAR. Nullable |
| `territory` | Le syndicat de bassin sur lequel l'emprise a été cadrée, par son nom court (`Aude Centre`, `Orbieu Jourres`…). Facultatif, et seulement avec une `extent` |
| `period` | `{ from, to }`, deux instants, dans l'ordre |
| `description` | Chaîne de 2 000 caractères au plus ; retours à la ligne et tabulations permis, aucun autre caractère de contrôle. Les blancs autour sont retirés, et une description vide vaut une description absente. Facultatif |
| `phenomenon` | `flood` (crue), `intense-rainfall` (orage, pluie intense), `runoff` (ruissellement), `marine-submersion` (submersion marine), `windstorm` (tempête) ou `other`. Facultatif |
| `severity` | L'échelle des seuils du SMMAR : `vigilance`, `alert`, `reinforced-alert` (alerte renforcée) ou `crisis`. Facultatif |

Le corps est lu par un schéma strict : **un champ que la requête ne connaît pas
la fait refuser**, sans que la réponse le nomme : son nom est le texte du
client, et la réponse n'en répète aucun.

Les trois derniers ne servent qu'à présenter et classer le rejeu : la
construction ne les reçoit pas, et le manifeste les porte tels qu'ils ont été
donnés, ou ne les porte pas.

La réponse est `201`, avec un en-tête `Location` et le manifeste. Le rejeu
existe dès sa création : ce que la réponse attend encore, c'est la nouvelle
qu'une construction n'a **pas pu démarrer du tout** — un jeton manquant, un
volume injoignable — parce que le rejeu qu'elle aurait rempli ne doit pas rester
là, vide. Dans ce cas le rejeu est supprimé et la réponse est `500`.

L'attente est plafonnée, à cinq secondes par défaut.

### Les voies qu'une construction prend

La requête ne choisit pas les sources : **une construction lancée par l'API
prend toutes celles que le serveur est en état de collecter.** Aquasys et le
Lizmap en font partie sans condition, et une configuration qui leur manque est
précisément ce qui donne le `500` ci-dessus.

Les lames d'eau radar font exception : le répertoire des livraisons n'existe
qu'une fois Predict passé, et tant qu'il n'est pas configuré, cette voie n'est
pas prise. Le rejeu se construit sans elle, le manifeste ne porte ni la voie ni
le jeu `radar-rainfall`, et la route de ce jeu rend `404` — voir *Ce que la
présence d'un jeu veut dire*.

## Supprimer un rejeu

`DELETE /replays/:id` rend `204`, ou `409` si une construction est en cours sur
ce rejeu.

Le refus s'appuie sur une réservation, pas sur le manifeste : rien ne peut
démarrer une construction sur ce nom pendant qu'il s'en va. **Ce que le refus ne
promet pas :** le registre des constructions est en mémoire et ne connaît que ce
que cette instance a lancé.

Les lignes partent d'abord, les octets ensuite. Dans l'autre ordre, un rejeu se
listerait avec ses images envolées.

## Saisir un événement

`POST /replays/:id/events`. Un agent y rapporte un fait qu'aucune source n'a
produit : une route coupée, un appel d'une commune.

Le corps prend deux formes :

- **JSON**, limite 64 ko, pour un événement sans photo ;
- **`multipart/form-data`**, pour un événement avec ses photos : d'abord une
  partie `event` portant le même JSON, limite 64 ko, puis de 0 à 10 parties
  `photo`, de 15 Mo chacune au plus. Toute autre partie est refusée.

Tout autre type de corps rend `415`.

| Champ | Contrainte |
|---|---|
| `title` | Chaîne non vide de 200 caractères au plus, sans caractère de contrôle |
| `description` | Chaîne de 5 000 caractères au plus ; tabulations et retours à la ligne admis. Nullable |
| `producerKind` | Qui l'a rapporté — agent SMMAR, commune, SDIS… Chaîne non vide de 100 caractères au plus, sans caractère de contrôle |
| `link` | Une page qui en parle — publication, article, vidéo. Adresse `http` ou `https` de 2 000 caractères au plus. Nullable |
| `from` | Un instant, dans la période du rejeu |
| `to` | Un instant, dans la période du rejeu et pas avant `from`. Nullable : l'événement est alors ponctuel |
| `position` | Un `Point` ou un `Polygon` GeoJSON en WGS84, dans l'emprise du rejeu — le territoire du SMMAR si le rejeu n'en a pas. Une zone est fermée, a une surface — trois sommets distincts, pas tous alignés — et ses côtés ne se croisent pas. Nullable |

Comme pour un rejeu, le schéma est strict : l'identifiant, l'origine et la
catégorie ne s'envoient pas, ils sont fixés par le stockage.

La réponse est `201`, avec l'événement tel que `GET /replays/:id/events` le
servira, horodaté sur l'horloge commune. La version du jeu `events` change, si
bien qu'un client qui tenait la liste d'avant la recharge à sa prochaine
lecture.

`409` dans deux cas : le rejeu est en cours de construction ou de suppression,
ou il n'a pas de jeu `events`, parce que la voie qui le produit a échoué.

Le rejeu n'est réservé que le temps d'écrire l'événement en base, pas pendant
la réception des photos : une saisie dont les photos arrivent ne fait pas
refuser celles des autres agents. Deux écritures qui tombent au même instant,
elles, se refusent encore l'une l'autre par `409`. Les vérifications sont
refaites une fois le rejeu réservé.

### Les photos

Le type d'une photo est lu dans **ses premiers octets**, jamais dans le nom ou
le type que le client lui a donné : JPEG, PNG ou WebP, sinon `415`. Une photo
trop lourde, ou une de trop, rend `413` ; une photo envoyée avant la partie
`event`, `400`.

Chaque photo est rangée sous `field-reports/<uuid>/<n>.<extension>`, un dossier
tiré au hasard à chaque envoi, et l'événement porte ces chemins dans `media`. Elle
se lit ensuite par `GET /replays/:id/media/*path`, avec le même cache que tout
média.

L'événement est jugé avant qu'aucune photo soit écrite : un événement refusé ne
laisse rien derrière lui. **Ce que le refus ne promet pas :** une photo refusée
après d'autres laisse celles déjà écrites sur le volume. Aucun événement ne les
nomme ; elles restent sur le volume jusqu'à la suppression du rejeu.

## Modifier ou supprimer un événement

Seul un événement saisi par un agent se modifie ou se supprime. Un franchissement
est calculé sur les mesures figées : `PUT` et `DELETE` le traitent comme un
identifiant inconnu, et rendent `404`. Le corps d'erreur ne répète pas
l'identifiant demandé.

Le rejeu doit pouvoir recevoir un événement, comme pour une saisie : sinon `409`.

### Modifier

`PUT /replays/:id/events/:eventId` remplace l'événement **en entier** : un
champ omis prend sa valeur par défaut, il ne garde pas l'ancienne. Le corps a
les deux mêmes formes qu'une saisie, et les mêmes règles, avec un champ de plus,
**obligatoire** :

| Champ | Contrainte |
|---|---|
| `media` | Les photos que l'événement garde, parmi les siennes, sans doublon, dans l'ordre voulu |

Les photos envoyées dans le formulaire s'ajoutent après celles qu'il garde. Les
photos qu'il ne garde plus sont effacées du volume, une fois l'événement
modifié.

La réponse est `200`, avec l'événement modifié ; il garde son identifiant.

Si une autre modification a retiré entre-temps une photo que celle-ci garde, la
réponse est `409` : l'événement n'est pas modifié, et les photos envoyées sont
effacées. Le client relit l'événement et renvoie sa modification.

### Supprimer

`DELETE /replays/:id/events/:eventId` rend `204`. La suppression est
définitive, et efface les photos de l'événement.

**Ce que la réponse ne promet pas :** une photo que le volume refuse d'effacer
reste derrière, et l'échec va au journal du serveur. La modification ou la
suppression, elle, est faite.

## Les jeux de données

`GET /replays/:id/:dataset`, où `:dataset` est l'un de :

`events` · `stations` · `thresholds` · `measures` · `measured-stations` ·
`webcams` · `webcam-images` · `radar-rainfall`

`measured-stations` est le tableau des identifiants des stations qui portent au
moins une mesure sur la période : de quoi distinguer une station mesurée sans
franchissement d'une station qui n'a rien mesuré, sans charger les mesures.

Un nom hors de cette liste rend `404 no data set goes by that name`, et le nom
n'est pas répété dans le corps.

### Restreindre ce qu'on demande

| Jeu de données | Filtres acceptés |
|---|---|
| `measures` | `family`, `source`, `quantity`, `from`, `to` |
| `webcam-images` | `code` |
| les six autres | aucun |

**Un filtre qu'un jeu ne connaît pas rend `400`**, plutôt que d'être ignoré :
servi le jeu entier, un client qui aurait mal orthographié `source` lirait une
station qu'il n'a jamais demandée comme s'il l'avait demandée. Le refus nomme
les filtres acceptés. Un paramètre donné deux fois est refusé, et `from` après
`to` aussi. `from` et `to` sont des instants qui portent leur fuseau, même
donnés seuls.

**Une mesure porte sa famille** — `hydro` ou `rain-gauge` — parce que les deux
numérotent leurs sources chacune de leur côté : `source=4` désigne une station
et un pluviomètre, et seul `family` dit lequel.

### Ce que la présence d'un jeu veut dire

Un jeu qu'aucune voie n'a produit et un jeu collecté vide portent le même nombre
de lignes. Seul le manifeste les sépare, et c'est lui que la route interroge
avant de répondre : un jeu absent du manifeste rend `404`, jamais un tableau
vide.

### Les caches

Les jeux de données sont servis avec `ETag` et
`Cache-Control: public, max-age=0, must-revalidate`, et compressés. Ils ne sont
pas `immutable` : une construction en cours remplit ses jeux pendant qu'on les
lit, et les agents modifient les événements d'un rejeu construit.

Les médias, eux, sont servis avec `Cache-Control: public, max-age=31536000,
immutable` : une adresse de média, une fois gelée, désigne les mêmes octets pour
de bon.

**Un rejeu non publié est servi en `private`** à la place de `public`, pour
qu'aucun cache partagé ne garde ce que seul l'administrateur a vu. La liste et
le manifeste, qui dépendent de la session, sont servis en `private, no-cache`.

Une publication retirée ne rappelle pas ce qui a déjà été servi : un média reste
dans le cache d'un visiteur ou d'un proxy jusqu'à son expiration. Un jeu de
données, revalidé à chaque lecture, rend `404` dès le retrait.

## Les médias

`GET /replays/:id/media/*path`. Le chemin est relatif au rejeu ; tout ce qui
sortirait de son répertoire est refusé par `400`, sans que le corps répète le
chemin envoyé.

Le type est déduit de l'extension, parmi celles qu'un gel conserve. Une
extension hors de cette liste est servie en flux d'octets, en pièce jointe.
Tout corps binaire porte `X-Content-Type-Options: nosniff`.

## Suivre une construction

`GET /replays/:id/journal` rend la trace en NDJSON. Le paramètre `since` reprend
à un numéro de ligne ; tout ce qui n'est pas un entier positif vaut 0.

`GET /replays/:id/progress` rend un flux d'événements — `manifest`, `journal`,
`end` — avec un battement toutes les quinze secondes. L'en-tête `Last-Event-ID`
reprend là où le client s'était arrêté. Le flux n'est pas compressé : gzip
retiendrait chaque ligne jusqu'à remplir son tampon.

Ces deux routes ne passent pas par le manifeste : une construction morte avant
d'en publier un est précisément le cas qu'elles servent.

## Les erreurs

Une seule forme, [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457), servie en
`application/problem+json` :

```json
{
  "type": "not-found",
  "title": "Not found",
  "status": 404,
  "detail": "no replay c4a7c5be-73d0-48db-aa17-8be7b314f863"
}
```

`type` est un jeton nu, tant que l'API n'a pas d'URL de documentation. Sur un
refus de schéma, un tableau `refusals` s'ajoute, disant **quel champ** a été
refusé et pourquoi — jamais la valeur envoyée.

**`detail` ne reporte qu'une valeur passée par un des schémas de l'API.** Un
identifiant de rejeu peut y figurer ; un chemin de média, un nom de jeu de
données, la sortie d'erreur d'un processus fils, non. Ce qui ne peut pas être
dit dans la réponse va au journal du serveur.

## Ce que l'API ne fait pas

Elle ne résout aucune donnée en direct pour un rejeu stocké : tout a été gelé à
la génération, seuils compris.
