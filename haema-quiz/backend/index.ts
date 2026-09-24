// Public educational content; all administrative operations use expiring opaque sessions.
// No password, API key or other secret belongs in this source.
const base = Deno.env.get('SUPABASE_URL')!;
const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const key = keys.default || Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'content-type, x-quiz-session','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Cache-Control':'no-store','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff'};
const response = (data:unknown,status=200) => new Response(JSON.stringify(data),{status,headers:cors});
async function db(path:string,method='GET',body?:unknown) {
 const headers:Record<string,string>={apikey:key,'Content-Type':'application/json',Prefer:'return=representation'};
 if(!key.startsWith('sb_secret_')) headers.Authorization='Bearer '+key;
 const r=await fetch(base+'/rest/v1/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 if(!r.ok) throw new Error('Database request failed: '+r.status);
 return r.status===204?null:await r.json();
}
async function hash(s:string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');}
async function session(req:Request) {
 const t=req.headers.get('x-quiz-session')||'';
 if(!/^[a-f0-9]{64}$/.test(t)) return null;
 const h=await hash(t);
 const rows=await db('hq_sessions?token_hash=eq.'+h+'&expires_at=gt.'+encodeURIComponent(new Date().toISOString())+'&select=token_hash');
 return rows.length?h:null;
}
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 try {
 const url=new URL(req.url); const action=url.searchParams.get('action')||'weeks';
 if(req.method==='POST' && action==='login') {
  const raw=await req.text(); if(raw.length>1024) return response({error:'Anfrage zu groß.'},413);
  let body;try{body=JSON.parse(raw);}catch{return response({error:'Ungültige Anfrage.'},400);}
  if(typeof body.password!=='string'||!body.password.length||body.password.length>128) return response({error:'Passwort fehlt.'},400);
  const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown';
  const result=await db('rpc/hq_login','POST',{p_password:body.password,p_client:await hash(ip)});
  return response(result,result.error?(result.limited?429:401):200);
 }
 if(req.method==='GET' && action==='weeks') {
  const rows=await db('hq_weeks?select=id,title,published_at,hq_sets(id,title,position,hq_questions(id))&hq_sets.hq_questions.deleted_at=is.null&order=id.desc&limit=260');
  return response(rows.map((w:any)=>({...w,sets:w.hq_sets.sort((a:any,b:any)=>a.position-b.position).map((s:any)=>({id:s.id,title:s.title,position:s.position,count:s.hq_questions.length})),hq_sets:undefined})));
 }
 if(req.method==='GET' && action==='set') {
  const id=url.searchParams.get('id')||'';
  if(!/^\d{4}-W\d{2}-s[123]$/.test(id)) return response({error:'Ungültiges Set.'},400);
  const rows=await db('hq_questions?set_id=eq.'+id+'&deleted_at=is.null&order=position&select=id,position,payload');
  return response(rows.map((q:any)=>({id:q.id,position:q.position,question:q.payload.question,topic:q.payload.topic,hint:q.payload.hint,reviewed_at:q.payload.reviewed_at,options:q.payload.options.map((o:any)=>({value:o.value,label:o.label}))})));
 }
 if(req.method==='POST' && action==='answer') {
  const raw=await req.text();if(raw.length>512)return response({error:'Anfrage zu groß.'},413);
  let body;try{body=JSON.parse(raw);}catch{return response({error:'Ungültige Anfrage.'},400);}
  if(!/^\d{4}-W\d{2}-s[123]-q[1-5]$/.test(body.id)||!['A','B','C','D'].includes(body.value))return response({error:'Ungültige Antwort.'},400);
  const rows=await db('hq_questions?id=eq.'+body.id+'&deleted_at=is.null&select=payload');
  if(!rows.length)return response({error:'Diese Frage wurde entfernt. Bitte lade das Set neu.'},404);
  const q=rows[0].payload;return response({correct:q.correct,isCorrect:body.value===q.correct,explanation:q.explanation,sources:q.sources,options:q.options});
 }
 if((req.method==='GET'&&action==='admin')||(req.method==='POST'&&action==='logout')||(req.method==='DELETE'&&action==='question')) {
  const h=await session(req);if(!h)return response({error:'Bitte erneut als Admin anmelden.'},401);
  if(action==='logout'){await db('hq_sessions?token_hash=eq.'+h,'DELETE');return response({ok:true});}
  if(action==='admin')return response(await db('hq_questions?deleted_at=is.null&select=id,set_id,position,payload&order=id.desc&limit=4000'));
  const id=url.searchParams.get('id')||'';if(!/^\d{4}-W\d{2}-s[123]-q[1-5]$/.test(id))return response({error:'Ungültige Frage.'},400);
  const rows=await db('hq_questions?id=eq.'+id+'&deleted_at=is.null','PATCH',{deleted_at:new Date().toISOString()});
  return rows.length?response({ok:true}):response({error:'Frage bereits entfernt.'},404);
 }
 return response({error:'Nicht gefunden.'},404);
 } catch(e) {console.error(e instanceof Error?e.message:'Request failed');return response({error:'Die Anfrage konnte nicht verarbeitet werden. Bitte erneut versuchen.'},500);}
});
