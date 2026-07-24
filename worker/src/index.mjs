// The Hugging Bay index on Cloudflare Workers + D1.
// Rendering is shared with the Node server via ../../lib/views.mjs.
import CSS from '../../public/style.css';
import BANNER from '../../public/banner.webp';
import CARD from '../../public/card.jpg';
import { CATEGORIES, validateListing } from '../../lib/shared.mjs';
import { llmsTxt, robotsTxt, sitemapXml, OPENAPI } from '../../lib/discovery.mjs';
import { esc } from '../../lib/pages.mjs';
import * as views from '../../lib/views.mjs';

const SORTS = {
  seeds: 't.seeds DESC',
  date: 't.uploaded_at DESC',
  size: 't.size_bytes DESC',
  name: 't.name COLLATE NOCASE ASC',
};

const BASE_SELECT = `
  SELECT t.*, u.name AS uploader, u.rank AS uploader_rank
  FROM torrents t LEFT JOIN uploaders u ON u.id = t.uploader_id
`;

async function searchTorrents(db, { q = '', cats = [], sort = 'seeds', limit = 100 } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push('(t.name LIKE ? OR t.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const validCats = cats.filter((c) => CATEGORIES[c]);
  if (validCats.length) {
    where.push(`t.category IN (${validCats.map(() => '?').join(',')})`);
    params.push(...validCats);
  }
  const sql = BASE_SELECT +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ` ORDER BY ${SORTS[sort] || SORTS.seeds} LIMIT ?`;
  params.push(Math.min(Math.max(1, limit || 100), 500));
  return (await db.prepare(sql).bind(...params).all()).results;
}

const getTorrent = (db, infohash) =>
  db.prepare(BASE_SELECT + ' WHERE t.infohash = ?').bind(infohash).first();

async function fleetStats(db) {
  const totals = await db.prepare(`
    SELECT COUNT(*) AS torrents, COALESCE(SUM(size_bytes),0) AS bytes,
           COALESCE(SUM(seeds),0) AS seeds, COALESCE(SUM(leechers),0) AS leechers
    FROM torrents
  `).first();
  const underSeeded = (await db.prepare(
    BASE_SELECT + ' ORDER BY t.seeds ASC, t.size_bytes DESC LIMIT 10'
  ).all()).results;
  return { totals, underSeeded };
}

const topUploaders = async (db) => (await db.prepare(`
  SELECT u.name, u.rank, COUNT(t.id) AS uploads, SUM(t.size_bytes) AS bytes
  FROM uploaders u JOIN torrents t ON t.uploader_id = u.id
  GROUP BY u.id ORDER BY uploads DESC, bytes DESC LIMIT 10
`).all()).results;

const latestCatalog = (db) => db.prepare(
  BASE_SELECT + " WHERE t.name LIKE 'hugging-bay-catalog-%' ORDER BY t.uploaded_at DESC LIMIT 1"
).first();

const categoryCounts = async (db) => (await db.prepare(
  'SELECT category, COUNT(*) AS n, SUM(size_bytes) AS bytes FROM torrents GROUP BY category'
).all()).results;

async function insertTorrent(db, f) {
  await db.prepare('INSERT OR IGNORE INTO uploaders (name) VALUES (?)').bind(f.uploader).run();
  const u = await db.prepare('SELECT id FROM uploaders WHERE name = ?').bind(f.uploader).first();
  await db.prepare(`
    INSERT INTO torrents (infohash, name, category, size_bytes, uploader_id,
      license, source_url, description, verified, files_json, webseeds_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).bind(
    f.infohash, f.name, f.category, Math.round(f.size_bytes), u.id,
    f.license, f.source_url, f.description, f.files_json, f.webseeds_json,
  ).run();
}

// Shared by the HTML form and the JSON API.
async function handleSubmit(db, form) {
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
  if (await getTorrent(db, f.infohash)) return { page: views.submitView('', 'That infohash is already listed.') };
  await insertTorrent(db, f);
  return {
    page: views.submitView(`Listed! <a href="/torrent/${esc(f.infohash)}">View your listing</a> — it is Unverified until a Captain checks the manifest.`),
    infohash: f.infohash,
  };
}

const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

// Fail-open rate limit check: a limiter outage should not take the API down.
async function overLimit(limiter, key) {
  if (!limiter) return false;
  try { return !(await limiter.limit({ key })).success; } catch { return false; }
}

export default {
  async fetch(request, env) {
    const db = env.DB;
    const url = new URL(request.url);
    const path = url.pathname;
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';

    try {
      if (path.startsWith('/api/') && request.method === 'GET' && await overLimit(env.READ_LIMIT, ip))
        return json({ error: 'rate limited — 120 reads/min per IP. Ease off, sailor.' }, 429);
      if (request.method === 'POST' && await overLimit(env.WRITE_LIMIT, ip))
        return json({ error: 'rate limited — 10 writes/min per IP. Ease off, sailor.' }, 429);
      // Webseed shim (BEP-19): clients append "<torrent-name>/<file path>" to a base URL
      // ending in "/". HF resolve URLs need "/resolve/main/" between repo and file, so
      // torrents carry ws=https://thehuggingbay.io/ws/<org>/ and we redirect:
      //   /ws/<org>/<repo>/<file...> -> huggingface.co/<org>/<repo>/resolve/main/<file...>
      if (path.startsWith('/ws/')) {
        const [org, repo, ...file] = path.slice(4).split('/');
        if (!org || !repo || !file.length) return new Response('bad webseed path', { status: 400 });
        return Response.redirect(
          `https://huggingface.co/${org}/${repo}/resolve/main/${file.join('/')}`, 302,
        );
      }

      const text = (body, type) => new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=3600' } });
      if (path === '/llms.txt') return text(llmsTxt(), 'text/plain; charset=utf-8');
      if (path === '/robots.txt') return text(robotsTxt(), 'text/plain; charset=utf-8');
      if (path === '/openapi.json') return text(JSON.stringify(OPENAPI, null, 2), 'application/json');
      if (path === '/sitemap.xml') {
        const rows = (await db.prepare('SELECT infohash FROM torrents ORDER BY seeds DESC LIMIT 500').all()).results;
        return text(sitemapXml(rows.map((r) => r.infohash)), 'application/xml');
      }
      if (path === '/style.css')
        return new Response(CSS, { headers: { 'content-type': 'text/css', 'cache-control': 'public, max-age=3600' } });
      if (path === '/banner.webp')
        return new Response(BANNER, { headers: { 'content-type': 'image/webp', 'cache-control': 'public, max-age=86400' } });
      if (path === '/card.jpg')
        return new Response(CARD, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=86400' } });

      if (request.method === 'GET') {
        if (path === '/') return html(views.homeView({
          latest: await searchTorrents(db, { sort: 'date', limit: 15 }),
          stats: (await fleetStats(db)).totals,
        }));
        if (path === '/search') {
          const q = url.searchParams.get('q') || '';
          const cats = url.searchParams.getAll('cat').filter(Boolean);
          const sort = url.searchParams.get('sort') || 'seeds';
          return html(views.searchView({ q, cats, sort, rows: await searchTorrents(db, { q, cats, sort }) }));
        }
        if (path === '/lucky') {
          const q = url.searchParams.get('q') || '';
          const cats = url.searchParams.getAll('cat').filter(Boolean);
          const rows = await searchTorrents(db, { q, cats, limit: 500 });
          const pick = rows[Math.floor(Math.random() * rows.length)];
          return Response.redirect(url.origin + (pick ? `/torrent/${pick.infohash}` : '/'), 302);
        }
        if (path === '/recent') return html(views.listView('Recent Uploads', 'date', await searchTorrents(db, { sort: 'date' })));
        if (path === '/top100') return html(views.listView('Top 100 (by seeds)', 'seeds', await searchTorrents(db, { sort: 'seeds' })));
        if (path === '/browse') return html(views.browseIndexView({ counts: await categoryCounts(db) }));
        if (path.startsWith('/browse/')) {
          const cat = path.slice(8);
          if (!CATEGORIES[cat]) return html(views.notFoundView('Unknown category.'), 404);
          return html(views.browseCatView({ cat, rows: await searchTorrents(db, { cats: [cat], limit: 200 }) }));
        }
        if (path.startsWith('/torrent/')) {
          const t = await getTorrent(db, path.slice(9).toLowerCase());
          return t ? html(views.detailView(t)) : html(views.notFoundView('No such torrent. Lost at sea. 🌊'), 404);
        }
        if (path === '/submit') return html(views.submitView());
        if (path === '/fleet') {
          const { totals, underSeeded } = await fleetStats(db);
          return html(views.fleetView({ totals, underSeeded, sailors: await topUploaders(db) }));
        }
        if (path === '/catalog') return html(views.catalogView({ latest: await latestCatalog(db) }));
        if (path === '/mirrors') return html(views.mirrorsView({ latest: await latestCatalog(db) }));
        if (path === '/api/catalog') {
          const c = await latestCatalog(db);
          return c ? json(views.torrentJson(c)) : json({ error: 'no catalog yet' }, 404);
        }
        if (path === '/api') return html(views.apiDocsView());
        if (path === '/about') return html(views.aboutView());
        if (path === '/policy') return html(views.policyView());
        if (path === '/api/stats') return json((await fleetStats(db)).totals);
        if (path === '/api/torrents') {
          const rows = await searchTorrents(db, {
            q: url.searchParams.get('q') || '',
            cats: url.searchParams.getAll('cat').filter(Boolean),
            sort: url.searchParams.get('sort') || 'seeds',
            limit: Number(url.searchParams.get('limit') || 100),
          });
          return json(rows.map(views.torrentJson));
        }
        if (path.startsWith('/api/torrent/')) {
          const t = await getTorrent(db, path.slice(13).toLowerCase());
          return t ? json(views.torrentJson(t)) : json({ error: 'not found' }, 404);
        }
      }

      if (request.method === 'POST' && path === '/api/scrape') {
        const auth = request.headers.get('authorization') || '';
        if (!env.SCRAPE_TOKEN || auth !== `Bearer ${env.SCRAPE_TOKEN}`)
          return json({ error: 'unauthorized' }, 401);
        const { updates } = await request.json();
        if (!Array.isArray(updates) || updates.length > 2000) return json({ error: 'bad payload' }, 400);
        const stmt = db.prepare('UPDATE torrents SET seeds = ?, leechers = ? WHERE infohash = ?');
        await db.batch(updates
          .filter((u) => /^[a-f0-9]{40}$/.test(u.infohash || ''))
          .map((u) => stmt.bind(Math.max(0, u.seeds | 0), Math.max(0, u.leechers | 0), u.infohash)));
        return json({ ok: true, updated: updates.length });
      }

      if (request.method === 'POST' && (path === '/submit' || path === '/api/torrents')) {
        if (path === '/api/torrents') {
          const data = await request.json();
          if (Array.isArray(data.webseeds)) data.webseeds_json = JSON.stringify(data.webseeds);
          if (Array.isArray(data.files)) data.files_json = JSON.stringify(data.files);
          const form = new Map(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : v == null ? null : String(v)]));
          const { infohash } = await handleSubmit(db, { get: (k) => form.get(k) });
          return infohash
            ? json(views.torrentJson(await getTorrent(db, infohash)), 201)
            : json({ error: 'rejected — check fields and license' }, 400);
        }
        const form = new URLSearchParams(await request.text());
        return html((await handleSubmit(db, form)).page);
      }

      return html(views.notFoundView(), 404);
    } catch (err) {
      console.error(err);
      return html(views.errorView(), 500);
    }
  },
};
