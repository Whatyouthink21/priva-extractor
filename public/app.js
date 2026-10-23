const $ = id => document.getElementById(id);
let hls;
function status(text,state='IDLE') {$('status').textContent=text;$('state').textContent=state;}
function reset(){if(hls){hls.destroy();hls=null;}$('video').pause();$('video').removeAttribute('src');$('video').load();}
$('type').onchange=()=>{$('episodes').hidden=$('type').value!=='tv';};
$('form').onsubmit=async e=>{
  e.preventDefault(); reset(); $('video').hidden=true;$('empty').hidden=false;$('sources').replaceChildren();$('resolve').disabled=true;$('diagnostics').textContent='Contacting provider…';status('Requesting server tokens and resolving encrypted links…','RESOLVING');
  try {
    const body=Object.fromEntries(new FormData(e.target));
    const res=await fetch('/api/extract',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await res.json();if(!res.ok)throw Error(data.error);
    $('diagnostics').textContent=JSON.stringify({diagnostics:data.diagnostics,subtitles:data.subtitles,streams:data.streams.map(({server,type,quality})=>({server,type,quality}))},null,2);
    if(!data.streams.length){status('No streams resolved. Check extraction details. The provider may be unreachable or its API may have changed.','NO STREAMS');return;}
    status(`${data.streams.length} streams resolved. Choose a server below. DASH sources are listed for inspection only.`,'RESOLVED');
    data.streams.forEach(stream=>{
      const button=document.createElement('button');button.className='source';button.textContent=`${stream.server.toUpperCase()} · ${stream.quality}p · ${stream.type.toUpperCase()}${stream.type==='dash'?' — not supported in this player':''}`;button.disabled=!stream.playbackUrl;
      button.onclick=()=>{
        reset();document.querySelectorAll('.source').forEach(b=>b.classList.remove('active'));button.classList.add('active');$('empty').hidden=true;$('video').hidden=false;status(`Loading ${stream.server}…`,'LOADING');
        if(stream.type==='m3u8' && Hls.isSupported()){
          hls=new Hls();hls.loadSource(stream.playbackUrl);hls.attachMedia($('video'));hls.on(Hls.Events.MANIFEST_PARSED,()=>{$('video').play().catch(()=>status('Ready. Press play to begin.','READY'));});
          hls.on(Hls.Events.ERROR,(_,d)=>{if(d.fatal)status(`Playback failed: ${d.details}. Try another server or resolve again.`,'ERROR');});
        }else if(stream.type==='mp4' || $('video').canPlayType('application/vnd.apple.mpegurl')){
          $('video').src=stream.playbackUrl;$('video').play().catch(()=>status('Ready. Press play to begin.','READY'));
        }else status('This browser does not support HLS playback.','ERROR');
      };$('sources').append(button);
    });
  }catch(e){status(e.message,'ERROR');$('diagnostics').textContent=e.message;}finally{$('resolve').disabled=false;}
};
$('video').onplaying=()=>status('Stream is playing.','PLAYING');
$('video').onerror=()=>{if($('video').getAttribute('src'))status('Media could not be played. Try another server; browser codec support and upstream availability vary.','ERROR');};
