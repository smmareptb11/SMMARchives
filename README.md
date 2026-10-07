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

### Ce qui fonctionne

- Création d'un rejeu sur une période et une emprise rectangulaire, limitée au
  territoire du SMMAR (tout le territoire par défaut), et suivi de sa construction en direct
- Collecte automatisée des hauteurs d'eau, débits, cumuls de pluie et seuils
- Détection automatique des franchissements de seuils
- Récupération des images de webcams et des lames d'eau radar
- Rejeu synchronisé carte et frise, piloté par une seule horloge
- Graphiques par station et par pluviomètre
- Liste des rejeux constitués, du plus récent au plus ancien

### Ce qui est prévu et n'est pas écrit

La saisie manuelle d'événements et de témoignages géolocalisés, l'export
d'images pour les supports de présentation, et l'administration protégée par
mot de passe.

> [!WARNING]
> **Rien n'est protégé aujourd'hui.** Aucune route ne demande de mot de passe,
> et `DELETE /replays/:id` efface un rejeu entier, irréversiblement. L'API ne
> doit pas être exposée publiquement.

## Les sources de données

| Source | Contenu |
|---|---|
| **Aquasys** | Hauteurs d'eau, débits, cumuls pluviométriques et seuils des stations du réseau |
| **Ceneau**, via le Lizmap du SMMAR | Images horodatées des webcams orientées cours d'eau |
| **Lames d'eau radar** | Cumuls de précipitations en PNG géoréférencés, produits par Predict Services et livrés par lots |
| **Saisie manuelle** | Témoignages, photos et observations de terrain |

Les adresses de ces services ne sont pas versionnées : elles se renseignent par
variables d'environnement, décrites dans
[`installation.md`](docs/installation.md#les-variables-denvironnement).

## La pile

React, Vite et TypeScript · MapLibre GL JS · Node.js, Express et Zod ·
PostgreSQL et PostGIS · Docker Compose.

Les échanges utilisent des formats ouverts : REST, JSON, GeoJSON et CSV.

## Démarrer

Node.js 24 ou plus récent, et Docker Compose.

```bash
npm install
cp .env.sample .env       # prêt à l'emploi en local ; les sources se renseignent après
docker compose up -d db   # PostgreSQL avec PostGIS
npm run migrate           # applique le schéma
npm run dev:api           # http://localhost:3000
npm run dev:web           # http://localhost:5180, dans un second terminal
```

`http://localhost:5180` ouvre la liste des rejeux, la création vit à `/nouveau`
et un rejeu à `/rejeux/<identifiant>`. Constituer un rejeu demande en plus les
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
| [`installation.md`](docs/installation.md) | Installer, configurer, lancer, déployer |
| [`utilisation.md`](docs/utilisation.md) | Constituer un rejeu en ligne de commande |
| [`api.md`](docs/api.md) | Consommer un rejeu par HTTP : routes, filtres, codes, forme des erreurs |

## Licence

GNU Affero General Public License v3.0 — voir [`LICENSE`](LICENSE).

Copyright (C) 2026 SMMAR — EPTB Aude.
