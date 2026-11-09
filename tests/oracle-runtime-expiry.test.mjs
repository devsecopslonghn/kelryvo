import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createOracleRuntimeExpiry} from '../apps/worker/managed-oracle-runtime.mjs';

test('a thirty-day installation remains active instead of overflowing to a one-millisecond abort',async()=>{
  const expiry=createOracleRuntimeExpiry(new Date(Date.now()+30*86400000).toISOString());
  try{await delay(30);assert.equal(expiry.signal.aborted,false);}finally{expiry.close();}
});
test('the actual protected deadline aborts and malformed deadlines are rejected',async()=>{
  const expiry=createOracleRuntimeExpiry(new Date(Date.now()+20).toISOString());
  try{await delay(40);assert.equal(expiry.signal.aborted,true);}finally{expiry.close();}
  const expired=createOracleRuntimeExpiry(new Date(Date.now()-1000).toISOString());
  try{assert.equal(expired.signal.aborted,true);}finally{expired.close();}
  assert.throws(()=>createOracleRuntimeExpiry('invalid'));
});
