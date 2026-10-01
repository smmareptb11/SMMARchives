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

### Ce que la construction collecte

**La construction restreint avant les appels par source.** Aquasys n'a pas de
filtre spatial : son référentiel est chargé en entier — trois requêtes — puis
filtré en mémoire ; tout ce qui suit coûte une requête par source.

Ce sont la liste de chaque famille et, pour les stations, leurs rattachements
aux réseaux. Le code du réseau donne le type d'une station : 4 (`Ouvrage`) ou
5 (`Déversoir`) en fait un ouvrage, 1 (`Étiage`) ou 2 (`Inondation`) un cours
d'eau. **Une station qu'aucun de ces quatre réseaux ne rattache n'est pas
collectée.** Une station rattachée à la fois à un réseau d'ouvrage et à un
réseau de cours d'eau ne l'est pas non plus, et le rapport le dit.

Chaque jeu de données est vérifié contre son contrat avant d'être stocké : une
valeur que son propre contrat refuse fait échouer la voie, elle n'est jamais
écrite.

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

Le manifeste porte le rapport de chaque jeu de données ; le journal porte la
trace au fil de l'eau. Les deux se lisent par l'API — voir [`api.md`](api.md).

Un rapport porte ce que les données ne peuvent pas montrer : quand la collecte
a tourné, les paramètres réellement utilisés, les sources interrogées qui n'ont
rien répondu, les règles appliquées de façon dégradée, et les appels en échec.
**Une règle qui n'a pas pu s'appliquer telle qu'écrite est reportée, jamais
appliquée en silence.**
