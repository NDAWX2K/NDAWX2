/** NDAWX weather relay — Cloudflare module Worker, JavaScript only.
 * Set ALLOWED_ORIGIN to your GitHub Pages origin, e.g. https://jose.github.io
 * No arbitrary URL proxy. Fixed, read-only public weather endpoints only.
 */
const ALLOWED_ORIGIN = '*'; // Public weather. Restrict to your Pages origin if desired.
const USER_AGENT = 'NDAWX/2.0 (Arizona weather dashboard)';
const IDS = 'KLUF,KPHX,KIWA,KGYR,KDVT,KSDL,KTUS,KDMA,KFLG,KGXF,KNYL,KPRC';
async function get(url) {
  const r = await fetch(url, {headers:{'User-Agent':USER_AGENT,Accept:'application/json'},signal:AbortSignal.timeout(25000)});
  if (!r.ok) throw new Error('Upstream HTTP '+r.status);
  return r.status === 204 ? [] : r.json();
}
async function metars() {
  // Explicit airport query ensures the user's 12 sites are always requested.
  const selected = await get('https://aviationweather.gov/api/data/metar?format=json&ids='+IDS);
  if (!Array.isArray(selected)) throw new Error('Invalid METAR response');
  // Bbox order: minimum latitude, minimum longitude, maximum latitude, maximum longitude.
  const regional = await get('https://aviationweather.gov/api/data/metar?format=json&bbox=31,-115,37.2,-108.9');
  if (!Array.isArray(regional)) throw new Error('Invalid regional METAR response');
  return [...selected,...regional]; // Browser deduplicates by newest station observation.
}
async function hrrr() {
  const points=[];
  for(let y=0;y<12;y++)for(let x=0;x<11;x++)points.push([+(31+y*.6).toFixed(2),+(-114.9+x*.6).toFixed(2)]);
  const data=[];
  for(let i=0;i<points.length;i+=44){
    const p=points.slice(i,i+44);
    const q=new URLSearchParams({latitude:p.map(v=>v[0]).join(','),longitude:p.map(v=>v[1]).join(','),hourly:'temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m',models:'ncep_hrrr_conus',wind_speed_unit:'kn',temperature_unit:'celsius',timeformat:'unixtime',timezone:'GMT',forecast_days:'2',cell_selection:'nearest',elevation:p.map(()=>'nan').join(',')});
    const r=await get('https://api.open-meteo.com/v1/forecast?'+q);
    data.push(...(Array.isArray(r)?r:[r]));
  }
  return data;
}
async function discussion() {
  const index=await get('https://api.weather.gov/products/types/AFD/locations/PSR');
  const latest=(index['@graph']||[]).filter(p=>p.productCode==='AFD'&&p.issuingOffice==='KPSR').sort((a,b)=>Date.parse(b.issuanceTime)-Date.parse(a.issuanceTime))[0];
  if(!latest)throw new Error('No Phoenix discussion available');
  return get('https://api.weather.gov/products/'+encodeURIComponent(latest.id));
}
export default {
  async fetch(request,env,ctx){
    const cors={'Access-Control-Allow-Origin':ALLOWED_ORIGIN,'Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Accept','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
    if(request.method!=='GET')return new Response(JSON.stringify({error:'GET only'}),{status:405,headers:cors});
    const url=new URL(request.url),routes={'/metars':[metars,300],'/hrrr':[hrrr,3600],'/discussion':[discussion,600]};
    const route=routes[url.pathname];
    if(!route)return new Response(JSON.stringify({error:'Use /metars, /hrrr, or /discussion'}),{status:404,headers:cors});
    // Normalize queries out of the cache key; visitors share cached fixed datasets.
    const key=new Request(url.origin+url.pathname+'?schema=2'),cache=caches.default,cached=await cache.match(key);
    if(cached)return cached;
    try{
      const data=await route[0]();
      const response=new Response(JSON.stringify(data),{headers:{...cors,'Cache-Control':'public, max-age='+route[1]}});
      ctx.waitUntil(cache.put(key,response.clone()));
      return response;
    }catch(error){return new Response(JSON.stringify({error:'Weather source temporarily unavailable',detail:error.message}),{status:502,headers:{...cors,'Cache-Control':'no-store'}})}
  }
};
