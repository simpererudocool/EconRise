# Made with Natural Earth

Source country and first-order administrative boundary data: Natural Earth.

- License: **public domain**, including modified/redistributed/commercial use.
- Terms: https://www.naturalearthdata.com/about/terms-of-use/
- Country layer: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/
- Province layer: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/
- Upstream reference: https://github.com/nvkelso/natural-earth-vector

This game uses user-provided local GeoJSON copies. Actual SHA-256 hashes and filenames are recorded in sources.json; referenced upstream URLs do not prove the local copies' release version. The build labels them “Natural Earth (local copy)”.

The processor simplifies geometry for browser display, projects longitude/latitude to an equirectangular map, retains original subdivision IDs, derives shared-edge adjacency and exterior-border entry metadata, and bundles only 24 playable countries' subdivisions. All countries are drawn as background geography; only the 24 configured countries are playable. No runtime mapping provider, credential or network fetch beyond same-origin static assets is used.

These are cartographic references, not legally authoritative, current survey boundaries. Natural Earth defaults to de facto boundaries, and Admin-1 is a beta dataset. Disputed territories and differing country subdivision systems are not political endorsements. The UK layer has 232 local administrative areas, not eight comparable large provinces; Australia includes small offshore territories. Internal command costs are per action, while country starting reserves remain equal. Military control in EconRise is fictional and layered over these reference geometries.
