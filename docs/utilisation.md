# Utilisation en ligne de commande

Sept scripts collectent, un huitième constitue un rejeu. Tous lisent le `.env`
de la racine s'il existe, et se lancent par `npm run`, les options venant après
un `--` :

```bash
npm run fetch:aquasys:measures -- --from 2019-10-22T06:00Z --to 2019-10-22T07:00Z --station 84
```

## Le contrat commun aux scripts de collecte

**Un script de collecte retourne, il ne stocke rien.** Le gel — copier les
médias, écrire en base — appartient à la constitution d'un rejeu.

### La sortie

La sortie standard ne porte **que** l'enveloppe JSON, suivie d'un retour à la
ligne :

```json
{ "data": …, "report": { … } }
```

La progression et les diagnostics vont sur la sortie d'erreur. L'enveloppe est
vérifiée contre le contrat que le script déclare avant d'être émise : un
collecteur qui produirait une valeur que son propre contrat refuse s'arrête.

Le rapport porte ce que `data` ne peut pas montrer : quand le script a tourné,
les paramètres réellement utilisés, les sources interrogées qui n'ont rien
répondu, les règles appliquées de façon dégradée, et les appels en échec. **Un
décompte de ce qui est dans `data` n'y figure pas** — l'appelant tient `data`.

**Une règle qui n'a pas pu s'appliquer telle qu'écrite est reportée, jamais
appliquée en silence.**

### Les codes de sortie

| Code | Sens |
|---|---|
| `0` | Succès. `data` peut être vide : une absence de données n'est pas une erreur |
| `1` | Le script n'a pas pu tourner — option inconnue, configuration manquante, source injoignable. Rien sur la sortie standard |
| `2` | Succès partiel : au moins un appel a échoué, et le rapport les liste |

Le code est déduit du rapport, pas déclaré : une exécution qui a enregistré un
échec ne peut pas se présenter comme complète.

### Les options communes

Les options sont lues en mode strict : **une option inconnue ou un argument
positionnel est refusé**, jamais ignoré.

- `--bbox minLon,minLat,maxLon,maxLat` — l'emprise, en WGS84. Les bornes sont
  vérifiées, et `min` doit être inférieur à `max`. Omise, le script collecte
  tout le parc.
- `--station <entier>`, répétable. **`--station` et `--bbox` ensemble sont
  refusés** : les deux répondent à la même question.
- `--family hydro|rain-gauge` — la famille de sources.
- `--from` et `--to` — les bornes de la période. Quand elles sont exigées, les
  deux le sont ; quand elles sont facultatives, elles le sont ensemble.

**Un script prend l'emprise et la période, et restreint avant les appels par
source.** Aquasys n'a pas de filtre spatial : son référentiel est chargé en
entier — trois requêtes au plus — puis filtré en mémoire ; tout ce qui suit
coûte une requête par source.

Ce sont la liste de chaque famille et, pour les stations, leurs rattachements
aux réseaux. Le code du réseau donne le type d'une station : 4 (`Ouvrage`) ou
5 (`Déversoir`) en fait un ouvrage, 1 (`Étiage`) ou 2 (`Inondation`) un cours
d'eau. **Une station qu'aucun de ces quatre réseaux ne rattache n'est pas
collectée** ; désignée par `--station`, elle est retirée et le rapport le dit.
Une station rattachée à la fois à un réseau d'ouvrage et à un réseau de cours
d'eau n'est pas collectée non plus, et le rapport le dit.

## Les sept scripts

| Script | Options | Variables |
|---|---|---|
| `fetch:aquasys:stations` | `--family` (les deux si omis), `--bbox`, `--no-details` | `ACYCLIQ_*` |
| `fetch:aquasys:thresholds` | `--family` (défaut `hydro`), `--station`, `--bbox` | `ACYCLIQ_*` |
| `fetch:aquasys:measures` | `--from`, `--to` (**obligatoires**), `--family` (défaut `hydro`), `--station`, `--measure`, `--bbox` | `ACYCLIQ_*` |
| `fetch:lizmap:layers` | `--layer <nom>`, répétable | `LIZMAP_BASE_URL` |
| `fetch:webcams:positions` | `--bbox` | `LIZMAP_BASE_URL` |
| `fetch:webcams:images` | `--code`, répétable, `--from`, `--to`, `--bbox` | `LIZMAP_BASE_URL` |
| `index:radar-rainfall` | `--dir`, `--delivery`, répétable, `--from`, `--to` | `RADAR_RAINFALL_PATH` sauf si `--dir`, `RADAR_RAINFALL_BBOX` |

Un nom de couche inconnu est refusé en nommant la liste acceptée. `--dir`
l'emporte sur `RADAR_RAINFALL_PATH`, sans passer par un faux environnement.

Quelques exemples :

```bash
npm run fetch:aquasys:stations -- --no-details
npm run fetch:aquasys:thresholds -- --station 84
npm run fetch:lizmap:layers
npm run fetch:webcams:images -- --code 215
npm run index:radar-rainfall -- --delivery 20034
```

## Constituer un rejeu

```bash
npm run build:replay -- --from 2019-10-22T00:00Z --to 2019-10-24T00:00Z --label "Crue d'octobre 2019"
```

| Option | Effet |
|---|---|
| `--from`, `--to` | **Obligatoires.** La période rejouée |
| `--label` | Le libellé du rejeu |
| `--bbox` | L'emprise. Omise, tout le parc |
| `--id` | Construit **dans un rejeu existant**. Sans elle, la base frappe un identifiant neuf. Un identifiant qui ne désigne rien est refusé |
| `--only` | Les voies collectées, parmi `aquasys`, `lizmap`, `radar-rainfall`, répétable. Toutes si omise ; un nom inconnu est refusé |
| `--dir` | Racine des livraisons radar, l'emporte sur la variable |
| `--delivery` | Les livraisons radar retenues, répétable |
| `--no-media` | Ne copie pas les médias |

**Un rejeu est nommé par ce qui le stocke.** C'est la base qui frappe
l'identifiant : aucun appelant n'en choisit un, donc aucun n'entre en collision
et aucun n'a à être refusé.

`--only` est ce qui permet de constituer un rejeu **sans réseau du tout** : un
rejeu des seules lames d'eau livrées n'exige aucun jeton Aquasys.

**Une voie n'exige sa configuration que si elle est demandée.** Les lames d'eau
vont plus loin : demandées par leur nom — `--only radar-rainfall`, ou un `--dir`
— elles refusent une racine manquante en nommant `RADAR_RAINFALL_PATH` ; prises
par défaut avec les autres, une racine manquante ne fait que les écarter, et la
construction le dit sur sa sortie d'erreur. C'est ce qui rend un rejeu
constituable avant la première livraison Predict.

`DATABASE_URL` et `MEDIA_PATH` sont exigées dans tous les cas, `--no-media`
compris.

### Codes de sortie

| Code | Sens |
|---|---|
| `0` | Le manifeste est `complete` |
| `2` | Le manifeste est `partial` **ou** `failed` |
| `1` | Le processus n'a pas pu tourner |

Un rejeu qui n'a **rien** stocké ne se distingue pas, par le seul code de
sortie, d'un rejeu à qui il manque une mesure : seul le manifeste les sépare.
Il est `failed` si aucun jeu de données n'a été écrit, `partial` si une voie
n'est pas terminée, si un rapport porte un échec, si un média a échoué, ou si
le journal n'a pas pu s'écrire.

### Relancer

**Les traitements sont relançables sans créer de doublon.** Une source
indisponible n'empêche pas les autres, et une reprise ne duplique rien.

### Ce que la construction laisse derrière elle

Le manifeste porte le rapport de chaque source ; le journal porte la trace au
fil de l'eau. Les deux se lisent par l'API — voir [`api.md`](api.md).
