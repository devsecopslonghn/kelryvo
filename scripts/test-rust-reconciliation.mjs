// Isolated public-response fixtures exercise the actual compiled Rust/WASM UI.
// They create no database, approval, native recovery evidence or Oracle session.
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {once} from 'node:events';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';

export async function reconciliationResponseBrowser({browser,webDirectory}){
  assert(path.isAbsolute(webDirectory));
  const assets=new Set(['index.html','bootstrap.js','app.js','app_bg.wasm','styles.css']);
  const project='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222';
  const actor={id:'response-fixture-reviewer',name:'Response fixture reviewer',role:'approver'};
  const complete={status:'RECOVERED_APPLIED',jobState:'HOLD',retryEligible:false,executionAuthority:false,evidenceDigest:'f'.repeat(64)};
  const retained={jobId:job,projectId:project,retryEligible:false,executionAuthority:false,reconciliations:[],recoveredCompletion:complete};
  const invalid=[
    {jobId:project},{projectId:job},{retryEligible:true},{executionAuthority:true},
    {executionAuthority:'false'},{reconciliations:null},{reconciliations:Array(21).fill({})},
    ...[{status:'VERIFIED_SUCCESS'},{jobState:'VERIFIED_SUCCESS'},{retryEligible:true},
      {executionAuthority:true},{evidenceDigest:'F'.repeat(64)},{evidenceDigest:'f'.repeat(63)},
      {evidenceDigest:'<script>window.recoveryCanary=true</script>'}]
      .map(change=>({recoveredCompletion:{...complete,...change}})),
  ];
  const submission='44444444-4444-4444-8444-444444444444';
  const row={id:submission,jobId:job,retryEligible:false,executionAuthority:false,submitterId:'response-fixture-author',evidenceKind:'TARGET_LEDGER',evidenceDigest:'f'.repeat(64),reason:'Response fixture'};
  let reply=retained,postReply,historyStatus=200,jobState='HOLD',canDeploy=false,authorAvailable=true,historyReads=0,writes=0;
  const server=http.createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      const name=pathname==='/'?'index.html':pathname.slice(1);
      if(!assets.has(name)){res.writeHead(404);res.end();return;}
      const bytes=await readFile(path.join(webDirectory,name));
      res.writeHead(200,{'content-type':name.endsWith('.wasm')?'application/wasm':name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});res.end(bytes);
    }catch{res.writeHead(500);res.end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const context=await browser.newContext(),page=await context.newPage();
  const errors=[],unexpected=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
    await page.route('**/api/**',route=>{
      const request=route.request(),p=new URL(request.url()).pathname;let value;
      if(request.method()==='POST'&&[ `/api/execution-jobs/${job}/reconciliations`, `/api/execution-jobs/${job}/reconciliations/${submission}/decision` ].includes(p)){
        writes++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(postReply)});
      }
      if(request.method()!=='GET')unexpected.push(request.method()+' '+p);
      if(p==='/api/session')value={actor,accessMode:'ENFORCED',csrfToken:'response-fixture-only'};
      else if(p==='/api/auth/methods')value={token:true};
      else if(p==='/api/projects')value={projects:[{id:project,name:'Response fixture'}]};
      else if(p===`/api/projects/${project}`)value={project:{id:project,name:'Response fixture',archivedAt:null},plans:authorAvailable?[{id:'33333333-3333-4333-8333-333333333333',authorId:'response-fixture-author'}]:[],profiles:[],environments:[],releases:[],canDeploy};
      else if(p===`/api/projects/${project}/execution-jobs`)value={jobs:[{id:job,planId:'33333333-3333-4333-8333-333333333333',state:jobState,revision:2,requesterId:'response-fixture-author',reason:'Response fixture'}],nextCursor:null};
      else if(p===`/api/execution-jobs/${job}/reconciliations`){historyReads++;value=reply;}
      else if(p===`/api/recovery/status`)value={state:'ACTIVE'};
      else{unexpected.push(request.method()+' '+p);value={};}
      return route.fulfill({status:p===`/api/execution-jobs/${job}/reconciliations`?historyStatus:200,contentType:'application/json',body:JSON.stringify(value)});
    });
    const article=()=>page.getByRole('article').filter({has:page.getByRole('heading',{name:`Request ${job}`,exact:true})});
    const open=async(value,{state='HOLD',role='approver',deployer=false,knownAuthor=true}={})=>{
      reply=value;historyStatus=200;jobState=state;actor.role=role;canDeploy=deployer;authorAvailable=knownAuthor;await page.goto('about:blank');
      await page.goto(`http://127.0.0.1:${server.address().port}/#project=${project}&page=executions`);
      await page.getByRole('heading',{name:'Execution requests',exact:true}).waitFor();
      if(state==='HOLD')await article().getByRole('button',{name:'HOLD evidence review',exact:true}).click();
    };
    for(const change of invalid){
      await open({...retained,...change});
      await page.getByText('Reconciliation history unavailable. Refresh evidence and try again.',{exact:true}).waitFor();
      assert.equal(await article().locator('.hold-review').count(),0);
      assert.equal(await page.evaluate(()=>window.recoveryCanary),undefined);
    }
    await open({...retained,reconciliations:[{...row,decision:{decision:'EVIDENCE_REVIEWED',reviewerId:actor.id,reason:'Independent response fixture review'}}],recoveredCompletion:{...complete,reconciliationId:submission}});
    await article().getByRole('complementary',{name:'Verified recovery',exact:true}).waitFor();
    assert.match(await article().innerText(),/stays on HOLD and cannot be replayed/);
    await article().getByText('This review is linked to the verified recovery above.',{exact:true}).waitFor();
    assert.equal(await article().getByRole('button',{name:/^(retry|replay)/i}).count(),0);
    await open({...retained,recoveredCompletion:null});
    await article().getByRole('heading',{name:'HOLD evidence review',exact:true}).waitFor();
    assert.equal(await article().getByRole('complementary',{name:'Verified recovery',exact:true}).count(),0);
    await open(retained,{state:'VERIFIED_SUCCESS'});
    assert.equal(await article().getByRole('button',{name:'HOLD evidence review',exact:true}).count(),0);
    await open({...retained,recoveredCompletion:null,reconciliations:[row]},{knownAuthor:false});
    await article().getByRole('heading',{name:'HOLD evidence review',exact:true}).waitFor();
    assert.equal(await article().getByRole('button',{name:'Mark evidence reviewed',exact:true}).count(),0);
    await open({...retained,recoveredCompletion:null},{role:'developer',deployer:true});
    await article().getByLabel('Evidence SHA-256',{exact:true}).fill('not-a-digest');
    await article().getByLabel('Evidence reason',{exact:true}).fill('Invalid digest must stay local');
    await article().getByRole('button',{name:'Submit evidence',exact:true}).click();
    await page.getByText('Enter a SHA-256 digest and reason for evidence, or a reason for independent review.',{exact:true}).waitFor();
    assert.equal(writes,0,'invalid digest must not be sent to the API');
    assert.equal(await article().getByLabel('Evidence SHA-256',{exact:true}).inputValue(),'not-a-digest');
    assert.equal(await article().getByLabel('Evidence reason',{exact:true}).inputValue(),'Invalid digest must stay local');
    const submit=async()=>{
      await article().getByLabel('Evidence SHA-256',{exact:true}).fill('f'.repeat(64));
      await article().getByLabel('Evidence reason',{exact:true}).fill('Response fixture evidence');
      await article().getByRole('button',{name:'Submit evidence',exact:true}).click();
    };
    for(const change of [{jobId:project},{retryEligible:true},{executionAuthority:true}]){
      await open({...retained,recoveredCompletion:null},{role:'developer',deployer:true});
      await article().getByLabel('Evidence SHA-256',{exact:true}).waitFor();
      postReply={reconciliation:{...row,...change}};const reads=historyReads;await submit();
      await page.getByText('Could not confirm the reconciliation response. Refresh evidence before continuing.',{exact:true}).waitFor();
      assert.equal(historyReads,reads,'unconfirmed submission must not consume a fresh history response');
      assert.equal(await article().getByLabel('Evidence reason',{exact:true}).inputValue(),'Response fixture evidence');
    }
    await open({...retained,recoveredCompletion:null},{role:'developer',deployer:true});
    await article().getByLabel('Evidence SHA-256',{exact:true}).waitFor();postReply={reconciliation:row};await submit();
    await page.getByText('HOLD evidence retained. Execution remains held; replay is not permitted.',{exact:true}).waitFor();
    assert.equal(await article().getByLabel('Evidence SHA-256',{exact:true}).inputValue(),'');
    assert.equal(await article().getByLabel('Evidence reason',{exact:true}).inputValue(),'');
    for(const change of [{reconciliation:{...row,id:project}},{retryEligible:true},{executionAuthority:true}]){
      await open({...retained,recoveredCompletion:null,reconciliations:[row]});
      await article().getByLabel('HOLD review reason',{exact:true}).fill('Independent response fixture review');
      postReply={reconciliation:row,retryEligible:false,executionAuthority:false,...change};const reads=historyReads;
      await article().getByRole('button',{name:'Mark evidence reviewed',exact:true}).click();
      await page.getByText('Could not confirm the reconciliation response. Refresh evidence before continuing.',{exact:true}).waitFor();
      assert.equal(historyReads,reads,'unconfirmed review must not consume a fresh history response');
      assert.equal(await article().getByLabel('HOLD review reason',{exact:true}).inputValue(),'Independent response fixture review');
    }
    await open({...retained,recoveredCompletion:null,reconciliations:[row]});
    await article().getByLabel('HOLD review reason',{exact:true}).fill('Independent response fixture review');
    postReply={reconciliation:row,retryEligible:false,executionAuthority:false};
    await article().getByRole('button',{name:'Mark evidence reviewed',exact:true}).click();
    await page.getByText('HOLD evidence retained. Execution remains held; replay is not permitted.',{exact:true}).waitFor();
    assert.equal(await article().getByLabel('HOLD review reason',{exact:true}).inputValue(),'');
    assert.equal(writes,8);
    await open({...retained,recoveredCompletion:null},{role:'developer',deployer:true});
    await article().getByLabel('Evidence SHA-256',{exact:true}).waitFor();
    reply={...retained,jobId:project};postReply={reconciliation:row};await submit();
    await page.getByText(/Reconciliation history unavailable/).waitFor();
    assert.equal(await article().getByLabel('Evidence SHA-256',{exact:true}).inputValue(),'');
    assert.equal(await article().getByLabel('Evidence reason',{exact:true}).inputValue(),'');
    await page.getByText('Evidence reference retained. Reconciliation history unavailable. Refresh evidence and try again.',{exact:true}).waitFor();
    await open({...retained,recoveredCompletion:null,reconciliations:[row]});
    await article().getByLabel('HOLD review reason',{exact:true}).fill('Confirmed review, failed history');
    reply={...retained,jobId:project};postReply={reconciliation:row,retryEligible:false,executionAuthority:false};
    await article().getByRole('button',{name:'Mark evidence reviewed',exact:true}).click();
    await page.getByText(/Reconciliation history unavailable/).waitFor();
    assert.equal(await article().getByLabel('HOLD review reason',{exact:true}).inputValue(),'');
    await page.getByText('Independent review retained. Reconciliation history unavailable. Refresh evidence and try again.',{exact:true}).waitFor();
    assert.equal(writes,10);
    await open({...retained,recoveredCompletion:null},{role:'developer',deployer:true});
    await article().getByLabel('Evidence SHA-256',{exact:true}).waitFor();
    historyStatus=503;reply={error:'RECONCILIATION_UNAVAILABLE'};postReply={reconciliation:row};await submit();
    await page.getByText(/^Evidence reference retained\./).waitFor();
    assert.equal(await article().getByLabel('Evidence SHA-256',{exact:true}).inputValue(),'');
    assert.equal(await article().getByLabel('Evidence reason',{exact:true}).inputValue(),'');
    await open({...retained,recoveredCompletion:null,reconciliations:[row]});
    await article().getByLabel('HOLD review reason',{exact:true}).fill('Confirmed review, unavailable history');
    historyStatus=503;reply={error:'RECONCILIATION_UNAVAILABLE'};postReply={reconciliation:row,retryEligible:false,executionAuthority:false};
    await article().getByRole('button',{name:'Mark evidence reviewed',exact:true}).click();
    await page.getByText(/^Independent review retained\./).waitFor();
    assert.equal(await article().getByLabel('HOLD review reason',{exact:true}).inputValue(),'');
    assert.equal(writes,12);
    assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
    console.log('PASS: compiled Rust/WASM recovery display, HOLD-only controls, 14 malformed history and 6 malformed mutation response refusals, valid submission/review, retained mutation with malformed/unavailable history; isolated response fixtures only, no database or Oracle.');
  }finally{await context.close();await new Promise(resolve=>server.close(resolve));}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const browser=await chromium.launch({headless:true});
  try{await reconciliationResponseBrowser({browser,webDirectory:path.resolve(process.argv[2]??'dist/rust-web')});}
  finally{await browser.close();}
}
