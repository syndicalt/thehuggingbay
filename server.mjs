import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getDb, searchTorrents, getTorrent, randomTorrent, categoryCounts,
  fleetStats, insertTorrent, topUploaders, latestCatalog,
  getTorrentFile, getBlob, putBlob,
  CATEGORIES, validateListing,
} from './lib/db.mjs';
import * as views from './lib/views.mjs';
import { esc } from './lib/pages.mjs';
import { llmsTxt, robotsTxt, sitemapXml, OPENAPI } from './lib/discovery.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 1337);
const CSS = readFileSync(join(ROOT, 'public', 'style.css'));
const BANNER = readFileSync(join(ROOT, 'public', 'banner.webp'));
const CARD = readFileSync(join(ROOT, 'public', 'card.jpg'));

getDb(); // open + seed on first run

// Per-IP fixed-window rate limiting (in-memory; matches the Worker's limits).
const buckets = new Map();
function overLimit(ip, kind, limit) {
  const now = Date.now();
  const key = `${kind}:${ip}`;
  let b = buckets.get(key);
  if (!b || now > b.reset) { b = { count: 0, reset: now + 60_000 }; buckets.set(key, b); }
  if (buckets.size > 50_000) for (const [k, v] of buckets) if (now > v.reset) buckets.delete(k);
  return ++b.count > limit;
}

function lucky(url) {
  const q = url.searchParams.get('q') || '';
  const cats = url.searchParams.getAll('cat').filter(Boolean);
  const rows = q || cats.length ? searchTorrents({ q, cats, limit: 500 }) : [randomTorrent()];
  const pick = rows[Math.floor(Math.random() * rows.length)];
  return pick ? `/torrent/${pick.infohash}` : '/';
}

// Shared by the HTML form and the JSON API. Returns { page, infohash } — page is the
// HTML response for the form flow; infohash is set only on success.
function handleSubmit(form) {
  const f = {
    infohash: (form.get('infohash') || '').trim().toLowerCase(),
    name: (form.get('name') || '').trim(),
    category: form.get('category'),
    license: form.get('license'),
    size_bytes: Number(form.get('size_bytes')),
    uploader: (form.get('uploader') || '').trim() || 'anonymous',
    source_url: form.get('source_url') || null,
    description: form.get('description') || null,
    files_json: form.get('files_json') || null,
    webseeds_json: form.get('webseeds_json') || null,
    torrent_b64: form.get('torrent_b64') || null,
  };
  const err = validateListing(f);
  if (err) return { page: views.submitView('', esc(err)) };
  if (getTorrent(f.infohash)) return { page: views.submitView('', 'That infohash is already listed.') };
  insertTorrent({ ...f, size_bytes: Math.round(f.size_bytes), verified: 0 });
  return {
    page: views.submitView(`Listed! <a href="/torrent/${esc(f.infohash)}">View your listing</a> — it is Unverified until a Captain checks the manifest.`),
    infohash: f.infohash,
  };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const path = url.pathname;
  const send = (status, body, type = 'text/html; charset=utf-8') => {
    res.writeHead(status, { 'content-type': type });
    res.end(body);
  };
  const json = (status, obj) => send(status, JSON.stringify(obj, null, 2), 'application/json');
  const redirect = (loc) => { res.writeHead(302, { location: loc }); res.end(); };

  const ip = req.socket.remoteAddress || 'unknown';

  try {
    if (path.startsWith('/api/') && req.method === 'GET' && overLimit(ip, 'r', 120))
      return json(429, { error: 'rate limited — 120 reads/min per IP. Ease off, sailor.' });
    if (req.method === 'POST' && overLimit(ip, 'w', 10))
      return json(429, { error: 'rate limited — 10 writes/min per IP. Ease off, sailor.' });
    if (path === '/llms.txt') return send(200, llmsTxt(), 'text/plain; charset=utf-8');
    if (path === '/robots.txt') return send(200, robotsTxt(), 'text/plain; charset=utf-8');
    if (path === '/openapi.json') return send(200, JSON.stringify(OPENAPI, null, 2), 'application/json');
    if (path === '/sitemap.xml') return send(200, sitemapXml(searchTorrents({ limit: 500 }).map((t) => t.infohash)), 'application/xml');
    if (path === '/style.css') return send(200, CSS, 'text/css');
    if (path === '/banner.webp') return send(200, BANNER, 'image/webp');
    if (path === '/card.jpg') return send(200, CARD, 'image/jpeg');
    if (req.method === 'GET') {
      if (path === '/') return send(200, views.homeView({
        latest: searchTorrents({ sort: 'date', limit: 15 }),
        stats: fleetStats().totals,
      }));
      if (path === '/search') {
        const q = url.searchParams.get('q') || '';
        const cats = url.searchParams.getAll('cat').filter(Boolean);
        const sort = url.searchParams.get('sort') || 'seeds';
        return send(200, views.searchView({ q, cats, sort, rows: searchTorrents({ q, cats, sort, limit: 100 }) }));
      }
      if (path === '/lucky') return redirect(lucky(url));
      if (path === '/recent') return send(200, views.listView('Recent Uploads', 'date', searchTorrents({ sort: 'date', limit: 100 })));
      if (path === '/top100') return send(200, views.listView('Top 100 (by seeds)', 'seeds', searchTorrents({ sort: 'seeds', limit: 100 })));
      if (path === '/browse') return send(200, views.browseIndexView({ counts: categoryCounts() }));
      if (path.startsWith('/browse/')) {
        const cat = path.slice(8);
        if (!CATEGORIES[cat]) return send(404, views.notFoundView('Unknown category.'));
        return send(200, views.browseCatView({ cat, rows: searchTorrents({ cats: [cat], sort: 'seeds', limit: 200 }) }));
      }
      if (path.startsWith('/torrent/') && path.endsWith('.torrent')) {
        const buf = getTorrentFile(path.slice(9, -8).toLowerCase());
        if (!buf) return send(404, 'no .torrent file stored for this listing');
        res.writeHead(200, { 'content-type': 'application/x-bittorrent', 'content-disposition': 'attachment' });
        return res.end(buf);
      }
      if (path.startsWith('/torrent/')) {
        const t = getTorrent(path.slice(9).toLowerCase());
        return t ? send(200, views.detailView(t)) : send(404, views.notFoundView('No such torrent. Lost at sea. 🌊'));
      }
      if (path.startsWith('/ws/_catalog/')) {
        const blob = getBlob(path.slice('/ws/_catalog/'.length));
        return blob ? send(200, blob.buf, blob.type) : send(404, 'not found');
      }
      if (path === '/submit') return send(200, views.submitView());
      if (path === '/fleet') {
        const { totals, underSeeded } = fleetStats();
        return send(200, views.fleetView({ totals, underSeeded, sailors: topUploaders() }));
      }
      if (path === '/catalog') return send(200, views.catalogView({ latest: latestCatalog() }));
      if (path === '/mirrors') return send(200, views.mirrorsView({ latest: latestCatalog() }));
      if (path === '/api/catalog') {
        const c = latestCatalog();
        return c ? json(200, views.torrentJson(c)) : json(404, { error: 'no catalog yet' });
      }
      if (path === '/api') return send(200, views.apiDocsView());
      if (path === '/about') return send(200, views.aboutView());
      if (path === '/policy') return send(200, views.policyView());
      if (path === '/api/stats') return json(200, fleetStats().totals);
      if (path === '/api/torrents') {
        const rows = searchTorrents({
          q: url.searchParams.get('q') || '',
          cats: url.searchParams.getAll('cat').filter(Boolean),
          sort: url.searchParams.get('sort') || 'seeds',
          limit: Number(url.searchParams.get('limit') || 100),
        });
        return json(200, rows.map(views.torrentJson));
      }
      if (path.startsWith('/api/torrent/')) {
        const t = getTorrent(path.slice(13).toLowerCase());
        return t ? json(200, views.torrentJson(t)) : json(404, { error: 'not found' });
      }
    }
    if (req.method === 'POST' && (path === '/submit' || path === '/api/torrents')) {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 512 * 1024) return send(413, 'Too large');
      }
      if (path === '/api/torrents') {
        const data = JSON.parse(body);
        if (Array.isArray(data.webseeds)) data.webseeds_json = JSON.stringify(data.webseeds);
        if (Array.isArray(data.files)) data.files_json = JSON.stringify(data.files);
        const form = new Map(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : v == null ? null : String(v)]));
        const { infohash } = handleSubmit({ get: (k) => form.get(k) });
        return infohash
          ? json(201, views.torrentJson(getTorrent(infohash)))
          : json(400, { error: 'rejected — check fields and license' });
      }
      return send(200, handleSubmit(new URLSearchParams(body)).page);
    }
    return send(404, views.notFoundView());
  } catch (err) {
    console.error(err);
    return send(500, views.errorView());
  }
});

server.listen(PORT, () => {
  console.log(`🏴‍☠️🤗 The Hugging Bay is sailing at http://localhost:${PORT}`);
});
