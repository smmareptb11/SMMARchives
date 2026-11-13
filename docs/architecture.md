# Architecture

SMMARchives se compose d'une interface web, d'une API, d'une construction de
rejeu lancée par l'API, et d'un stockage : une base PostgreSQL avec PostGIS pour
les données, un répertoire pour les images. Le code est réparti en workspaces
npm sous `packages/`.

## Vue d'ensemble

```mermaid
flowchart LR
  Navigateur((Navigateur))

  subgraph Serveur["Serveur SMMARchives"]
    nginx["nginx<br/>une seule origine"]
    web["Interface<br/>React · MapLibre · uPlot"]
    api["API<br/>Node · Express"]
    build["Construction d'un rejeu<br/>processus lancé par l'API"]
    db[("PostgreSQL + PostGIS<br/>données des rejeux")]
    media[("Répertoire des médias<br/>images copiées")]
  end

  subgraph Sources["Sources externes"]
    aquasys["Aquasys<br/>mesures, seuils, stations"]
    lizmap["Lizmap du SMMAR<br/>positions des webcams"]
    ceneau["Ceneau<br/>images des webcams"]
    radar[("Livraisons radar<br/>répertoire sur le serveur")]
  end

  Navigateur --> nginx
  nginx -->|"fichiers de l'interface"| web
  nginx -->|"/replays, /session, /health"| api
  api -->|lance| build
  build --> aquasys
  build --> lizmap
  build --> ceneau
  build --> radar
  build -->|"données figées"| db
  build -->|"images copiées"| media
  api -->|lit| db
  api -->|sert| media
```

- **L'interface ne parle qu'à l'API**, par des chemins relatifs : nginx sert ses
  fichiers et relaie vers l'API sur la même origine.
- **Seule la construction lit les sources.** L'API ne sert que ce qu'une
  construction a stocké : un rejeu ouvert ne déclenche aucun appel externe.
- **La construction est un processus à part**, lancé par l'API à la création
  d'un rejeu. Un redémarrage de l'API ne l'interrompt pas, et sa progression se
  lit dans le journal du rejeu.
- **Un rejeu est figé** : données, seuils et images sont copiés à la
  construction, et ne bougent plus ensuite. Seuls les événements saisis par un
  administrateur s'y ajoutent, s'y modifient ou s'en retirent.

## La construction d'un rejeu

```mermaid
flowchart LR
  creation(["Création du rejeu"])
  aquasys["Mesures et seuils<br/>Aquasys"]
  webcams["Webcams<br/>Lizmap et Ceneau,<br/>images copiées"]
  radar["Lames d'eau<br/>livraisons radar"]
  events["Franchissements<br/>calculés sur les mesures"]
  media["Images radar<br/>copiées"]
  fin(["Rejeu complet,<br/>partiel ou en échec"])

  creation --> aquasys
  creation --> webcams
  creation --> radar
  aquasys --> events
  radar --> media
  events --> fin
  webcams --> fin
  media --> fin
```

- **Les trois sources se collectent en parallèle**, chacune dans sa voie :
  l'échec de l'une ne coûte que ses propres données.
- **Une voie ne tourne que si sa source est configurée.** Sans répertoire radar,
  les lames d'eau et leurs images sont absentes du rejeu, qui reste complet.
- **Les franchissements de seuils se calculent** sur les mesures et les seuils
  collectés : ils ne viennent d'aucune source.
- **L'état final** : complet quand tout a été collecté sans erreur, partiel
  quand une partie manque, en échec quand rien n'a pu être stocké. Seul un rejeu
  complet peut être publié.

## Les paquets

| Paquet | Contient |
|---|---|
| `packages/web` | L'interface : la carte, la chronologie, les graphiques, les formulaires |
| `packages/api` | Les routes HTTP, la session de l'administrateur, le lancement des constructions |
| `packages/worker` | Les lecteurs des sources, la construction d'un rejeu, le stockage dans PostgreSQL, les commandes `build:replay` et `migrate` |
| `packages/shared` | Les contrats de données partagés, l'horloge, la configuration, les tables de référence |

Le schéma de la base est dans `migrations/`, et ce qu'il demande à la base est
décrit dans [installation.md](installation.md#la-base-de-données). Les routes
de l'API sont décrites dans [api.md](api.md).
