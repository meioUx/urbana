import { deliverNotifications } from "../server/field.js";
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { seed } from '../server/seed.js';
import { createApp } from '../server/app.js';
import { synchronize } from '../server/gis.js';

let db,server,base,admin,reader,field;
const temp=mkdtempSync(join(tmpdir(),'urbana-test-'));
process.env.DATA_DIR=temp;process.env.DEMO_DATA='false';process.env.ADMIN_PASSWORD='Testing@2026';
delete process.env.DATABASE_URL;
const json=async(path,method='GET',body,cookie=admin)=>{const r=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
const draft=(lat=-27.1)=>({category_id:'category-1',subcategory:'Buraco',description:'Falha no pavimento',origin:'Fiscalização municipal',priority:'Alta',lat,lng:-48.6,address:'Rua de teste, 100',neighborhood:'Centro'});
const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV6kAAAAASUVORK5CYII=','base64');
async function attach(path,stage,content=photo,mime='image/png') {const f=new FormData();f.append('file',new Blob([content],{type:mime}),'photo.png');f.append('stage',stage);f.append('lat','-27.1');f.append('lng','-48.6');const r=await fetch(base+path+'/anexos',{method:'POST',headers:{cookie:admin},body:f});return {status:r.status,data:await r.json()};}
async function createTriaged(lat) {const o=await json('/ocorrencias','POST',draft(lat));assert.equal(o.status,200);const c=await json(`/ocorrencias/${o.data.id}/classificar`,'POST',{category_id:'category-1',subcategory:'Buraco',priority:'Alta',sector_id:'sector-1'});assert.equal(c.status,200);return o.data;}
async function schedule(o,team='team-1') {return json('/ordens-servico','POST',{occurrence_ids:[o.id],team_id:team,scheduled_at:'2026-09-15',responsible:'Responsável de teste'});}
before(async()=>{db=await openDatabase();await seed(db);server=createApp(db).listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));base=`http://127.0.0.1:${server.address().port}/api`;admin=(await json('/auth/login','POST',{email:'admin@urbana.local',password:'Testing@2026'},null)).cookie;assert.ok(admin);
for(const [email,role,team_id] of [['reader@test.local','Consulta',null],['field@test.local','Equipe de Campo','team-2']]){assert.equal((await json('/users','POST',{name:'Teste',email,password:'Testing@2026',role,team_id})).status,200);const cookie=(await json('/auth/login','POST',{email,password:'Testing@2026'},null)).cookie;if(role==='Consulta')reader=cookie;else field=cookie;}
});
after(async()=>{await new Promise(r=>server.close(r));await db.close();rmSync(temp,{recursive:true,force:true});});
test('authentication, origin checks and role enforcement',async()=>{
assert.equal((await json('/ocorrencias','GET',undefined,null)).status,401);
assert.equal((await json('/ocorrencias','POST',draft(),reader)).status,403);
assert.equal((await json('/categorias','POST',{name:'Invalid'},reader)).status,403);
const r=await fetch(base+'/ocorrencias',{method:'POST',headers:{cookie:admin,origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify(draft())});assert.equal(r.status,403);
assert.equal((await json('/ocorrencias','POST',{...draft(),lat:91})).status,400);
assert.equal((await json('/ocorrencias','POST',{...draft(),origin:''})).status,400);
});
test('duplicate detection, linking and explicit override',async()=>{
const first=await json('/ocorrencias','POST',draft(-27.2));assert.equal(first.status,200);
const dup=await json('/ocorrencias','POST',draft(-27.2));assert.equal(dup.status,409);assert.equal(dup.data.details.nearby[0].id,first.data.id);
const linked=await json('/ocorrencias','POST',{...draft(-27.2),duplicate_action:'link',duplicate_id:first.data.id});assert.equal(linked.data.id,first.data.id);assert.equal(linked.data.linked,true);
const extra=await json('/ocorrencias','POST',{...draft(-27.2),duplicate_action:'new'});assert.equal(extra.status,200);assert.notEqual(extra.data.id,first.data.id);
});
test('full lifecycle: triage, assignment, evidence, materials, validation, map and history',async()=>{
const o=await createTriaged(-27.3);const result=await schedule(o);assert.equal(result.status,200);const id=result.data.id,path=`/ordens-servico/${id}`;
assert.equal((await json(path,'GET',undefined,field)).status,403);
assert.ok(!(await json('/dashboard','GET',undefined,field)).data.orders.some(o=>o.id===id));
assert.equal((await json(path+'/iniciar','POST',{lat:-27.3,lng:-48.6})).status,400);
assert.equal((await attach(path,'antes',Buffer.from('<script>evil</script>'))).status,400);
assert.equal((await attach(path,'antes')).status,200);
assert.equal((await json(path+'/assumir','POST',{})).status,200);
assert.equal((await json(path+'/iniciar','POST',{lat:-27.3,lng:-48.6})).status,200);
assert.equal((await json(path+'/concluir','POST',{notes:'Concluído'})).status,400);
assert.equal((await json(path+'/material','POST',{material_id:'material-1',quantity:-1})).status,400);
assert.equal((await json(path+'/material','POST',{material_id:'material-1',quantity:95})).status,200);
assert.equal((await json(path+'/equipamento','POST',{equipment_id:'equipment-1'})).status,200);
assert.equal((await attach(path,'depois')).status,200);
assert.equal((await json(path+'/concluir','POST',{notes:'Reparo concluído e pista liberada.'})).status,200);
assert.equal((await json(path+'/validar','POST',{},field)).status,403);
assert.equal((await json(path+'/validar','POST',{})).status,200);
assert.equal((await json(path+'/iniciar','POST',{lat:-27.3,lng:-48.6})).status,409);
assert.equal((await attach(path,'depois')).status,409);
const detail=(await json(path)).data;assert.equal(detail.status,'CONCLUIDA');assert.equal(detail.materials[0].quantity,95);assert.ok(detail.history.length>=8);
const oc=(await json(`/ocorrencias/${o.id}`)).data;assert.equal(oc.status,'CONCLUIDA');assert.ok(oc.history.length>=5);
const map=(await json('/mapa/ocorrencias')).data;assert.equal(map.features.find(f=>f.properties.id===o.id).properties.status,'CONCLUIDA');
assert.equal((await json('/gis/status')).data.find(g=>g.occurrence_id===o.id).status,'pending');
assert.equal((await json(path+'/reabrir','POST',{reason:'Refazer acabamento'})).status,200);assert.equal((await json(`/ocorrencias/${o.id}`)).data.status,'EM_EXECUCAO');
});
test('sector validation and transaction rollback',async()=>{
const o=await createTriaged(-27.4);const before=(await json('/ordens-servico')).data.length;
assert.equal((await schedule(o,'team-3')).status,400);assert.equal((await json('/ordens-servico')).data.length,before);assert.equal((await json(`/ocorrencias/${o.id}`)).data.status,'EM_TRIAGEM');
});
test('configurable category and SLA, persistent audit',async()=>{
const r=await json('/categorias','POST',{name:'Iluminação pública',subcategories:['Luminária apagada'],sector_id:'sector-2',sla:{Emergencial:12,Alta:24,'Média':48,Baixa:72,Programada:120},require_before:false,require_after:false,require_material:false});assert.equal(r.status,200);
const o=(await json('/ocorrencias','POST',{...draft(-27.5),category_id:r.data.id,subcategory:'Luminária apagada'})).data;
assert.equal(o.sector_id,'sector-2');assert.ok((await json('/auditoria')).data.length>0);
assert.equal((await db.get('SELECT version FROM schema_migrations')).version,1);
});
test('ArcGIS retains failed jobs and retries with stable identifier',async()=>{
const realFetch=globalThis.fetch;process.env.ARCGIS_LAYER_URL='https://example.test/FeatureServer/0';
try{globalThis.fetch=async()=>{throw new Error('Simulated offline');};await synchronize(db);assert.ok((await db.all("SELECT * FROM gis_sync WHERE status='error'")).length);
let edits=0;globalThis.fetch=async(url,opts)=>({ok:true,json:async()=>String(url).endsWith('/query')?{features:[{attributes:{OBJECTID:123}}]}:(assert.ok(opts.body.has('updates')),edits++,{updateResults:[{success:true}]})});await synchronize(db);assert.ok(edits>0);assert.equal((await db.all("SELECT * FROM gis_sync WHERE status<>'synced'")).length,0);
}finally{globalThis.fetch=realFetch;delete process.env.ARCGIS_LAYER_URL;}
});

test('street action plans: priority, permissions, membership, scheduling and persistence',async()=>{
  const create=async(address,neighborhood='Centro',priority='Baixa')=>{
    const result=await json('/ocorrencias','POST',{...draft(-28),address,neighborhood,priority,duplicate_action:'new'});
    assert.equal(result.status,200);return result.data;
  };
  const a=await create('Rua União, 100'),b=await create('R. Uniao, 200'),other=await create('Rua União, 300','Outro bairro');
  const emergency=await create('Rua Emergência, 1','Centro','Emergencial');
  const payload={occurrence_ids:[a.id,b.id],objective:'Reparar os trechos da rua em conjunto',responsible:'Gestão viária',scheduled_at:'2026-09-20'};
  assert.equal((await json('/planos-acao','POST',payload,reader)).status,403);
  assert.equal((await json('/planos-acao','POST',{...payload,occurrence_ids:[a.id]})).status,400);
  assert.equal((await json('/planos-acao','POST',{...payload,occurrence_ids:[a.id,a.id]})).status,400);
  assert.equal((await json('/planos-acao','POST',{...payload,occurrence_ids:[a.id,other.id]})).status,400);
  assert.equal((await json('/planos-acao','POST',{...payload,scheduled_at:'2026-02-30'})).status,400);
  const groups=(await json('/planejamento')).data.groups;
  assert.equal(groups[0].occurrences[0].id,emergency.id);
  assert.equal(groups.find(g=>g.occurrences.some(o=>o.id===a.id)).priority,'Alta');
  const plan=await json('/planos-acao','POST',payload);assert.equal(plan.status,200);assert.equal(plan.data.priority,'Alta');
  assert.equal((await json('/planos-acao','POST',payload)).status,409);
  assert.equal((await json('/ocorrencias/'+a.id)).data.priority,'Baixa');
  const orderPayload={occurrence_ids:[a.id,b.id],plan_id:plan.data.id,team_id:'team-1',scheduled_at:'2026-09-20',responsible:'Equipe de pavimentação'};
  assert.equal((await json('/ordens-servico','POST',orderPayload)).status,409);
  for(const o of [a,b]) assert.equal((await json(`/ocorrencias/${o.id}/classificar`,'POST',{category_id:'category-1',subcategory:'Buraco',priority:'Baixa',sector_id:'sector-1'})).status,200);
  assert.equal((await json('/ordens-servico','POST',{...orderPayload,plan_id:'invalid'})).status,400);
  assert.equal((await json('/ordens-servico','POST',{...orderPayload,team_id:'team-3'})).status,400);
  const scheduled=await json('/ordens-servico','POST',orderPayload);assert.equal(scheduled.status,200);assert.equal(scheduled.data.priority,'Alta');assert.equal(scheduled.data.plan_id,plan.data.id);
  const category=(await json('/bootstrap')).data.catalogs.find(c=>c.id==='category-1');
  assert.equal(Date.parse(scheduled.data.due_at),Math.min(Date.parse(a.created_at),Date.parse(b.created_at))+category.sla.Alta*3600000);
  assert.equal((await json('/ordens-servico','POST',orderPayload)).status,409);
  let current=(await json('/planejamento')).data.plans.find(p=>p.id===plan.data.id);
  assert.equal(current.orders.length,1);assert.equal(current.completed,0);
  assert.equal((await json('/planejamento','GET',undefined,field)).data.plans.find(p=>p.id===plan.data.id).orders.length,0);
  const persisted=await openDatabase();assert.equal((await persisted.get('SELECT code FROM action_plans WHERE id=?',[plan.data.id])).code,plan.data.code);assert.equal((await persisted.all('SELECT * FROM schema_migrations WHERE version=2')).length,1);await persisted.close();
  await db.run("UPDATE occurrences SET status='CONCLUIDA' WHERE id=?",[a.id]);
  current=(await json('/planejamento')).data.plans.find(p=>p.id===plan.data.id);assert.equal(current.completed,1);
  await db.run("UPDATE occurrences SET status='CANCELADA' WHERE id=?",[b.id]);
  current=(await json('/planejamento')).data.plans.find(p=>p.id===plan.data.id);assert.equal(current.status,'Encerrado com cancelamentos');assert.equal(current.cancelled,1);
  assert.ok(!(await json('/planejamento')).data.groups.some(g=>g.occurrences.some(o=>o.id===a.id || o.id===b.id)));
  assert.ok((await json('/auditoria')).data.some(a=>a.entity_id===plan.data.id));
});

test('order numbering follows highest existing code despite gaps',async()=>{
  const existing=await db.get('SELECT id FROM orders LIMIT 1');
  const year=new Date().getFullYear();
  await db.run('UPDATE orders SET code=? WHERE id=?',[`OS-${year}-00999`,existing.id]);
  const occurrence=await createTriaged(-29);
  const result=await schedule(occurrence);
  assert.equal(result.status,200);assert.equal(result.data.code,`OS-${year}-01000`);
});

test('field capture, individual dispatch, return and review permissions',async()=>{
 const me=(await json('/auth/me','GET',undefined,field)).data.user;
 const draftId=crypto.randomUUID();
 const payload={...draft(-30),request_id:draftId,address:'Rua do Operador, 500',requested_by:'Ouvidoria 123/2026',phone:'(47) 0000-0000'};
 const first=await json('/ocorrencias','POST',payload,field);assert.equal(first.status,200);
 assert.equal((await json('/ocorrencias','POST',payload,field)).data.id,first.data.id);
 const uploadAs=async(path,stage,cookie,requestId)=>{const form=new FormData();form.append('file',new Blob([photo],{type:'image/png'}),'foto.png');form.append('stage',stage);form.append('lat','-30');form.append('lng','-48.6');form.append('request_id',requestId);const result=await fetch(base+path+'/anexos',{method:'POST',headers:{cookie},body:form});return {status:result.status,data:await result.json()};};
 const photoId=crypto.randomUUID();const evidence=await uploadAs('/ocorrencias/'+first.data.id,'registro',field,photoId);assert.equal(evidence.status,200);assert.equal((await uploadAs('/ocorrencias/'+first.data.id,'registro',field,photoId)).data.id,evidence.data.id);
 assert.equal((await json(`/ocorrencias/${first.data.id}/classificar`,'POST',{category_id:'category-1',subcategory:'Buraco',priority:'Alta',sector_id:'sector-1'},field)).status,403);
 await json(`/ocorrencias/${first.data.id}/classificar`,'POST',{category_id:'category-1',subcategory:'Buraco',priority:'Alta',sector_id:'sector-1'});
 const secondUser=await json('/users','POST',{name:'Outro operador',email:'second-field@test.local',password:'Testing@2026',role:'Equipe de Campo',team_id:'team-2'});assert.equal(secondUser.status,200);
 const secondCookie=(await json('/auth/login','POST',{email:'second-field@test.local',password:'Testing@2026'},null)).cookie;
 const task={occurrence_ids:[first.data.id],team_id:'team-2',assigned_user_id:me.id,scheduled_at:'2026-09-20',responsible:'Operador designado',notes:'Executar tapa-buraco com sinalização.'};
 assert.equal((await json('/ordens-servico','POST',{...task,team_id:'team-1'})).status,400);
 const scheduled=await json('/ordens-servico','POST',task);assert.equal(scheduled.status,200);const path='/ordens-servico/'+scheduled.data.id;
 assert.equal((await json(path,'GET',undefined,field)).status,200);assert.equal((await json(path,'GET',undefined,secondCookie)).status,403);
 assert.ok(!(await json('/campo','GET',undefined,secondCookie)).data.orders.some(o=>o.id===scheduled.data.id));
 assert.ok(!(await json('/dashboard','GET',undefined,secondCookie)).data.orders.some(o=>o.id===scheduled.data.id));
 assert.equal((await json('/ocorrencias/'+first.data.id,'GET',undefined,secondCookie)).data.orders.length,0);
 assert.equal((await json(path+'/devolver','POST',{reason:''},field)).status,400);
 assert.equal((await json(path+'/devolver','POST',{reason:'Rua interditada; necessário reagendar.'},field)).status,200);
 assert.equal((await json(path,'GET',undefined,field)).data.status,'DEVOLVIDA');
 assert.equal((await json(path+'/validar','POST',{},field)).status,403);
 assert.equal((await json(path+'/programacao','POST',{team_id:'team-2',responsible:'Equipe de manutenção',scheduled_at:'2026-09-21'},field)).status,403);
 assert.equal((await json(path+'/programacao','POST',{team_id:'team-2',assigned_user_id:me.id,responsible:'Equipe de manutenção',scheduled_at:'2026-09-21',notes:'Acesso liberado, executar.'})).status,200);
 assert.equal((await json(path+'/assumir','POST',{},field)).status,200);
 assert.equal((await uploadAs(path,'antes',field,crypto.randomUUID())).status,200);
 assert.equal((await json(path+'/iniciar','POST',{lat:-30,lng:-48.6},field)).status,200);
 assert.equal((await json(path+'/material','POST',{material_id:'material-1',quantity:25},field)).status,200);
 assert.equal((await uploadAs(path,'depois',field,crypto.randomUUID())).status,200);
 assert.equal((await json(path+'/concluir','POST',{notes:'Reparo concluído, pista limpa e sinalização retirada.'},field)).status,200);
 assert.equal((await json(path,'GET',undefined,field)).data.status,'AGUARDANDO_VALIDACAO');
 assert.equal((await json(path+'/validar','POST',{})).status,200);
 assert.equal((await json(path,'GET',undefined,field)).data.status,'CONCLUIDA');
 assert.equal((await json(path+'/reabrir','POST',{reason:'Complementar acabamento'})).status,200);
 assert.equal((await json(path+'/concluir','POST',{notes:'Revisado'},field)).status,400,'Reopened work requires a new after photo');
 assert.equal((await uploadAs(path,'depois',field,crypto.randomUUID())).status,200);
 assert.equal((await json(path+'/concluir','POST',{notes:'Acabamento revisado com nova evidência'},field)).status,200);
 assert.ok((await db.all('SELECT * FROM push_jobs WHERE order_id=?',[scheduled.data.id])).every(j=>j.user_id===me.id));
});

test('push delivery retries, expires subscriptions and checks current assignment',async()=>{
 const me=(await json('/auth/me','GET',undefined,field)).data.user;
 const occurrence=await createTriaged(-31);
 const scheduled=await json('/ordens-servico','POST',{occurrence_ids:[occurrence.id],team_id:'team-2',assigned_user_id:me.id,scheduled_at:'2026-09-21',responsible:'Campo'});assert.equal(scheduled.status,200);
 const orderId=scheduled.data.id;
 const key='push-test-sub',endpoint='https://fcm.googleapis.com/fcm/send/test';
 const subscription={endpoint,keys:{p256dh:'abc',auth:'abc'}};
 process.env.VAPID_PUBLIC_KEY='test-public';process.env.VAPID_PRIVATE_KEY='test-private';process.env.VAPID_SUBJECT='mailto:example@example.test';
 try {
  assert.equal((await json('/campo/notificacoes','POST',{...subscription,endpoint:'https://127.0.0.1/private'},field)).status,400);
  assert.equal((await json('/campo/notificacoes','POST',subscription,field)).status,200);
  await db.run("UPDATE push_jobs SET status='delivered' WHERE order_id<>?",[orderId]);
  const enqueue=fn=>fn();
  await deliverNotifications(db,enqueue,async()=>{throw new Error('Temporary offline');});
  let job=await db.get('SELECT * FROM push_jobs WHERE order_id=?',[orderId]);assert.equal(job.status,'pending');assert.equal(job.attempts,1);
  await db.run("UPDATE push_jobs SET next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?",[job.id]);
  let delivered=0;await deliverNotifications(db,enqueue,async(sub,payload)=>{delivered++;assert.equal(sub.endpoint,endpoint);assert.equal(JSON.parse(payload).url,`/campo?ordem=${orderId}`);});assert.equal(delivered,1);
  assert.equal((await db.get('SELECT status FROM push_jobs WHERE id=?',[job.id])).status,'delivered');
  await db.run("UPDATE push_jobs SET status='pending',next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?",[job.id]);
  await deliverNotifications(db,enqueue,async()=>{throw Object.assign(new Error('Expired'),{statusCode:410});});
  assert.equal((await db.all('SELECT * FROM push_subscriptions WHERE endpoint=?',[endpoint])).length,0);
  await json('/campo/notificacoes','POST',subscription,field);
  await db.run("UPDATE push_jobs SET status='pending',next_attempt_at='2000-01-01T00:00:00Z' WHERE id=?",[job.id]);
  const raw=await db.get('SELECT data FROM orders WHERE id=?',[orderId]);const data=JSON.parse(raw.data);data.assigned_user_id='someone-else';await db.run('UPDATE orders SET data=? WHERE id=?',[JSON.stringify(data),orderId]);
  await deliverNotifications(db,enqueue,async()=>{assert.fail('Must not notify a former assignee');});
 } finally {delete process.env.VAPID_PUBLIC_KEY;delete process.env.VAPID_PRIVATE_KEY;delete process.env.VAPID_SUBJECT;}
});


test('invoice confirmation updates stock, stage cost and controlled OS consumption',async()=>{
  const occurrence=await createTriaged(-33.1);const scheduled=await schedule(occurrence);const id=scheduled.data.id;
  const invoiceId=crypto.randomUUID();const adminUser=await db.get("SELECT id FROM users WHERE email='admin@urbana.local'");
  await db.run("INSERT INTO invoices(id,order_id,status,supplier,invoice_number,issue_date,total_value,filename,original_name,user_id,created_at,data) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",[invoiceId,id,'RASCUNHO','','',null,0,'fixture.pdf','fixture.pdf',adminUser.id,new Date().toISOString(),'{}']);
  const confirmation=await json('/notas-fiscais/'+invoiceId+'/confirmar','POST',{supplier:'Fornecedor Teste',invoice_number:'NF-ESTOQUE-1',issue_date:'2026-09-14',total_value:200,items:[{description:'Massa asfáltica',material_id:'material-1',stage:'execucao',purchased_quantity:100,used_quantity:10,unit:'kg',unit_value:2,product_total:200}]});
  assert.equal(confirmation.status,200);assert.equal(confirmation.data.status,'CONFIRMADA');
  assert.equal((await json('/almoxarifado','GET',undefined,reader)).status,403);
  let inventory=(await json('/almoxarifado')).data;let material=inventory.materials.find(item=>item.id==='material-1');assert.equal(material.stock,90);assert.equal(material.average_cost,2);
  let detail=(await json('/ordens-servico/'+id)).data;assert.equal(detail.cost_by_stage.find(row=>row.stage==='execucao').value,20);
  assert.equal((await attach('/ordens-servico/'+id,'antes')).status,200);assert.equal((await json('/ordens-servico/'+id+'/iniciar','POST',{lat:-33.1,lng:-48.6})).status,200);
  assert.equal((await json('/ordens-servico/'+id+'/material','POST',{material_id:'material-1',quantity:5})).status,200);
  inventory=(await json('/almoxarifado')).data;material=inventory.materials.find(item=>item.id==='material-1');assert.equal(material.stock,85);
  assert.equal((await json('/ordens-servico/'+id+'/material','POST',{material_id:'material-1',quantity:1000})).status,409);
});
