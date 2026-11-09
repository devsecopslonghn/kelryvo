import { writeFile } from 'node:fs/promises';
const sourceSha=process.argv[2];
if(!/^(?:[a-f0-9]{40}|local-unpublished)$/.test(sourceSha??''))throw new Error('Invalid source revision');
await writeFile('source-identity.json',JSON.stringify({format:1,sourceSha})+'\n',{mode:0o444,flag:'wx'});
