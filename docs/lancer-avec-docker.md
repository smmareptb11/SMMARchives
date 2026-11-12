# Lancer SMMARchives avec Docker

`docker-compose.yml` lance toute l'application depuis le dépôt : les images se
construisent sur la machine qui les exécute, sans registre ni question
d'architecture. Seuls Docker et le fichier `.env` sont nécessaires sur l'hôte.

## Prérequis

- Docker Engine, ou Docker Desktop, avec Compose v2 (`docker compose version`).
- L'URL de l'API Aquasys et son jeton, l'URL du Lizmap du SMMAR. Ils se
  demandent à l'exploitant de chaque service : le dépôt est public et ne les
  contient pas.
- Le répertoire des livraisons de lames d'eau radar, s'il y en a.

## Services

Le projet Compose s'appelle `smmarchives`, quel que soit le nom du dossier :
une nouvelle version extraite ailleurs retrouve les volumes de la précédente.

| Service | Rôle |
|---|---|
| `db` | PostgreSQL et PostGIS, sur le volume `db`, publié sur `127.0.0.1:${DB_PORT:-5432}` |
| `migrate` | Applique les migrations manquantes à chaque démarrage, puis s'arrête |
| `api` | L'API et les constructions qu'elle lance comme processus fils ; démarre après la réussite de `migrate` ; médias sur le volume `media` |
| `web` | nginx : l'interface et le relais vers l'API sur une seule origine, publié sur `127.0.0.1:${HTTP_PORT:-8080}` |

## Installation

```bash
git clone git@github.com:smmareptb11/SMMARchives.git && cd SMMARchives
cp .env.sample .env
docker compose build
```

### Secrets

Les deux commandes tournent dans l'image de l'API, sans Node sur l'hôte.

```bash
# SESSION_SECRET : au moins 32 caractères, propre au déploiement
docker compose run --rm --no-deps api node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"

# ADMIN_PASSWORD_HASH : demande le mot de passe deux fois, sans écho, et
# imprime une ligne `scrypt:…` à coller telle quelle
docker compose run --rm --no-deps api node_modules/.bin/tsx packages/api/src/hash-password.ts
```

`openssl rand -base64 48` convient aussi pour `SESSION_SECRET`. Le changer
ferme toutes les sessions ouvertes. Le mot de passe administrateur n'est
stocké nulle part en clair.

### `.env`

| Variable | Valeur |
|---|---|
| `ACYCLIQ_API_URL`, `ACYCLIQ_TOKEN` | URL et jeton Aquasys |
| `LIZMAP_BASE_URL` | URL du Lizmap |
| `SESSION_SECRET`, `ADMIN_PASSWORD_HASH` | Les deux lignes produites ci-dessus |
| `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Identifiants de la base ; vides, ils valent `smmarchives` |
| `RADAR_HOST_PATH` | Répertoire radar sur l'hôte, monté en lecture seule ; vide, les rejeux se construisent sans lames d'eau |
| `HTTP_PORT`, `DB_PORT` | Ports publiés sur `127.0.0.1` |
| `RADAR_RAINFALL_BBOX` | Voir les commentaires de `.env.sample` |

Deux contraintes sur la base :

- **Les identifiants `DB_*` ne s'appliquent qu'à la création du volume `db`.**
  Les changer ensuite casse la connexion de `migrate` et de l'API, jusqu'à ce
  que le volume soit recréé.
- **`DB_PASSWORD` ne doit contenir ni `@`, ni `:`, ni `/`** : Compose
  l'insère tel quel dans l'URL de connexion.

`docker-compose.yml` impose au conteneur de l'API `DATABASE_URL`, `API_PORT`,
`MEDIA_PATH`, `RADAR_RAINFALL_PATH` et `TRUST_PROXY` : les valeurs de ces
variables dans `.env` sont celles du développement hors conteneur, et y sont
ignorées.

### Démarrage

```bash
docker compose up -d
docker compose ps -a        # db, api, web : Up ; migrate : Exited (0)
curl -s localhost:8080/health
```

L'interface est sur <http://localhost:8080>, la connexion administrateur sur
`/connexion`.

## Exploitation

| Action | Commande |
|---|---|
| Arrêter, volumes conservés | `docker compose down` |
| Relancer | `docker compose up -d` |
| Mettre à jour | `git pull && docker compose up -d --build` |
| Journaux de l'API | `docker compose logs -f --tail 50 api` |
| Shell dans la base | `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'` |

Les services sont en `restart: unless-stopped` : ils repartent avec le démon
Docker.

**`docker compose down -v` supprime les volumes `db` et `media`**, donc tous
les rejeux, sans retour possible.

## Dépannage

| Symptôme | Cause et correction |
|---|---|
| `port is already allocated` | `HTTP_PORT` ou `DB_PORT` est pris : en choisir un autre dans `.env`, puis `docker compose up -d` |
| `env file … .env not found` | `.env` n'existe pas dans le répertoire courant |
| `migrate` en `Exited (1)` | `docker compose logs migrate` ; le plus souvent, des `DB_*` modifiés après la création du volume |
| `api` redémarre en boucle | `docker compose logs --tail 20 api` : la validation de la configuration nomme la variable manquante ou invalide |
| Rejeux construits sans lames d'eau | `RADAR_HOST_PATH` vide ou faux ; seuls les rejeux construits après la correction en bénéficient |

## Exposer l'application

`web` n'écoute que sur `127.0.0.1`. Pour l'ouvrir au réseau, placer devant
lui un reverse proxy HTTPS qui transmet `X-Forwarded-Proto` : l'API marque
alors le cookie de session `Secure`. Le détail est dans
[installation.md](installation.md#déployer-avec-docker).

## Non couvert

- **La sauvegarde** : la base et le volume `media` se sauvegardent ensemble,
  et la procédure n'est pas écrite.
- **Le transfert de rejeux** d'une installation à une autre : chaque
  installation construit les siens.
