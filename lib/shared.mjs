// Runtime-agnostic constants and helpers, shared by the Node server and the Cloudflare Worker.

export const CATEGORIES = {
  llm:  { label: 'LLM',  color: '#e2d5f5', name: 'LLMs' },
  emb:  { label: 'EMB',  color: '#cfe3f7', name: 'Embeddings' },
  vis:  { label: 'VIS',  color: '#f7d9cf', name: 'Vision' },
  aud:  { label: 'AUD',  color: '#f5eec9', name: 'Audio' },
  agt:  { label: 'AGT',  color: '#d9f0d9', name: 'Agents' },
  data: { label: 'DATA', color: '#ccf0da', name: 'Datasets' },
  app:  { label: 'APP',  color: '#f5e6c9', name: 'Applications' },
  meme: { label: 'MEME', color: '#f7cfe3', name: 'Memes' },
};

// Licenses the Bay accepts: must permit redistribution of the artifact.
export const OPEN_LICENSES = [
  'Apache-2.0', 'MIT', 'Modified-MIT', 'BSD-3-Clause', 'GPL-3.0', 'AGPL-3.0',
  'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'CC-BY-NC-4.0',
  'ODC-By-1.0', 'OpenRAIL', 'OpenRAIL++-M',
  'Llama-3.1-Community', 'Gemma', 'Qwen-License', 'Other-Open',
];

export const TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.torrent.eu.org:451/announce',
];

export function magnetFor(t) {
  const ws = t.webseeds_json ? JSON.parse(t.webseeds_json) : [];
  const parts = [
    `xt=urn:btih:${t.infohash}`,
    `dn=${encodeURIComponent(t.name)}`,
    ...TRACKERS.map((tr) => `tr=${encodeURIComponent(tr)}`),
    ...ws.map((w) => `ws=${encodeURIComponent(w)}`),
  ];
  return `magnet:?${parts.join('&')}`;
}

// Validate an upload (form or API). Returns an error string, or null if acceptable.
export function validateListing(f) {
  if (!/^[a-f0-9]{40}$/.test(f.infohash || '')) return 'Infohash must be 40 hex characters.';
  if (!f.name) return 'Name is required.';
  if (!CATEGORIES[f.category]) return 'Invalid category.';
  if (!OPEN_LICENSES.includes(f.license)) return 'License must be one of the accepted open licenses.';
  if (!Number.isFinite(f.size_bytes) || f.size_bytes < 1) return 'Size must be a positive number of bytes.';
  return null;
}
