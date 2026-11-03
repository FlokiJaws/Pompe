# PompeMoi

Application web mobile qui affiche les prix des carburants autour de soi, calcule le coût réel d'un plein (trajet aller-retour par la route inclus) et compare avec les stations espagnoles près de la frontière.

**Démo : https://flokijaws.github.io/Pompe/**. Sur téléphone, « Ajouter à l'écran d'accueil » l'installe comme une application plein écran.

## Fonctionnalités

- Toutes les stations dans un rayon de 2 à 40 km autour de la position (géolocalisation du navigateur)
- 6 carburants : Gazole, E10, SP95, SP98, E85, GPLc
- Tri par prix au litre, coût du plein, distance, ou du plus cher au moins cher
- Distance **par la route** et temps de trajet estimé (sans trafic), calculés avec OSRM
- Profil véhicule (réservoir, consommation) et niveau actuel du réservoir, enregistrés sur l'appareil : coût estimé des litres manquants + carburant consommé pour l'aller-retour
- Nom de l'enseigne, ancienneté du prix (signalée au-delà de 48 h), nombre de stations en rupture
- Comparaison avec l'Espagne (proposée à moins de 200 km d'un passage frontière) : meilleure station française contre meilleure station espagnole, trajet inclus
- Itinéraire en un geste vers Google Maps, Waze, Plans (iPhone) ou n'importe quelle app GPS (sélecteur Android) : au choix à chaque fois, ou application par défaut dans les réglages
- Pensée pour le mobile : panneaux à faire glisser pour les fermer, zones tactiles larges, saisie décimale avec virgule, prise en compte des encoches (safe areas), actualisation automatique au retour sur l'appli après 15 min

## Sources de données

Toutes publiques et sans clé d'API, appelées directement depuis le navigateur :

| Donnée | Source |
|---|---|
| Prix France (temps réel) | [data.economie.gouv.fr — flux instantané v2](https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/) |
| Enseignes des stations | [public.opendatasoft.com — prix des carburants J-7](https://public.opendatasoft.com/explore/dataset/prix_des_carburants_j_7/) |
| Prix Espagne | API REST du Ministerio para la Transición Ecológica (`sedeaplicaciones.minetur.gob.es`), filtrée par province |
| Distances routières | [OSRM](https://project-osrm.org/) sur le serveur public de FOSSGIS (`routing.openstreetmap.de`), données © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright) |

### Contraintes des API, et comment elles sont gérées

- **Opendatasoft** limite chaque requête à 100 résultats : le premier appel donne le nombre total, et les pages restantes sont récupérées en parallèle (jusqu'à ~700 stations sur 40 km autour de Paris).
- **API espagnole** : l'endpoint national fait ~12 Mo. On interroge uniquement la province du passage frontière le plus proche (~300 Ko).
- **Serveur OSRM public** : 1 requête par seconde au maximum. Les distances sont demandées par lots de 250 stations (limite de longueur d'URL), les plus proches en premier, avec au moins 1,1 s entre deux requêtes. La liste s'affiche tout de suite avec les distances à vol d'oiseau (marquées « ~ »), puis se met à jour. Chaque lot a un délai maximal et une seconde tentative. Si OSRM ne répond toujours pas, l'appli l'indique et propose de réessayer.

## Structure

```
index.html            Structure de la page
style.css             Styles
app.js                Logique (JavaScript sans framework ni étape de build)
manifest.webmanifest  Installation sur l'écran d'accueil
icons/                Icônes de l'application
```

Hébergé sur GitHub Pages : chaque push sur `main` met le site à jour. Après une modification de `style.css` ou `app.js`, incrémenter le `?v=` dans `index.html` pour que les téléphones ne gardent pas l'ancienne version en cache.

## Lancer en local

La géolocalisation n'est disponible qu'en HTTPS ou sur `localhost` :

```bash
python -m http.server 8000
# puis ouvrir http://localhost:8000
```

## Limites connues

- Le coût du trajet utilise la consommation moyenne du véhicule. Il ne tient compte ni du trafic ni des péages, et le temps affiché est une estimation sans trafic.
- L'itinéraire choisi par l'app de navigation peut différer légèrement de celui d'OSRM : la distance affichée reste une estimation.
- Seuls 4 passages frontière sont pris en compte (Hendaye/Irun, Somport, Puigcerdà, La Jonquera). La recherche espagnole se limite à la province du passage.
- Les prix sont ceux déclarés par les stations : leur ancienneté est affichée sur chaque carte.

## Licence

[MIT](LICENSE)
