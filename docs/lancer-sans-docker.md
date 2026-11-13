# Installer SMMARchives sans Docker

Le parcours manuel : l'application tourne directement sur un serveur
**Debian 12**, avec Node pour l'API et nginx pour l'interface, et se branche sur
la base PostgreSQL de votre choix, déjà en place ou installée pour elle. Les
commandes supposent un compte qui peut utiliser `sudo`.

Le détail de chaque variable est dans [installation.md](installation.md) ; ce
document en est le chemin pas à pas.

## Prérequis

- Debian 12, avec un accès à Internet pour les paquets.
- Une base PostgreSQL 14 ou plus récent, déjà en place ou à
  installer à l'étape 2 : ses exigences sont dans
  [les prérequis de la base](installation.md#la-base-de-données).
- Un reverse proxy HTTPS devant le serveur, avec nom de domaine et certificat.
- L'URL de l'API Aquasys et son jeton, l'URL du Lizmap du SMMAR. Ils se
  demandent à l'exploitant de chaque service : le dépôt est public et ne les
  contient pas.
- Le répertoire des livraisons de lames d'eau radar, s'il y en a.

## 1. Installer Node et nginx

Debian 12 ne fournit pas Node 24 : il vient du dépôt de son éditeur.

```bash
sudo apt update
sudo apt install -y curl git nginx

curl -fsSL https://deb.nodesource.com/setup_24.x -o nodesource_setup.sh
sudo bash nodesource_setup.sh
sudo apt install -y nodejs
node --version          # v24.…
```

## 2. Préparer la base

L'application n'a besoin que de l'adresse d'une base qui remplit
[ses prérequis](installation.md#la-base-de-données) : PostgreSQL 14 ou plus
récent, et un compte qui peut y créer des tables.

**Vous avez déjà un serveur PostgreSQL** : demandez à son administrateur une
base qui remplit ces prérequis, et son adresse. Passez à l'étape 3.

**Vous n'en avez pas** : installez-en un sur ce serveur. Celui de Debian 12,
PostgreSQL 15, suffit.

```bash
sudo apt install -y postgresql
```

Puis créez un compte et une base au nom de l'application. Le compte est
propriétaire de sa base, sans être superutilisateur.

```bash
sudo -u postgres createuser --pwprompt smmarchives   # un mot de passe en lettres et chiffres
sudo -u postgres createdb --owner smmarchives smmarchives
```

L'adresse de cette base est
`postgres://smmarchives:<mot de passe>@localhost:5432/smmarchives`.

## 3. Récupérer l'application

Un compte système dédié la fait tourner, et possède le code et les médias.

```bash
sudo adduser --system --group --home /opt/smmarchives smmarchives
sudo chmod 755 /opt/smmarchives   # nginx lit l'interface construite dans le dépôt
sudo -u smmarchives git clone https://github.com/smmareptb11/SMMARchives.git /opt/smmarchives/app
cd /opt/smmarchives/app
sudo -u smmarchives npm ci
sudo install -d -o smmarchives -g smmarchives /var/lib/smmarchives/media
```

`npm ci` installe aussi les dépendances de développement, et il le faut : l'API
lance chaque construction de rejeu avec `tsx`, depuis les sources du dépôt.
Une installation avec `--omit=dev` démarre, puis échoue à chaque rejeu.

Selon la version de npm, `npm ci` peut signaler qu'`esbuild` a un script
d'installation non approuvé : l'avertissement est sans conséquence, rien n'est à
faire.

## 4. Configurer `.env`

```bash
sudo -u smmarchives cp .env.sample .env
sudo chmod 600 .env                         # il contient le jeton Aquasys et les secrets
```

Générez les deux secrets. La seconde commande demande le mot de passe
administrateur deux fois, sans l'afficher.

```bash
openssl rand -base64 48                     # la clé de session
sudo -u smmarchives npm run hash-password
```

Ouvrez `.env` (`sudo -u smmarchives nano .env`) et renseignez :

| Variable | Valeur |
|---|---|
| `SESSION_SECRET` | La ligne produite par `openssl` |
| `ADMIN_PASSWORD_HASH` | La ligne `scrypt:…` produite par `hash-password`, telle quelle |
| `ACYCLIQ_API_URL`, `ACYCLIQ_TOKEN` | L'URL et le jeton Aquasys |
| `LIZMAP_BASE_URL` | L'URL du Lizmap |
| `DATABASE_URL` | L'adresse de la base : celle que son administrateur vous a donnée, ou celle de l'étape 2 |
| `MEDIA_PATH` | `/var/lib/smmarchives/media` |
| `RADAR_RAINFALL_PATH` | Le répertoire des livraisons radar ; vide, les rejeux se construisent sans lames d'eau |
| `API_PORT` | `3000` |
| `TRUST_PROXY` | `loopback` : nginx tourne sur la même machine |

**`MEDIA_PATH` est un chemin absolu.** Relatif, il se lit depuis le répertoire
où l'API est lancée, et les médias s'écrivent ailleurs que prévu.

**Le mot de passe de la base, dans `DATABASE_URL`, ne contient que des lettres
et des chiffres** : il est inséré tel quel dans l'adresse, où un `@`, un `:`, un
`/`, un `#` ou un `?` en changerait le sens.

`RADAR_RAINFALL_BBOX` reste vide : l'emprise des lames d'eau est fixée dans le
code, et ne se règle que si elle s'avère fausse.

Ces lignes de `.env.sample` ne servent qu'à Docker Compose, et sont ignorées
ici : `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`, `HTTP_PORT`,
`RADAR_HOST_PATH`. `DATABASE_URL_TEST` et `WEB_PORT` ne servent qu'au
développement.

## 5. Appliquer le schéma

```bash
sudo -u smmarchives npm run migrate   # applied 0001-replay.sql
```

## 6. Construire l'interface

```bash
sudo -u smmarchives npm run build:web   # produit packages/web/dist/
```

## 7. Faire tourner l'API

Un service systemd la démarre avec le serveur et la relance si elle s'arrête.
Il appelle `tsx` directement, comme l'image Docker : `npm run dev:api` lance la
même chose, mais n'a rien à faire dans un service.

`/etc/systemd/system/smmarchives-api.service` :

```ini
[Unit]
Description=SMMARchives API
After=network.target postgresql.service

[Service]
User=smmarchives
Group=smmarchives
WorkingDirectory=/opt/smmarchives/app
ExecStart=/opt/smmarchives/app/node_modules/.bin/tsx --env-file=.env packages/api/src/main.ts
Restart=on-failure
# Une construction de rejeu tourne détachée de l'API, pendant des minutes :
# arrêter ou relancer l'API ne doit arrêter que l'API.
KillMode=process

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now smmarchives-api
systemctl status smmarchives-api
curl -s localhost:3000/health
```

**L'API écoute sur toutes les interfaces.** Le port `3000` ne doit pas être
ouvert au réseau : seul nginx y accède, depuis la machine.

## 8. Servir l'interface avec nginx

La configuration est celle du déploiement Docker,
[`docker/nginx.conf`](../docker/nginx.conf), avec trois lignes adaptées : elle
porte déjà la taille d'envoi des photos, le flux de progression non bufferisé,
le repli vers `index.html` et les en-têtes de sécurité.

```bash
sudo cp /opt/smmarchives/app/docker/nginx.conf /etc/nginx/sites-available/smmarchives
sudo nano /etc/nginx/sites-available/smmarchives
```

| Ligne | Devient |
|---|---|
| `listen 80;` | `listen 127.0.0.1:8080;`, le port que vise le reverse proxy HTTPS |
| `root /usr/share/nginx/html;` | `root /opt/smmarchives/app/packages/web/dist;` |
| `proxy_pass http://api:3000;` | `proxy_pass http://127.0.0.1:3000;` |

```bash
sudo ln -s /etc/nginx/sites-available/smmarchives /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
curl -s localhost:8080/health
```

Le reverse proxy HTTPS vise `127.0.0.1:8080` et transmet `X-Forwarded-Proto` ;
l'API marque alors le cookie de session `Secure`. Si ce nginx termine lui-même
le HTTPS, sans proxy devant lui, `$http_x_forwarded_proto` devient `$scheme`.

Le site par défaut de nginx, la page d'accueil de Debian sur le port 80, reste
actif : il se retire par `sudo rm /etc/nginx/sites-enabled/default`, puis
`sudo systemctl reload nginx`.

## Exploitation

| Action | Commande |
|---|---|
| Arrêter l'API | `sudo systemctl stop smmarchives-api` |
| Relancer l'API | `sudo systemctl restart smmarchives-api` |
| Journaux de l'API | `journalctl -u smmarchives-api -f` |
| Shell dans la base | `psql '<la valeur de DATABASE_URL>'` |

Une mise à jour, depuis `/opt/smmarchives/app` :

```bash
sudo -u smmarchives git pull
sudo -u smmarchives npm ci
sudo -u smmarchives npm run migrate
sudo -u smmarchives npm run build:web
sudo systemctl restart smmarchives-api
```

## Dépannage

| Symptôme | Cause et correction |
|---|---|
| `npm run migrate` : `permission denied for schema public` | Le compte de `DATABASE_URL` ne peut pas créer de tables : depuis PostgreSQL 15, seul le propriétaire de la base le peut par défaut. Voir [les prérequis de la base](installation.md#la-base-de-données) |
| `npm run migrate` : `password authentication failed` | Le mot de passe de `DATABASE_URL` n'est pas celui du compte de la base |
| L'API redémarre en boucle | `journalctl -u smmarchives-api -n 20` : la validation de la configuration nomme la variable manquante ou invalide |
| `EADDRINUSE` dans les journaux | Le port `API_PORT` est pris : en choisir un autre, et reporter le même dans `proxy_pass` |
| Une page rechargée rend 404 | Le repli `try_files $uri /index.html` manque dans la configuration nginx |
| Une construction échoue aussitôt | Les dépendances de développement manquent : relancer `npm ci` sans `--omit=dev` |
| Rejeux construits sans lames d'eau | `RADAR_RAINFALL_PATH` vide, faux, ou illisible par le compte `smmarchives` |

## Non couvert

- **La sauvegarde** : la base et `/var/lib/smmarchives/media` se sauvegardent
  ensemble, et la procédure n'est pas écrite.
- **Le reverse proxy HTTPS** et son certificat.
