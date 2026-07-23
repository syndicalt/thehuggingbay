# 🏴‍☠️🤗 The Hugging Bay

A community index of BitTorrent magnet links for **openly-licensed** AI models, weights, and
datasets. The Bay never hosts files — it catalogs verified magnets; the fleet of seeders
("Sailors") does the rest.

> Hug more. Gatekeep less. Sailors unite. ⛵

Live index: **https://thehuggingbay.io** (Cloudflare Worker + D1)

## Components

| Piece | What it does |
|---|---|
| `worker/` | Production index on Cloudflare Workers + D1: full site, JSON API, webseed redirect shim, scrape ingest |
| `server.mjs` | Same site as a zero-dep Node app (local dev + self-hosted mirrors), SQLite via `node:sqlite` |
| `bay-cli.mjs` | One command: HF repo → verified torrent (+ SHA-256 manifest) → published listing |
| `bay-scrape.mjs` | BEP-15 UDP tracker scrape → pushes real seed/leech counts to the index |
| `build-static.mjs` | Static export of the whole site for GitHub Pages / mirror hosting |
| `lib/` | Shared rendering + validation used by both the Node server and the Worker |

## Quick start (local mirror)

Zero dependencies. Requires Node.js ≥ 22.5.

```bash
node server.mjs        # http://localhost:1337 — seeds a demo catalog on first run
```

## Create + publish a torrent

```bash
node bay-cli.mjs create openai/whisper-large-v3
```

This downloads the repo (via `hf`), refuses gated repos, auto-maps the HF license tag
(unmapped licenses require an explicit `--license`), hashes every file (SHA-256 manifest +
torrent pieces in one pass), writes `~/bay-fleet/torrents/<name>.torrent` + manifest JSON,
and publishes the listing to the index. Add the .torrent to any client pointed at
`~/bay-fleet` and you're seeding. `--no-publish`, `--skip-download`, `--license`,
`--category`, `--uploader` are available; see `node bay-cli.mjs` for all options.

### Webseeds

Torrents carry a webseed base of `https://thehuggingbay.io/ws/<org>/` (BEP-19). Clients
append `<repo>/<file>`, and the Worker 302-redirects to
`https://huggingface.co/<org>/<repo>/resolve/main/<file>` — so every torrent can draw from
Hugging Face's CDN even with zero peers, and the swarm keeps working if HF goes away.

## Swarm stats

`bay-scrape.mjs` scrapes the tracker list for every listed infohash and POSTs real
seed/leech counts to `POST /api/scrape` (bearer token, `SCRAPE_TOKEN` Worker secret).
Run it anywhere via cron/systemd; a 30-min systemd user timer ships in this repo's
deploy notes. Dry-run a specific torrent: `node bay-scrape.mjs <infohash>`.

## Worker deploy

```bash
cd worker
npx wrangler d1 create hugging-bay          # put the id in wrangler.jsonc
npx wrangler d1 execute hugging-bay --remote --file schema.sql
npx wrangler secret put SCRAPE_TOKEN
npx wrangler deploy                          # custom domains: thehuggingbay.io, www
```

## Design principles

1. **Index only, never host.** Magnets + infohashes; the swarm carries the bytes.
2. **Verification first.** Every listing links its upstream source and carries a per-file
   SHA-256 manifest; Captains re-check before the 🏴‍☠️✔ badge.
3. **Open licenses only.** If the license doesn't permit redistribution, it doesn't sail.
   `bay-cli` enforces this at creation time; the index enforces it at submission time.
4. **Hybrid resilience.** DHT + trackers + webseeds back to upstream mirrors.

## Roadmap

- [ ] Captain verification workflow (signed re-hash attestations → verified badge)
- [ ] DHT scrape fallback for trackerless swarms
- [ ] Dataset repo support in bay-cli (`datasets/` resolve paths in the webseed shim)
- [ ] Accounts + signed uploads; crew rank progression
- [ ] Catalog-as-torrent / BEP-44 mutable index so the Bay itself can't be taken offline
- [ ] Semantic search over model cards

## License

MIT. The cargo indexed here carries its own licenses — they travel with the torrent.
