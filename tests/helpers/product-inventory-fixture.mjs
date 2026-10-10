import { randomBytes } from 'node:crypto';
import { chmod,mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
export async function createInventoryOperatorFixture(databaseUrl){
  const directory=await mkdtemp(path.join(tmpdir(),'schemaforge-inventory-operator-'));await chmod(directory,0o700);
  const configPath=path.join(directory,'config.json');const config={databasePassword:randomBytes(32).toString('hex'),developerToken:randomBytes(32).toString('hex'),approverToken:randomBytes(32).toString('hex')};
  await writeFile(configPath,`${JSON.stringify(config)}\n`,{mode:0o600});await chmod(configPath,0o600);
  const url=new URL(databaseUrl);url.password=config.databasePassword;
  return {directory,configPath,config,databaseUrl:url.toString(),async close(){await rm(directory,{recursive:true,force:true});}};
}
