// Read-only witness for the opt-in, unreachable local Oracle fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import oracledb from 'oracledb';

assert.equal(process.getuid(),0);assert.equal(os.hostname(),'kelryvo-oracle-fixture');
const root=process.env.KELRYVO_ACK_FIXTURE_ROOT;
assert(root&&path.isAbsolute(root)&&path.basename(root)==='native-oracle-fixture'&&path.basename(path.dirname(root))==='.cache');
const app=path.join(root,'app-root'),privateRoot=path.join(root,'private');
const mode=process.argv[2];assert(['identity','ledger'].includes(mode));
const wallet=path.join(app,'opt/kelryvo/oracle/wallet');
const descriptor=`(DESCRIPTION=(ADDRESS=(PROTOCOL=TCPS)(HOST=127.0.0.1)(PORT=2485))(CONNECT_DATA=(SERVICE_NAME=freepdb1))(SECURITY=(SSL_SERVER_DN_MATCH=YES)(SSL_SERVER_CERT_DN="CN=localhost")(MY_WALLET_DIRECTORY="${wallet}")))`;
let connection;
try{
  oracledb.initOracleClient({libDir:path.join(app,'opt/kelryvo/oracle/client')});
  let username='KRV_MASTER',password=fs.readFileSync(path.join(privateRoot,'master-password'),'utf8'),ledger;
  if(mode==='ledger'){
    const installation=JSON.parse(fs.readFileSync(path.join(app,'run/kelryvo/runtime/execution/installation.json')));
    assert.equal(installation.route.host,'127.0.0.1');assert.equal(installation.route.port,2484);
    username=installation.principals.observer;ledger=installation.principals.ledgerOwner;
    assert(/^KRV_[A-F0-9]{12}_O$/.test(username)&&/^KRV_[A-F0-9]{12}_L$/.test(ledger));
    password=fs.readFileSync(path.join(app,'run/kelryvo/runtime/execution/observer-password'),'utf8');
  }
  connection=await oracledb.getConnection({user:username,password,connectString:descriptor});
  connection.callTimeout=3000;
  const query=async sql=>(await connection.execute(sql,[],{outFormat:oracledb.OUT_FORMAT_OBJECT})).rows;
  if(mode==='identity'){
    const [d]=await query('SELECT TO_CHAR(DBID) DBID, DB_UNIQUE_NAME, TO_CHAR(RESETLOGS_CHANGE#) RESETLOGS_CHANGE, CDB FROM SYS.V_$DATABASE');
    const [s]=await query("SELECT SYS_CONTEXT('USERENV','CON_ID') CONTAINER_ID, SYS_CONTEXT('USERENV','CON_NAME') CONTAINER_NAME, SYS_CONTEXT('USERENV','SERVICE_NAME') SERVICE_NAME FROM SYS.DUAL");
    const [c]=await query("SELECT TO_CHAR(DBID) CONTAINER_DBID, RAWTOHEX(GUID) CONTAINER_GUID FROM SYS.V_$CONTAINERS WHERE CON_ID=SYS_CONTEXT('USERENV','CON_ID')");
    const [v]=await query('SELECT BANNER VERSION FROM SYS.V_$VERSION WHERE ROWNUM=1');
    console.log(JSON.stringify({identity:{engine:'oracle',dbid:d.DBID,dbUniqueName:d.DB_UNIQUE_NAME,
      resetlogsChange:d.RESETLOGS_CHANGE,cdb:d.CDB==='YES',containerId:s.CONTAINER_ID,
      containerGuid:c.CONTAINER_GUID,containerDbid:c.CONTAINER_DBID,containerName:s.CONTAINER_NAME,
      serviceName:s.SERVICE_NAME,version:v.VERSION},serverVersion:connection.oracleServerVersionString}));
  }else{
    const events=await query(`SELECT * FROM ${ledger}.SF_TARGET_LEDGER_EVENTS ORDER BY TARGET_ID,SEQUENCE_NO`);
    const heads=await query(`SELECT * FROM ${ledger}.SF_TARGET_LEDGER_HEAD ORDER BY TARGET_ID`);
    console.log(JSON.stringify({events:events.length,heads:heads.length,
      sha256:createHash('sha256').update(JSON.stringify({events,heads})).digest('hex')}));
  }
}catch{
  console.error('Read-only local Oracle witness unavailable; private connection details omitted');process.exitCode=1;
}finally{if(connection)await connection.close();}
