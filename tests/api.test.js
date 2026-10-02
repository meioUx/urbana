import { deliverNotifications } from "../server/field.js";
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../server/db.js';
import { seed } from '../server/seed.js';
import { createApp } from '../server/app.js';

let db,server,base,admin,reader,field;
const temp=mkdtempSync(join(tmpdir(),'urbana-test-'));
process.env.DATA_DIR=temp;process.env.DEMO_DATA='false';process.env.ADMIN_PASSWORD='Testing@2026';
delete process.env.DATABASE_URL;
const json=async(path,method='GET',body,cookie=admin)=>{if(method!=='GET' && body){const m=path.match(/^\/(ocorrencias|ordens-servico)\/([^/]+)(?:\/([^/]+))?$/);if(m && !['material','equipamento','anexos'].includes(m[3]) && body.version===undefined){const current=await json('/'+m[1]+'/'+m[2],'GET',undefined,cookie);body={...body,version:current.data.version};}if(body.triage && body.triage.version===undefined){const current=await json('/ocorrencias/'+body.occurrence_ids[0],'GET',undefined,cookie);body={...body,triage:{...body.triage,version:current.data.version}};}}const r=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};};
const draft=(lat=-27.1)=>({category_id:'category-1',subcategory:'Buraco',description:'Falha no pavimento',origin:'Fiscalização municipal',priority:'Alta',lat,lng:-48.6,address:'Rua de teste, 100',neighborhood:'Centro'});
const photo=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV6kAAAAASUVORK5CYII=','base64');
async function attach(path,stage,content=photo,mime='image/png') {const f=new FormData();f.append('file',new Blob([content],{type:mime}),'photo.png');f.append('stage',stage);f.append('lat','-27.1');f.append('lng','-48.6');const r=await fetch(base+path+'/anexos',{method:'POST',headers:{cookie:admin},body:f});return {status:r.status,data:await r.json()};}
async function createTriaged(lat) {const o=await json('/ocorrencias','POST',draft(lat));assert.equal(o.status,200);const c=await json(`/ocorrencias/${o.data.id}/classificar`,'POST',{category_id:'category-1',subcategory:'Buraco',priority:'Alta',sector_id:'sector-1'});assert.equal(c.status,200);return o.data;}
async function schedule(o,team='team-1') {return json('/ordens-servico','POST',{occurrence_ids:[o.id],team_id:team,scheduled_at:'2026-09-15',responsible:'Responsável de teste'});}
test('triage refusal requires reason, preserves audit and removes demand from active planning',async()=>{
  const created=await json('/ocorrencias','POST',draft(-34.81));
  assert.equal(created.status,200);
  const id=created.data.id;
  assert.equal((await json(`/ocorrencias/${id}/recusar`,'POST',{reason:'Sem autorização'},reader)).status,403);
  assert.equal((await json(`/ocorrencias/${id}/recusar`,'POST',{reason:'Sem autorização'},field)).status,403);
  assert.equal((await json(`/ocorrencias/${id}/recusar`,'POST',{reason:'   '})).status,400);
  const before=(await json('/dashboard')).data.open;
  const rejected=await json(`/ocorrencias/${id}/recusar`,'POST',{reason:'  Demanda fora da competência municipal.  '});
  assert.equal(rejected.status,200);
  assert.equal(rejected.data.status,'RECUSADA');
  assert.equal(rejected.data.rejection_reason,'Demanda fora da competência municipal.');
  assert.ok(rejected.data.rejected_by);
  assert.ok(rejected.data.rejected_at);
  const detail=(await json(`/ocorrencias/${id}`)).data;
  assert.ok(detail.history.some(h=>h.event==='Demanda recusada na triagem' && JSON.parse(h.after_value).rejection_reason===rejected.data.rejection_reason));
  assert.equal((await json('/dashboard')).data.open,before-1);
  assert.ok((await json('/planejamento')).data.groups.every(g=>g.occurrences.every(o=>o.id!==id)));
  assert.equal((await json(`/ocorrencias/${id}/recusar`,'POST',{reason:'Outra justificativa'})).status,409);
  assert.equal((await schedule(created.data)).status,409);
  assert.equal((await attach(`/ocorrencias/${id}`,'registro')).status,409);
});
test('integrated triage and order creation roll back classification when scheduling fails',async()=>{
  const created=await json('/ocorrencias','POST',draft(-34.82));
  assert.equal(created.status,200);
  const payload={occurrence_ids:[created.data.id],team_id:'team-3',scheduled_at:'2026-10-02',responsible:'Gestor',triage:{category_id:'category-1',subcategory:'Buraco',sector_id:'sector-1',priority:'Alta'}};
  assert.equal((await json('/ordens-servico','POST',payload)).status,400);
  const unchanged=(await json(`/ocorrencias/${created.data.id}`)).data;
  assert.equal(unchanged.status,'IDENTIFICADA');
  assert.equal(unchanged.priority,created.data.priority);
  assert.equal(unchanged.history.filter(h=>h.event==='Triagem e encaminhamento registrados').length,0);
  const success=await json('/ordens-servico','POST',{...payload,team_id:'team-1'});
  assert.equal(success.status,200);
  assert.equal(success.data.status,'PROGRAMADA');
  assert.equal((await json(`/ocorrencias/${created.data.id}`)).data.status,'PROGRAMADA');
  assert.equal((await json(`/ocorrencias/${created.data.id}/recusar`,'POST',{reason:'Não é mais permitido'})).status,409);
});
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

test('street action plans: priority, permissions, membership, scheduling and persistence',async()=>{
  const create=async(address,neighborhood='Centro',priority='Baixa')=>{
    const result=await json('/ocorrencias','POST',{...draft(-28),address,neighborhood,priority,duplicate_action:'new'});
    assert.equal(result.status,200);return result.data;
  };
  const a=await create('Rua União, 100'),b=await create('R. Uniao, 200'),other=await create('Rua União, 300','Outro bairro');
  const emergency=await create('Rua Emergência, 1','Centro','Emergencial');
  const payload={occurrence_ids:[a.id,b.id],objective:'Reparar os trechos da rua em conjunto',responsible:'Gestão viária',scheduled_at:'2026-09-20'};
  assert.equal((await json('/planos-acao','POST',payload,reader)).status,403);
  assert.equal((await json('/planos-acao','POST',{...payload,occurrence_ids:[]})).status,400);
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

test('kanban shared ordering is persistent, authorized and rejects stale or incomplete columns',async()=>{
  let config=(await json('/kanban')).data;
  assert.equal((await json('/kanban','PATCH',{revision:config.revision,limits:{}},reader)).status,403);
  const created=await json('/ocorrencias','POST',draft(-36.21));assert.equal(created.status,200);
  const rows=(await json('/ocorrencias')).data,orders=(await json('/ordens-servico')).data;
  const linked=new Set(orders.flatMap(o=>o.occurrence_ids));
  const keys=rows.filter(o=>o.status==='IDENTIFICADA'&&!linked.has(o.id)).map(o=>'occurrence:'+o.id).reverse();
  assert.ok(keys.length);
  assert.equal((await json('/kanban/ordem','POST',{revision:config.revision,status:'IDENTIFICADA',keys},reader)).status,403);
  assert.equal((await json('/kanban/ordem','POST',{revision:config.revision,status:'IDENTIFICADA',keys:[...keys,keys[0]]})).status,409);
  assert.equal((await json('/kanban/ordem','POST',{revision:config.revision,status:'IDENTIFICADA',keys:[]})).status,409);
  const sorted=await json('/kanban/ordem','POST',{revision:config.revision,status:'IDENTIFICADA',keys});assert.equal(sorted.status,200);
  assert.equal((await json('/kanban/ordem','POST',{revision:config.revision,status:'IDENTIFICADA',keys})).status,409);
  config=(await json('/bootstrap')).data.kanban;assert.deepEqual(config.order.IDENTIFICADA,keys);
  assert.deepEqual(JSON.parse((await db.get("SELECT value FROM settings WHERE id='kanban'")).value).order.IDENTIFICADA,keys);
  assert.ok((await db.all("SELECT * FROM audit_logs WHERE entity_type='kanban'")).some(a=>a.event==='Ordem dos cartões atualizada'));
});

test('kanban WIP limits enforce atomic transitions outside the board and protect concurrent moves',async()=>{
  const source=(await json('/ocorrencias','POST',draft(-36.31))).data;
  const other=(await json('/ocorrencias','POST',draft(-36.32))).data;
  const triage={category_id:'category-1',subcategory:'Buraco',priority:'Alta',sector_id:'sector-1'};
  await createTriaged(-36.33);
  const count=Number((await db.get("SELECT COUNT(*) AS n FROM occurrences WHERE status='EM_TRIAGEM' AND NOT EXISTS (SELECT 1 FROM order_occurrences r WHERE r.occurrence_id=occurrences.id)")).n);
  let config=(await json('/kanban')).data;
  const limits=await json('/kanban','PATCH',{revision:config.revision,limits:{EM_TRIAGEM:count}});assert.equal(limits.status,200);
  try {
    const beforeAudit=(await db.all('SELECT * FROM audit_logs')).length;
    const full=await json(`/ocorrencias/${source.id}/classificar`,'POST',{...triage,kanban_expected_status:'IDENTIFICADA'});
    assert.equal(full.status,409);assert.equal(full.data.details.wip,'EM_TRIAGEM');
    assert.equal((await json('/ocorrencias/'+source.id)).data.status,'IDENTIFICADA');
    assert.equal((await db.all('SELECT * FROM audit_logs')).length,beforeAudit);
    config=(await json('/kanban')).data;
    assert.equal((await json('/kanban','PATCH',{revision:config.revision,limits:{CONCLUIDA:2}})).status,400);
    assert.equal((await json('/kanban','PATCH',{revision:config.revision,limits:{EM_TRIAGEM:-1}})).status,400);
    await json('/kanban','PATCH',{revision:config.revision,limits:{}});
    assert.equal((await json(`/ocorrencias/${source.id}/classificar`,'POST',{...triage,kanban_expected_status:'IDENTIFICADA'})).status,200);
    const stale=await json(`/ocorrencias/${source.id}/classificar`,'POST',{...triage,priority:'Baixa',kanban_expected_status:'IDENTIFICADA'});
    assert.equal(stale.status,409);assert.equal((await json('/ocorrencias/'+source.id)).data.priority,'Alta');
    const scheduled=await schedule(source);assert.equal(scheduled.status,200);
    const programmed=Number((await db.get("SELECT COUNT(*) AS n FROM orders WHERE status='PROGRAMADA'")).n);
    config=(await json('/kanban')).data;await json('/kanban','PATCH',{revision:config.revision,limits:{PROGRAMADA:programmed}});
    assert.equal((await json(`/ocorrencias/${other.id}/classificar`,'POST',triage)).status,200);
    const beforeOrders=(await json('/ordens-servico')).data.length;
    const noCapacity=await schedule(other);assert.equal(noCapacity.status,409);
    assert.equal((await json('/ordens-servico')).data.length,beforeOrders);
    assert.equal((await json('/ocorrencias/'+other.id)).data.status,'EM_TRIAGEM');
    // A leaving item releases a slot, while evidence rules remain mandatory.
    assert.equal((await json(`/ordens-servico/${scheduled.data.id}/iniciar`,'POST',{lat:-36.31,lng:-48.6})).status,400);
    assert.equal((await json(`/ordens-servico/${scheduled.data.id}/assumir`,'POST',{})).status,200);
    assert.equal((await schedule(other)).status,200);
  } finally { config=(await json('/kanban')).data;await json('/kanban','PATCH',{revision:config.revision,limits:{}}); }
});

test('single-demand plans and atomic planning plus dispatch preserve reservations and WIP',async()=>{
  const solo=(await json('/ocorrencias','POST',{...draft(-37.51),address:'Rua Obra Individual, 10',priority:'Baixa'})).data;
  const single=await json('/planos-acao','POST',{occurrence_ids:[solo.id],objective:'Executar a intervenção isolada',responsible:'Coordenação',scheduled_at:'2026-10-02'});
  assert.equal(single.status,200);assert.equal(single.data.priority,'Baixa');assert.equal(single.data.sector_id,'sector-1');
  const pending=(await json('/planejamento')).data.plans.find(p=>p.id===single.data.id);assert.equal(pending.occurrences.length,1);assert.equal(pending.orders.length,0);
  const paved=(await json('/ocorrencias','POST',{...draft(-37.52),address:'Rua Setor de Teste, 10'})).data;
  const drain=(await json('/ocorrencias','POST',{...draft(-37.53),address:'Rua Setor de Teste, 20',category_id:'category-2',subcategory:'Obstrução'})).data;
  const planCount=(await json('/planejamento')).data.plans.length;
  assert.equal((await json('/planos-acao','POST',{occurrence_ids:[paved.id,drain.id],objective:'Intervir na mesma rua',responsible:'Coordenação',scheduled_at:'2026-10-02'})).status,400);
  assert.equal((await json('/planejamento')).data.plans.length,planCount);
  const ready=await createTriaged(-37.54);
  const payload={occurrence_ids:[ready.id],team_id:'team-1',responsible:'Equipe responsável',scheduled_at:'2026-10-02',new_plan:{objective:'Reparar a via e liberar o tráfego',responsible:'Coordenação de obras'}};
  assert.equal((await json('/ordens-servico','POST',payload,reader)).status,403);
  assert.equal((await json('/ordens-servico','POST',{...payload,team_id:'team-3'})).status,400);
  assert.equal((await json('/ordens-servico','POST',{...payload,scheduled_at:'2026-02-30'})).status,400);
  assert.equal((await json('/planejamento')).data.plans.length,planCount);
  let config=(await json('/kanban')).data;
  const count=Number((await db.get("SELECT COUNT(*) AS n FROM orders WHERE status='PROGRAMADA'")).n);assert.ok(count>0);
  await json('/kanban','PATCH',{revision:config.revision,limits:{PROGRAMADA:count}});
  try {
    const auditCount=(await db.all('SELECT * FROM audit_logs')).length;
    const blocked=await json('/ordens-servico','POST',payload);assert.equal(blocked.status,409);assert.equal(blocked.data.details.wip,'PROGRAMADA');
    assert.equal((await json('/planejamento')).data.plans.length,planCount);
    assert.equal((await db.all('SELECT * FROM audit_logs')).length,auditCount);
    assert.equal((await db.get('SELECT plan_id FROM action_plan_occurrences WHERE occurrence_id=?',[ready.id])),undefined);
    assert.equal((await json('/ocorrencias/'+ready.id)).data.status,'EM_TRIAGEM');
  } finally {config=(await json('/kanban')).data;await json('/kanban','PATCH',{revision:config.revision,limits:{}});}
  const created=await json('/ordens-servico','POST',payload);assert.equal(created.status,200);assert.ok(created.data.plan_id);
  const plan=(await json('/planejamento')).data.plans.find(p=>p.id===created.data.plan_id);
  assert.equal(plan.orders.length,1);assert.equal(plan.orders[0].id,created.data.id);assert.deepEqual(plan.occurrences[0].order_ids,[created.data.id]);
  assert.equal(plan.occurrences[0].status,'PROGRAMADA');assert.equal(plan.scheduled_at,'2026-10-02');
  const beforeRepeat=(await json('/planejamento')).data.plans.length;
  assert.equal((await json('/ordens-servico','POST',payload)).status,409);
  assert.equal((await json('/planejamento')).data.plans.length,beforeRepeat);
  assert.equal((await json('/planos-acao','POST',{occurrence_ids:[ready.id],objective:'Novo plano indevido',responsible:'Coordenação',scheduled_at:'2026-10-03'})).status,409);
  // Existing OS links cannot be repackaged as unassigned work, even if an old record has a triage status.
  await db.run("UPDATE occurrences SET status='EM_TRIAGEM' WHERE id=?",[ready.id]);
  assert.equal((await json('/planos-acao','POST',{occurrence_ids:[ready.id],objective:'Novo plano indevido',responsible:'Coordenação',scheduled_at:'2026-10-03'})).status,409);
  await db.run("UPDATE occurrences SET status='PROGRAMADA' WHERE id=?",[ready.id]);
});


test('version conflicts reject stale edits, require a read version and roll back audit', async()=>{
  const created=await json('/ocorrencias','POST',draft(-38.01));
  assert.equal(created.data.version,1);
  const path='/ocorrencias/'+created.data.id;
  const triage={category_id:'category-1',subcategory:'Buraco',sector_id:'sector-1',priority:'Alta',version:1};
  const [first,second]=await Promise.all([json(path+'/classificar','POST',triage),json(path+'/classificar','POST',{...triage,priority:'Baixa'})]);
  assert.deepEqual([first.status,second.status].sort(),[200,409]);
  const conflict=[first,second].find(r=>r.status===409);
  assert.equal(conflict.data.code,'VERSION_CONFLICT');
  assert.equal(conflict.data.details.current_version,2);
  const current=(await json(path)).data;
  assert.equal(current.version,2);
  assert.equal(current.history.filter(h=>h.event==='Triagem e encaminhamento registrados').length,1);
  const missing=await fetch(base+path+'/classificar',{method:'POST',headers:{cookie:admin,'Content-Type':'application/json'},body:JSON.stringify({...triage,version:undefined})});
  assert.equal(missing.status,428);
  assert.equal((await missing.json()).code,'VERSION_REQUIRED');
  assert.equal((await json(path+'/classificar','POST',{...triage,version:'2'})).status,400);
  const scheduled=await schedule(created.data);
  assert.equal(scheduled.status,200);
  assert.equal(scheduled.data.version,1);
  assert.equal((await json(path)).data.version,3);
  const orderPath='/ordens-servico/'+scheduled.data.id;
  const taken=await json(orderPath+'/assumir','POST',{version:1});
  assert.equal(taken.status,200);assert.equal(taken.data.version,2);
  const stale=await json(orderPath+'/cancelar','POST',{version:1,reason:'Tela antiga'});
  assert.equal(stale.status,409);assert.equal(stale.data.code,'VERSION_CONFLICT');
  const order=(await json(orderPath)).data;
  assert.equal(order.status,'EM_DESLOCAMENTO');
  assert.equal(order.version,2);
  assert.ok(!order.history.some(h=>h.event.startsWith('cancelar:')));
});


test('SQL listing uses stable cursor pages, validates filters and preserves field authorization',async()=>{
  const ids=[];
  for(let i=0;i<5;i++){const c=await json('/ocorrencias','POST',{...draft(-39-i*0.01),address:'Rua Paginação SQL, '+i,description:'Descrição ÁRVORE SQL',duplicate_action:'new'});assert.equal(c.status,200);ids.push(c.data.id);}
  const path='/ocorrencias?limit=2&q='+encodeURIComponent('árvore sql');
  const seen=[];let cursor='';let pages=0;
  do {const r=await json(path+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(r.status,200);assert.ok(r.data.items.length<=2);seen.push(...r.data.items.map(x=>x.id));cursor=r.data.next_cursor;pages++;assert.ok(pages<=4);} while(cursor);
  assert.equal(seen.length,5);assert.equal(new Set(seen).size,5);assert.deepEqual(new Set(seen),new Set(ids));
  const first=(await json(path)).data;
  assert.equal((await json('/ocorrencias?limit=2&q=outro&cursor='+encodeURIComponent(first.next_cursor))).status,400);
  for(const query of ['limit=0','limit=201','limit=1.5','cursor=invalid','from=2026-02-30','from=2026-10-02&to=2026-01-01','bbox=1,2,3','bbox=1,2,0,4']) assert.equal((await json('/ocorrencias?'+query)).status,400,query);
  assert.equal((await json('/ocorrencias?limit=2&q='+encodeURIComponent('ÁRVORE SQL'))).data.items.length,2);
  assert.equal((await json('/ocorrencias?limit=2&q=%')).data.items.length,0);
  const map=(await json('/mapa/ocorrencias?bbox=-49,-39.01,-48,-38.99')).data;
  assert.ok(map.features.some(f=>f.properties.id===ids[0]));
  assert.ok(map.features.every(f=>f.geometry.coordinates[1]>=-39.01 && f.geometry.coordinates[1]<=-38.99));
  const fieldUser=(await json('/auth/me','GET',undefined,field)).data.user;
  const own=(await json('/ordens-servico?limit=2','GET',undefined,field)).data;
  assert.ok(own.items.every(o=>o.team_id==='team-2' && (!o.assigned_user_id || o.assigned_user_id===fieldUser.id)));
  assert.equal((await json('/auditoria?limit=2','GET',undefined,reader)).status,403);
  const audit=await json('/auditoria?limit=2&entity_type=occurrence&entity_id='+ids[0]);
  assert.equal(audit.status,200);assert.ok(audit.data.items.every(a=>a.entity_id===ids[0] && a.entity_type==='occurrence'));
  assert.ok(audit.data.items.every(a=>a.user_name));
});


test('inventory calculates balances from full SQL history while listing bounded cursor pages',async()=>{
  const material=await json('/materiais','POST',{name:'Material para paginação',unit:'UN',unit_cost:3,minimum_stock:1});assert.equal(material.status,200);
  const user=(await json('/auth/me')).data.user;
  for(let i=0;i<105;i++)await db.run("INSERT INTO inventory_movements(id,material_id,order_id,invoice_id,type,quantity,unit_cost,stage,notes,user_id,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",[crypto.randomUUID(),material.data.id,null,null,'entrada',2,3,'ajuste','Teste de paginação',user.id,'2026-10-02T12:00:00.000Z']);
  const warehouse=await json('/almoxarifado');assert.equal(warehouse.status,200);assert.ok(warehouse.data.movements.length<=100);
  const summary=warehouse.data.materials.find(m=>m.id===material.data.id);assert.equal(summary.stock,210);assert.equal(summary.average_cost,3);assert.equal(summary.stock_value,630);
  const path='/almoxarifado/movimentos?limit=50&material_id='+material.data.id;const seen=[];let cursor='';do{const r=await json(path+(cursor?'&cursor='+encodeURIComponent(cursor):''));assert.equal(r.status,200);assert.ok(r.data.items.length<=50);seen.push(...r.data.items.map(x=>x.id));cursor=r.data.next_cursor;}while(cursor);
  assert.equal(seen.length,105);assert.equal(new Set(seen).size,105);
  assert.equal((await json(path,'GET',undefined,reader)).status,403);
  assert.equal((await json(path,'GET',undefined,field)).status,403);
  assert.equal((await json(path+'&type=saida')).data.items.length,0);
});

test('HTTP policy permits browser origin Referer on external HTTPS tiles', async () => {
  const response = await fetch(base + '/auth/me', { headers: { cookie: admin } });
  assert.equal(response.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('cache-control'), 'no-store'); // API only, not external tile requests.
});

test('territorial summary uses linked OS data and authenticated evidence without administrative payload', async () => {
  const oc = await createTriaged(-32.4);
  const empty = await json(`/mapa/ocorrencias/${oc.id}/resumo`);
  assert.equal(empty.status,200); assert.deepEqual(empty.data.orders,[]);
  const created = await schedule(oc); assert.equal(created.status,200);
  const id = created.data.id;
  await attach(`/ordens-servico/${id}`,'antes');
  let result = (await json(`/mapa/ocorrencias/${oc.id}/resumo`)).data;
  assert.equal(result.address,oc.address); assert.equal(result.orders[0].code,created.data.code);
  assert.equal(result.orders[0].started_at,null); assert.equal(result.orders[0].attendance_at,created.data.scheduled_at);
  assert.ok(result.orders[0].team); assert.ok(result.orders[0].before); assert.equal(result.orders[0].after,null);
  assert.deepEqual(Object.keys(result.orders[0]).sort(),['code','started_at','attendance_at','completed_at','expected_completion_at','team','before','after'].sort());
  assert.equal((await json(`/mapa/ocorrencias/${oc.id}/resumo`,'GET',undefined,null)).status,401);
  assert.equal((await json(`/mapa/ocorrencias/${oc.id}/resumo`,'GET',undefined,field)).data.orders.length,0);
  await json(`/ordens-servico/${id}/assumir`,'POST',{});
  await json(`/ordens-servico/${id}/iniciar`,'POST',{lat:-32.4,lng:-48.6});
  await attach(`/ordens-servico/${id}`,'depois');
  await json(`/ordens-servico/${id}/material`,'POST',{material_id:'material-1',quantity:1});
  await json(`/ordens-servico/${id}/concluir`,'POST',{notes:'Servico executado'});
  await json(`/ordens-servico/${id}/validar`,'POST',{});
  const order = (await json(`/ordens-servico/${id}`)).data;
  result = (await json(`/mapa/ocorrencias/${oc.id}/resumo`)).data.orders[0];
  assert.equal(result.started_at,order.started_at); assert.equal(result.attendance_at,order.finished_at); assert.equal(result.completed_at,order.completed_at); assert.ok(result.after);
});
