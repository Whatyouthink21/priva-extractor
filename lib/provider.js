import { createHash, createDecipheriv } from 'node:crypto';
export const BASE = 'https://vidstuck.cc';
const PASSPHRASE = "7f4c9e2a81d63b05c4f7a9e8126d3b50e1a8c7f23d9465ab0c6e9f1d4a7b832c";
export const API_KEYS = {
    tmdbId: "a7f39c821d604e5b9c1e547b",
    mediaType: "c281b306d28147a35632e816b",
    server: "6b491e7258d392e7561a9384c",
    season: "d8427b59c38a2f957c3613e85b",
    episode: "91c6e4a753d1f785c92346b713d",
    ts: "61d9a5274c8e3b29f38c291e6",
    token: "c492f7a183d601e436c538a716d",
    title: "5e28c9147a306d1e29f3674b392a1",
    year: "b731e6c94f08675f8341c306e",
    date: "e1649321a39e5814b3027",
    imdbId: "f35a8c1943265e871c4933a725f",
  };
export const SERVERS = ['orion', 'andromeda', 'atlas', 'daedalus', 'ursa'];
export function decryptLink(encoded) {
  const raw = Buffer.from(encoded, 'base64');
  if (raw.subarray(0, 8).toString() !== 'Salted__' || raw.length < 32) throw new Error('Invalid encrypted link');
  const salt = raw.subarray(8,16);
  let derived = Buffer.alloc(0), block = Buffer.alloc(0);
  while (derived.length < 48) {
    block = createHash('md5').update(Buffer.concat([block, Buffer.from(PASSPHRASE), salt])).digest();
    derived = Buffer.concat([derived, block]);
  }
  const cipher = createDecipheriv('aes-256-cbc', derived.subarray(0,32), derived.subarray(32,48));
  const plain = Buffer.concat([cipher.update(raw.subarray(16)), cipher.final()]).toString('utf8');
  if (!/^https?:\/\/|^\/(?!\/)/.test(plain)) throw new Error('Invalid stream URL');
  return new URL(plain, BASE).href;
}
export function parseInput(input) {
  let { type = 'movie', tmdbId, season = 1, episode = 1 } = input;
  if (input.embed) {
    const u = new URL(input.embed);
    if (u.hostname !== 'vidstuck.cc' || !['http:', 'https:'].includes(u.protocol)) throw new Error('Use a vidstuck.cc embed URL');
    const match = u.pathname.match(/^\/embed\/(movie|tv)\/(\d+)(?:\/(\d+)\/(\d+))?\/?$/);
    if (!match) throw new Error('Expected /embed/movie/ID or /embed/tv/ID/SEASON/EPISODE');
    [,type,tmdbId,season = 1,episode = 1] = match;
  }
  if (!['movie','tv'].includes(type)) throw new Error('Invalid media type');
  for (const n of [tmdbId, season, episode]) if (!/^\d+$/.test(String(n)) || !Number.isSafeInteger(Number(n)) || Number(n) < 1) throw new Error('IDs, season and episode must be positive integers');
  return { ...input, type, tmdbId: Number(tmdbId), season: Number(season), episode: Number(episode) };
}
export async function extract(input, request) {
  const media = parseInput(input);
  const embed = `${BASE}/embed/${media.type}/${media.tmdbId}${media.type === 'tv' ? `/${media.season}/${media.episode}` : ''}`;
  const headers = { Origin: BASE, Referer: embed, 'User-Agent': 'Mozilla/5.0' };
  const diagnostics = [];
  async function query(server, endpoint) {
    const fields = { tmdbId: media.tmdbId, mediaType: media.type, server, ...(media.type === 'tv' ? {season: media.season, episode: media.episode} : {}) };
    const payload = Object.fromEntries(Object.entries(fields).map(([k,v]) => [API_KEYS[k],v]));
    const auth = await request(`${BASE}/backend/vidstuck`, { method: 'POST', data: payload, headers });
    if (!auth.data?.token || !auth.data?.ts) throw new Error('Token response missing token/ts');
    const params = new URLSearchParams(payload);
    for (const [k,v] of Object.entries({token: auth.data.token, ts: auth.data.ts, date: media.date || (media.year ? `${media.year}-01-01` : '2020-01-01'), title: media.title, year: media.year, imdbId: media.imdbId})) {
      if (v) params.set(API_KEYS[k], String(v));
    }
    return (await request(`${BASE}/backend/${endpoint}?${params}`, {headers})).data;
  }
  const captionsPromise = query('subtitle', 'subtitle').then(d => (d.captions || []).filter(c=>c.file).map(c=>({title:c.display || 'Subtitle', uri:c.file}))).catch(()=>[]);
  const groups = await Promise.all(SERVERS.map(async server => {
    try {
      const data = await query(server, `servers/${server}`);
      const streams = [];
      for (const item of data.links || []) {
        try {
          const link = decryptLink(item.link);
          const type = item.type === 'dash' || link.includes('database/andromeda') ? 'dash' : item.type === 'hls' || /\.m3u8|atlas|ursa|daedalus/.test(link) ? 'm3u8' : 'mp4';
          streams.push({server, link, type, quality: String(item.resolution || '1080'), headers: {Origin: BASE, Referer: BASE+'/', 'User-Agent': 'Mozilla/5.0'}});
        } catch (e) { diagnostics.push({server, error:e.message}); }
      }
      if (!streams.length) diagnostics.push({server, error:'No usable links returned'});
      return streams;
    } catch (e) { diagnostics.push({server, error:e.message}); return []; }
  }));
  return {streams:groups.flat(), subtitles:await captionsPromise, diagnostics};
}
