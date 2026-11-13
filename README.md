# SMMARchives

Outil de retour d'expérience (RETEX) inondation du **SMMAR — EPTB Aude**.

## Présentation

SMMARchives permet de **rejouer un épisode de crue passé** sur une emprise
géographique et une période choisies. À partir de ces deux paramètres,
l'application interroge les systèmes de surveillance existants, met les données
en cohérence sur une chronologie commune, et restitue l'événement dans une carte
interactive et une frise temporelle pilotées par la même horloge.

Les agents enrichissent ensuite le rejeu avec les observations de terrain que les
systèmes automatisés ne connaissent pas : témoignages, photos, captures de
réseaux sociaux, le tout géolocalisé et horodaté.

Usages visés : retours d'expérience post-crise, formation des agents et des
partenaires, préparation d'exercices de gestion de crise, et constitution d'une
mémoire du risque sur les bassins de l'Aude, de la Berre et des Corbières
maritimes.

**Un rejeu est figé au moment de sa génération.** Toutes les données, seuils
compris, sont copiées dans le rejeu : il reste rejouable à l'identique dans la
durée, même lorsque les systèmes sources n'exposent plus la période concernée.

## Les sources de données

| Source | Contenu |
|---|---|
| **Aquasys** | Hauteurs d'eau, débits, cumuls pluviométriques et seuils des stations du réseau |
| **Ceneau**, via le Lizmap du SMMAR | Images horodatées des webcams orientées cours d'eau |
| **Lames d'eau radar** | Cumuls de précipitations en images PNG, produits par Predict Services et livrés par lots |
| **Saisie manuelle** | Témoignages, photos et observations de terrain |

Les adresses de ces services ne sont pas versionnées : elles se renseignent par
variables d'environnement, décrites dans
[`installation.md`](docs/installation.md#les-variables-denvironnement).

## Stack technique

React, Vite et TypeScript · MapLibre GL JS · Node.js, Express et Zod ·
PostgreSQL et PostGIS · Docker Compose.

Les échanges utilisent des formats ouverts : REST, JSON, GeoJSON et CSV.

## Installer

Deux parcours, au choix, qui donnent la même application :

| | Avec Docker | Sans Docker |
|---|---|---|
| Pour | Essayer, recetter, ou héberger avec Docker seul | Installer sur un serveur Debian |
| Base de données | Incluse | La vôtre : PostgreSQL 14 ou plus récent avec PostGIS, déjà en place ou installée pour l'occasion |
| Procédure | [`lancer-avec-docker.md`](docs/lancer-avec-docker.md) | [`lancer-sans-docker.md`](docs/lancer-sans-docker.md) |

Docker n'est requis que par le premier. Les deux se configurent de la même
façon, par un fichier `.env` : les adresses des sources, à demander à
l'exploitant de chaque service, une clé de session et le mot de passe
administrateur. Chaque procédure dit quand et comment le remplir.

## Développer

Node.js 24 ou plus récent, et Docker Compose pour la base de développement — ou
un PostgreSQL 14 ou plus récent avec PostGIS déjà installé, à la place du
service `db`.

```bash
npm install
cp .env.sample .env       # les sources se renseignent avant le premier rejeu
npm run hash-password     # coller la ligne dans ADMIN_PASSWORD_HASH
openssl rand -base64 48   # coller la ligne dans SESSION_SECRET
docker compose up -d db   # PostgreSQL avec PostGIS
npm run migrate           # applique le schéma
npm run dev:api           # http://localhost:3000
npm run dev:web           # http://localhost:5180, dans un second terminal
```

`http://localhost:5180` ouvre la liste des rejeux, la création vit à `/nouveau`,
la connexion de l'administrateur à `/connexion` et un rejeu à
`/rejeux/<identifiant>`. Constituer un rejeu demande d'être connecté, et les
adresses des sources, que `.env.sample` laisse vides.

La procédure complète, les prérequis et le tableau des variables sont dans
[`installation.md`](docs/installation.md).

## Vérifications

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
```

`npm test` refuse de démarrer sans base : les suites de stockage et de routes
tournent contre une vraie base, et rien ne se saute en silence — sauf, sous
root, les quatre cas qui retirent une permission, et le résumé les compte. Pour
ne lancer que ce qui n'a besoin de rien, `npm run test:unit` : une affirmation
plus étroite, qui se dit comme telle.

## Documentation

| Document | Quand l'ouvrir |
|---|---|
| [`lancer-avec-docker.md`](docs/lancer-avec-docker.md) | Installer pas à pas avec Docker, base comprise |
| [`lancer-sans-docker.md`](docs/lancer-sans-docker.md) | Installer pas à pas sur un serveur Debian, avec votre base PostgreSQL |
| [`architecture.md`](docs/architecture.md) | Comprendre comment l'application est construite, en deux schémas |
| [`installation.md`](docs/installation.md) | La référence : prérequis de la base, variables, déploiement, développement |
| [`utilisation.md`](docs/utilisation.md) | Constituer un rejeu en ligne de commande |
| [`api.md`](docs/api.md) | Consommer un rejeu par HTTP : routes, filtres, codes, forme des erreurs |

## Licence

GNU Affero General Public License v3.0 — voir [`LICENSE`](LICENSE).

Copyright (C) 2026 SMMAR — EPTB Aude.
