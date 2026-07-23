# 🏴‍☠️🤗 The Hugging Bay

A community index of BitTorrent magnet links for **openly-licensed** AI models, weights, and
datasets. The Bay never hosts files — it catalogs verified magnets; the fleet of seeders
("Sailors") does the rest.

> Hug more. Gatekeep less. Sailors unite. ⛵

## Quick start

Zero dependencies. Requires Node.js ≥ 22.5 (uses the built-in `node:sqlite`).

```bash
node server.mjs
# → http://localhost:1337
```

First run creates and seeds `bay.db` with a **demo catalog** (real model names, placeholder
infohashes — they don't point at live swarms). To wipe and reseed:

```bash
rm bay.db* && node server.mjs
```

## What's here

- **Search + category filters** (LLMs, Embeddings, Vision, Audio, Agents, Datasets, Applications, Memes)
- **Torrent listings** with seeds/leechers, health score, license tag, upstream source link, and
  webseeds pointing back at Hugging Face mirrors
- **Verification tiers** — Unverified → Community ✔ → Captain 🏴‍☠️✔ (SHA-256 manifest checked
  against the upstream release)
- **Fleet Status** page — total indexed capacity, under-seeded ships that need sailors, crew leaderboard
- **Upload form** with license allowlist enforcement (open, redistributable licenses only)
- **JSON API** (`/api/torrents`, `/api/torrent/<infohash>`, `/api/stats`, `POST /api/torrents`) —
  built for the future one-command torrent-creation CLI
- **Policy page** — open licenses only, takedown process

## Design principles

1. **Index only, never host.** Magnets + infohashes; the swarm carries the bytes.
2. **Verification first.** Every listing links its upstream source; SHA-256 manifests are re-checked
   before the Captain badge.
3. **Open licenses only.** If the license doesn't permit redistribution, it doesn't sail. No gated
   repos, no leaked weights.
4. **Hybrid resilience.** DHT + trackers + webseeds back to upstream mirrors, so models stay
   reachable even if the index goes down.

## Roadmap

- [ ] `bay-cli`: one command to torrent-ify a local HF cache/repo (tuned piece size, webseeds,
      SHA-256 manifest, auto-publish via `POST /api/torrents`)
- [ ] Real swarm scraping (DHT/tracker scrape) to replace stored seed/leech counts
- [ ] Captain verification workflow: re-hash popular torrents against upstream checksums on a schedule
- [ ] Accounts + signed uploads; crew rank progression
- [ ] Catalog-as-torrent / BEP-44 mutable index so the Bay itself can't be taken offline
- [ ] Semantic search over model cards

## License

MIT. The cargo indexed here carries its own licenses — they travel with the torrent.
