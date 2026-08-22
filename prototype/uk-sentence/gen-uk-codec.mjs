// UK 5-word sentence codec — builds uk-codec.js from the HAND-CURATED lists.
//
// The word lists (nouns.json / adjectives.json / verbs.json) are the source of
// truth, produced by curation/curate.mjs (edit the drop/add sets there, or the
// JSONs directly). This script VALIDATES the lists, verifies the codec by
// measurement, and emits the browser codec:
//   node gen-uk-codec.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const HERE = new URL('.', import.meta.url).pathname;

const ADJ = JSON.parse(readFileSync(`${HERE}/adjectives.json`, 'utf8'));
const NOUN = JSON.parse(readFileSync(`${HERE}/nouns.json`, 'utf8'));
const VERB = JSON.parse(readFileSync(`${HERE}/verbs.json`, 'utf8'));

// ---- validate list invariants ----
const isP = (n) => { for (let i = 2; i * i <= n; i++) if (n % i === 0) return false; return n > 1; };
const A = ADJ.length, N = NOUN.length, V = VERB.length;
if (!isP(N)) throw new Error(`nouns.length ${N} is not prime`);
if (A >= N || V >= N) throw new Error('nouns must be the largest list (checksum modulus)');
for (const [name, list] of [['adj', ADJ], ['noun', NOUN], ['verb', VERB]]) {
  if (new Set(list).size !== list.length) throw new Error(`${name} list has duplicates`);
  for (const w of list) if (!/^[a-z]{3,9}$/.test(w)) throw new Error(`${name} "${w}" malformed`);
}
const nset = new Set(NOUN), aset = new Set(ADJ);
for (const w of ADJ) if (nset.has(w)) throw new Error(`"${w}" in both adj and noun lists`);
for (const w of VERB) if (nset.has(w) || aset.has(w)) throw new Error(`"${w}" in verb and another list`);

// ---- UK grid at 3m ----
const LA0 = 49.8, LA1 = 61.0, LO0 = -8.7, LO1 = 1.9, TARGET = 3;
const LATC = Math.ceil((LA1 - LA0) * 111320 / TARGET);
const LONC = Math.ceil((LO1 - LO0) * 111320 * Math.cos(55 * Math.PI / 180) / TARGET);
const TOTAL = LATC * LONC, bits = Math.log2(TOTAL);
const capBits = 2 * Math.log2(A) + Math.log2(N) + Math.log2(V);
if (Math.pow(2, capBits) < TOTAL) throw new Error(`capacity 2^${capBits.toFixed(1)} < grid 2^${bits.toFixed(1)} — need coarser cells or more words`);

// ---- reversible scramble: multiply mod TOTAL ----
const gcd = (a, b) => { while (b) { [a, b] = [b, a % b]; } return a; };
const egcd = (a, m) => { let [old_r, r] = [a, m], [old_s, s] = [1n, 0n]; while (r) { const q = old_r / r; [old_r, r] = [r, old_r - q * r]; [old_s, s] = [s, old_s - q * s]; } return ((old_s % m) + m) % m; };
const Tb = BigInt(TOTAL);
let MUL = 2654435761n; while (gcd(MUL, Tb) !== 1n) MUL += 2n;
const MINV = egcd(MUL, Tb);

// ---- verify in node ----
const Ab = BigInt(A), Nb = BigInt(N), Vb = BigInt(V), Pb = BigInt(N), W = [1n, 2n, 3n, 4n];
const gridIndex = (lat, lon) => { const li = Math.min(LATC - 1, Math.max(0, Math.floor((lat - LA0) / (LA1 - LA0) * LATC))); const oi = Math.min(LONC - 1, Math.max(0, Math.floor((lon - LO0) / (LO1 - LO0) * LONC))); return li * LONC + oi; };
const cellCenter = (idx) => { const li = Math.floor(idx / LONC), oi = idx % LONC; return [((li + 0.5) / LATC) * (LA1 - LA0) + LA0, ((oi + 0.5) / LONC) * (LO1 - LO0) + LO0]; };
const scramble = (i) => (BigInt(i) * MUL) % Tb;
const unscramble = (s) => (s * MINV) % Tb;
function toWords(lat, lon) { let x = scramble(gridIndex(lat, lon)); const ia = x % Ab; x /= Ab; const in1 = x % Nb; x /= Nb; const iv = x % Vb; x /= Vb; const ia2 = x % Ab; const chk = (W[0] * ia + W[1] * in1 + W[2] * iv + W[3] * ia2) % Pb; return [ADJ[Number(ia)], NOUN[Number(in1)], VERB[Number(iv)], ADJ[Number(ia2)], NOUN[Number(chk)]]; }

// ---- fuzzy word lookup: typo-tolerant, NOT mishearing-tolerant ----
// A typed word gets matched to the closest list entry within edit distance 2
// (only if that closest match is unique — an ambiguous typo is still an
// error). This recovers spelling slips on the way IN; it doesn't touch the
// checksum, which is what actually guards against a wrong/misheard word — a
// fuzzy-corrected sentence still has to pass the exact same checksum check as
// an exactly-typed one, so a typo that (rarely) lands on another real word is
// caught exactly like any other substitution already is.
const FUZZ_MAX = 2;
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const ALL_WORDS = new Set([...ADJ, ...NOUN, ...VERB]);
function fuzzyIndex(list, word) {
  const exact = list.indexOf(word);
  if (exact >= 0) return { index: exact, corrected: false };
  // A correctly-spelled word that belongs to a DIFFERENT slot's list (e.g. a
  // noun landing in the adjective position) is a structural error, not a
  // typo — don't fuzzy-correct it into some nearby word in this list, or a
  // word-swap becomes indistinguishable from a spelling slip.
  if (ALL_WORDS.has(word)) return { index: -1, corrected: false };
  let bestI = -1, bestD = FUZZ_MAX + 1, tie = false;
  for (let i = 0; i < list.length; i++) {
    const d = lev(list[i], word);
    if (d < bestD) { bestD = d; bestI = i; tie = false; }
    else if (d === bestD) tie = true;
  }
  if (bestI >= 0 && !tie) return { index: bestI, corrected: true, to: list[bestI] };
  return { index: -1, corrected: false };
}
function parseWords(w) {
  const r = [fuzzyIndex(ADJ, w[0]), fuzzyIndex(NOUN, w[1]), fuzzyIndex(VERB, w[2]), fuzzyIndex(ADJ, w[3]), fuzzyIndex(NOUN, w[4])];
  if (r.some((x) => x.index < 0)) return null;
  const ia = BigInt(r[0].index), in1 = BigInt(r[1].index), iv = BigInt(r[2].index), ia2 = BigInt(r[3].index), ichk = r[4].index;
  const chk = (W[0] * ia + W[1] * in1 + W[2] * iv + W[3] * ia2) % Pb;
  if (Number(chk) !== ichk) return { bad: true };
  const s = ia + Ab * (in1 + Nb * (iv + Vb * ia2));
  if (s >= Tb) return { bad: true };
  const [lat, lon] = cellCenter(Number(unscramble(s)));
  const corrections = r.map((x, i) => x.corrected ? { pos: i, from: w[i], to: x.to } : null).filter(Boolean);
  return { lat, lon, corrections };
}
// round-trip
function hav(a, b, c, d) { const R = 6371000, r = Math.PI / 180; const dLat = (c - a) * r, dLon = (d - b) * r; const s = Math.sin(dLat / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(s)); }
let worst = 0, fails = 0;
for (let t = 0; t < 20000; t++) { const lat = LA0 + Math.random() * (LA1 - LA0), lon = LO0 + Math.random() * (LO1 - LO0); const w = toWords(lat, lon); const p = parseWords(w); if (!p || p.bad) { fails++; continue; } const d = hav(lat, lon, p.lat, p.lon); if (d > worst) worst = d; }
// detection: single-word substitution and adjacent word-swap
let dt = 0, du = 0; const L = [ADJ, NOUN, VERB, ADJ];
for (let t = 0; t < 100000; t++) { const lat = LA0 + Math.random() * (LA1 - LA0), lon = LO0 + Math.random() * (LO1 - LO0); const w = toWords(lat, lon); const pos = t % 4; let nw; do { nw = L[pos][Math.floor(Math.random() * L[pos].length)]; } while (nw === w[pos]); const w2 = [...w]; w2[pos] = nw; const r = parseWords(w2); dt++; if (r && !r.bad) du++; }
let st = 0, su = 0;
for (let t = 0; t < 50000; t++) { const lat = LA0 + Math.random() * (LA1 - LA0), lon = LO0 + Math.random() * (LO1 - LO0); const w = toWords(lat, lon); const i = t % 4, j = (i + 1) % 4; if (w[i] === w[j]) continue; const w2 = [...w]; [w2[i], w2[j]] = [w2[j], w2[i]]; const r = parseWords(w2); st++; if (r && !r.bad) su++; }
// fuzzy typo tolerance: a single-character substitution in a random word slot
// should still resolve (via fuzzyIndex) to the same place the checksum agrees
// on. Measures the real thing we're claiming, not just that the code runs.
function typo(word) {
  const i = Math.floor(Math.random() * word.length);
  let c; do { c = String.fromCharCode(97 + Math.floor(Math.random() * 26)); } while (c === word[i]);
  return word.slice(0, i) + c + word.slice(i + 1);
}
let ftTrials = 0, ftResolved = 0, ftCorrected = 0, ftWorst = 0;
for (let t = 0; t < 20000; t++) {
  const lat = LA0 + Math.random() * (LA1 - LA0), lon = LO0 + Math.random() * (LO1 - LO0);
  const w = toWords(lat, lon);
  const pos = t % 5;
  const w2 = [...w]; w2[pos] = typo(w2[pos]);
  ftTrials++;
  const r = parseWords(w2);
  if (!r || r.bad) continue;
  ftResolved++;
  if (r.corrections.length) ftCorrected++;
  const d = hav(lat, lon, r.lat, r.lon);
  if (d > ftWorst) ftWorst = d;
}
console.log(`lists: adj ${A}, nouns ${N} (prime ${isP(N)}), verbs ${V}`);
console.log(`grid: ${LATC}x${LONC} = 2^${bits.toFixed(2)} cells, ~${TARGET}m; capacity 2^${capBits.toFixed(2)}`);
console.log(`round-trip: ${fails} fails/20000, worst ${worst.toFixed(2)}m from click`);
console.log(`single-word detection: ${(100 * (1 - du / dt)).toFixed(4)}% (${du} slipped)`);
console.log(`word-swap detection: ${(100 * (1 - su / st)).toFixed(4)}% (${su} slipped)`);
console.log(`fuzzy typo tolerance: ${ftResolved}/${ftTrials} resolved despite a 1-letter typo (${ftCorrected} auto-corrected), worst ${ftWorst.toFixed(2)}m`);

// ---- sample sentences for the eyeball test ----
console.log('\nsample sentences:');
for (let t = 0; t < 25; t++) { const lat = LA0 + Math.random() * (LA1 - LA0), lon = LO0 + Math.random() * (LO1 - LO0); const w = toWords(lat, lon); console.log(`  ${w[0][0].toUpperCase() + w[0].slice(1)} ${w[1]} ${w[2]} ${w[3]} ${w[4]}.`); }

// ---- emit browser codec ----
const js = `// UK 5-word sentence codec — generated from the curated lists, self-contained.
(function(g){
var ADJ=${JSON.stringify(ADJ)},NOUN=${JSON.stringify(NOUN)},VERB=${JSON.stringify(VERB)};
var LA0=${LA0},LA1=${LA1},LO0=${LO0},LO1=${LO1},LATC=${LATC},LONC=${LONC};
var TOTAL=${TOTAL}n,MUL=${MUL}n,MINV=${MINV}n,P=${N}n,W=[1n,2n,3n,4n];
var A=BigInt(ADJ.length),N=BigInt(NOUN.length),Vb=BigInt(VERB.length);
function grid(lat,lon){var li=Math.min(LATC-1,Math.max(0,Math.floor((lat-LA0)/(LA1-LA0)*LATC)));var oi=Math.min(LONC-1,Math.max(0,Math.floor((lon-LO0)/(LO1-LO0)*LONC)));return li*LONC+oi;}
function center(idx){var li=Math.floor(idx/LONC),oi=idx%LONC;return[((li+0.5)/LATC)*(LA1-LA0)+LA0,((oi+0.5)/LONC)*(LO1-LO0)+LO0];}
function cap(s){return s.charAt(0).toUpperCase()+s.slice(1);}
function toSentence(lat,lon){var x=(BigInt(grid(lat,lon))*MUL)%TOTAL;var ia=x%A;x/=A;var in1=x%N;x/=N;var iv=x%Vb;x/=Vb;var ia2=x%A;var chk=(W[0]*ia+W[1]*in1+W[2]*iv+W[3]*ia2)%P;return cap(ADJ[Number(ia)])+' '+NOUN[Number(in1)]+' '+VERB[Number(iv)]+' '+ADJ[Number(ia2)]+' '+NOUN[Number(chk)]+'.';}
var FUZZ_MAX=2;
var ALL_WORDS={};ADJ.concat(NOUN,VERB).forEach(function(w){ALL_WORDS[w]=true;});
function lev(a,b){var d=[],i,j;for(i=0;i<=a.length;i++)d[i]=[i];for(j=0;j<=b.length;j++)d[0][j]=j;for(i=1;i<=a.length;i++)for(j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length];}
function fuzzyIndex(list,word){var exact=list.indexOf(word);if(exact>=0)return{index:exact,corrected:false};if(ALL_WORDS[word])return{index:-1,corrected:false};var bestI=-1,bestD=FUZZ_MAX+1,tie=false;for(var k=0;k<list.length;k++){var d=lev(list[k],word);if(d<bestD){bestD=d;bestI=k;tie=false;}else if(d===bestD){tie=true;}}if(bestI>=0&&!tie)return{index:bestI,corrected:true,to:list[bestI]};return{index:-1,corrected:false};}
function parseSentence(str){var toks=str.toLowerCase().replace(/[^a-z ]/g,' ').split(/\\s+/).filter(Boolean);if(toks.length!==5)return{ok:false,reason:'wrong-shape'};var r=[fuzzyIndex(ADJ,toks[0]),fuzzyIndex(NOUN,toks[1]),fuzzyIndex(VERB,toks[2]),fuzzyIndex(ADJ,toks[3]),fuzzyIndex(NOUN,toks[4])];if(r.some(function(x){return x.index<0;}))return{ok:false,reason:'unreadable'};var ia=BigInt(r[0].index),in1=BigInt(r[1].index),iv=BigInt(r[2].index),ia2=BigInt(r[3].index),ichk=r[4].index;var chk=(W[0]*ia+W[1]*in1+W[2]*iv+W[3]*ia2)%P;if(Number(chk)!==ichk)return{ok:false,reason:'bad-checksum'};var s=ia+A*(in1+N*(iv+Vb*ia2));if(s>=TOTAL)return{ok:false,reason:'bad-checksum'};var c=center(Number((s*MINV)%TOTAL));var corrections=r.map(function(x,i){return x.corrected?{pos:i,from:toks[i],to:x.to}:null;}).filter(Boolean);return{ok:true,lat:c[0],lon:c[1],cellM:${TARGET},corrections:corrections};}
g.UK5={toSentence:toSentence,parseSentence:parseSentence,bounds:[[LA0,LO0],[LA1,LO1]]};
})(window);`;
writeFileSync(`${HERE}/uk-codec.js`, js);
writeFileSync(`${HERE}/params.json`, JSON.stringify({
  nouns: N, adjectives: A, verbs: V, nounsPrime: true,
  payloadBits: +capBits.toFixed(2), ukGrid: `${TARGET}m`,
  frame: '[Adj] [noun] [verb] [adj] [checknoun]',
  listsSource: 'curation/curate.mjs (hand-curated drop/add sets over Brysbaert+Warriner pools)',
}, null, 2) + '\n');
console.log(`\nwrote uk-codec.js (${(js.length / 1024).toFixed(0)}kb) + params.json`);
