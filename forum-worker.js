/* NDAWX guest forum. Cloudflare Worker + D1 (binding: DB).
 * Required vars: ALLOWED_ORIGIN, TURNSTILE_SITE_KEY.
 * Required secrets: TURNSTILE_SECRET_KEY, ADMIN_TOKEN (32+ random characters), RATE_LIMIT_SALT (32+ random characters).
 * No visitor accounts. New posts require Turnstile and publish immediately. Owner can remove them afterward.
 */
class HTTPError extends Error { constructor(status,message){super(message);this.status=status} }
const fail=(s,m)=>{throw new HTTPError(s,m)};
const fields='id,parent_id,name,body,status,created_at';
async function readJSON(request){
  if(!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))fail(415,'Send JSON.');
  if(Number(request.headers.get('Content-Length'))>12000)fail(413,'Request too large.');
  const reader=request.body?.getReader();if(!reader)fail(400,'Request body is required.');
  const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>12000){await reader.cancel();fail(413,'Request too large.')}chunks.push(value)}
  const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length}
  try{return JSON.parse(new TextDecoder().decode(bytes))}catch{fail(400,'Invalid JSON.')}
}
function idValue(v,optional=false){if(optional&&(v===null||v===undefined||v===''))return null;const n=Number(v);if(!Number.isSafeInteger(n)||n<1)fail(400,'Invalid comment ID.');return n}
async function hashIP(ip,salt){const enc=new TextEncoder();const key=await crypto.subtle.importKey('raw',enc.encode(salt),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(ip)))].map(v=>v.toString(16).padStart(2,'0')).join('')}
async function adminAuth(request,env){
  if(!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32)fail(503,'Owner access is not configured.');
  const token=request.headers.get('Authorization')||'';
  if(!token.startsWith('Bearer ')||token.length>512)fail(401,'Invalid owner key.');
  const encode=new TextEncoder(),digest=v=>crypto.subtle.digest('SHA-256',encode.encode(v));
  const [a,b]=await Promise.all([digest(token.slice(7)),digest(env.ADMIN_TOKEN)]);
  const aa=new Uint8Array(a),bb=new Uint8Array(b);let diff=0;for(let i=0;i<aa.length;i++)diff|=aa[i]^bb[i];if(diff)fail(401,'Invalid owner key.');
}
async function consumeRate(env,ipHash,now){
  const bucket=ipHash+':'+Math.floor(now/3600);
  const rows=await env.DB.batch([
    env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO rate_limits(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count<10 RETURNING count').bind(bucket,now+86400)
  ]);
  if(!rows[1].results?.length)fail(429,'Too many submission attempts from this network. Try again next hour.');
}
async function verifyChallenge(token,ip,env){
  if(typeof token!=='string'||!token||token.length>2048)fail(400,'Complete the spam check.');
  const r=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET_KEY,response:token,remoteip:ip}),signal:AbortSignal.timeout(10000)});
  if(!r.ok)fail(503,'Spam check is unavailable. Please retry.');
  const v=await r.json();if(!v.success||v.hostname!==new URL(env.ALLOWED_ORIGIN).hostname||v.action!=='comment')fail(400,'Spam check expired or failed. Please complete it again.');
}
async function route(request,env,url){
  const now=Math.floor(Date.now()/1000),path=url.pathname;
  if(!env.DB)fail(503,'Forum database is not connected.');
  if(path==='/config'&&request.method==='GET'){
    const ready=Boolean(env.TURNSTILE_SITE_KEY&&env.TURNSTILE_SECRET_KEY&&env.ADMIN_TOKEN?.length>=32&&env.RATE_LIMIT_SALT?.length>=32);
    return {ready,siteKey:ready?env.TURNSTILE_SITE_KEY:null,moderation:false};
  }
  if(path==='/comments'&&request.method==='GET'){
    const before=idValue(url.searchParams.get('before'),true)||Number.MAX_SAFE_INTEGER;
    const {results}=await env.DB.prepare(`SELECT ${fields},(SELECT count(*) FROM comments r WHERE r.parent_id=c.id AND r.status='approved') AS reply_count FROM comments c WHERE c.parent_id IS NULL AND c.status='approved' AND c.id < ? ORDER BY c.id DESC LIMIT 21`).bind(before).all();
    return {comments:results.slice(0,20),nextBefore:results.length>20?results[19].id:null};
  }
  const replies=path.match(/^\/comments\/(\d+)\/replies$/);
  if(replies&&request.method==='GET'){
    const parent=idValue(replies[1]),after=idValue(url.searchParams.get('after'),true)||0;
    const root=await env.DB.prepare("SELECT id FROM comments WHERE id=? AND parent_id IS NULL AND status='approved'").bind(parent).first();if(!root)fail(404,'Discussion not found.');
    const {results}=await env.DB.prepare(`SELECT ${fields} FROM comments WHERE parent_id=? AND status='approved' AND id>? ORDER BY id ASC LIMIT 51`).bind(parent,after).all();return {comments:results.slice(0,50),nextAfter:results.length>50?results[49].id:null};
  }
  if(path==='/comments'&&request.method==='POST'){
    if(!env.TURNSTILE_SECRET_KEY||!env.TURNSTILE_SITE_KEY||!env.ADMIN_TOKEN||env.ADMIN_TOKEN.length<32||!env.RATE_LIMIT_SALT||env.RATE_LIMIT_SALT.length<32)fail(503,'Posting is not configured yet.');
    const b=await readJSON(request);if(!b||typeof b!=='object')fail(400,'Invalid submission.');
    if(b.website)fail(400,'Submission rejected.');
    const name=typeof b.name==='string'?b.name.trim().normalize('NFKC'):'',body=typeof b.body==='string'?b.body.trim():'';
    if(name.length<2||name.length>40||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(name))fail(400,'Use a display name of 2–40 characters.');
    if(body.length<2||body.length>2000||/[\u0000]/.test(body))fail(400,'Write 2–2,000 characters.');
    if(typeof b.requestId!=='string'||!/^[-a-f0-9]{36}$/i.test(b.requestId))fail(400,'Invalid request identifier.');
    const parent=idValue(b.parentId,true),ip=request.headers.get('CF-Connecting-IP');if(!ip)fail(503,'Network verification unavailable.');
    const ipHash=await hashIP(ip,env.RATE_LIMIT_SALT);
    const old=await env.DB.prepare('SELECT id,ip_hash FROM comments WHERE request_id=?').bind(b.requestId).first();if(old){if(old.ip_hash!==ipHash)fail(409,'Submission identifier already used.');return {ok:true,id:old.id,message:'Submission already received.'}}
    if(parent){const root=await env.DB.prepare("SELECT id FROM comments WHERE id=? AND parent_id IS NULL AND status='approved'").bind(parent).first();if(!root)fail(404,'The discussion is no longer available for replies.')}
    await consumeRate(env,ipHash,now);await verifyChallenge(b.token,ip,env);
    const inserted=await env.DB.prepare("INSERT INTO comments(parent_id,name,body,created_at,request_id,ip_hash,status) VALUES(?,?,?,?,?,?,'approved') ON CONFLICT(request_id) DO NOTHING RETURNING id").bind(parent,name,body,now,b.requestId,ipHash).first();
    if(!inserted)fail(409,'Submission already received. Refresh before trying again.');
    return {ok:true,id:inserted.id,message:'Published. Your comment is now visible to everyone.'};
  }
  if(path==='/admin/comments'&&request.method==='GET'){
    await adminAuth(request,env);const status=url.searchParams.get('status')||'pending';if(!['pending','approved','rejected'].includes(status))fail(400,'Invalid status.');
    const before=idValue(url.searchParams.get('before'),true)||Number.MAX_SAFE_INTEGER;
    const {results}=await env.DB.prepare(`SELECT ${fields} FROM comments WHERE status=? AND id<? ORDER BY id DESC LIMIT 51`).bind(status,before).all();return {comments:results.slice(0,50),nextBefore:results.length>50?results[49].id:null};
  }
  const admin=path.match(/^\/admin\/comments\/(\d+)$/);
  if(admin&&request.method==='PATCH'){
    await adminAuth(request,env);const id=idValue(admin[1]),b=await readJSON(request);if(!['pending','approved','rejected'].includes(b?.status))fail(400,'Invalid moderation status.');
    const row=await env.DB.prepare('SELECT parent_id FROM comments WHERE id=?').bind(id).first();if(!row)fail(404,'Comment not found.');
    if(b.status==='approved'&&row.parent_id){const p=await env.DB.prepare("SELECT id FROM comments WHERE id=? AND status='approved'").bind(row.parent_id).first();if(!p)fail(409,'Approve the parent discussion before approving this reply.')}
    await env.DB.prepare('UPDATE comments SET status=? WHERE id=?').bind(b.status,id).run();return {ok:true};
  }
  fail(404,'Endpoint not found.');
}
export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin'),allowed=env.ALLOWED_ORIGIN;
    const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin','Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'};
    let configured=false;try{configured=new URL(allowed).origin===allowed&&allowed.startsWith('https://')}catch{}
    if(!configured)return new Response(JSON.stringify({error:'Set ALLOWED_ORIGIN to the exact HTTPS website origin.'}),{status:503,headers});
    if(origin&&origin!==allowed)return new Response(JSON.stringify({error:'Origin not allowed.'}),{status:403,headers});
    headers['Access-Control-Allow-Origin']=allowed;
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(['POST','PATCH'].includes(request.method)&&origin!==allowed)return new Response(JSON.stringify({error:'Website origin required.'}),{status:403,headers});
    try{return new Response(JSON.stringify(await route(request,env,new URL(request.url))),{headers})}
    catch(e){const status=e instanceof HTTPError?e.status:503;return new Response(JSON.stringify({error:e instanceof HTTPError?e.message:'Forum temporarily unavailable. Please retry.'}),{status,headers})}
  },
  async scheduled(controller,env,ctx){if(env.DB)ctx.waitUntil(env.DB.prepare('DELETE FROM rate_limits WHERE expires_at < ?').bind(Math.floor(Date.now()/1000)).run())}
};
