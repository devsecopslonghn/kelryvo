#!/usr/bin/env bash
set -u
cd /home/longhn0710/workspace/schemaforge-product-release-source-comparison
base=704ef82f3bf183707b40e8194f3b1f0a15e29a89
head=2f3147fd57cfa726bfe7253f4947e321c1c747ef
printf 'HEAD '; git rev-parse HEAD
printf 'TREE '; git rev-parse HEAD^{tree}
printf 'STATUS_COUNT '; git status --porcelain=v1 | wc -l
printf 'SOURCE_AND_LICENSE_HASHES\n'
sha256sum apps/api/index.ts apps/web/src/app.jsx packages/migrations/compare-retained-releases.mjs tests/product-release-comparison.test.mjs tests/product-release-comparison-browser.integration.mjs docs/development/local-product.md LICENSE NOTICE package.json package-lock.json
if git diff --check "$base..$head" -- apps/api/index.ts apps/web/src/app.jsx packages/migrations/compare-retained-releases.mjs tests/product-release-comparison.test.mjs tests/product-release-comparison-browser.integration.mjs docs/development/local-product.md docs/decisions/log.json docs/implementation; then printf 'FOCUSED_DIFF_CHECK PASS\n'; else printf 'FOCUSED_DIFF_CHECK FAIL\n'; exit 1; fi
if git diff --quiet "$base..$head" -- LICENSE NOTICE package.json package-lock.json docs/dependencies docs/product/license-and-naming.md docs/inputs/db-research experiments; then printf 'LICENSE_NOTICE_DEPENDENCY_GRANTS_GRAMMAR_UNCHANGED true\n'; else printf 'LICENSE_NOTICE_DEPENDENCY_GRANTS_GRAMMAR_UNCHANGED false\n'; exit 1; fi
if git diff --quiet "$base..$head" -- docs/implementation/acceptance.json; then printf 'ORIGINAL_ACCEPTANCE_UNCHANGED true\n'; else printf 'ORIGINAL_ACCEPTANCE_UNCHANGED false\n'; exit 1; fi
node - <<'NODE'
const fs=require('fs'),cp=require('child_process'),crypto=require('crypto');
const dir='/tmp/schemaforge-t25-corrected-publication-20261010T0109Z';
const cls=JSON.parse(fs.readFileSync(dir+'/classification.json','utf8'));
const snapshot=JSON.parse(fs.readFileSync(dir+'/snapshot-sha256.json','utf8'));
let snapCopyOK=0,snapHeadOK=0,snapFail=0;
for(const[p,h]of Object.entries(snapshot)){try{const a=fs.readFileSync(dir+'/snapshot/'+p);const b=cp.execFileSync('git',['show',`2f3147fd57cfa726bfe7253f4947e321c1c747ef:${p}`],{maxBuffer:30*1024*1024});const hash=x=>crypto.createHash('sha256').update(x).digest('hex');if(hash(a)===h)snapCopyOK++;else snapFail++;if(hash(b)===h)snapHeadOK++;else snapFail++;}catch{snapFail++;}}
let refsOK=0,refsFail=0;const categories={};
for(const f of cls.classification){categories[f.classification]=(categories[f.classification]||0)+1;try{const b=cp.execFileSync('git',['show',`${f.commit}:${f.path}`],{maxBuffer:30*1024*1024});if(crypto.createHash('sha256').update(b).digest('hex')===f.blob_sha256)refsOK++;else refsFail++;}catch{refsFail++;}}
function safe(p){return JSON.parse(fs.readFileSync(p,'utf8'));}
function tupleCounts(p){const x=safe(p),m=new Map();for(const f of x.finding_metadata){const k=JSON.stringify([f.RuleID,f.File,f.StartLine,f.EndLine,f.Commit]);m.set(k,(m.get(k)||0)+1);}return m;}
function compare(aPath,bPath){const a=tupleCounts(aPath),b=tupleCounts(bPath);let missing=0,added=0,old=0,current=0;for(const[k,n]of a){old+=n;if((b.get(k)||0)<n)missing+=n-(b.get(k)||0);}for(const[k,n]of b){current+=n;if(n>(a.get(k)||0))added+=n-(a.get(k)||0);}return{old,current,missing,added};}
function hash(p){return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');}
const pub=safe(dir+'/publication-safe.json'),hist=safe(dir+'/history-safe.json');
const pubPrivate=hash(dir+'/publication-private-report.json'),histPrivate=hash(dir+'/history-private-report.json');
const native=safe('/home/longhn0710/workspace/schemaforge-product-release-source-comparison/evidence/product/product-t25-corrected-root-20261010T0107Z/native/native-corrected-final-completion.json');
const nativeHashes={};let nativeLogsMatch=true;for(const [name,run]of Object.entries(native.final_runs)){const actual=hash(run.path);nativeHashes[name]=actual;if(actual!==run.sha256)nativeLogsMatch=false;}
const apiRun=native.focused_runs.focused_api_final_source;const apiHash=hash(apiRun.path);if(apiHash!==apiRun.sha256)nativeLogsMatch=false;
const summary={snapshot:{paths:Object.keys(snapshot).length,copied_exact:snapCopyOK,head_exact:snapHeadOK,failures:snapFail},classification:{entries:cls.classification.length,targets_exact:refsOK,failures:refsFail,categories},scans:{publication:{paths:pub.paths.length,findings:pub.finding_count,exit:pub.scanner_exit_code,clean_PASS:pub.clean_scan_PASS,private_hash_matches:pub.private_report_sha256===pubPrivate},history:{findings:hist.finding_count,exit:hist.scanner_exit_code,clean_PASS:hist.clean_scan_PASS,private_hash_matches:hist.private_report_sha256===histPrivate},actual_credentials_observed:cls.actual_credentials_observed,rotation_indicated:cls.rotation_indicated},history_preservation:{t24:compare('/tmp/schemaforge-t24-publication-20261009T2208Z/history-safe.json',dir+'/history-safe.json'),t25_pre_correction:compare('/tmp/schemaforge-t25-publication-20261009T2323Z/history-safe.json',dir+'/history-safe.json')},native:{recorded_head:native.head,final_source_manifest:native.source_manifest.map(x=>x.path),raw_log_hashes_match:nativeLogsMatch,api_corrected_source_tests:apiRun.tap,final_suite_counts:Object.fromEntries(Object.entries(native.final_runs).map(([k,v])=>[k,v.tap]))}};
console.log('PROVENANCE '+JSON.stringify(summary));
if(snapFail||snapCopyOK!==741||snapHeadOK!==741||refsFail||refsOK!==cls.classification.length||!pub.private_report_sha256||pub.private_report_sha256!==pubPrivate||hist.private_report_sha256!==histPrivate||!nativeLogsMatch)process.exit(1);
NODE
