import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
const HERE = new URL('.', import.meta.url).pathname;
// Fonts come from the whereareyou-design skill. Override with DESIGN_FONTS if
// the skill lives elsewhere.
const FONTS =
  process.env.DESIGN_FONTS ??
  `${homedir()}/.claude/skills/whereareyou-design/assets/fonts`;
const b64 = (p) => readFileSync(p).toString('base64');
const atkR = b64(`${FONTS}/AtkinsonHyperlegible-Regular.woff2`);
const atkB = b64(`${FONTS}/AtkinsonHyperlegible-Bold.woff2`);
const codec = readFileSync(`${HERE}/uk-codec.js`, 'utf8');

const page = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>whereareyou — UK sentence code</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>
@font-face{font-family:'Atkinson Hyperlegible';font-weight:400;font-display:swap;src:url(data:font/woff2;base64,${atkR}) format('woff2');}
@font-face{font-family:'Atkinson Hyperlegible';font-weight:700;font-display:swap;src:url(data:font/woff2;base64,${atkB}) format('woff2');}
:root{
  --offline:#4338ca; --danger:#b91c1c; --live:#15803d;
  --bg:#fbfbf9; --surface:#ffffff; --surface-2:#f4f4f1;
  --text:#14161a; --text-dim:#5f6672; --rule:#14161a; --rule-soft:#d8d8d2;
  --accent:#1d4ed8; --accent-soft:#eff3ff; --accent-on:#fff;
  --font:'Atkinson Hyperlegible',system-ui,sans-serif; --radius:4px;
  --ease:cubic-bezier(0.2,0,0.2,1);
}
@media (prefers-color-scheme:dark){:root{
  --bg:#14161a; --surface:#1c1f25; --surface-2:#23272f; --text:#f2f3f5; --text-dim:#98a0ad;
  --rule:#f2f3f5; --rule-soft:#343941; --accent:#7ba1ff; --accent-soft:#1e2740; --accent-on:#0b1220;
  --offline:#a5b4fc; --danger:#f87171; --live:#4ade80;
}}
*{box-sizing:border-box;}
body{margin:0;font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.5;-webkit-font-smoothing:antialiased;}
.inner{max-width:640px;margin:0 auto;padding:0 20px 56px;}
.head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;padding:20px 0 14px;border-bottom:2px solid var(--rule);margin-bottom:20px;}
.word{font-weight:700;font-size:19px;}.word .pin{color:var(--accent);}
.tag{font-size:11px;text-transform:uppercase;letter-spacing:0.14em;color:var(--text-dim);font-weight:700;}
.hint{font-size:13px;color:var(--text-dim);margin:0 0 12px;}
#map{height:340px;border:2px solid var(--rule);border-radius:var(--radius);margin-bottom:16px;background:var(--surface-2);}
.leaflet-container{font-family:var(--font);}
.label{font-size:12px;text-transform:uppercase;letter-spacing:0.14em;font-weight:700;color:var(--text-dim);display:block;}
.label.offline{color:var(--offline);}
.doc{border:2px solid var(--rule);border-radius:var(--radius);background:var(--surface);padding:20px;margin-bottom:20px;}
.doc .label{margin-bottom:12px;}
.sentence{font-size:clamp(24px,6vw,34px);font-weight:700;line-height:1.22;margin:0;text-wrap:balance;}
.sentence .cw{color:var(--offline);}
.sentence.empty{font-size:18px;font-weight:400;color:var(--text-dim);}
.rt{font-size:13px;color:var(--text-dim);margin-top:14px;padding-top:13px;border-top:1px solid var(--rule-soft);display:flex;gap:7px;align-items:baseline;}
.rt .tick{color:var(--live);font-weight:700;}
.rt .mono{font-variant-numeric:tabular-nums;}
.panel{margin-bottom:16px;}
.panel .label{margin-bottom:10px;}
.row{display:flex;gap:10px;}
#parsein{flex:1;font-family:inherit;font-size:16px;color:var(--text);background:var(--surface);border:2px solid var(--rule-soft);border-radius:var(--radius);padding:10px 12px;}
#parsein:focus-visible{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent);}
.btn{font-family:inherit;font-weight:700;font-size:15px;cursor:pointer;border-radius:var(--radius);border:2px solid var(--accent);background:var(--accent);color:var(--accent-on);padding:10px 16px;transition:filter var(--ease) 150ms;}
.btn:hover{filter:brightness(1.08);}.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px;}
.notice{margin-top:12px;padding:11px 14px;border-radius:var(--radius);background:var(--surface-2);font-size:14px;}
.notice.err{border-left:4px solid var(--danger);}
.notice .h{font-weight:700;color:var(--danger);}
.foot{margin-top:28px;padding-top:14px;border-top:1px solid var(--rule-soft);font-size:12.5px;color:var(--text-dim);line-height:1.6;}
.foot strong{color:var(--text);}
@media (prefers-reduced-motion:reduce){*{transition-duration:.001ms!important;}}
</style>
</head>
<body>
<div class="inner">
  <header class="head">
    <span class="word">wherearey<span class="pin">&#9679;</span>u</span>
    <span class="tag">UK offline sentence &mdash; 3m &mdash; prototype</span>
  </header>

  <p class="hint">Click anywhere on the map to turn that 3-metre spot into a five-word sentence you could read to an operator.</p>
  <div id="map"></div>

  <section class="doc">
    <span class="label offline">Offline code &mdash; read this aloud</span>
    <p class="sentence empty" id="sentence">Click the map to make a code.</p>
    <div class="rt" id="rt"></div>
  </section>

  <section class="panel">
    <span class="label">Read one back</span>
    <p class="hint">Type a sentence a caller read to you. A single misheard word is caught, never sent as a wrong place.</p>
    <div class="row">
      <input id="parsein" placeholder="Orderly lark sweeps full pedestal.">
      <button class="btn" id="find">Find it</button>
    </div>
    <div id="parseout"></div>
  </section>

  <footer class="foot">
    <p><strong>UK only, for now.</strong> The grid covers Britain at ~3m. Going global adds one leading region word (&ldquo;Scotland &mdash; &hellip;&rdquo;); nothing here gets rebuilt.</p>
    <p><strong>Curated word list.</strong> UK spellings only, no homophones, no words that could read as part of a real 999 call. Every click round-trips to within ~3m, and every single misheard word and word-swap is caught (measured 100%).</p>
    <p>A prototype, not connected to any emergency service. For a real emergency, dial 999.</p>
  </footer>
</div>

<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>${codec}</script>
<script>
(function(){
  var map=L.map('map',{zoomControl:true}).setView([54.5,-3.2],5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap'}).addTo(map);
  var accent=getComputedStyle(document.documentElement).getPropertyValue('--offline').trim()||'#4338ca';
  var marker=null;
  function place(lat,lon){
    if(marker)map.removeLayer(marker);
    marker=L.circleMarker([lat,lon],{radius:7,color:accent,weight:3,fillColor:accent,fillOpacity:0.35}).addTo(map);
  }
  function colour(s){
    return s.split(' ').map(function(t){return '<span class="cw">'+t+'</span>';}).join(' ');
  }
  function hav(a,b,c,d){var R=6371000,r=Math.PI/180;var dLat=(c-a)*r,dLon=(d-b)*r;var s=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(a*r)*Math.cos(c*r)*Math.sin(dLon/2)*Math.sin(dLon/2);return 2*R*Math.asin(Math.sqrt(s));}
  var B=UK5.bounds;
  function show(lat,lon,fromClick){
    if(lat<B[0][0]||lat>B[1][0]||lon<B[0][1]||lon>B[1][1]){
      document.getElementById('sentence').className='sentence empty';
      document.getElementById('sentence').textContent='That’s outside the UK grid — click within Britain.';
      document.getElementById('rt').textContent='';return;
    }
    var s=UK5.toSentence(lat,lon);
    var p=UK5.parseSentence(s);
    document.getElementById('sentence').className='sentence';
    document.getElementById('sentence').innerHTML=colour(s);
    place(p.lat,p.lon);
    var d=fromClick?hav(lat,lon,p.lat,p.lon):0;
    document.getElementById('rt').innerHTML='<span class="tick">&#10003;</span><span>Decodes to <span class="mono">'+p.lat.toFixed(5)+', '+p.lon.toFixed(5)+'</span> — a ~3m cell'+(fromClick?', '+d.toFixed(1)+' m from your click':'')+'.</span>';
    document.getElementById('parsein').value=s;
    document.getElementById('parseout').innerHTML='';
  }
  map.on('click',function(e){show(e.latlng.lat,e.latlng.lng,true);});

  document.getElementById('find').addEventListener('click',function(){
    var v=document.getElementById('parsein').value.trim();
    if(!v)return;
    var r=UK5.parseSentence(v);
    var out=document.getElementById('parseout');
    if(r.ok){
      if(r.corrections&&r.corrections.length){
        var fixes=r.corrections.map(function(c){return '“'+c.from+'” as “'+c.to+'”';}).join(', ');
        out.innerHTML='<div class="notice">Read '+fixes+' — worth double-checking that’s what was said.</div>';
      }else{
        out.innerHTML='';
      }
      map.setView([r.lat,r.lon],16); place(r.lat,r.lon);
      document.getElementById('sentence').className='sentence';
      document.getElementById('sentence').innerHTML=colour(v.replace(/[^A-Za-z ]/g,'').trim());
      document.getElementById('rt').innerHTML='<span class="tick">&#10003;</span><span>Found: <span class="mono">'+r.lat.toFixed(5)+', '+r.lon.toFixed(5)+'</span> — a ~3m cell.</span>';
    }else{
      var msg=r.reason==='bad-checksum'?'That doesn’t look right — read it again. A word was likely misheard, so it was caught rather than sending the wrong place.':r.reason==='wrong-shape'?'That should be five words — like “Orderly lark sweeps full pedestal”.':'Couldn’t read one of those words. Check the spelling.';
      out.innerHTML='<div class="notice err"><span class="h">&#10007; </span>'+msg+'</div>';
    }
  });
  document.getElementById('parsein').addEventListener('keydown',function(e){if(e.key==='Enter')document.getElementById('find').click();});

  // start on Trafalgar Square
  show(51.50809,-0.12789,false);
  map.setView([51.50809,-0.12789],14);
})();
</script>
</body>
</html>`;
writeFileSync(`${HERE}/index.html`, page);
console.log('wrote index.html', (page.length/1024).toFixed(0)+'kb');
