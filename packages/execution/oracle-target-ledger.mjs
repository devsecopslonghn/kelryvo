import { createHash } from 'node:crypto';
import oracledb from 'oracledb';
import { MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { MAX_PLAN_STATEMENTS } from '../migrations/offline-plan-intent.mjs';
import { compareVersions } from '../migrations/import-release.mjs';

const MAX_EVENTS = 3 * MAX_PLAN_STATEMENTS + 2 * MAX_RELEASE_FILES;
const DIGEST = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const KEY = /^[A-Za-z0-9._:/-]{1,512}$/;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const columns = ['event_type','file_ordinal','statement_ordinal','path','migration_version','source_digest',
  'manifest_digest','approval_reference','intent_digest','planned_count','planned_digest','statement_digest','receipt_digest'];
const identityColumns = ['path','migration_version','source_digest','manifest_digest','approval_reference','intent_digest','planned_count','planned_digest'];
const SQL = Object.freeze({
  head: 'SELECT sequence_no, checksum FROM sf_target_ledger_head WHERE target_id = :targetId',
  lock: 'SELECT sequence_no, checksum FROM sf_target_ledger_head WHERE target_id = :targetId FOR UPDATE',
  read: `SELECT sequence_no, ${columns.join(', ')}, previous_checksum, checksum
    FROM sf_target_ledger_events WHERE target_id = :targetId ORDER BY sequence_no FETCH FIRST ${MAX_EVENTS + 1} ROWS ONLY`,
  insertHead: 'INSERT INTO sf_target_ledger_head (target_id, sequence_no, checksum) VALUES (:targetId, 0, :checksum)',
  insertEvent: `INSERT INTO sf_target_ledger_events (target_id, sequence_no, ${columns.join(', ')}, previous_checksum, checksum)
    VALUES (:targetId, :sequence_no, ${columns.map(c => ':' + c).join(', ')}, :previous_checksum, :checksum)`,
  updateHead: `UPDATE sf_target_ledger_head SET sequence_no = :sequenceNo, checksum = :checksum
    WHERE target_id = :targetId AND sequence_no = :priorSequence AND checksum = :priorChecksum`,
});
const normalize = row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key.toLowerCase(),value]));
const event = (type, ordinal, fields={}) => ({ ...Object.fromEntries(columns.map(c => [c,null])),
  event_type:type,file_ordinal:ordinal,...fields });
const checksum = (targetId, row) => hash([targetId,row.sequence_no,row.previous_checksum,columns.map(c => row[c])]);
const receipt = (targetId,file,ordinal,statementDigest) => hash([targetId,file.approvalReference,file.intentDigest,file.ordinal,ordinal,statementDigest]);

function snapshotMigration(file) {
  if (!file || typeof file.path !== 'string' || !KEY.test(file.path)
      || file.path.split('/').some(p => !p || p==='.' || p==='..') || file.path.startsWith('/')
      || typeof file.version !== 'string' || file.version.length > 128 || !/^(0|[1-9]\d*)(\.(0|[1-9]\d*))*$/.test(file.version)
      || ![file.sha256,file.statementManifestDigest,file.intentDigest].every(d => typeof d==='string' && DIGEST.test(d))
      || typeof file.approvalReference!=='string' || !UUID.test(file.approvalReference)
      || !Array.isArray(file.statementDigests) || !file.statementDigests.length || file.statementDigests.length > MAX_PLAN_STATEMENTS
      || file.statementDigests.some(d => typeof d !== 'string' || !DIGEST.test(d))) return null;
  return Object.freeze({ path:file.path,version:file.version,sha256:file.sha256,statementManifestDigest:file.statementManifestDigest,
    approvalReference:file.approvalReference,intentDigest:file.intentDigest,statementDigests:Object.freeze(file.statementDigests.slice()) });
}

function replay(rows,targetId) {
  if (!Array.isArray(rows) || rows.length > MAX_EVENTS) return null;
  const files=[]; let prior='0'.repeat(64),expectedTotal=0;
  for (let index=0;index<rows.length;index++) {
    const row=normalize(rows[index]);
    if (row.sequence_no!==index+1 || row.previous_checksum!==prior || !DIGEST.test(row.checksum ?? '')
        || columns.some(c => row[c]===undefined) || checksum(targetId,row)!==row.checksum
        || !Number.isInteger(row.file_ordinal) || row.file_ordinal<1 || row.file_ordinal>MAX_RELEASE_FILES) return null;
    const ordinal=row.file_ordinal;
    if (row.event_type==='FILE_STARTED') {
      const file=snapshotMigration({ path:row.path,version:row.migration_version,sha256:row.source_digest,
        statementManifestDigest:row.manifest_digest,approvalReference:row.approval_reference,intentDigest:row.intent_digest,
        statementDigests:['0'.repeat(64)] });
      if (!file || ordinal!==files.length+1 || files.at(-1) && files.at(-1).state!=='APPLIED'
          || !Number.isInteger(row.planned_count) || row.planned_count<1 || row.planned_count>MAX_PLAN_STATEMENTS
          || !DIGEST.test(row.planned_digest ?? '') || row.statement_ordinal!==null || row.statement_digest!==null || row.receipt_digest!==null
          || files.some(f => f.path===file.path) || files.at(-1) && compareVersions(file.version,files.at(-1).version)<=0
          || (expectedTotal+=row.planned_count)>MAX_PLAN_STATEMENTS) return null;
      files.push({ ...file,ordinal,expectedCount:row.planned_count,expectedDigest:row.planned_digest,statementDigests:[],states:[],receipts:[] });
    } else {
      const file=files[ordinal-1];
      if (!file || ordinal!==files.length || file.state==='APPLIED' || identityColumns.some(c => row[c]!==null)) return null;
      if (row.event_type==='FILE_APPLIED') {
        if (row.statement_ordinal!==null || row.statement_digest!==null || file.states.length!==file.expectedCount
            || file.states.some(s => s!=='ACKNOWLEDGED') || row.receipt_digest!==hash(file.receipts)) return null;
        file.state='APPLIED';
      } else {
        const s=row.statement_ordinal;
        if (!Number.isInteger(s) || s<1 || s>file.expectedCount || !DIGEST.test(row.statement_digest ?? '')) return null;
        if (row.event_type==='STATEMENT_PLANNED') {
          if (file.states.length || s!==file.statementDigests.length+1 || row.receipt_digest!==null) return null;
          file.statementDigests.push(row.statement_digest);
          if (s===file.expectedCount) {
            if (hash(file.statementDigests)!==file.expectedDigest) return null;
            file.planComplete=true;
          }
        } else {
          if (!file.planComplete
              || file.statementDigests[s-1]!==row.statement_digest) return null;
          if (row.event_type==='STATEMENT_STARTED') {
            if (s!==file.states.length+1 || file.states.length && file.states.at(-1)!=='ACKNOWLEDGED' || row.receipt_digest!==null) return null;
            file.states.push('STARTED'); file.receipts.push(null);
          } else if (row.event_type==='STATEMENT_ACKNOWLEDGED') {
            if (s!==file.states.length || file.states[s-1]!=='STARTED'
                || row.receipt_digest!==receipt(targetId,file,s,row.statement_digest)) return null;
            file.states[s-1]='ACKNOWLEDGED'; file.receipts[s-1]=row.receipt_digest;
          } else return null;
        }
      }
    }
    prior=row.checksum;
  }
  return { files,sequence:rows.length,checksum:prior,expectedTotal };
}

/** Private installed capability, with a dedicated protected ledger-owner connection.
 * No connection/credential lookup, migration execution, reconnect or retry occurs here.
 * Head-row locks serialize appends only; caller must independently validate canonical
 * identity, ledger owner/grants, continuous target mutex, dispatch permit and central facts.
 * UNINITIALIZED is an absent partition, never proof that the application schema is empty.
 * Before its first startFile, host must verify empty-target adoption or a reviewed baseline.
 * IN_FLIGHT/UNTRUSTED/null must HOLD; the applied prefix cannot hide unresolved files.
 */
export function createOracleTargetLedger(connection) {
  if (!connection || !['execute','commit','rollback'].every(k => typeof connection[k]==='function'))
    throw new TypeError('Private Oracle ledger connection required');
  let busy=false,poisoned=false;
  const execute=(sql,binds) => connection.execute(sql,binds,{ autoCommit:false,outFormat:oracledb.OUT_FORMAT_OBJECT,maxRows:MAX_EVENTS+1 });
  const guard=async (fallback,operation) => {
    if (busy || poisoned) return fallback;
    busy=true;
    try { return await operation(); }
    catch { poisoned=true; try { await connection.rollback(); } catch {} return fallback; }
    finally { busy=false; }
  };
  const inspect=async (targetId,lock=false) => {
    const heads=(await execute(lock ? SQL.lock : SQL.head,{ targetId })).rows;
    const rows=(await execute(SQL.read,{ targetId })).rows;
    if (!Array.isArray(heads) || heads.length>1 || !Array.isArray(rows)) return null;
    const head=heads.length ? normalize(heads[0]) : null,parsed=replay(rows,targetId);
    if (!parsed || !head && rows.length || head && (head.sequence_no!==parsed.sequence || head.checksum!==parsed.checksum)) return null;
    return { head,parsed,rows };
  };
  const append=async (targetId,prepare) => guard('UNKNOWN',async () => {
    if (typeof targetId!=='string' || !DIGEST.test(targetId)) return 'UNKNOWN';
    const current=await inspect(targetId,true);
    if (!current) { await connection.rollback(); return 'UNKNOWN'; }
    const fields=prepare(current.parsed);
    if (!fields?.length || current.parsed.sequence+fields.length>MAX_EVENTS) { await connection.rollback(); return 'UNKNOWN'; }
    let prior=current.parsed.checksum;
    const rows=fields.map((f,index) => {
      const row={ ...f,sequence_no:current.parsed.sequence+index+1,previous_checksum:prior };
      row.checksum=checksum(targetId,row); prior=row.checksum; return row;
    });
    if (!replay([...current.rows,...rows],targetId)) { await connection.rollback(); return 'UNKNOWN'; }
    if (!current.head) await execute(SQL.insertHead,{ targetId,checksum:current.parsed.checksum });
    for (const row of rows) {
      if ((await execute(SQL.insertEvent,{ targetId,...row })).rowsAffected!==1) throw new Error('Ledger append uncertain');
    }
    if ((await execute(SQL.updateHead,{ targetId,sequenceNo:current.parsed.sequence+rows.length,checksum:prior,
      priorSequence:current.parsed.sequence,priorChecksum:current.parsed.checksum })).rowsAffected!==1) throw new Error('Ledger head uncertain');
    await connection.commit(); // A lost acknowledgement poisons this capability, including reads.
    return 'ACKNOWLEDGED';
  });
  const fileAt=(parsed,ordinal) => Number.isInteger(ordinal) && ordinal>0 ? parsed.files[ordinal-1] : null;
  return Object.freeze({
    async read(targetId) {
      return guard(null,async () => {
        if (typeof targetId!=='string' || !DIGEST.test(targetId)) return null;
        const snapshot=await inspect(targetId);
        if (!snapshot) return Object.freeze({ ledgerFormat:1,ledgerState:'UNTRUSTED',appliedMigrations:Object.freeze([]),startedFiles:Object.freeze([]) });
        const { parsed }=snapshot;
        const identity=file => ({ path:file.path,version:file.version,sha256:file.sha256,statementManifestDigest:file.statementManifestDigest,
          approvalReference:file.approvalReference,intentDigest:file.intentDigest,statementDigests:Object.freeze(file.statementDigests.slice()) });
        return Object.freeze({ ledgerFormat:1,ledgerState:!snapshot.head ? 'UNINITIALIZED' : !parsed.files.length ? 'EMPTY' : parsed.files.at(-1).state==='APPLIED' ? 'COMPLETE' : 'IN_FLIGHT',
          appliedMigrations:Object.freeze(parsed.files.filter(f => f.state==='APPLIED').map(f => Object.freeze({ ...identity(f),outcome:'APPLIED' }))),
          startedFiles:Object.freeze(parsed.files.filter(f => f.state!=='APPLIED').map(f => Object.freeze({ ...identity(f),
            expectedStatementCount:f.expectedCount,statementStates:Object.freeze(f.states.slice()) }))),sequence:parsed.sequence,checksum:parsed.checksum });
      });
    },
    async startFile(targetId,input) {
      const file=snapshotMigration(input); if (!file) return 'UNKNOWN';
      return append(targetId,parsed => {
        if (parsed.files.length>=MAX_RELEASE_FILES || parsed.expectedTotal+file.statementDigests.length>MAX_PLAN_STATEMENTS) return null;
        const ordinal=parsed.files.length+1;
        return [event('FILE_STARTED',ordinal,{ path:file.path,migration_version:file.version,source_digest:file.sha256,
          manifest_digest:file.statementManifestDigest,approval_reference:file.approvalReference,intent_digest:file.intentDigest,
          planned_count:file.statementDigests.length,planned_digest:hash(file.statementDigests) }),
        ...file.statementDigests.map((d,i) => event('STATEMENT_PLANNED',ordinal,{ statement_ordinal:i+1,statement_digest:d }))];
      });
    },
    async startStatement(targetId,fileOrdinal,ordinal,statementDigest) {
      return append(targetId,parsed => fileAt(parsed,fileOrdinal) ? [event('STATEMENT_STARTED',fileOrdinal,
        { statement_ordinal:ordinal,statement_digest:statementDigest })] : null);
    },
    /** Restricted host calls only after its separate writer connection reports ACKNOWLEDGED.
     * Receipt checksums link facts; they do not independently prove target SQL effects.
     */
    async acknowledgeStatement(targetId,fileOrdinal,ordinal,statementDigest) {
      return append(targetId,parsed => {
        const file=fileAt(parsed,fileOrdinal);
        return file ? [event('STATEMENT_ACKNOWLEDGED',fileOrdinal,{ statement_ordinal:ordinal,statement_digest:statementDigest,
          receipt_digest:receipt(targetId,file,ordinal,statementDigest) })] : null;
      });
    },
    async completeFile(targetId,fileOrdinal) {
      return append(targetId,parsed => {
        const file=fileAt(parsed,fileOrdinal);
        return file ? [event('FILE_APPLIED',fileOrdinal,{ receipt_digest:hash(file.receipts) })] : null;
      });
    },
  });
}

/** Stable physical-target partition; catalog reassignment cannot erase its ledger.
 * Hashing caller data authenticates no identity, owner, mutex or execution authority.
 */
export function oracleTargetLedgerId(binding) {
  if (!binding || typeof binding.targetKey!=='string' || !KEY.test(binding.targetKey)
      || typeof binding.targetIdentityDigest!=='string' || !DIGEST.test(binding.targetIdentityDigest)) return null;
  if(binding.credentialMode==='INSTANCE_MASTER') {
    if(typeof binding.streamId!=='string' || !UUID.test(binding.streamId))return null;
    return hash(['INSTANCE_SCHEMA_STREAM_V2',binding.streamId]);
  }
  return hash([binding.targetKey,binding.targetIdentityDigest]);
}
/** Partitions used by the pre-release V1 instance-stream ledger. Keep these
 * readable so a new V2 stream cannot mistake retained V1 effects for empty. */
export function oracleV1InstanceStreamLedgerIds(binding) {
  if (!binding || typeof binding.streamId!=='string' || !UUID.test(binding.streamId)) return null;
  const keys = new Set();
  if (typeof binding.targetKey==='string' && KEY.test(binding.targetKey)) keys.add(binding.targetKey);
  if (typeof binding.lineageId==='string' && UUID.test(binding.lineageId)) keys.add(`oracle-lineage-v1:${binding.lineageId}`);
  if (!keys.size) return null;
  return Object.freeze([...keys].map(key=>hash(['INSTANCE_SCHEMA_STREAM_V1',key,binding.streamId])));
}
export const oracleTargetLedgerSql=SQL;
