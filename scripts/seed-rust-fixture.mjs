// Insert fixed synthetic metadata into the caller's disposable PostgreSQL only.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
const mode=process.argv[2];
assert(['target','option','completion'].includes(mode));
const url=process.env.KELRYVO_RUST_TEST_DATABASE_URL;
assert(url?.startsWith('postgresql:///kelryvo_rust_test?host='));
const sql=postgres({host:new URL(url).searchParams.get('host'),database:'kelryvo_rust_test',username:process.env.USER,max:1,onnotice:()=>{}});
try {
  const name=mode==='completion'?'seed-completion':mode==='option'?'seed-target-option':'seed-target-bound';
  const fixture=JSON.parse(await readFile(new URL(`../tests/fixtures/contracts/${name}.json`,import.meta.url),'utf8'));
  let rows=fixture.rows;
  if(mode!=='completion'){
    const project=process.env.KELRYVO_RUST_TEST_PROJECT_ID;
    assert(/^[a-f0-9-]{36}$/.test(project??''));
    const [environment]=await sql`SELECT id,name FROM sf_environments WHERE project_id=${project} ORDER BY created_at LIMIT 1`;
    assert(environment);
    const profile=rows.sf_profiles[0],originalProject=profile.project_id,originalEnvironment=profile.environment_id;
    const replacements=new Map([[originalProject,project],[originalEnvironment,environment.id],['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001']]);
    let wire=JSON.stringify(rows).replaceAll(originalProject.replaceAll('-',''),project.replaceAll('-',''));
    wire=wire.replace(/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/gi,id=>{if(!replacements.has(id))replacements.set(id,randomUUID());return replacements.get(id);});
    rows=JSON.parse(wire);
    for(const records of Object.values(rows))for(const row of records)if('environment_name' in row)row.environment_name=environment.name;
  }
  await sql.begin(async tx=>{
    await tx`SET CONSTRAINTS ALL DEFERRED`;
    const pending=new Set(Object.keys(rows));
    while(pending.size){
      const table=[...pending].find(t=>fixture.dependencies.every(d=>d.child!==t||!pending.has(d.parent)||d.parent===t||(d.child==='sf_target_options'&&d.parent==='sf_target_option_revisions')||(d.child==='sf_target_bindings'&&d.parent==='sf_target_binding_revisions')));
      assert(table&&/^sf_[a-z_]+$/.test(table),'Fixture dependency cycle');
      for(const row of rows[table]){
        if(table==='sf_local_credentials'){row.issued_at=new Date().toISOString();row.expires_at=new Date(Date.now()+86400000).toISOString();}
        const fields=Object.keys(row);assert(fields.every(k=>/^[a-z_][a-z0-9_]*$/.test(k)));
        await tx.unsafe(`INSERT INTO ${table}(${fields.join(',')}) SELECT ${fields.join(',')} FROM json_populate_record(NULL::${table},$1::json)`,[row]);
      }
      pending.delete(table);
    }
  });
  if(mode==='completion')process.stdout.write(JSON.stringify(fixture.output)+'\n');
  else if(mode==='target')process.stdout.write(JSON.stringify({binding:{bindingId:rows.sf_target_bindings[0].id,bindingRevision:String(rows.sf_target_bindings[0].current_revision),assignmentRevision:String(rows.sf_target_binding_revisions[0].assignment_revision)}})+'\n');
  else {const option=rows.sf_target_options[0],profile=rows.sf_profiles[0];process.stdout.write(JSON.stringify({assignmentId:option.assignment_id,expectedAssignmentRevision:'1',environmentId:profile.environment_id,targetOptionId:option.id,expectedTargetOptionRevision:'1',expectedBindingRevision:'0',reason:'Bind native compatibility fixture'})+'\n');}
} finally {await sql.end({timeout:2});}
