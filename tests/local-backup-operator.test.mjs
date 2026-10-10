import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, chmod, writeFile, rm, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { readPrivateLocalConfig, authorizeLocalMetadataUrl } from '../scripts/local-operator-config.mjs';

test('backup private configuration and loopback database authorization fail closed',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sf-backup-config-'));
  try {
    await chmod(root,0o700);
    const password=randomBytes(32).toString('hex');
    const configPath=path.join(root,'config.json');
    await writeFile(configPath,JSON.stringify({databasePassword:password,developerToken:'a'.repeat(64),approverToken:'b'.repeat(64)}),{mode:0o600});
    const config=await readPrivateLocalConfig(configPath);
    assert.equal(config.databasePassword,password);
    await assert.rejects(()=>authorizeLocalMetadataUrl(configPath,`postgres://schemaforge:${password}@10.0.0.1:5432/schemaforge`));
    await assert.rejects(()=>authorizeLocalMetadataUrl(configPath,`postgres://schemaforge:${password}@127.0.0.1:5432/schemaforge?sslmode=require`));
    await assert.rejects(()=>authorizeLocalMetadataUrl(configPath,`postgres://schemaforge:${password}@127.0.0.1:5432/sf_product_restore_invalid`));
    const stat=await lstat(configPath); assert.equal(stat.mode&0o777,0o600);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('backup operator rejects existing, unsafe, nested-witness, and symlink paths',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'sf-backup-path-'));
  try {
    await chmod(root,0o700);
    const password=randomBytes(32).toString('hex');
    const configPath=path.join(root,'config.json');
    await writeFile(configPath,JSON.stringify({databasePassword:password,developerToken:'a'.repeat(64),approverToken:'b'.repeat(64)}),{mode:0o600});
    const occupied=path.join(root,'occupied'); await mkdir(occupied,{mode:0o700});
    const link=path.join(root,'linked'); const target=path.join(root,'target'); await mkdir(target,{mode:0o700});
    const { symlink }=await import('node:fs/promises'); await symlink(target,link);
    const { createPrivateBackup }=await import('../packages/backup/index.mjs');
    const databaseUrl=`postgres://schemaforge:${password}@127.0.0.1:5432/schemaforge`;
    await assert.rejects(()=>createPrivateBackup({configPath,databaseUrl,destination:occupied,witnessPath:path.join(root,'witness')}));
    await assert.rejects(()=>createPrivateBackup({configPath,databaseUrl,destination:path.join(root,'fresh'),witnessPath:path.join(root,'fresh','witness')}));
    await assert.rejects(()=>createPrivateBackup({configPath,databaseUrl,destination:path.join(link,'backup'),witnessPath:path.join(root,'witness')}));
  } finally { await rm(root,{recursive:true,force:true}); }
});
