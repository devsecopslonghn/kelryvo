// Native schema evidence UI against a private PostgreSQL fixture. Synthetic
// retained snapshots test rendering/comparison; none qualifies live Oracle.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {normalizeSchema,compareSchemas} from './native-test-fixtures.mjs';

export async function schemaBaselinesBrowser({page,api,sql,actor,reviewer,reviewerToken,origin}){
  if(!process.env.KELRYVO_RUST_TEST_DATABASE_URL?.startsWith('postgresql:///kelryvo_rust_test?host='))throw new Error('Private schema evidence fixture required');
  const org='00000000-0000-4000-8000-000000000001';
  const created=await api.post('/api/projects',{data:{name:'Native schema baselines browser'}});assert.equal(created.status(),201);const project=(await created.json()).project.id;
  for(const member of [actor,reviewer])await sql`INSERT INTO sf_project_grants(organization_id,project_id,actor_id,grant_os_uid) VALUES(${org},${project},${member},1000)`;
  assert.equal((await api.post(`/api/projects/${project}/environments`,{data:{name:'Schema evidence development'}})).status(),201);
  execFileSync(process.execPath,['scripts/seed-rust-fixture.mjs','target'],{env:{...process.env,KELRYVO_RUST_TEST_PROJECT_ID:project},stdio:['ignore','pipe','pipe']});
  const r=await api.get(`/api/projects/${project}/target-bindings`);assert.equal(r.status(),200);const binding=(await r.json()).bindings[0],id=binding.bindingId;
  const registered=await api.post(`/api/projects/${project}/database-connections`,{data:{assignmentId:binding.assignmentId,routeId:binding.routeId,name:'Authorized schema fixture',engine:'oracle',username:'APP',credentialRef:'secret://native/schema-private-pointer',reason:'Private schema evidence fixture'}});assert.equal(registered.status(),201,await registered.text());const connection=(await registered.json()).connection;
  const coverage={TABLE:'COMPLETE',VIEW:'COMPLETE',INDEX:'COMPLETE',SEQUENCE:'COMPLETE',DEPENDENCY:'COMPLETE'};
  const definition={columns:[{name:'ID',type:'NUMBER'}],text:'<script>window.schemaObjectCanary=true</script> Tiếng Việt 😀'};
  const before=normalizeSchema({coverage,objects:[{owner:'APP',name:'ITEM',type:'TABLE',definition},{owner:'APP',name:'ITEM_VIEW',type:'VIEW',definition:{query:'select ID from ITEM'}}],limitations:[]},'APP');
  const after=normalizeSchema({coverage,objects:[{owner:'APP',name:'ITEM',type:'TABLE',definition:{...definition,columns:[...definition.columns,{name:'LABEL',type:'VARCHAR2(40 BYTE)'}]}},{owner:'APP',name:'ITEM_VIEW',type:'VIEW',definition:{query:'select ID from ITEM'}},{owner:'APP',name:'ITEM_INDEX',type:'INDEX',definition:{table:'ITEM',columns:['ID']}}],limitations:[]},'APP');
  const insert=async(schema,offset)=>{
    const [snap]=await sql`INSERT INTO sf_schema_snapshots(organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,live_accepted,actor_id,reason,observed_at) VALUES(${org},${project},${id},${binding.bindingRevision},${binding.assignmentRevision},${binding.streamId},${binding.routeId},${connection.id},1,'APP',NULL,${'a'.repeat(64)},${sql.json(schema)},${schema.contentDigest},'FIXTURE',false,${actor},'Private synthetic retained schema',${new Date(Date.now()+offset)}) RETURNING id`;
    return snap.id;
  };
  const oldest=await insert(before,-120000),latest=await insert(after,-1000);
  await sql`INSERT INTO sf_schema_snapshots(organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,live_accepted,actor_id,reason,observed_at) SELECT organization_id,project_id,binding_id,binding_revision,assignment_revision,stream_id,route_id,connection_id,connection_revision,owner,identity,identity_digest,schema,content_digest,provenance,live_accepted,actor_id,reason,observed_at+g*interval '1 microsecond' FROM sf_schema_snapshots CROSS JOIN generate_series(1,50) g WHERE id=${oldest}`;
  await sql`INSERT INTO sf_schema_baselines(organization_id,project_id,snapshot_id,name,reason,actor_id,created_at) SELECT ${org},${project},${oldest},'Private baseline '||g,'Private baseline pagination',${actor},clock_timestamp()-g*interval '1 microsecond' FROM generate_series(1,101) g`;
  const idle=p=>p.locator('#root[aria-busy="false"]').waitFor();
  const open=async p=>{await p.getByRole('button',{name:'Projects',exact:true}).click();await p.locator(`#project-card-${project}`).getByRole('button',{name:'Open project',exact:true}).click();await p.getByRole('button',{name:'Schema baselines',exact:true}).click();await p.getByRole('region',{name:'Schema baselines and drift',exact:true}).waitFor();await idle(p);};
  const detail=p=>p.getByRole('region',{name:'Schema snapshot detail',exact:true});
  const snap=p=>p.locator('.schema-snapshot-row');const baseline=p=>p.locator('.schema-baseline-row');
  await open(page);assert.equal(await page.getByLabel('Schema target',{exact:true}).inputValue(),id);assert.equal(await snap(page).count(),50);assert.equal(await baseline(page).count(),100);
  await page.getByRole('button',{name:'Load more snapshots',exact:true}).click();await idle(page);assert.equal(await snap(page).count(),52);assert.equal(await baseline(page).count(),100,'snapshot pagination preserves baseline page');
  await page.getByRole('button',{name:'Load more baselines',exact:true}).click();await idle(page);assert.equal(await snap(page).count(),52,'baseline pagination preserves all snapshot pages');assert.equal(await baseline(page).count(),101);
  await page.getByRole('button',{name:latest,exact:true}).click();await detail(page).waitFor();assert.equal(await page.locator('.retained-schema-object:not([hidden])').count(),3);
  await detail(page).getByText('Coverage and limitations',{exact:true}).click();assert.match(await detail(page).innerText(),/Not established/);
  await page.getByLabel('Search retained objects',{exact:true}).fill('app.item');await page.getByLabel('Filter retained objects by type',{exact:true}).selectOption('INDEX');assert.equal(await page.locator('.retained-schema-object:not([hidden])').count(),1);
  await page.getByLabel('Search retained objects',{exact:true}).fill('missing object fixture');assert.equal(await page.locator('.retained-schema-object:not([hidden])').count(),0);await page.getByText('No retained objects match these filters. This filtered view does not establish schema absence.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Clear object filters',exact:true}).click();await idle(page);assert.equal(await page.locator('.retained-schema-object:not([hidden])').count(),3);assert.equal(await detail(page).locator('script').count(),0);assert.equal(await page.evaluate(()=>window.schemaObjectCanary),undefined);
  await page.getByLabel('Baseline name',{exact:true}).fill('Native baseline <b>Tiếng Việt 😀</b>');await page.getByLabel('Capture reason',{exact:true}).fill('Explicit capture of retained synthetic evidence');
  await page.getByRole('button',{name:'Capture immutable baseline',exact:true}).click();await page.getByRole('status').filter({hasText:'Immutable baseline captured from the selected snapshot.'}).waitFor();
  const audit=await sql`SELECT actor_id,facts FROM sf_database_connection_audit WHERE connection_id=${connection.id} AND action='SCHEMA_BASELINE_CAPTURED'`;assert.equal(audit.length,1);assert.equal(audit[0].actor_id,actor);
  assert.equal((await sql`SELECT count(*)::int n FROM sf_schema_baselines WHERE project_id=${project}`)[0].n,102);assert.equal(await baseline(page).locator('b').count(),0);
  await page.getByLabel('Expected reference',{exact:true}).selectOption(oldest);await page.getByLabel('Observed snapshot',{exact:true}).selectOption(latest);
  await page.getByRole('button',{name:'Compare',exact:true}).click();const comparison=page.getByRole('region',{name:'Schema comparison result',exact:true});await comparison.waitFor();assert.match(await comparison.innerText(),/DRIFT/);assert.equal(await comparison.locator('.schema-comparison-change').count(),2);
  const compared=await api.get(`/api/projects/${project}/schema-comparison?expected=${oldest}&observed=${latest}`);assert.equal(compared.status(),200);assert.deepEqual((await compared.json()).comparison,JSON.parse(JSON.stringify(compareSchemas({owner:'APP',identityDigest:'a'.repeat(64),schema:before},{owner:'APP',identityDigest:'a'.repeat(64),schema:after}))));
  await page.getByLabel('Schema target',{exact:true}).selectOption('');await idle(page);assert.equal(await detail(page).count(),0);assert.equal(await comparison.count(),0,'target changes clear retained snapshot/comparison state');
  await page.getByLabel('Schema target',{exact:true}).selectOption(id);await idle(page);
  await page.route(`**/api/projects/${project}/schema-snapshots/${latest}`,r=>r.fulfill({status:409,contentType:'application/json',body:'{"error":"SCHEMA_SNAPSHOT_UNAVAILABLE"}'}));
  await page.getByRole('button',{name:latest,exact:true}).click();await page.getByRole('alert').filter({hasText:'SCHEMA SNAPSHOT UNAVAILABLE'}).waitFor();assert.equal(await detail(page).count(),0);
  await page.unroute(`**/api/projects/${project}/schema-snapshots/${latest}`);
  await page.getByRole('button',{name:'Open SQL Workspace for target',exact:true}).click();await page.getByRole('heading',{name:'SQL Workspace',exact:true}).waitFor();assert.equal(await page.getByLabel('Database target',{exact:true}).inputValue(),id);
  // Target handoff edits a new draft; retain the normal unsaved-change guard.
  await page.getByRole('button',{name:'Discard unsaved edits',exact:true}).click();await idle(page);
  await page.getByRole('button',{name:'Schema baselines',exact:true}).click();await idle(page);await page.getByRole('button',{name:'Open migration history for target',exact:true}).click();await idle(page);assert.equal(await page.getByLabel('Filter history by target',{exact:true}).inputValue(),id);
  await page.getByRole('button',{name:'Schema baselines',exact:true}).click();await idle(page);
  await page.getByText('Collect a schema observation',{exact:true}).click();await page.getByLabel('Authorized connection',{exact:true}).selectOption(connection.id);await page.getByLabel('Observation reason',{exact:true}).fill('Record actual unavailable native schema collection');
  await page.getByRole('button',{name:'Observe schema',exact:true}).click();await page.getByRole('status').filter({hasText:'Schema observation retained as an immutable snapshot.'}).waitFor();await detail(page).waitFor();assert.match(await detail(page).innerText(),/UNAVAILABLE|Unknown/);
  assert.equal((await sql`SELECT count(*)::int n FROM sf_schema_snapshots WHERE project_id=${project}`)[0].n,53);
  const reviewerContext=await page.context().browser().newContext({ignoreHTTPSErrors:true});const reviewerPage=await reviewerContext.newPage();
  try{
    await reviewerPage.goto(origin);await reviewerPage.getByText('Use an operator access token',{exact:true}).click();await reviewerPage.getByLabel('Access token',{exact:true}).fill(reviewerToken);await reviewerPage.getByRole('button',{name:'Continue',exact:true}).click();await reviewerPage.getByRole('heading',{name:'Projects',exact:true}).waitFor();await open(reviewerPage);
    assert.equal(await reviewerPage.getByRole('button',{name:'Observe schema',exact:true}).count(),0);await reviewerPage.getByRole('button',{name:latest,exact:true}).click();await detail(reviewerPage).waitFor();assert.equal(await reviewerPage.getByRole('button',{name:'Capture immutable baseline',exact:true}).count(),0);
  }finally{await reviewerContext.close();}
  const generation=(await sql`SELECT generation_id FROM sf_metadata_current WHERE singleton`)[0].generation_id,hold=randomUUID();await sql`INSERT INTO sf_metadata_generations(id,state,checkpoint,operator_os_uid) VALUES(${hold},'RESTORE_HOLD',${'a'.repeat(64)},1000)`;
  try{await sql`UPDATE sf_metadata_current SET generation_id=${hold} WHERE singleton`;await page.getByRole('button',{name:'Refresh schema',exact:true}).click();await idle(page);assert.equal(await page.getByRole('button',{name:'Observe schema',exact:true}).count(),0);await page.getByRole('button',{name:latest,exact:true}).click();await detail(page).waitFor();assert.equal(await page.getByRole('button',{name:'Capture immutable baseline',exact:true}).count(),0);}finally{await sql`UPDATE sf_metadata_current SET generation_id=${generation} WHERE singleton`;}
  await sql`UPDATE sf_project_grants SET revoked_at=clock_timestamp(),revoke_os_uid=1000 WHERE project_id=${project} AND actor_id=${actor} AND revoked_at IS NULL`;
  await page.getByRole('button',{name:'Refresh schema',exact:true}).click();await page.getByRole('heading',{name:'Project unavailable',exact:true}).waitFor();assert.equal(await detail(page).count(),0);assert.equal(await snap(page).count(),0);
  assert.equal((await sql`SELECT count(*)::int n FROM sf_execution_jobs WHERE project_id=${project}`)[0].n,0);
  await page.getByRole('button',{name:'Back to projects',exact:true}).click();await page.getByRole('heading',{name:'Projects',exact:true}).waitFor();
}
