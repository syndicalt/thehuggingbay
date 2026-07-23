import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  getDb, searchTorrents, getTorrent, randomTorrent, categoryCounts,
  fleetStats, insertTorrent, topUploaders,
  CATEGORIES, validateListing,
} from './lib/db.mjs';
import * as views from './lib/views.mjs';
import { esc } from './lib/pages.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 1337);
const CSS = readFileSync(join(ROOT, 'public', 'style.css'));

getDb(); // open + seed on first run

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

  try {
    if (path === '/style.css') return send(200, CSS, 'text/css');
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
      if (path.startsWith('/torrent/')) {
        const t = getTorrent(path.slice(9).toLowerCase());
        return t ? send(200, views.detailView(t)) : send(404, views.notFoundView('No such torrent. Lost at sea. 🌊'));
      }
      if (path === '/submit') return send(200, views.submitView());
      if (path === '/fleet') {
        const { totals, underSeeded } = fleetStats();
        return send(200, views.fleetView({ totals, underSeeded, sailors: topUploaders() }));
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
