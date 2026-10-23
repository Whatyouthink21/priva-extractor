import express from 'express';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { extract } from './lib/provider.js';
import { request, rewriteHls } from './lib/network.js';
const app = express(), secret = randomBytes(32);
app.disable('x-powered-by');
app.use(express.json({limit:'16kb'}));
app.use((req,res,next)=> {res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('X-Content-Type-Options','nosniff'); next();});
app.use(express.static('public'));
app.get('/vendor/hls.js', (req,res)=>res.sendFile(`${process.cwd()}/node_modules/hls.js/dist/hls.min.js`));
const sign = (url, expires) => createHmac('sha256',secret).update(`${expires}\n${url}`).digest('hex');
function relay(url, expires = Date.now()+2*60*60*1000) { return `/api/media?${new URLSearchParams({url,expires:String(expires),sig:sign(url,expires)})}`; }
const active = new Map();
app.post('/api/extract', async (req,res,next)=> {
  const key = req.ip;
  if ((active.get(key)||0) >= 2) return res.status(429).json({error:'Two extractions already running. Please wait.'});
  active.set(key,(active.get(key)||0)+1);
  try {
    const result = await extract(req.body,request);
    result.streams = result.streams.map(s=>({...s, playbackUrl: s.type === 'dash' ? null : relay(s.link)}));
    res.setHeader('Cache-Control','no-store');
    res.json(result);
  } catch(e) {next(e);} finally {active.set(key,active.get(key)-1); if (!active.get(key)) active.delete(key);}
});
app.get('/api/media', async (req,res,next)=> {
  try {
    const {url,expires,sig} = req.query;
    if (typeof url !== 'string' || typeof sig !== 'string' || !/^\d+$/.test(expires) || Number(expires) < Date.now()) return res.status(403).send('Expired media link');
    const expected = sign(url,expires);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return res.status(403).send('Invalid media signature');
    const headers = {Origin:'https://vidstuck.cc',Referer:'https://vidstuck.cc/','User-Agent':'Mozilla/5.0'};
    if (req.headers.range) headers.Range = req.headers.range;
    const upstream = await request(url,{headers,responseType:'stream'});
    req.on('aborted',()=>upstream.data.destroy());
    const mime = upstream.headers['content-type'] || '';
    if (/mpegurl/i.test(mime) || /\.m3u8(?:\?|$)/i.test(upstream.finalUrl)) {
      let size=0; const chunks=[];
      for await (const chunk of upstream.data) {size+=chunk.length; if (size>2*1024*1024) {upstream.data.destroy(); throw new Error('Manifest too large');} chunks.push(chunk);}
      res.type('application/vnd.apple.mpegurl').send(rewriteHls(Buffer.concat(chunks).toString(),upstream.finalUrl,u=>relay(u,expires)));
    } else {
      res.status(upstream.status);
      for (const h of ['content-type','content-length','content-range','accept-ranges']) if(upstream.headers[h]) res.setHeader(h,upstream.headers[h]);
      res.setHeader('Cache-Control','private, no-store');
      await pipeline(upstream.data,res);
    }
  } catch(e) {if (!res.headersSent) next(e); else res.destroy();}
});
app.use((err,req,res,next)=>res.status(400).json({error:err.message || 'Request failed'}));
app.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Player listening on port '+(process.env.PORT||3000)));
