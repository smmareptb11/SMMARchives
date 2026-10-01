# Installation

## Prérequis

| Élément | Exigence |
|---|---|
| Node.js | **24 ou plus récent** — `fetch`, `parseArgs` et `--env-file` viennent du runtime |
| npm | Les paquets sont des *workspaces* npm : une seule installation, à la racine |
| PostgreSQL | **17**, avec l'extension **PostGIS** |
| Docker et Docker Compose | Pour la base de développement |

Rien n'est compilé côté serveur : l'API et le worker s'exécutent par `tsx`,
directement depuis les sources TypeScript. `npm run typecheck` ne produit aucun
artefact.

Le compte qui applique le schéma doit pouvoir créer une extension : la première
migration exécute `create extension if not exists postgis`. Le superutilisateur
du conteneur de développement le permet ; une base gérée peut le refuser.

## La base de développement

`docker-compose.yml` ne porte qu'un service, `db` :

| Élément | Valeur |
|---|---|
| Image | `imresamu/postgis:17-3.5-alpine` — un build multi-architecture, l'image officielle n'étant publiée qu'en amd64 |
| Compte, mot de passe, base | `DB_USER`, `DB_PASSWORD`, `DB_NAME` |
| Port publié | `DB_PORT`, par défaut `5432` |
| Volume | `db`, sur le répertoire de données de PostgreSQL |
| Sonde | `pg_isready`, toutes les 5 secondes |

Les images de l'API et du worker ne sont pas écrites : en développement comme
aujourd'hui en production, les deux tournent sur l'hôte.

### Choisir les identifiants

Les trois variables se renseignent dans `.env`, que Docker Compose lit tout
seul. Laissées vides, elles valent `smmarchives` toutes les trois : c'est un
repli de développement, sur une base qui n'écoute que la machine locale, et non
une valeur à emporter ailleurs.

```bash
DB_USER=smmarchives
DB_PASSWORD=<un mot de passe>
DB_NAME=smmarchives
DATABASE_URL=postgres://smmarchives:<le même>@localhost:5432/smmarchives
```

Deux pièges, et le second coûte une demi-heure à qui l'ignore.

- **Rien ne déduit `DATABASE_URL` des trois autres.** L'application ne lit que
  cette chaîne, Docker Compose ne lit que les trois variables, et personne ne
  vérifie qu'elles s'accordent. Les changer d'un côté seulement donne une base
  qui démarre et une application qui ne s'y connecte pas.
- **PostgreSQL n'applique ces identifiants qu'à la création du volume.** Les
  modifier ensuite n'a aucun effet : le conteneur redémarre avec les anciens,
  sans rien dire. Pour qu'un nouveau mot de passe prenne, il faut effacer le
  volume — et ce qu'il contient avec :

  ```bash
  docker compose down -v   # efface la base, rejeux compris
  docker compose up -d db
  npm run migrate
  ```

## Les variables d'environnement

Toute la configuration passe par l'environnement. **Aucun secret n'est
versionné.** `.env.sample` en tient la version commentée ; les commandes `npm run`
la lisent par `--env-file-if-exists=.env`, à la racine du dépôt.

Une variable présente mais vide vaut une variable absente : elle est refusée de
la même façon.

| Variable | Statut | Défaut | Lue par |
|---|---|---|---|
| `DATABASE_URL` | obligatoire | — | API, migrations, `build:replay` |
| `MEDIA_PATH` | obligatoire | — | API, `build:replay` |
| `ACYCLIQ_API_URL` | obligatoire | — | `build:replay` |
| `ACYCLIQ_TOKEN` | obligatoire | — | idem |
| `AQUASYS_TIME_ZONE` | optionnelle | `UTC` | idem |
| `LIZMAP_BASE_URL` | obligatoire | — | `build:replay` |
| `RADAR_RAINFALL_PATH` | optionnelle : vide, un rejeu se construit sans les lames d'eau | — | `build:replay`, et donc l'API |
| `RADAR_RAINFALL_BBOX` | optionnelle | une emprise fixée dans le code | idem |
| `API_PORT` | optionnelle | `3000` | API, et le serveur de développement pour savoir où relayer |
| `WEB_PORT` | optionnelle | `5180` | Serveur de développement |
| `DATABASE_URL_TEST` | obligatoire pour `npm test` | — | Suites de stockage et de routes |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | optionnelles | `smmarchives` | **Docker Compose seul** |
| `DB_PORT` | optionnelle | `5432` | **Docker Compose seul** |

Trois précisions que le tableau ne peut pas porter.

- **Les quatre variables `DB_*` n'ont aucun effet sur l'applicatif.** Elles ne
  règlent que le conteneur de développement. L'application ne lit que
  `DATABASE_URL`, et la changer d'un seul côté casse la connexion sans que rien
  ne le signale.
- **Une valeur invalide est refusée par qui la lit, jamais corrigée.** Un
  `API_PORT` qui n'est pas un entier de 1 à 65535 arrête l'API à son démarrage,
  en se nommant : un port coercé en `NaN` donnerait une API qui écoute ailleurs
  et ne dit pas pourquoi. Un `AQUASYS_TIME_ZONE` qui n'est pas un fuseau IANA et
  un `RADAR_RAINFALL_BBOX` malformé arrêtent de même la construction qui les
  lit — mais **pas** le démarrage de l'API, qui ne les lit pas : l'erreur se
  voit alors au premier rejeu lancé, sous la forme d'une construction qui n'a
  pas pu démarrer.
- **Les adresses des sources ne sont pas versionnées.** `ACYCLIQ_API_URL` et
  `LIZMAP_BASE_URL` se renseignent auprès de l'exploitant des services
  concernés. Le jeton Aquasys est un secret : ni versionné, ni journalisé, ni
  placé dans une URL, et son renouvellement se fait par configuration.

## Mise en route

```bash
git clone <dépôt> && cd SMMARchives
npm install
cp .env.sample .env
docker compose up -d db
npm run migrate
npm run dev:api      # port 3000
npm run dev:web      # port 5180, dans un second terminal
```

**Ces six commandes se suivent telles quelles** : `.env.sample` porte déjà, pour
`DATABASE_URL` et `MEDIA_PATH`, des valeurs qui s'accordent avec le conteneur de
développement. Il n'y a rien à renseigner avant d'obtenir une interface qui
s'affiche. Les variables des sources ne sont exigées qu'au moment de constituer
un rejeu, et elles sont à renseigner avant le premier.

Le répertoire des médias est créé à la demande ; le chemin est résolu en absolu.

L'API échoue au démarrage sur une configuration incomplète : elle imprime le nom
de la variable et la raison sur la sortie d'erreur, puis rend 1. Pas de pile à
lire.

Le serveur de développement **échoue si son port est pris**, plutôt que de
glisser sur le suivant : l'adresse est ce qu'un onglet, une capture d'écran et
un rapport de bug nomment tous les trois.

## Le schéma et ses migrations

Le schéma est une suite de fichiers SQL numérotés sous `migrations/`, appliqués
par :

```bash
npm run migrate
```

La commande n'applique que ce que la base n'a pas encore vu — une table
`schema_migration` en tient le registre — et traite **chaque fichier dans sa
propre transaction** : une migration qui échoue laisse la base sur la dernière
qui a fonctionné, pas au milieu de celle-ci. Elle est donc rejouable sans
risque, et c'est la première chose à lancer après une mise à jour.

Elle écrit `nothing to apply` ou `applied <noms>` sur la sortie d'erreur, et
rend 0. Le retour arrière d'une migration n'est pas écrit.

## Servir l'interface

`npm run build:web` produit un paquet de fichiers statiques dans
`packages/web/dist/`.

**L'interface n'appelle que des chemins relatifs** : rien en elle ne sait où
vit l'API. Le reverse proxy a donc trois obligations, sur une seule origine :

1. servir `dist/` ;
2. relayer `/replays` et `/health` vers l'API ;
3. **rendre `index.html` pour tout chemin qui ne correspond à aucun fichier.**

La troisième est celle qu'on oublie, et elle ne se voit pas tout de suite.
L'interface tient trois adresses — `/` la liste des rejeux, `/nouveau` la
création, `/rejeux/<identifiant>` un rejeu — et elle passe de l'une à l'autre
sans demander la page au serveur. Le serveur ne voit `/nouveau` et
`/rejeux/<identifiant>` qu'au rechargement et sur un lien partagé : sans ce
repli, ce sont exactement ces deux cas qui rendent 404, alors que tout paraît
fonctionner par ailleurs. Sous nginx :

```nginx
location /assets { }                      # un fichier absent rend 404
location /       { try_files $uri /index.html; }
```

**Le repli s'arrête au répertoire des fichiers construits.** Appliqué à
`/assets` aussi, il rendrait `index.html` — et un `200` en HTML — pour un
fichier que la construction n'a pas produit : le navigateur refuse alors une
ressource dont il attendait autre chose, sans que rien ne dise laquelle
manquait. Une ligne pour que l'absence reste une absence.

Le serveur de développement reproduit les trois obligations, le repli compris.

L'API ne porte aucun en-tête CORS et n'a pas à en porter. Servir l'interface
depuis un autre hôte demanderait de l'ouvrir à une origine tierce, ce qu'il n'y
a aucune raison de faire.

> [!WARNING]
> L'avertissement d'exposition vaut aussi pour l'interface : elle n'ajoute
> aucune protection, elle appelle les mêmes routes, ouvertes.

## Faire tourner l'API

L'API se lance depuis le dépôt complet, dépendances de développement
installées :

```bash
npm run dev:api
```

Ce n'est pas une facilité de développement. Pour construire un rejeu, l'API
lance un processus fils, et elle résout son interpréteur et son script **par
rapport au dépôt** : un déploiement empaqueté avec `--omit=dev` n'a ni l'un ni
l'autre, et toute construction échouerait à démarrer.

Deux autres propriétés à connaître avant de déployer :

- **Le registre des constructions en cours est en mémoire.** Il ne connaît que
  ce que cette instance a lancé. Deux instances d'API ne se coordonneraient pas,
  et le refus de supprimer un rejeu en cours de construction ne protégerait rien
  entre elles. Une seule instance, donc.
- **Une construction est détachée.** Un redémarrage de l'API ne tue pas une
  collecte qui dure des minutes ; sa trace est le journal du rejeu, pas ce
  processus.

## Hébergement

L'application se déploie sur un hôte dont l'exploitant garde la maîtrise. Elle
n'appelle aucun service d'hébergement tiers, à l'exception du fond de carte.

Prérequis sur l'hôte cible :

- Linux ;
- Docker et Docker Compose ;
- un reverse proxy HTTPS, avec nom de domaine et certificat ;
- un volume persistant pour les médias et les rasters ;
- une base PostgreSQL avec l'extension PostGIS.

### Dimensionnement du stockage

Le gel fait de chaque rejeu une copie complète : le volume croît à chaque
nouveau rejeu.

| Élément | Poids mesuré |
|---|---|
| Mesures d'un rejeu de 3 jours, 94 stations, hauteur et débit | ~19 Mo de JSON |
| Une livraison de lames d'eau de 7 à 9 jours, non recadrée | 580 à 700 Mo |
| La même livraison recadrée sur l'emprise du bassin | quelques Mo |

### Sauvegarde

La base et le volume des médias sont à **sauvegarder ensemble**. Ce n'est pas
une précaution générale : la base porte l'index des médias — ce qu'une image
est, quand elle a été prise, d'où elle vient — et le volume porte les octets.
Restaurés à deux dates différentes, ils donnent un rejeu qui se liste, s'ouvre,
et dont les images manquent sans que rien ne le signale.

La fréquence des sauvegardes et leur vérification relèvent de l'exploitant.

### Suppression d'un rejeu

Une suppression efface les lignes du rejeu, puis son répertoire de médias. Dans
cet ordre : un rejeu disparu de la base cesse aussitôt d'être listé, et ce qui
resterait sur le volume n'est plus référencé par rien. Un effacement de médias
qui n'aboutit pas est journalisé au moment où il se produit, et laisse un
répertoire orphelin qui pèse ce que pesait le rejeu — à chercher lors d'un
contrôle de volume.

## Les tests

```bash
docker compose up -d db
npm test
```

`npm test` **refuse de démarrer sans `DATABASE_URL_TEST`**, et le dit avec la
commande qui répare. Chaque fichier de test migre un schéma qui lui est propre,
si bien que les fichiers tournant en parallèle ne se vident pas les tables : la
même base que le développement convient.

`npm run test:unit` ne lance que les suites qui n'ont besoin de rien.

Sous root, quatre cas qui retirent une permission se sautent d'eux-mêmes, et le
résumé les compte : **un run en conteneur root n'est pas un run complet.**

## Ce qui n'est pas écrit

- Les images Docker de l'API et du worker, et la procédure de déploiement qui
  irait avec.
- La supervision, l'arrêt propre et le redémarrage de l'API : il n'y a ni
  gestion de `SIGTERM`, ni sonde applicative autre que `GET /health`.
- La procédure de sauvegarde et de restauration, le retour arrière d'une
  migration, la rotation des journaux.
- Toute protection d'accès. Ni administration, ni authentification, ni
  publication.
