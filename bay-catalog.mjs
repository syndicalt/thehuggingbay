#!/usr/bin/env node
// bay-catalog: snapshot the entire index into a dated catalog torrent, seed it, list it.
// The Bay outlives the Bay: anyone seeding the catalog carries the whole map.
//
//   node bay-catalog.mjs            # snapshot https://thehuggingbay.io
//   BAY_INDEX=... node bay-catalog.mjs
//
// Runs from a timer on the fleet box. Requires the local qBittorrent WebUI for seeding.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const INDEX = process.env.BAY_INDEX || 'https://thehuggingbay.io';
const FLEET = process.env.BAY_FLEET || join(homedir(), 'bay-fleet');
const QBT = process.env.BAY_QBT || 'http://localhost:8090';

const date = new Date().toISOString().slice(0, 10);
const name = `hugging-bay-catalog-${date}`;
const dir = join(FLEET, name);

const torrents = await (await fetch(`${INDEX}/api/torrents?limit=500`)).json();
const stats = await (await fetch(`${INDEX}/api/stats`)).json();

// Skip if nothing changed since the last snapshot (compare infohash sets + names).
const prev = await (await fetch(`${INDEX}/api/catalog`)).json().catch(() => null);
// Fingerprint excludes catalog snapshots themselves, else every snapshot "changes" the index.
const fingerprint = torrents
  .filter((t) => !t.name.startsWith('hugging-bay-catalog-'))
  .map((t) => t.infohash).sort().join(',');
if (prev && !process.env.BAY_FORCE) {
  try {
    const prevCatalog = prev.description?.match(/fingerprint:([a-f0-9,]+)/)?.[1];
    if (prevCatalog === fingerprint) {
      console.log('catalog unchanged since last snapshot — skipping (BAY_FORCE=1 to override)');
      process.exit(0);
    }
  } catch { /* fall through and snapshot */ }
}

mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'catalog.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  index: INDEX,
  stats,
  torrents,
}, null, 2));
writeFileSync(join(dir, 'README.md'), `# The Hugging Bay — catalog snapshot ${date}

This is the complete index of ${INDEX} as of ${date}: ${torrents.length} listings,
${(stats.bytes / 1024 ** 3).toFixed(1)} GiB of openly-licensed AI artifacts.

- \`catalog.json\` — every listing with magnet link, infohash, license, upstream source,
  and per-file SHA-256 manifest. Same shape as the live API.
- Extract all magnets: \`jq -r '.torrents[].magnet' catalog.json\`
- Verify a download against its manifest before trusting it.

Seed this torrent and you carry the whole map. If the site is gone, the swarm remains.
This snapshot is CC0 — mirror it, fork it, rehost it. Sailors unite. ⛵🤗
`);

// The catalog isn't HF-backed, so give it a webseed served from the Worker's blob store.
// Client appends "<torrent-name>/<file>" to this base (BEP-19).
const WS_CATALOG = `${INDEX}/ws/_catalog/`;

// Create + publish via bay-cli (dir name == torrent name, so seeding rechecks cleanly).
const r = spawnSync('node', [join(ROOT, 'bay-cli.mjs'), 'create', dir,
  '--license', 'CC0-1.0', '--category', 'data',
  '--source', `${INDEX}/catalog`,
  '--webseed', WS_CATALOG,
  '--uploader', process.env.BAY_UPLOADER || 'the-bay-itself',
  '--description', `Full index snapshot ${date}: ${torrents.length} listings. fingerprint:${fingerprint}`,
], { stdio: ['ignore', 'inherit', 'inherit'] });
if (r.status !== 0) process.exit(r.status);

// Upload the catalog files to the Worker's blob store so the webseed can serve them.
const TOKEN = process.env.BAY_SCRAPE_TOKEN;
if (TOKEN) {
  for (const [file, type] of [['catalog.json', 'application/json'], ['README.md', 'text/markdown']]) {
    const res = await fetch(`${INDEX}/api/blob`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        path: `${name}/${file}`,
        content_b64: readFileSync(join(dir, file)).toString('base64'),
        content_type: type,
      }),
    });
    console.log(`blob ${name}/${file}: ${res.status}`);
  }
} else {
  console.warn('BAY_SCRAPE_TOKEN not set — catalog webseed blobs NOT uploaded (peer-only until fixed)');
}

// Seed it.
const torrentPath = join(FLEET, 'torrents', `${name}.torrent`);
const add = spawnSync('curl', ['-s', '-X', 'POST', `${QBT}/api/v2/torrents/add`,
  '-F', `torrents=@${torrentPath}`, '-F', `savepath=${FLEET}`]);
console.log('qbittorrent add:', add.stdout.toString().trim() || add.status);
const manifest = JSON.parse(readFileSync(join(FLEET, 'torrents', `${name}.manifest.json`), 'utf8'));
console.log(`⚓ catalog ${name} live: ${INDEX}/torrent/${manifest.infohash}`);
