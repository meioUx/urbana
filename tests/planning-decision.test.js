import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkCandidates, filterWorkCandidates, groupStreets, occurrenceDeadline, sortWorkCandidates, unscheduledPlanMembers } from "../shared/planning.mjs";

const catalogs = [{id:"paving",kind:"categorias",name:"Pavimentação",sla:{Emergencial:24,Alta:48,Média:120,Baixa:240}},{id:"drain",kind:"categorias",name:"Drenagem",sla:{Alta:48}},{id:"roads",kind:"setores",name:"Vias"},{id:"water",kind:"setores",name:"Águas"}];
const row = (id, extras={}) => ({id,code:`OC-${id}`,address:"Rua União, 100",neighborhood:"Centro",sector_id:"roads",category_id:"paving",priority:"Baixa",status:"EM_TRIAGEM",created_at:"2026-09-01T12:00:00Z",...extras});
const time=Date.parse("2026-09-03T12:00:00Z");

test("decision candidates exclude reserved and assigned services and separate sectors on the same street",()=>{
  const rows=[row("ready"),row("waiting",{status:"IDENTIFICADA"}),row("reserved",{plan_id:"plan"}),row("order",{order_ids:["os"]}),row("linked"),row("active",{status:"EM_EXECUCAO"}),row("drain",{category_id:"drain",sector_id:"water",priority:"Alta"})];
  const candidates=buildWorkCandidates(groupStreets(rows),catalogs,[{occurrence_ids:["linked"]}],time);
  assert.equal(candidates.length,2);
  const roads=candidates.find(c=>c.sector_id==="roads");
  assert.deepEqual(roads.ready.map(o=>o.id),["ready"]);
  assert.deepEqual(roads.waiting.map(o=>o.id),["waiting"]);
  assert.equal(roads.priority,"Alta");assert.equal(roads.highest_priority,"Baixa");assert.equal(roads.grouped_priority,true);
  assert.equal(roads.earliest_due_at,"2026-09-11T12:00:00.000Z");
  assert.equal(roads.age_days,2);assert.equal(roads.overdue,0);
  assert.equal(candidates.find(c=>c.sector_id==="water").ready.length,1);
});

test("decision filtering is accent insensitive and priority changes do not hide isolated emergencies",()=>{
  const rows=[row("emergency",{address:"Rua Única, 1",priority:"Emergencial",status:"IDENTIFICADA"}),row("large1",{address:"Rua Volume, 1"}),row("large2",{address:"Rua Volume, 2"}),row("large3",{address:"Rua Volume, 3"})];
  const candidates=buildWorkCandidates(groupStreets(rows),catalogs,[],time);
  for(const mode of ["priority","volume","deadline","age"]) assert.equal(sortWorkCandidates(candidates,mode)[0].street,"Rua Única");
  assert.equal(filterWorkCandidates(candidates,{query:"unica centro"}).length,1);
  assert.equal(filterWorkCandidates(candidates,{readiness:"ready"})[0].street,"Rua Volume");
  assert.equal(filterWorkCandidates(candidates,{readiness:"triage"})[0].street,"Rua Única");
  assert.equal(filterWorkCandidates(candidates,{sector:"missing"}).length,0);
});

test("deadline calculation preserves the original clock and reveals absent SLA rather than guessing",()=>{
  const low=row("low");
  assert.equal(occurrenceDeadline(low,catalogs),"2026-09-11T12:00:00.000Z");
  assert.equal(occurrenceDeadline(low,catalogs,"Alta"),"2026-09-03T12:00:00.000Z");
  assert.equal(occurrenceDeadline({...low,category_id:"missing"},catalogs),null);
  assert.equal(occurrenceDeadline({...low,created_at:"invalid"},catalogs),null);
  const candidates=buildWorkCandidates(groupStreets([row("unknown",{category_id:"missing",created_at:"invalid"})]),catalogs,[],time);
  assert.equal(candidates[0].earliest_due_at,null);assert.equal(candidates[0].age_days,null);
  assert.deepEqual(unscheduledPlanMembers({occurrences:[row("ready"),row("assigned",{order_ids:["os"]}),row("waiting",{status:"IDENTIFICADA"})]}).map(o=>o.id),["ready"]);
});
