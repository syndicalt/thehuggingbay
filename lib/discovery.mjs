// Machine-discoverability: llms.txt, robots.txt, OpenAPI, sitemap.
// Shared by the Node server and the Worker.

const SITE = 'https://thehuggingbay.io';

export function llmsTxt() {
  return `# The Hugging Bay

> A community index of BitTorrent magnet links for openly-licensed AI models, weights, and
> datasets. The index stores metadata only — the swarm carries the bytes. Everything here is
> redistributable by license; takedown contact: takedown@thehuggingbay.io.

Agents are welcome. All content is server-rendered HTML; every dataset is also available as
JSON. No keys required. Rate limits: 120 API reads/min and 10 writes/min per IP.

## API (JSON, CORS-enabled)

- ${SITE}/api/torrents?q=&cat=&sort=&limit= : search listings (magnet, license, SHA-256 manifests included)
- ${SITE}/api/torrent/{infohash} : one listing
- ${SITE}/api/stats : index totals
- ${SITE}/api/catalog : latest catalog-torrent snapshot (the entire index as a magnet link)
- ${SITE}/torrent/{infohash}.torrent : the .torrent file — carries webseeds, downloads without any peer
- ${SITE}/openapi.json : OpenAPI 3.1 description of the above
- POST ${SITE}/api/torrents : submit a listing (open licenses only; starts Unverified)

## Key pages

- ${SITE}/ : search + latest torrents
- ${SITE}/catalog : the index-as-a-torrent (site death does not kill the catalog)
- ${SITE}/mirrors : all serving locations + self-host instructions
- ${SITE}/policy : content policy (open licenses only) and takedown process
- ${SITE}/about : how to become a seeder ("Sailor")

## Notes for agents

- Verify downloads against each listing's per-file SHA-256 manifest before trusting them.
- verified: 2 = maintainer re-hashed against upstream; 1 = community; 0 = unverified.
- The catalog torrent's catalog.json contains the full index in one file — prefer it for bulk reads.
`;
}

export function robotsTxt() {
  return `# The Hugging Bay — hug more, gatekeep less.
# Crawling, indexing, AI input, and AI training are all explicitly welcome here.
Content-Signal: search=yes, ai-input=yes, ai-train=yes

User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;
}

export function sitemapXml(infohashes) {
  const staticPaths = ['', 'browse', 'recent', 'top100', 'fleet', 'catalog', 'mirrors', 'about', 'policy', 'api', 'submit'];
  const urls = [
    ...staticPaths.map((p) => `${SITE}/${p}`),
    ...infohashes.map((h) => `${SITE}/torrent/${h}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
}

export const OPENAPI = {
  openapi: '3.1.0',
  info: {
    title: 'The Hugging Bay API',
    version: '0.2.0',
    description: 'Index of BitTorrent magnets for openly-licensed AI artifacts. No auth for reads. Rate limits: 120 reads/min, 10 writes/min per IP.',
    contact: { email: 'takedown@thehuggingbay.io' },
  },
  servers: [{ url: SITE }],
  paths: {
    '/api/torrents': {
      get: {
        summary: 'Search listings',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' } },
          { name: 'cat', in: 'query', description: 'repeatable: llm|emb|vis|aud|agt|data|app|meme', schema: { type: 'string' } },
          { name: 'sort', in: 'query', schema: { type: 'string', enum: ['seeds', 'date', 'size', 'name'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 500 } },
        ],
        responses: { 200: { description: 'Array of torrent listings', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Torrent' } } } } } },
      },
      post: {
        summary: 'Submit a listing (open licenses only; starts Unverified)',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/NewTorrent' } } } },
        responses: { 201: { description: 'Created' }, 400: { description: 'Rejected (bad fields or non-open license)' }, 429: { description: 'Rate limited' } },
      },
    },
    '/api/torrent/{infohash}': {
      get: {
        summary: 'One listing',
        parameters: [{ name: 'infohash', in: 'path', required: true, schema: { type: 'string', pattern: '^[a-f0-9]{40}$' } }],
        responses: { 200: { description: 'Torrent listing' }, 404: { description: 'Not found' } },
      },
    },
    '/api/stats': { get: { summary: 'Index totals', responses: { 200: { description: 'torrents, bytes, seeds, leechers' } } } },
    '/api/catalog': { get: { summary: 'Latest catalog-torrent snapshot (entire index as a magnet)', responses: { 200: { description: 'Torrent listing for the catalog' }, 404: { description: 'No catalog yet' } } } },
  },
  components: {
    schemas: {
      Torrent: {
        type: 'object',
        properties: {
          infohash: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' },
          size_bytes: { type: 'integer' }, seeds: { type: 'integer' }, leechers: { type: 'integer' },
          license: { type: 'string' }, source_url: { type: 'string' }, magnet: { type: 'string' },
          verified: { type: 'integer', description: '0 unverified, 1 community, 2 captain' },
          webseeds: { type: 'array', items: { type: 'string' } },
          files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, size: { type: 'integer' }, sha256: { type: 'string' } } } },
        },
      },
      NewTorrent: {
        type: 'object',
        required: ['name', 'infohash', 'category', 'size_bytes', 'license', 'uploader'],
        properties: {
          name: { type: 'string' }, infohash: { type: 'string', pattern: '^[a-f0-9]{40}$' },
          category: { type: 'string' }, size_bytes: { type: 'integer' }, license: { type: 'string' },
          uploader: { type: 'string' }, source_url: { type: 'string' }, description: { type: 'string' },
          webseeds: { type: 'array', items: { type: 'string' } },
          files: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
};

// schema.org JSON-LD for a torrent detail page.
export function torrentJsonLd(t, magnet) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: t.name,
    description: t.description || `${t.name} — openly-licensed AI artifact distributed via BitTorrent.`,
    url: `${SITE}/torrent/${t.infohash}`,
    license: t.license,
    isBasedOn: t.source_url || undefined,
    dateModified: t.uploaded_at,
    distribution: [{
      '@type': 'DataDownload',
      encodingFormat: 'application/x-bittorrent',
      contentUrl: magnet,
      contentSize: String(t.size_bytes),
    }],
  };
}
