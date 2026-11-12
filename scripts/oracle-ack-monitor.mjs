// Opt-in harness observer for the isolated installed-Oracle fixture. This process
// reads only Oracle catalogs/ledger rows and controls the private transport proxy.
// It cannot admit jobs, dispatch SQL, edit receipts or manufacture recovery evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import oracledb from 'oracledb';

const root=process.env.KELRYVO_ACK_FIXTURE_ROOT;
assert(root&&path.isAbsolute(root)&&path.basename(root)==='native-oracle-fixture'&&path.basename(path.dirname(root))==='.cache');
const privateRoot=path.join(root,'private'),image=path.join(root,'app-root');
assert.equal(process.getuid(),0);
assert.equal(os.hostname(),'kelryvo-oracle-fixture');
const installation=JSON.parse(fs.readFileSync(path.join(image,'run/kelryvo/runtime/execution/installation.json')));
assert.equal(installation.route.host,'127.0.0.1');assert.equal(installation.route.port,2484);
const marker=JSON.parse(fs.readFileSync(path.join(privateRoot,'installed-test-context.json')));
assert.equal(marker.kind,'KELRYVO_DISPOSABLE_NATIVE_ORACLE_V1');assert.equal(marker.connectionId,installation.connectionId);
const migrationPath=process.env.KELRYVO_ACK_MIGRATION_PATH??'V2__recovery.sql';
assert(/^V[1-9][0-9]{0,3}__[a-z0-9_]{1,40}\.sql$/.test(migrationPath));
const targetId=process.env.KELRYVO_ACK_TARGET_ID;
assert(/^[a-f0-9]{64}$/.test(targetId??''),'An exact independently approved stream is required');
const stem='oracle-ack-'+migrationPath.slice(0,-4);
const ready=path.join(privateRoot,stem+'-ready.json'),report=path.join(privateRoot,stem+'-result.json');
assert(!fs.existsSync(ready)&&!fs.existsSync(report),'Never silently repeat a fault attempt');
const ledger=installation.principals.ledgerOwner,observer=installation.principals.observer;
assert(/^KRV_[A-F0-9]{12}_L$/.test(ledger));assert(/^KRV_[A-F0-9]{12}_O$/.test(observer));
const wallet=path.join(image,'opt/kelryvo/oracle/wallet');
const descriptor=`(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=127.0.0.1)(PORT=2485))(CONNECT_DATA=(SERVICE_NAME=freepdb1))(SECURITY=(SSL_SERVER_DN_MATCH=YES)(SSL_SERVER_CERT_DN="CN=localhost")(MY_WALLET_DIRECTORY="${wallet}")))`;
assert.equal(installation.route.service,'freepdb1');assert.equal(installation.route.serverCertificateDN,'CN=localhost');
const save=(file,value)=>fs.writeFileSync(file,JSON.stringify(value),{mode:0o600,flag:'wx'});
function control(value){return new Promise((resolve,reject)=>{
  const socket=net.createConnection(path.join(privateRoot,'proxy-control.sock'));let input='';
  socket.setTimeout(2000,()=>socket.destroy(new Error('Private proxy timeout')));
  socket.once('connect',()=>socket.write(JSON.stringify(value)+'\n'));
  socket.on('data',chunk=>{input+=chunk.toString();if(input.length>16384){socket.destroy(new Error('Oversized private response'));return;}
    if(input.includes('\n')){socket.end();try{resolve(JSON.parse(input));}catch(error){reject(error);}}});
  socket.once('error',reject);socket.once('end',()=>{if(!input.includes('\n'))reject(new Error('Incomplete private response'));});
});}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let connection,cancelled=false,selectedPort=null,polls=0;
process.once('SIGTERM',()=>{cancelled=true;});
try{
  oracledb.initOracleClient({libDir:path.join(image,'opt/kelryvo/oracle/client')});
  connection=await oracledb.getConnection({user:observer,
    password:fs.readFileSync(path.join(image,'run/kelryvo/runtime/execution/observer-password'),'utf8'),connectString:descriptor});
  connection.callTimeout=2000;
  assert.equal(connection.oracleServerVersionString,installation.driverServerVersionString);
  // Only FILE_STARTED carries the path. The terminal event is joined through
  // its protected target/file identity and strictly increasing sequence.
  const eventSql=`SELECT a.target_id,a.sequence_no,a.checksum,s.path FROM ${ledger}.SF_TARGET_LEDGER_EVENTS s JOIN ${ledger}.SF_TARGET_LEDGER_EVENTS a ON a.target_id=s.target_id AND a.file_ordinal=s.file_ordinal AND a.sequence_no>s.sequence_no WHERE s.event_type='FILE_STARTED' AND s.target_id=:targetId AND s.path=:migrationPath AND a.event_type='FILE_APPLIED'`;
  const binds={targetId,migrationPath:'migrations/'+migrationPath};
  assert.equal((await connection.execute(eventSql,binds)).rows.length,0,'Fresh migration required');
  assert.equal((await control({op:'snapshot'})).result.cuts,0);
  save(ready,{status:'READY_READ_ONLY',connectionId:marker.connectionId,targetId,migrationPath});
  const deadline=Date.now()+120000;let negativeStart=null,proof=null,event=null;
  while(Date.now()<deadline){
    assert(!cancelled,'Monitor cancelled; no replay is authorized');polls++;
    const readStart=process.hrtime.bigint();
    const observed=(await connection.execute(eventSql,binds)).rows;
    if(observed.length===0){negativeStart=readStart;}
    else{
      assert.equal(observed.length,1);assert(negativeStart!==null&&selectedPort!==null);
      event=observed[0];
      assert.equal(event[0],targetId);
      // An independent Oracle session sees the committed event. Only cut while
      // no server response captured since the last negative read was forwarded.
      for(let attempt=0;attempt<20;attempt++){
        const result=await control({op:'cut',port:selectedPort,afterNs:negativeStart.toString()});
        if(result.ok){proof=result.result;break;}
        const snapshot=(await control({op:'snapshot'})).result;
        const stream=snapshot.connections.find(s=>s.upstreamPort===selectedPort&&!s.closed);
        if(!stream)break;
        assert(typeof stream.lastForwardedCapturedNs==='string','Exact monotonic clock serialization required');
        if(BigInt(stream.lastForwardedCapturedNs)>=negativeStart)break;
        await sleep(1);
      }
      assert(proof,'Fault window missed; do not replay the approved migration');
      assert.equal(proof.oracleCommitProven,false);
      assert.equal((await connection.execute(eventSql,binds)).rows.length,1,'Committed event must survive the cut');
      break;
    }
    if(selectedPort===null){
      const sessions=(await connection.execute("SELECT PORT FROM SYS.V_$SESSION WHERE USERNAME=:ledger AND TYPE='USER'",{ledger})).rows.map(row=>row[0]);
      const snapshot=(await control({op:'snapshot'})).result;
      const live=snapshot.connections.filter(s=>!s.closed&&sessions.includes(s.upstreamPort));
      if(live.length===1){selectedPort=live[0].upstreamPort;assert((await control({op:'arm',port:selectedPort})).ok);}
      else assert(live.length===0,'Ambiguous ledger connection; refusing a fault');
    }
    await sleep(2);
  }
  assert(proof&&event,'No committed fault observed; do not replay the approved migration');
  const evidence={status:'PASS',oracleCommitProven:true,transport:proof,
    committedEvent:{targetId:event[0],sequence:event[1],checksum:event[2],path:event[3]},
    connectionId:marker.connectionId,sourceTreeDigest:marker.sourceTreeDigest,
    appImageDigest:marker.appImageDigest,oracleServerVersion:connection.oracleServerVersionString,
    selectedSessionUsername:ledger,qualification:'DISPOSABLE_LOCAL_FIXTURE_ONLY'};
  evidence.evidenceDigest=createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
  save(report,evidence);console.log('PASS: independent committed FILE_APPLIED read and one withheld ledger response cut');
}catch(error){
  // Error text can contain descriptors; private diagnostics remain inside the
  // fixture and are never copied as public evidence.
  if(!fs.existsSync(report))save(report,{status:'FAIL',error:error.message,oracleCommitProven:false,selectedPort,polls,migrationPath});
  console.error('Oracle ACK fixture failed; inspect private diagnostics; no replay is authorized');process.exitCode=1;
}finally{if(connection)await connection.close();}
