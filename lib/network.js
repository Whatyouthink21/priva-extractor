import axios from 'axios';
import { lookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
export function publicLookup(host, options, callback) {
  lookup(host, {...options, all:true}, (error, records) => {
    if (error) return callback(error);
    if (!records.length || records.some(r => ipaddr.process(r.address).range() !== 'unicast')) return callback(new Error('Private or reserved network destination blocked'));
    if (options.all) callback(null, records);
    else callback(null, records[0].address, records[0].family);
  });
}
const client = axios.create({timeout:15000, proxy:false, maxRedirects:0, maxContentLength:8*1024*1024, httpAgent:new http.Agent({lookup:publicLookup}), httpsAgent:new https.Agent({lookup:publicLookup})});
export async function request(url, config = {}, depth = 0) {
  const u = new URL(url);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || (u.port && !['80','443'].includes(u.port))) throw new Error('Unsupported destination');
  const res = await client(url, {...config, validateStatus:()=>true});
  if ([301,302,303,307,308].includes(res.status)) {
    res.data?.destroy?.();
    if (depth >= 4 || !res.headers.location) throw new Error('Too many redirects');
    return request(new URL(res.headers.location, url).href, {...config, ...(res.status === 303 ? {method:'GET',data:undefined} : {})}, depth+1);
  }
  if (res.status < 200 || res.status >= 300) { res.data?.destroy?.(); throw new Error(`Upstream HTTP ${res.status}`); }
  res.finalUrl = url;
  return res;
}
export function rewriteHls(text, base, relay) {
  return text.split('\n').map(line => {
    if (line.startsWith('#')) return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${relay(new URL(uri,base).href)}"`);
    return line.trim() ? relay(new URL(line.trim(),base).href) : line;
  }).join('\n');
}
