# Paete, Laguna — interactive 3D site

A single-page site about Paete, Laguna, with real-time 3D scenes built in three.js (r170):
a landscape hero, Ukit (wood carving), Taka (papier-mâché), St. James the Apostle Parish,
and the climb to Tatlong Krus. Sound is synthesized with the Web Audio API (no audio files).

## Deploy to Cloudflare Workers

The site is plain static files in `site/`. `wrangler.jsonc` tells Cloudflare to serve that
folder as Worker static assets, so there is no Worker script to write.

**From your machine**

```bash
npm install
npx wrangler login
npm run deploy
```

Wrangler prints the live URL (`https://paete.<your-subdomain>.workers.dev`). Change `"name"`
in `wrangler.jsonc` to rename the Worker. Add a custom domain under the Worker's
**Settings → Domains & Routes** in the Cloudflare dashboard.

**Automatic deploys from GitHub (Workers Builds)**

In the Cloudflare dashboard: **Workers & Pages → Create → Import a repository**, pick this
repo, and use:

| Setting | Value |
| --- | --- |
| Build command | *(leave empty)* |
| Deploy command | `npx wrangler deploy` |
| Root directory | `/` |

Every push to `main` then redeploys the site.

## Run it locally

```bash
npm install
npm run dev
```

Then open the URL Wrangler prints (usually http://localhost:8787). Any static server also
works, for example `cd site && python3 -m http.server 8080`. The page loads ES modules and data
files, so opening `index.html` straight from disk will not work.

three.js is loaded from jsDelivr through the import map in `index.html`; fonts come from
Google Fonts. Both need an internet connection.

## Files

| File | What it is |
| --- | --- |
| `site/index.html` | Markup, styles, copy, import map |
| `site/app.js` | All 3D scenes, the church and cross models, interactions and sound |
| `site/paete.json` | OpenStreetMap buildings, roads, streams, trail, church footprint and landmark positions, in local metres around the church |
| `site/terrain.png` | Detail elevation grid (16 m spacing), heights encoded in R/G: `h = (R*256 + G) / 50 - 100` metres |
| `site/context.png` | Wider, coarser elevation grid for the far mountains (same encoding) |
| `site/satellite.jpg`, `site/context.jpg` | Sentinel-2 imagery reprojected onto those grids |
| `site/waternormals.jpg` | Water normal map from the three.js examples (MIT) |
| `site/404.html` | Not-found page served by Cloudflare |
| `site/og-image.jpg` | 1200×630 link-preview image (rendered from the hero scene) |
| `site/favicon.svg`, `site/favicon-32.png`, `site/apple-touch-icon.png` | Site icons |
| `site/robots.txt`, `site/sitemap.xml` | Crawler rules and sitemap for https://paete.jpmadrigal.dev/ |
| `wrangler.jsonc` | Cloudflare Workers config (static assets from `site/`) |
| `data-prep/prep.py` | Rebuilds the data files from the original sources |

## SEO

`index.html` carries the title, description, canonical URL, Open Graph and Twitter card tags,
and schema.org JSON-LD for the site, the author, Paete, St. James the Apostle Parish Church and
Tatlong Krus (with real coordinates). If the site moves to another domain, update the URLs in
those tags, `robots.txt` and `sitemap.xml`.

## Rebuilding the data

`data-prep/prep.py` downloads elevation and imagery tiles, reprojects them into a local metric
frame centred on the church, and writes the files into `site/`. It needs Python 3 with Pillow,
and an `osm.json` export next to it from the Overpass API (buildings, highways, water and
waterways for the Paete area; see the bounding boxes in the script).

```bash
cd data-prep
pip install pillow
python3 prep.py
```

## Credits

- Terrain: AWS Terrain Tiles (Mapzen; includes SRTM data from NASA)
- Imagery: Sentinel-2 cloudless (https://s2maps.eu) by EOX IT Services GmbH, contains modified
  Copernicus Sentinel data 2016, CC BY 4.0
- Map data © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright)
- Facts: Wikipedia (Paete, Paete Church, Three Crosses of Paete), Artes de las Filipinas, PinoyMountaineer

These credits are required by the data licenses; keep the footer credit line if you publish the site.

Made by JP Madrigal — https://www.jpmadrigal.dev
