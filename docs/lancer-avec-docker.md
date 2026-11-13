# Installer SMMARchives avec Docker

Le parcours tout inclus : la base de données, l'application et l'interface
tournent dans des conteneurs, et seuls Docker et git sont à installer sur la
machine.
Pour installer l'application sur un serveur avec votre propre base PostgreSQL,
suivez plutôt [le parcours manuel](lancer-sans-docker.md).

## Prérequis

- Docker Engine, ou Docker Desktop, avec Compose v2 ou plus récent
  (`docker compose version`).
- `git` pour récupérer le code, et `openssl` pour la clé de session, présent sur
  la plupart des systèmes.
- L'URL de l'API Aquasys et son jeton, l'URL du Lizmap du SMMAR. Ils se
  demandent à l'exploitant de chaque service : le dépôt est public et ne les
  contient pas.
- Le répertoire des livraisons de lames d'eau radar, s'il y en a.

## 1. Récupérer le code

```bash
git clone https://github.com/smmareptb11/SMMARchives.git
cd SMMARchives
```

## 2. Configurer `.env`

```bash
cp .env.sample .env
chmod 600 .env          # il contient le jeton Aquasys et les secrets
```

Construisez l'application, ce qui prend quelques minutes la première fois, puis
générez les deux secrets. La dernière commande demande le mot de passe
administrateur deux fois, sans l'afficher.

```bash
docker compose build
openssl rand -base64 48     # la clé de session
docker compose run --rm --no-deps api node_modules/.bin/tsx packages/api/src/hash-password.ts
```

Ouvrez `.env` et renseignez :

| Variable | Valeur |
|---|---|
| `SESSION_SECRET` | La ligne produite par `openssl` |
| `ADMIN_PASSWORD_HASH` | La ligne `scrypt:…` produite par la dernière commande, telle quelle |
| `ACYCLIQ_API_URL`, `ACYCLIQ_TOKEN` | L'URL et le jeton Aquasys |
| `LIZMAP_BASE_URL` | L'URL du Lizmap |
| `DB_PASSWORD` | Un mot de passe pour la base incluse, en lettres et chiffres seulement : il est inséré tel quel dans l'adresse de connexion |
| `RADAR_HOST_PATH` | Le répertoire des livraisons radar ; vide, les rejeux se construisent sans lames d'eau |

Le reste a une valeur par défaut qui convient : `DB_USER` et `DB_NAME` valent
`smmarchives`, l'interface est publiée sur le port `8080` (`HTTP_PORT`) et la
base sur `5432` (`DB_PORT`), tous deux sur `127.0.0.1` seulement. Les autres
lignes de `.env`, dont `DATABASE_URL`, `MEDIA_PATH` et `RADAR_RAINFALL_PATH`,
servent au parcours manuel et au développement : avec Docker, elles sont
ignorées ou fixées par `docker-compose.yml`. Laissez-les telles quelles.

**Les identifiants `DB_*` ne s'appliquent qu'à la création de la base**, au
premier démarrage. Les changer ensuite casse la connexion, jusqu'à ce que la
base soit recréée (voir [Exploitation](#exploitation)).

## 3. Démarrer

```bash
docker compose up -d
```

## 4. Vérifier

```bash
docker compose ps -a        # db, api, web : Up ; migrate : Exited (0)
curl -s localhost:8080/health
```

L'interface est sur <http://localhost:8080>. La connexion administrateur se
fait sur `/connexion`, avec le mot de passe choisi à l'étape 2.

## Exploitation

| Action | Commande |
|---|---|
| Arrêter, données conservées | `docker compose down` |
| Relancer | `docker compose up -d` |
| Mettre à jour | `git pull && docker compose up -d --build` |
| Journaux de l'API | `docker compose logs -f --tail 50 api` |
| Shell dans la base | `docker compose exec db sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'` |

Une mise à jour conserve la base et les médias : le schéma est appliqué à chaque
démarrage, et seul ce qui manque l'est. Les services repartent avec le démon
Docker.

**`docker compose down -v` supprime la base et les médias**, donc tous les
rejeux, sans retour possible.

## Dépannage

| Symptôme | Cause et correction |
|---|---|
| `port is already allocated` | `HTTP_PORT` ou `DB_PORT` est pris : en choisir un autre dans `.env`, puis `docker compose up -d` |
| `env file … .env not found` | `.env` n'existe pas dans le répertoire courant |
| `migrate` en `Exited (1)` | `docker compose logs migrate` ; le plus souvent, des `DB_*` modifiés après la création de la base |
| `api` redémarre en boucle | `docker compose logs --tail 20 api` : la validation de la configuration nomme la variable manquante ou invalide |
| Rejeux construits sans lames d'eau | `RADAR_HOST_PATH` vide ou faux ; seuls les rejeux construits après la correction en bénéficient |

## Exposer l'application

L'interface n'écoute que sur `127.0.0.1`. Pour l'ouvrir au réseau, placer devant
elle un reverse proxy HTTPS qui transmet `X-Forwarded-Proto` : l'API marque alors
le cookie de session `Secure`. Le détail est dans
[installation.md](installation.md#déployer-avec-docker).

## Non couvert

- **Une base PostgreSQL externe** : ce parcours utilise la sienne. Pour la vôtre,
  suivez [le parcours manuel](lancer-sans-docker.md).
- **La sauvegarde** : la base et le volume `media` se sauvegardent ensemble, et
  la procédure n'est pas écrite.
- **Le transfert de rejeux** d'une installation à une autre : chaque
  installation construit les siens.
