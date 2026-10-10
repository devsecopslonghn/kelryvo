import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import postgres from 'postgres';
import { authorizeLocalMetadataUrl } from '../../scripts/local-operator-config.mjs';
import { PG_IMAGE } from '../../scripts/local-resources.mjs';

export const BACKUP_FORMAT = 'schemaforge-private-postgres-backup-v1';
export const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024;
const uid = () => process.geteuid?.() ?? process.getuid();
const fail = () => new Error('Local backup or restore failed; inspect private operator state and retry.');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const TABLES = [
  'sf_organizations','sf_local_actors','sf_local_credentials','sf_projects','sf_project_access_mode','sf_project_grants',
  'sf_project_operator_audit','sf_environments','sf_profiles','sf_releases','sf_plans','sf_audit',
  'sf_plan_approval_revocations','sf_plan_comments','sf_history','sf_reference_databases','sf_reference_containers',
  'sf_reference_services','sf_reference_schemas','sf_reference_assignments','sf_reference_operator_audit',
  'sf_project_deploy_grants','sf_execution_jobs','sf_execution_admission_proofs','sf_execution_job_events',
  'sf_execution_attempts','sf_execution_attempt_events','sf_execution_receipts','sf_metadata_generations',
  'sf_metadata_current','sf_metadata_operator_audit','sf_metadata_credentials_revoked','sf_metadata_restore_owners',
].sort();
const SEQUENCES = ['sf_plan_comments_position_seq'];
const RELATIONS = [...TABLES.map(name => `r:${name}`), ...SEQUENCES.map(name => `S:${name}`)].sort();
const FUNCTIONS = ['sf_check_approval_revocation_reference','sf_check_execution_job_projection','sf_reject_approval_revocation_mutation',
  'sf_reject_execution_attempt_mutation','sf_reject_execution_event_mutation','sf_reject_execution_proof_mutation',
  'sf_reject_metadata_evidence_mutation'].sort();
const TRIGGERS = ['sf_execution_admission_proofs_immutable','sf_execution_attempt_events_immutable','sf_execution_attempts_immutable',
  'sf_execution_job_events_immutable','sf_execution_jobs_projection_guard','sf_execution_receipts_immutable',
  'sf_metadata_credentials_revoked_immutable','sf_metadata_generations_immutable','sf_metadata_operator_audit_immutable','sf_metadata_restore_owners_immutable',
  'sf_plan_approval_revocations_immutable','sf_plan_approval_revocations_reference_match'].sort();
const SCHEMA_SIGNATURE = '600dbb4039a8f5d838004b43501c6da01ffb79726b9c28f84f1e37904a4ab4ea';
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const schemaDigest = schema => sha(JSON.stringify({schemas:['public'],tables:schema.tables,relations:schema.relations,
  functions:schema.functions,triggers:schema.triggers,columns:schema.columns,constraints:schema.constraints,indexes:schema.indexes,routines:schema.routines,triggerDefinitions:schema.triggerDefinitions,sequenceDefinitions:schema.sequenceDefinitions,ownership:schema.ownership}));
async function syncPath(file) {
  const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {await handle.sync();} finally {await handle.close();}
}
const ensurePrivateDirectory = async dir => {
  const st = await lstat(dir);
  if (!st.isDirectory() || st.uid !== uid() || (st.mode & 0o777) !== 0o700) throw fail();
};
async function privateFile(file, maxBytes) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.uid !== uid() || st.nlink !== 1 || st.size > maxBytes || (st.mode & 0o777) !== 0o600) throw fail();
    return await handle.readFile();
  } finally { await handle.close(); }
}
async function noSymlinkPath(file) {
  const abs = path.resolve(file); let cursor = path.parse(abs).root;
  for (const part of abs.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    try { if ((await lstat(cursor)).isSymbolicLink()) throw fail(); }
    catch (error) { if (error.code !== 'ENOENT') throw fail(); }
  }
}
function runDocker(args, env = {}) {
  if(process.env.DOCKER_HOST && process.env.DOCKER_HOST !== 'unix:///var/run/docker.sock'
    || process.env.DOCKER_CONTEXT && process.env.DOCKER_CONTEXT !== 'default'
    || process.env.DOCKER_TLS_VERIFY || process.env.DOCKER_CERT_PATH) throw fail();
  const result = spawnSync('/usr/bin/docker', ['--host','unix:///var/run/docker.sock', ...args], {
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('DOCKER_') || k === 'DOCKER_CONFIG')), ...env, PATH:'/usr/bin:/bin' },
    encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: 120_000,
  });
  if (result.error || result.status !== 0) throw fail();
  return result.stdout ?? '';
}
async function assertPinnedLocalPostgres(port) {
  if(!/^\d{1,5}$/.test(String(port)) || Number(port)<1 || Number(port)>65535) throw fail();
  const imageId=runDocker(['image','inspect','--format','{{.Id}}',PG_IMAGE]).trim();
  const ids=runDocker(['container','ls','--quiet']).split('\n').filter(Boolean);
  const matches=[];
  for(const id of ids) {
    const value=runDocker(['container','inspect','--format',
      '{{.Config.Image}}|{{.Image}}|{{.State.Running}}|{{json .NetworkSettings.Ports}}',id]).trim();
    const [image,imageDigest,running,ports]=value.split('|');
    if(image===PG_IMAGE && imageDigest===imageId && running==='true') {
      let bindings; try { bindings=JSON.parse(ports); } catch { throw fail(); }
      const host=(bindings['5432/tcp']??[]).filter(item=>item.HostIp==='127.0.0.1' && item.HostPort===String(port));
      if(host.length) matches.push(id);
    }
  }
  if(matches.length!==1) throw fail();
}
function toolArgs(command, mount, archive, url, config, snapshot = null) {
  const parsed = new URL(url);
  const db = decodeURIComponent(parsed.pathname.slice(1));
  const dsn = `postgresql://${encodeURIComponent(decodeURIComponent(parsed.username))}@127.0.0.1:${parsed.port || '5432'}/${db}`;
  const common = ['run','--rm','--network','host','--user',`${uid()}:${process.getgid?.() ?? process.getuid?.() ?? uid()}`,'--read-only','--cap-drop=ALL','--security-opt','no-new-privileges',
    '--mount',`type=bind,src=${mount},dst=/backup${command==='pg_restore'?',readonly':''}`, '--env','PGHOST=127.0.0.1','--env',`PGPORT=${parsed.port || '5432'}`,
    '--env',`PGUSER=${decodeURIComponent(parsed.username)}`,'--env','PGPASSWORD',
    '--entrypoint', command, PG_IMAGE];
  return [...common, ...(command === 'pg_dump' ? ['--format=custom','--data-only','--no-owner','--no-privileges', ...(snapshot ? [`--snapshot=${snapshot}`] : []),
    '--exclude-table=public.sf_organizations','--exclude-table=public.sf_metadata_restore_owners','--exclude-table=public.sf_metadata_current','--file',archive,dsn] : ['--list',archive])];
}
function toolEnv(config) { return { PGPASSWORD:config.databasePassword }; }
async function inventory(sql) {
  const schemaRows=await sql`SELECT nspname FROM pg_namespace WHERE nspname NOT IN ('pg_catalog','information_schema') AND nspname !~ '^pg_toast' ORDER BY nspname`;
  if(JSON.stringify(schemaRows.map(r=>r.nspname))!==JSON.stringify(['public'])) throw fail();
  const rows = await sql`SELECT c.relkind, n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','S','v','m','f') ORDER BY c.relkind,c.relname`;
  const tables = rows.filter(r => ['r','p'].includes(r.relkind)).map(r => r.relname).sort();
  if (JSON.stringify(tables) !== JSON.stringify(TABLES)) throw fail();
  const functions = await sql`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' ORDER BY p.proname`;
  const triggers = await sql`SELECT t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    JOIN pg_proc p ON p.oid=t.tgfoid WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY t.tgname`;
  const columns=await sql`SELECT table_name,column_name,ordinal_position::int AS ordinal_position,data_type,udt_name,is_nullable,column_default
    FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position`;
  const constraints=await sql`SELECT c.conname,c.contype,c.conrelid::regclass::text AS table_name,pg_get_constraintdef(c.oid,true) AS definition
    FROM pg_constraint c JOIN pg_class r ON r.oid=c.conrelid JOIN pg_namespace n ON n.oid=r.relnamespace
    WHERE n.nspname='public' ORDER BY c.conrelid::regclass::text,c.conname`;
  const indexes=await sql`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`;
  const routineRows=await sql`SELECT p.proname,p.prokind,p.prosecdef,p.provolatile,p.proacl::text AS acl,(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned,
    pg_get_function_identity_arguments(p.oid) AS arguments,l.lanname AS language,
    pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' ORDER BY p.proname,arguments`;
  const routines=routineRows.map(({definition,...facts})=>({...facts,definitionSha256:sha(definition)}));
  const triggerRows=await sql`SELECT t.tgname,c.relname AS table_name,t.tgenabled,p.proname AS routine_name,
    pn.nspname AS routine_schema,pg_get_function_identity_arguments(p.oid) AS routine_arguments,
    pg_get_triggerdef(t.oid,true) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
    JOIN pg_namespace pn ON pn.oid=p.pronamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY t.tgname`;
  const triggerDefinitions=triggerRows.map(({definition,...facts})=>({...facts,definitionSha256:sha(definition)}));
  const sequenceDefinitions=await sql`SELECT s.relname AS sequence_name,q.seqtypid::regtype::text AS type,
    q.seqstart::text AS start,q.seqincrement::text AS increment,q.seqmax::text AS maximum,
    q.seqmin::text AS minimum,q.seqcache::text AS cache,q.seqcycle AS cycle,
    d.deptype AS dependency_type,r.relname AS table_name,a.attname AS column_name
    FROM pg_class s JOIN pg_namespace n ON n.oid=s.relnamespace JOIN pg_sequence q ON q.seqrelid=s.oid
    LEFT JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=s.oid
      AND d.refclassid='pg_class'::regclass AND d.deptype IN ('a','i')
    LEFT JOIN pg_class r ON r.oid=d.refobjid LEFT JOIN pg_attribute a ON a.attrelid=r.oid AND a.attnum=d.refobjsubid
    WHERE n.nspname='public' ORDER BY s.relname`;
  const ownership=await sql`SELECT c.relname,c.relkind,(c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owned,
    c.relacl::text AS acl FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','S') ORDER BY c.relname`;
  if(ownership.some(row=>!row.owned || row.acl!==null) || routines.some(row=>!row.owned || row.acl!==null)) throw fail();
  const relationList=rows.map(r => `${r.relkind}:${r.relname}`);
  const functionList=functions.map(r => r.proname), triggerList=triggers.map(r => r.tgname);
  if(JSON.stringify(relationList)!==JSON.stringify(RELATIONS)
    || JSON.stringify(functionList)!==JSON.stringify(FUNCTIONS) || JSON.stringify(triggerList)!==JSON.stringify(TRIGGERS)) throw fail();
  const signature=sha(JSON.stringify({schemas:['public'],tables,relations:relationList,functions:functionList,triggers:triggerList,columns,constraints,indexes,routines,triggerDefinitions,sequenceDefinitions,ownership}));
  if(signature!==SCHEMA_SIGNATURE) throw fail();
  return { tables, relations: relationList, functions: functionList, triggers: triggerList, columns, constraints, indexes, routines, triggerDefinitions, sequenceDefinitions, ownership, signature };
}
function validateArchiveList(list, owner) {
  const lines = list.split('\n').filter(line => line && !line.startsWith(';'));
  const role=owner.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const allowed=new Set(TABLES.filter(name=>!['sf_organizations','sf_metadata_restore_owners','sf_metadata_current'].includes(name)));
  const seen=new Set(), sequences=new Set();
  if (!lines.length || lines.some(line => {
    const match=line.match(new RegExp(`^\\d+; \\d+ \\d+ (TABLE DATA|SEQUENCE SET) public (sf_[a-z0-9_]+) ${role}$`));
    if(!match) return true;
    const expected = match[1] === 'TABLE DATA' ? allowed : new Set(SEQUENCES);
    const observed = match[1] === 'TABLE DATA' ? seen : sequences;
    if(!expected.has(match[2]) || observed.has(match[2])) return true;
    observed.add(match[2]); return false;
  })) throw fail();
  if(JSON.stringify([...seen].sort())!==JSON.stringify([...allowed].sort())
    || JSON.stringify([...sequences].sort())!==JSON.stringify(SEQUENCES)) throw fail();
}
function exactManifest(m) {
  return m && Object.keys(m).sort().join(',') === 'archive,checkpoint,createdAt,format,metadataGeneration,schema,sourceDatabase,witnessId'
    && m.format === BACKUP_FORMAT && Object.keys(m.archive??{}).sort().join(',')==='bytes,file,sha256'
    && typeof m.archive?.sha256 === 'string' && /^[a-f0-9]{64}$/.test(m.archive.sha256)
    && Number.isSafeInteger(m.archive?.bytes) && m.archive.bytes > 0 && m.archive.bytes <= MAX_ARCHIVE_BYTES
    && typeof m.checkpoint === 'string' && /^[a-f0-9]{64}$/.test(m.checkpoint)
    && typeof m.metadataGeneration === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.metadataGeneration)
    && typeof m.witnessId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(m.witnessId)
    && m.schema && Object.keys(m.schema).sort().join(',')==='columns,constraints,functions,indexes,ownership,relations,routines,sequenceDefinitions,signature,tables,triggerDefinitions,triggers'
    && JSON.stringify(m.schema.tables)===JSON.stringify(TABLES)
    && JSON.stringify(m.schema.relations)===JSON.stringify(RELATIONS)
    && JSON.stringify(m.schema.functions)===JSON.stringify(FUNCTIONS) && JSON.stringify(m.schema.triggers)===JSON.stringify(TRIGGERS)
    && Array.isArray(m.schema.columns) && Array.isArray(m.schema.constraints) && Array.isArray(m.schema.indexes)
    && Array.isArray(m.schema.routines) && Array.isArray(m.schema.triggerDefinitions)
    && Array.isArray(m.schema.sequenceDefinitions) && Array.isArray(m.schema.ownership)
    && m.schema.signature===SCHEMA_SIGNATURE && schemaDigest(m.schema)===SCHEMA_SIGNATURE
    && typeof m.createdAt==='string' && Number.isFinite(Date.parse(m.createdAt)) && new Date(m.createdAt).toISOString()===m.createdAt
    && typeof m.sourceDatabase === 'string' && /^[a-z0-9_]{1,63}$/.test(m.sourceDatabase);
}
async function ensureToolchain() {
  let digests;
  try { digests=JSON.parse(runDocker(['image','inspect','--format','{{json .RepoDigests}}', PG_IMAGE])); } catch { throw fail(); }
  const pinned=`postgres@${PG_IMAGE.split('@')[1]}`;
  if (!Array.isArray(digests) || !digests.includes(pinned)) throw fail();
  const version = runDocker(['run','--rm','--network','none','--read-only','--cap-drop=ALL','--entrypoint','pg_dump',PG_IMAGE,'--version']);
  if (!/^pg_dump \(PostgreSQL\) 17\.10(?: \([^\n]+\))?\n?$/.test(version)) throw fail();
}

/** Create a new private backup directory and independent operator witness. */
export async function createPrivateBackup({ configPath, databaseUrl, destination, witnessPath }) {
  const config = await authorizeLocalMetadataUrl(configPath, databaseUrl);
  if (!destination || !witnessPath) throw fail();
  const dir = path.resolve(destination), witness = path.resolve(witnessPath);
  if(/[,:\n]/.test(dir) || /[,:\n]/.test(witness)) throw fail();
  if (witness.startsWith(`${dir}${path.sep}`) || witness === dir) throw fail();
  await noSymlinkPath(dir); await noSymlinkPath(witness);
  await ensurePrivateDirectory(path.dirname(dir));
  await ensurePrivateDirectory(path.dirname(witness));
  const sql = postgres(databaseUrl, { max:1, onnotice:()=>{} });
  let made = false;
  try {
    await assertPinnedLocalPostgres(new URL(databaseUrl).port);
    if(Number((await sql`SELECT current_setting('server_version_num')::int AS version`)[0]?.version)!==170010) throw fail();
    await ensureToolchain();
    await mkdir(dir, { mode:0o700 }); made = true;
    await chmod(dir,0o700);
    await ensurePrivateDirectory(dir);
    const archiveName = 'metadata.pgdump';
    const archivePath = path.join(dir,archiveName);
    let state, schema, archiveBytes;
    await sql.begin(async tx=>{
      await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
      const snapshot=(await tx`SELECT pg_export_snapshot() AS snapshot`)[0]?.snapshot;
      state=(await tx`SELECT g.id,g.checkpoint FROM sf_metadata_current c JOIN sf_metadata_generations g ON g.id=c.generation_id WHERE c.singleton`)[0];
      if(!state || !snapshot) throw fail();
      const organizations=await tx`SELECT id::text AS id,name FROM sf_organizations ORDER BY id`;
      if(organizations.length!==1 || organizations[0].id!=='00000000-0000-4000-8000-000000000001'
        || organizations[0].name!=='Local organization') throw fail();
      schema=await inventory(tx);
      runDocker(toolArgs('pg_dump',dir,`/backup/${archiveName}`,databaseUrl,config,snapshot),toolEnv(config));
      const archiveStat=await lstat(archivePath);
      if(!archiveStat.isFile() || archiveStat.uid!==uid() || archiveStat.nlink!==1 || archiveStat.size<1 || archiveStat.size>MAX_ARCHIVE_BYTES) throw fail();
      await chmod(archivePath,0o600);
      archiveBytes=await privateFile(archivePath,MAX_ARCHIVE_BYTES);
    });
    const witnessId = randomUUID();
    const manifest = { format:BACKUP_FORMAT, createdAt:new Date().toISOString(), sourceDatabase:decodeURIComponent(new URL(databaseUrl).pathname.slice(1)),
      metadataGeneration:state.id, checkpoint:state.checkpoint, schema, witnessId,
      archive:{ file:archiveName, bytes:archiveBytes.length, sha256:sha(archiveBytes) } };
    const manifestPath = path.join(dir,'manifest.json');
    await writeFile(manifestPath,json(manifest),{mode:0o600,flag:'wx'});
    if(JSON.stringify((await readdir(dir)).sort())!==JSON.stringify(['manifest.json','metadata.pgdump'])) throw fail();
    const manifestBytes = await privateFile(manifestPath,256*1024);
    const witnessValue = { format:BACKUP_FORMAT, witnessId, manifestSha256:sha(manifestBytes), archiveSha256:manifest.archive.sha256,
      metadataGeneration:state.id, checkpoint:state.checkpoint };
    await syncPath(archivePath);await syncPath(manifestPath);await syncPath(dir);
    await writeFile(witness,json(witnessValue),{mode:0o600,flag:'wx'});
    await syncPath(witness);await syncPath(path.dirname(witness));
    return { witnessId, archiveSha256:manifest.archive.sha256 };
  } catch (error) {
    if (made) await rm(dir,{recursive:true,force:true}).catch(()=>{});
    throw fail();
  } finally { await sql.end({timeout:2}); }
}

/** Restore only after validating all private inputs; the destination name is invocation-generated. */
export async function restorePrivateBackup({ configPath, databaseUrl, backupDirectory, witnessPath, destinationDatabase, interruptAt }) {
  if(interruptAt !== undefined && interruptAt !== 'after-import') throw fail();
  const config = await authorizeLocalMetadataUrl(configPath,databaseUrl);
  const dir=path.resolve(backupDirectory), witness=path.resolve(witnessPath);
  if(/[,:\n]/.test(dir) || /[,:\n]/.test(witness)) throw fail();
  await noSymlinkPath(dir); await noSymlinkPath(witness); await ensurePrivateDirectory(dir); await ensurePrivateDirectory(path.dirname(witness));
  if (witness.startsWith(`${dir}${path.sep}`)) throw fail();
  if(JSON.stringify((await readdir(dir)).sort())!==JSON.stringify(['manifest.json','metadata.pgdump'])) throw fail();
  const manifestBytes=await privateFile(path.join(dir,'manifest.json'),256*1024);
  const archiveBytes=await privateFile(path.join(dir,'metadata.pgdump'),MAX_ARCHIVE_BYTES);
  const witnessBytes=await privateFile(witness,16*1024);
  let manifest, external;
  try { manifest=JSON.parse(manifestBytes); external=JSON.parse(witnessBytes); } catch { throw fail(); }
  if (!exactManifest(manifest) || manifest.archive.file!=='metadata.pgdump' || manifest.archive.bytes!==archiveBytes.length
      || sha(archiveBytes)!==manifest.archive.sha256
      || Object.keys(external).sort().join(',')!=='archiveSha256,checkpoint,format,manifestSha256,metadataGeneration,witnessId'
      || external.format!==BACKUP_FORMAT || external.witnessId!==manifest.witnessId
      || external.manifestSha256!==sha(manifestBytes) || external.archiveSha256!==manifest.archive.sha256
      || external.metadataGeneration!==manifest.metadataGeneration || external.checkpoint!==manifest.checkpoint) throw fail();
  const stagingDirectory=path.join(path.dirname(dir),`.sf-restore-stage-${randomUUID()}`);
  await mkdir(stagingDirectory,{mode:0o700}); await chmod(stagingDirectory,0o700); await ensurePrivateDirectory(stagingDirectory);
  const stagedArchive=path.join(stagingDirectory,'metadata.pgdump');
  try {
  await writeFile(stagedArchive,archiveBytes,{mode:0o600,flag:'wx'});
  await chmod(stagedArchive,0o600);
  await assertPinnedLocalPostgres(new URL(databaseUrl).port);
  const server=postgres(databaseUrl,{max:1,onnotice:()=>{}});
  try { if(Number((await server`SELECT current_setting('server_version_num')::int AS version`)[0]?.version)!==170010) throw fail(); }
  finally { await server.end({timeout:2}); }
  await ensureToolchain();
  const listing=runDocker(toolArgs('pg_restore',stagingDirectory,'/backup/metadata.pgdump',databaseUrl,config),toolEnv(config));
  validateArchiveList(listing,decodeURIComponent(new URL(databaseUrl).username));
  const dbName=destinationDatabase ?? `sf_product_restore_${randomUUID().replaceAll('-','')}`;
  if (!/^sf_product_restore_[a-f0-9]{32}$/.test(dbName) || dbName===manifest.sourceDatabase) throw fail();
  const base=new URL(databaseUrl); const targetUrl=new URL(databaseUrl); targetUrl.pathname=`/${dbName}`;
  const admin=postgres(databaseUrl,{max:1,onnotice:()=>{}}); let adminClosed=false, created=false, createdOid, sql;
  const ownerId=randomUUID();
  try {
    const existing=await admin`SELECT 1 FROM pg_database WHERE datname=${dbName}`;
    if (existing.length) throw fail();
    await admin.unsafe(`CREATE DATABASE "${dbName}"`); created=true;
    createdOid=(await admin`SELECT oid::text AS oid FROM pg_database WHERE datname=${dbName} AND datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user)`)[0]?.oid;
    if(!createdOid) throw fail();
    await admin.end({timeout:2}); adminClosed=true;
    sql=postgres(targetUrl.toString(),{max:2,onnotice:()=>{}});
    const { initializeDatabase }=await import('../database/index.ts');
    await sql.unsafe('CREATE TABLE sf_metadata_restore_owners (id uuid PRIMARY KEY, operator_os_uid integer NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp())');
    await sql`INSERT INTO sf_metadata_restore_owners(id,operator_os_uid) VALUES(${ownerId},${uid()})`;
    await initializeDatabase(sql,{initializeMetadata:false});
    const schema=await inventory(sql);
    if (JSON.stringify(schema)!==JSON.stringify(manifest.schema)) throw fail();
    // These two immutable bootstrap rows are seeded by initialization. Their fixed values are
    // recreated before restore; all mutable catalog and lifecycle facts come from the snapshot.
    await sql`DELETE FROM sf_project_access_mode WHERE organization_id='00000000-0000-4000-8000-000000000001'`;
    runDocker(toolArgs('pg_restore',stagingDirectory,'/backup/metadata.pgdump',databaseUrl,config).slice(0,-2).concat(['--exit-on-error','--single-transaction','--dbname',`postgresql://${encodeURIComponent(decodeURIComponent(base.username))}@127.0.0.1:${base.port||'5432'}/${dbName}`,'/backup/metadata.pgdump']),toolEnv(config));
    // Trusted OS-only fault injection, matching the credential lifecycle test boundary.
    if(interruptAt === 'after-import') process.kill(process.pid,'SIGKILL');
    await sql.begin(async tx=>{
      const previous=(await tx`SELECT id FROM sf_metadata_generations WHERE id=${manifest.metadataGeneration} FOR SHARE`)[0];
      const current=(await tx`SELECT generation_id FROM sf_metadata_current WHERE singleton FOR UPDATE`)[0];
      if (!previous || current) throw fail();
      const generation=randomUUID(), checkpoint=sha(`${manifest.checkpoint}:${manifest.archive.sha256}:${generation}`);
      await tx`INSERT INTO sf_metadata_generations(id,predecessor_id,state,checkpoint,witness_id,operator_os_uid)
        VALUES(${generation},${manifest.metadataGeneration},'RESTORE_HOLD',${checkpoint},${manifest.witnessId},${uid()})`;
      await tx`INSERT INTO sf_metadata_current(singleton,generation_id) VALUES(true,${generation})`;
      await tx`INSERT INTO sf_metadata_operator_audit(id,action,generation_id,witness_id,operator_os_uid)
        VALUES(${randomUUID()},'RESTORE_HOLD',${generation},${manifest.witnessId},${uid()})`;
      const jobs=await tx`SELECT id,state,revision FROM sf_execution_jobs WHERE state IN ('WAITING_VALIDATION','ADMITTED') FOR UPDATE`;
      for (const job of jobs) {
        const updated=(await tx`UPDATE sf_execution_jobs SET state='HOLD',revision=revision+1,updated_at=clock_timestamp()
          WHERE id=${job.id} AND revision=${job.revision} RETURNING revision`)[0];
        await tx`INSERT INTO sf_execution_job_events(id,job_id,revision,from_state,to_state,actor_id,reason,facts)
          VALUES(${randomUUID()},${job.id},${updated.revision},${job.state},'HOLD','local-restore-operator','METADATA_RESTORED','{"reasonCode":"METADATA_RESTORED"}'::jsonb)`;
      }
      const attempts=await tx`SELECT a.id,a.job_id,a.state FROM sf_execution_attempts a JOIN sf_execution_jobs j ON j.id=a.job_id WHERE a.state='CLAIMED' FOR UPDATE OF a`;
      for (const attempt of attempts) {
        const last=(await tx`SELECT revision FROM sf_execution_attempt_events WHERE attempt_id=${attempt.id} ORDER BY revision DESC LIMIT 1`)[0];
        await tx`UPDATE sf_execution_attempts SET state='HOLD' WHERE id=${attempt.id} AND state='CLAIMED'`;
        await tx`INSERT INTO sf_execution_attempt_events(id,attempt_id,revision,phase,facts)
          VALUES(${randomUUID()},${attempt.id},${Number(last.revision)+1},'HOLD','{"reasonCode":"METADATA_RESTORED"}'::jsonb)`;
      }
      const credentials=await tx`UPDATE sf_local_credentials SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL RETURNING id,token_sha256`;
      for (const credential of credentials) {
        await tx`INSERT INTO sf_metadata_credentials_revoked(credential_id,token_sha256,generation_id) VALUES(${credential.id},${credential.token_sha256},${generation})`;
        await tx`INSERT INTO sf_metadata_operator_audit(id,action,generation_id,credential_id,credential_digest,operator_os_uid)
          VALUES(${randomUUID()},'CREDENTIAL_REVOKE',${generation},${credential.id},${credential.token_sha256},${uid()})`;
      }
    });
    return { databaseUrl:targetUrl.toString(), databaseName:dbName };
  } catch (error) {
    if (sql) await sql.end({timeout:2}).catch(()=>{});
    if(!adminClosed) await admin.end({timeout:2}).catch(()=>{});
    if (created) {
      const cleanup=postgres(databaseUrl,{max:1,onnotice:()=>{}});
      try {
        const target=postgres(targetUrl.toString(),{max:1,onnotice:()=>{}});
        let owned=false;
        try { owned=(await target`SELECT 1 FROM sf_metadata_restore_owners WHERE id=${ownerId}`).length===1; }
        catch { /* no ownership proof, so leave the inaccessible database in place */ }
        finally { await target.end({timeout:2}).catch(()=>{}); }
        const identity=(await cleanup`SELECT oid::text AS oid FROM pg_database WHERE datname=${dbName} AND datdba=(SELECT oid FROM pg_roles WHERE rolname=current_user)`)[0];
        if(owned && identity?.oid===createdOid) await cleanup.unsafe(`DROP DATABASE "${dbName}" WITH (FORCE)`);
      } catch { /* inaccessible or replaced destination is left untouched */ }
      finally { await cleanup.end({timeout:2}); }
    }
    throw error instanceof Error && error.message.startsWith('Local backup') ? error : fail();
  } finally { if(sql) await sql.end({timeout:2}).catch(()=>{}); }
  } finally { await rm(stagingDirectory,{recursive:true,force:true}).catch(()=>{}); }
}
