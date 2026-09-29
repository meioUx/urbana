import { test } from 'node:test';
import assert from 'node:assert/strict';
import { streetIdentity, groupStreets } from '../server/planning.js';
const row=(id,address,extra={})=>({id,address,neighborhood:'Centro',priority:'Baixa',status:'IDENTIFICADA',created_at:'2026-09-14T10:00:00Z',...extra});
test('street identity preserves numbered streets and separates neighborhoods',()=>{
  assert.equal(streetIdentity(row('a','Av. União, 12')).key,streetIdentity(row('b','Avenida Uniao, 35')).key);
  assert.equal(streetIdentity(row('a','Rua Brasil nº 100')).key,streetIdentity(row('b','Rua Brasil, 200')).key);
  assert.notEqual(streetIdentity(row('a','Rua 100')).key,streetIdentity(row('b','Rua 200')).key);
  assert.notEqual(streetIdentity(row('a','Rua Brasil, 1')).key,streetIdentity(row('b','Rua Brasil, 2',{neighborhood:'Bairro novo'})).key);
});
test('ranking counts open distinct occurrences and keeps emergencies first',()=>{
  const groups=groupStreets([row('a','Rua A, 1'),row('b','Rua A, 2'),row('c','Rua B, 1',{priority:'Emergencial'}),row('d','Rua C, 1',{status:'CONCLUIDA'}),row('e','Rua A, 3',{status:'CANCELADA'})]);
  assert.equal(groups.length,2);assert.equal(groups[0].priority,'Emergencial');assert.equal(groups[1].priority,'Alta');assert.equal(groups[1].occurrences.length,2);
});
