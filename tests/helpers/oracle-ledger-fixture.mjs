import assert from 'node:assert/strict';
import { oracleTargetLedgerSql as SQL } from '../../packages/execution/oracle-target-ledger.mjs';

// Explicit UNIT driver: commits atomically publish staged changes. Lost commit ACK
// is modeled both before and after publication; no SQL effects are performed.
export class FakeConnection {
  constructor() { this.heads=new Map();this.events=new Map();this.staged=null;this.calls=[];this.commits=0;this.failCommit=null;this.failSql=null; }
  async execute(sql,binds,options) {
    this.calls.push({ sql,binds:structuredClone(binds),options });
    if (sql===this.blockSql && this.block) await this.block;
    if (sql===this.failSql) throw new Error('UNIT driver failure');
    if (sql===SQL.lock && !this.staged) this.staged=structuredClone({ heads:this.heads,events:this.events });
    const state=this.staged ?? this,key=binds.targetId;
    if (sql===SQL.head || sql===SQL.lock) {
      const head=state.heads.get(key);return { rows:head ? [structuredClone(head)] : [] };
    }
    if (sql===SQL.read) return { rows:structuredClone((state.events.get(key) ?? []).slice(0,options.maxRows)) };
    assert.ok(this.staged,'DML requires a transaction');
    if (sql===SQL.insertHead) {
      if (state.heads.has(key)) throw new Error('duplicate head');
      state.heads.set(key,{ sequence_no:0,checksum:binds.checksum });return { rowsAffected:1 };
    }
    if (sql===SQL.insertEvent) {
      if (binds.event_type===this.failEventType) throw new Error('UNIT ledger event acknowledgement lost');
      if (binds.event_type==='STATEMENT_PLANNED' && binds.statement_ordinal===this.failPlannedOrdinal) throw new Error('UNIT interrupted plan');
      const { targetId,...row }=structuredClone(binds);
      const rows=state.events.get(key) ?? [];rows.push(row);state.events.set(key,rows);return { rowsAffected:1 };
    }
    if (sql===SQL.updateHead) {
      const head=state.heads.get(key);
      if (this.zeroHead || !head || head.sequence_no!==binds.priorSequence || head.checksum!==binds.priorChecksum) return { rowsAffected:0 };
      state.heads.set(key,{ sequence_no:binds.sequenceNo,checksum:binds.checksum });return { rowsAffected:1 };
    }
    throw new Error('Unexpected UNIT SQL');
  }
  async commit() {
    this.commits++;
    if (this.failCommit==='before') throw new Error('UNIT lost commit acknowledgement');
    if (this.staged) { this.heads=this.staged.heads;this.events=this.staged.events;this.staged=null; }
    if (this.failCommit==='after') throw new Error('UNIT lost commit acknowledgement');
  }
  async rollback() { this.staged=null; }
}
