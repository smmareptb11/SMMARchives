# Utilisation en ligne de commande

Un rejeu se constitue par `npm run build:replay`. C'est la commande que l'API
lance quand on crée un rejeu ; elle se lance aussi à la main. Elle lit le `.env`
de la racine s'il existe, et ses options viennent après un `--`.

## Constituer un rejeu

```bash
npm run build:replay -- --from 2019-10-22T00:00Z --to 2019-10-24T00:00Z --label "Crue d'octobre 2019"
```

| Option | Effet |
|---|---|
| `--from`, `--to` | **Obligatoires.** La période rejouée, deux instants ISO 8601 qui portent leur fuseau (`Z` ou un décalage) |
| `--label` | Le libellé du rejeu |
| `--bbox` | L'emprise, contenue dans le territoire du SMMAR. Omise, tout le parc |
| `--territory` | Le syndicat de bassin sur lequel l'emprise a été cadrée, par son nom court (`Aude Centre`, `Orbieu Jourres`…). Seulement avec `--bbox` |
| `--id` | Construit dans le rejeu que l'API vient de créer. Sans elle, la base frappe un identifiant neuf. Un identifiant qui ne désigne rien, ou un rejeu qu'une construction a déjà entamé, est refusé |

**Un rejeu est nommé par ce qui le stocke.** C'est la base qui frappe
l'identifiant : aucun appelant n'en choisit un, donc aucun n'entre en collision
et aucun n'a à être refusé.

**Un rejeu collecte toutes les sources et copie tous ses médias.** Où les
trouver vient de l'environnement — voir
[`installation.md`](installation.md#les-variables-denvironnement). Les lames
d'eau sont la seule source facultative : sans `RADAR_RAINFALL_PATH`, la
construction les écarte et le dit sur sa sortie d'erreur, ce qui rend un rejeu
constituable avant la première livraison Predict. La variable renseignée,
toutes les livraisons du répertoire sont indexées.

### Ce que la construction collecte

**La construction restreint avant les appels par source.** Aquasys n'a pas de
filtre spatial : son référentiel est chargé en entier — trois requêtes — puis
filtré en mémoire ; tout ce qui suit coûte une requête par source.

Ce sont la liste de chaque famille et, pour les stations, leurs rattachements
aux réseaux. Le code du réseau donne le type d'une station : 4 (`Ouvrage`) ou
5 (`Déversoir`) en fait un ouvrage, 1 (`Étiage`) ou 2 (`Inondation`) un cours
d'eau. **Une station qu'aucun de ces quatre réseaux ne rattache n'est pas
collectée**, et le rapport du référentiel les nomme. Une station rattachée à la
fois à un réseau d'ouvrage et à un réseau de cours d'eau ne l'est pas non plus,
et le rapport le dit aussi.

Ni ce typage ni la lecture des libellés de seuil — « Crue du… » pour un repère
de crue, Vigilance, Alerte, Alerte renforcée et Crise pour le rang — ne sont
donnés par la source. Ce sont des tables de l'application, dans
`packages/shared/src/reference/classification.ts`, et le rapport de chaque jeu
qu'elles ont trié les recopie : un rejeu dit avec quelles règles il a été
construit.

**Les pluviomètres simulés ne sont pas collectés.** Ce sont des mailles de
réanalyse, pas des instruments, et aucun champ d'Aquasys ne les distingue : ils
sont reconnus à leur code, `SAFRAN_…` pour SAFRAN, `X…Y…` pour ERA5. Le rapport
du référentiel dit combien en ont été écartés.

Chaque jeu de données est vérifié contre son contrat avant d'être stocké : une
valeur que son propre contrat refuse fait échouer la voie, elle n'est jamais
écrite.

### Codes de sortie

| Code | Sens |
|---|---|
| `0` | Le manifeste est `complete` |
| `2` | Le manifeste est `partial` **ou** `failed` |
| `1` | Le processus n'a pas pu tourner, ou a été interrompu |

Un rejeu qui n'a **rien** stocké ne se distingue pas, par le seul code de
sortie, d'un rejeu à qui il manque une mesure : seul le manifeste les sépare.
Il est `failed` si aucun jeu de données n'a été écrit, `partial` si une voie
n'est pas terminée, si un rapport porte un échec, si un média a échoué, ou si
le journal n'a pas pu s'écrire.

**Une construction qui s'arrête avant la fin laisse son rejeu `failed`**, qu'elle
ait échoué en route ou reçu `SIGTERM` ou `SIGINT` — un conteneur remplacé, un
Ctrl-C. Seul un `SIGKILL` ne s'intercepte pas : le rejeu reste alors `running`,
et seule sa suppression l'en sort.

**Un rejeu construit est figé.** Il ne se reconstruit pas : une source
indisponible n'empêche pas les autres, et ce qu'elle n'a pas rendu manque au
rejeu, qui le dit. Pour l'avoir, on construit un nouveau rejeu.

### Ce que la construction laisse derrière elle

Le manifeste porte le rapport de chaque jeu de données ; le journal porte la
trace au fil de l'eau. Les deux se lisent par l'API — voir [`api.md`](api.md).

Un rapport porte ce que les données ne peuvent pas montrer : quand la collecte
a tourné, les paramètres réellement utilisés, les sources interrogées qui n'ont
rien répondu, les règles appliquées de façon dégradée, et les appels en échec.
**Une règle qui n'a pas pu s'appliquer telle qu'écrite est reportée, jamais
appliquée en silence.**
