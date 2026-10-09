# L'API

L'API sert ce qu'une construction a gelé. Elle lit à travers le port de
stockage, jamais par du SQL à elle.

> [!WARNING]
> **Aucune route n'est protégée.** Aucune ne demande de mot de passe, et
> `DELETE /replays/:id` efface un rejeu entier, irréversiblement. L'API ne doit
> pas être exposée publiquement : elle écoute sur une interface locale, ou
> derrière un accès restreint.

L'API ne porte **aucun en-tête CORS** : l'interface est servie depuis la même
origine, et lui ouvrir une origine tierce n'aurait aucune raison d'être.

## Les routes

| Méthode | Chemin | Réponses |
|---|---|---|
| `GET` | `/health` | `200 { "status": "ok" }` |
| `GET` | `/replays` | `200`, le tableau des manifestes |
| `POST` | `/replays` | `201` · `400` · `500` |
| `GET` | `/replays/:id` | `200` le manifeste · `400` · `404` |
| `DELETE` | `/replays/:id` | `204` sans corps · `400` · `404` · `409` |
| `GET` | `/replays/:id/journal` | `200` en NDJSON · `400` · `404` |
| `GET` | `/replays/:id/progress` | `200` en flux d'événements · `400` · `404` |
| `GET` | `/replays/limits` | `200 { "manualImageBytes": … }` |
| `POST` | `/replays/:id/events` | `201` l'événement · `400` · `404` |
| `PUT` | `/replays/:id/events/:eventId/image` | `201` l'événement · `400` · `404` · `409` · `413` · `415` |
| `GET` | `/replays/:id/media/*path` | `200` les octets · `304` · `400` · `404` |
| `GET` | `/replays/:id/:dataset` | `200` en JSON · `304` · `400` · `404` |

Un identifiant de rejeu qui ne passe pas son schéma rend `400` avant que le
stockage soit touché. Une route inconnue rend `404 no route here`.

## Lancer un rejeu

`POST /replays`, corps JSON, **limite 64 ko**.

| Champ | Contrainte |
|---|---|
| `label` | Chaîne de 200 caractères au plus, sans caractère de contrôle. Nullable |
| `extent` | Emprise en WGS84, contenue dans le territoire du SMMAR. Nullable |
| `period` | `{ from, to }`, deux instants, dans l'ordre |

Le corps est lu par un schéma strict : **un champ que la requête ne connaît pas
la fait refuser**, en nommant ce champ.

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

## Ajouter un événement

`POST /replays/:id/events`, corps JSON, **limite 64 ko**. L'événement est
enregistré comme saisi par un agent (`origin: "manual"`, `category: "report"`).

| Champ | Contrainte |
|---|---|
| `title` | Obligatoire. 120 caractères au plus, espaces de bord retirés, sans caractère de contrôle |
| `from` | Obligatoire. Un instant, dans la période du rejeu |
| `to` | Un instant, ni avant `from` ni hors de la période. Absent ou nul, l'événement est ponctuel |
| `description` | 4 000 caractères au plus. Vide, elle vaut `null` |
| `position` | `{ lon, lat }` en WGS84, dans l'emprise du rejeu, ou dans le territoire du SMMAR pour un rejeu sans emprise |
| `provenance` | `smmar`, `river-syndicate`, `municipality`, `fire-service` ou `individual` |

Le schéma est strict, comme celui d'une création : un champ inconnu fait
refuser la requête, en le nommant. L'identifiant est attribué par la base. La
réponse est `201` avec l'événement, tel que le jeu `events` le rendra ensuite.

Un événement s'ajoute aussi pendant une construction. Celle-ci publie le rejeu
tel qu'elle le tient en mémoire, mais la date de mise à jour du rejeu ne recule
jamais : la plus récente des deux est gardée.

Le premier événement saisi sur un rejeu construit sans la voie Aquasys crée le
jeu `events` : le manifeste l'annonce dès lors. Une reconstruction remplace les
franchissements qu'elle dérive et **ne touche pas aux événements saisis**.

### Joindre une image

`PUT /replays/:id/events/:eventId/image`, l'image en corps brut. La limite vaut
10 Mo, se règle par `MANUAL_IMAGE_MAX_BYTES`, et `GET /replays/limits` la donne en
octets, pour qu'un client refuse une image trop lourde avant d'avoir rien créé.
Au-delà, la réponse est `413`, et son `detail` donne la limite.

Le rejeu et l'événement sont vérifiés **avant** que le corps soit lu : une
image trop lourde envoyée à un événement inconnu rend `404`, pas `413`. Une image que
l'événement n'a finalement pas reçue, parce qu'une autre requête l'a précédée,
est retirée du volume.

- Le format est lu dans les premiers octets, jamais dans le nom ni dans
  `Content-Type` : JPEG, PNG ou WebP, sinon `415`.
- Seul un événement saisi prend une image, et **une seule** : une seconde, ou
  une image sur un franchissement, rend `409`. Une adresse de média est servie
  comme immuable, et la remplacer ferait mentir les caches.
- L'image est rangée sous `manual/<eventId>/`, sous un nom attribué par le
  serveur, et servie par la route des médias.

La réponse est `201` avec l'événement, qui porte le chemin dans `media`.

## Les jeux de données

`GET /replays/:id/:dataset`, où `:dataset` est l'un de :

`events` · `stations` · `thresholds` · `measures` · `reference-layers` ·
`webcams` · `webcam-images` · `radar-rainfall`

Un nom hors de cette liste rend `404 no data set goes by that name`, et le nom
n'est pas répété dans le corps.

### Restreindre ce qu'on demande

| Jeu de données | Filtres acceptés |
|---|---|
| `measures` | `source`, `quantity`, `from`, `to` |
| `reference-layers` | `layer` |
| `webcam-images` | `code` |
| les cinq autres | aucun |

**Un filtre qu'un jeu ne connaît pas rend `400`**, plutôt que d'être ignoré :
servi le jeu entier, un client qui aurait mal orthographié `source` lirait une
station qu'il n'a jamais demandée comme s'il l'avait demandée. Le refus nomme
les filtres acceptés. Un paramètre donné deux fois est refusé, et `from` après
`to` aussi.

### Ce que la présence d'un jeu veut dire

Un jeu qu'aucune voie n'a produit et un jeu collecté vide portent le même nombre
de lignes. Seul le manifeste les sépare, et c'est lui que la route interroge
avant de répondre : un jeu absent du manifeste rend `404`, jamais un tableau
vide.

### Les caches

Les jeux de données sont servis avec `ETag` et
`Cache-Control: public, max-age=0, must-revalidate`, et compressés. Ils ne sont
pas `immutable` : une reconstruction réécrit un jeu sur place, et un événement
saisi change le jeu `events`.

Les médias, eux, sont servis avec `Cache-Control: public, max-age=31536000,
immutable` : une adresse de média, une fois gelée, désigne les mêmes octets pour
de bon.

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
  "detail": "no replay aude-2019-10"
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

## Ce qui n'existe pas encore

Ni administration, ni authentification, ni publication : aucune route ne protège
ni ne restitue ce qui précède. Un événement saisi ne se modifie ni ne se
supprime, et quiconque atteint l'API peut en ajouter.
