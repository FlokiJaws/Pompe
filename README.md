# PompeMoi

Application web mobile qui affiche les prix des carburants autour de soi, calcule le coût réel d'un plein (trajet aller-retour inclus) et compare avec les stations espagnoles près de la frontière.

**Démo : https://flokijaws.github.io/Pompe/**

## Fonctionnalités

- Stations dans un rayon de 2 à 40 km autour de la position (géolocalisation du navigateur)
- 6 carburants : Gazole, E10, SP95, SP98, E85, GPLc
- Tri par prix au litre, coût du plein, distance, ou du plus cher au moins cher
- Profil véhicule (réservoir, consommation) enregistré en local : estimation du plein + coût du trajet A/R
- Nom de l'enseigne de chaque station, ancienneté du prix affiché (signalé si > 48 h)
- Comparaison avec l'Espagne (proposée à moins de 200 km d'un passage frontière) : meilleure station française contre meilleure station espagnole, trajet inclus
- Lien itinéraire Google Maps pour chaque station

## Sources de données

Toutes publiques et sans clé d'API, appelées directement depuis le navigateur :

| Donnée | Source |
|---|---|
| Prix France (temps réel) | [data.economie.gouv.fr — flux instantané v2](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/) |
| Enseignes des stations | [public.opendatasoft.com — prix des carburants J-7](https://public.opendatasoft.com/explore/dataset/prix_des_carburants_j_7/) |
| Prix Espagne | API REST du Ministerio para la Transición Ecológica (`sedeaplicaciones.minetur.gob.es`), filtrée par province |

L'API Opendatasoft limite chaque requête à 100 résultats : les résultats sont donc récupérés par pages, en parallèle.

## Stack

Un seul fichier `index.html` : HTML, CSS et JavaScript sans framework ni étape de build. Hébergé sur GitHub Pages.

Lancer en local : ouvrir `index.html` dans un navigateur (la géolocalisation demande l'autorisation).

## Limites connues

- Les distances sont calculées à vol d'oiseau (formule de haversine), pas par la route : le coût du trajet est sous-estimé.
- Le « plein » suppose un réservoir vide.
- Seuls 4 passages frontière sont pris en compte (Hendaye/Irun, Somport, Puigcerdà, La Jonquera).
