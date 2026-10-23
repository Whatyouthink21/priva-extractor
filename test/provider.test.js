import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createCipheriv } from 'node:crypto';
import { decryptLink, parseInput, extract, API_KEYS } from '../lib/provider.js';
import { rewriteHls } from '../lib/network.js';
function encrypt(text) {
  const salt=Buffer.from('12345678'), pass=Buffer.from('7f4c9e2a81d63b05c4f7a9e8126d3b50e1a8c7f23d9465ab0c6e9f1d4a7b832c');
  let key=Buffer.alloc(0), d=Buffer.alloc(0);
  while(key.length<48){d=createHash('md5').update(Buffer.concat([d,pass,salt])).digest();key=Buffer.concat([key,d]);}
  const cipher=createCipheriv('aes-256-cbc',key.subarray(0,32),key.subarray(32,48));
  return Buffer.concat([Buffer.from('Salted__'),salt,cipher.update(text),cipher.final()]).toString('base64');
}
test('OpenSSL salted link decoding and validation',()=>{
  assert.equal(decryptLink(encrypt('/media/test.m3u8')),'https://vidstuck.cc/media/test.m3u8');
  assert.throws(()=>decryptLink('broken'));
  assert.throws(()=>decryptLink(encrypt('javascript:alert(1)')));
});
test('movie and TV embed parsing',()=>{
  assert.equal(parseInput({embed:'https://vidstuck.cc/embed/movie/123'}).tmdbId,123);
  assert.equal(parseInput({embed:'https://vidstuck.cc/embed/tv/123/2/3'}).episode,3);
  assert.throws(()=>parseInput({embed:'https://evil.example/embed/movie/123'}));
  assert.throws(()=>parseInput({tmdbId:-1}));
});
test('provider exchanges tokens, passes TV metadata and tolerates failed server',async()=>{
  const calls=[];
  const result=await extract({type:'tv',tmdbId:123,season:2,episode:3},async(url,config)=>{
    calls.push({url,config});
    if(config.method==='POST') {
      assert.equal(config.data[API_KEYS.season],2);
      return {data:{token:'test-token',ts:123}};
    }
    assert.equal(new URL(url).searchParams.get(API_KEYS.token),'test-token');
    if(url.includes('/subtitle?'))return {data:{captions:[{file:'https://cdn.example/sub.vtt',display:'English'}]}};
    if(url.includes('/servers/atlas'))throw Error('mock server failure');
    return {data:{links:[{link:encrypt('https://cdn.example/master.m3u8'),type:'hls',resolution:720}]}};
  });
  assert.equal(result.streams.length,4);assert.equal(result.subtitles.length,1);
  assert.equal(calls.length,12);assert.ok(result.diagnostics.some(d=>d.server==='atlas'));
});
test('HLS rewrites child playlists, segments, keys and audio URIs',()=>{
  const source='#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-MEDIA:TYPE=AUDIO,URI="/audio.m3u8"\nsub/child.m3u8\nhttps://cdn.example/seg.ts\n';
  const out=rewriteHls(source,'https://cdn.example/root/master.m3u8',u=>'proxy:'+u);
  assert.ok(out.includes('URI="proxy:https://cdn.example/root/key"'));
  assert.ok(out.includes('proxy:https://cdn.example/audio.m3u8'));
  assert.ok(out.includes('proxy:https://cdn.example/root/sub/child.m3u8'));
  assert.ok(out.includes('proxy:https://cdn.example/seg.ts'));
});
