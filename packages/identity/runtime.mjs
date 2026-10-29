import { isIP } from 'node:net';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
const bad=()=>new Error('Identity runtime configuration unavailable');
export function validateIdentityRuntime(value) {
  if(!value||value.format!==1||!Array.isArray(value.routes)||value.routes.length>20
    ||!/^[a-f0-9]{64}$/.test(value.key??'')||!value.secrets||Array.isArray(value.secrets))throw bad();
  const origin=new URL(value.publicOrigin);
  if(origin.origin!==value.publicOrigin||origin.protocol!=='https:')throw bad();
  const ids=new Set();
  for(const r of value.routes){
    if(!r||!/^[a-z][a-z0-9-]{0,63}$/.test(r.id??'')||ids.has(r.id)||!['OIDC','LDAP'].includes(r.kind)
      ||!Array.isArray(r.pinnedIPs)||!r.pinnedIPs.length||r.pinnedIPs.length>8||r.pinnedIPs.some(ip=>!isIP(ip))
      ||!Array.isArray(r.secretRefs)||!r.secretRefs.length||r.secretRefs.some(ref=>!/^[a-z][a-z0-9-]{0,63}$/.test(ref)||typeof value.secrets[ref]!=='string'||!value.secrets[ref]||value.secrets[ref].length>4096||/[\0\r\n]/.test(value.secrets[ref]))
      ||r.ca!==undefined&&(typeof r.ca!=='string'||r.ca.length>32768))throw bad();
    ids.add(r.id);
    if(r.kind==='OIDC'){
      const url=new URL(r.origin);
      if(url.origin!==r.origin||url.protocol!=='https:'||typeof r.issuerPrefix!=='string'||r.issuerPrefix.length>1024||!/^\/(?:[A-Za-z0-9._~-]+\/?)*$/.test(r.issuerPrefix)||r.issuerPrefix.split('/').some(s=>s==='.'||s==='..'))throw bad();
    }else if(typeof r.host!=='string'||r.host.length>253||isIP(r.host)||!r.host.split('.').every(s=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(s))||r.transport!=='LDAPS'||r.port!==636
      ||!Array.isArray(r.baseDNs)||!r.baseDNs.length||r.baseDNs.some(x=>typeof x!=='string'||!x||x.length>512)
      ||!Array.isArray(r.bindDNs)||!r.bindDNs.length||r.bindDNs.some(x=>typeof x!=='string'||!x||x.length>512))throw bad();
  }
  return value;
}
export async function readIdentityRuntime(file) {
  const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const st=await h.stat();if(!st.isFile()||![0,process.getuid?.()].includes(st.uid)||(st.mode&0o077)||st.nlink!==1||st.size>131072)throw bad();
    return validateIdentityRuntime(JSON.parse((await h.readFile()).toString('utf8')));
  }finally{await h.close();}
}
export function publicRoutes(runtime){return (runtime?.routes??[]).map(({id,kind,name,origin,issuerPrefix,host,port,transport,secretRefs,baseDNs,bindDNs})=>({id,kind,name:name??id,issuerOrigin:origin,issuerPrefix,host,port,transport,secretRefs,baseDNs,bindDNs}));}
export function validateProviderConfig(runtime,kind,c) {
  if(!c||typeof c!=='object'||Array.isArray(c))return false;
  const r=runtime?.routes.find(r=>r.id===c.routeId&&r.kind===kind);if(!r)return false;
  if(kind==='OIDC'){
    if(Object.keys(c).sort().join(',')!=='clientId,clientSecretRef,issuer,routeId'||typeof c.clientId!=='string'||!c.clientId.trim()||c.clientId.length>200||/[\u0000-\u001f\u007f]/.test(c.clientId)||typeof c.issuer!=='string'||c.issuer.length>2048||!r.secretRefs.includes(c.clientSecretRef))return false;
    try{const u=new URL(c.issuer),prefix=r.issuerPrefix.replace(/\/$/,'');return u.protocol==='https:'&&u.origin===r.origin&&!u.search&&!u.hash&&!u.username&&!u.password&&(u.pathname===prefix||u.pathname.startsWith(prefix+'/'))&&u.href.replace(/\/$/,'')===c.issuer.replace(/\/$/,'');}catch{return false;}
  }
  return kind==='LDAP'&&Object.keys(c).sort().join(',')==='baseDN,bindDN,bindSecretRef,loginAttribute,routeId,subjectAttribute'
    &&r.baseDNs.includes(c.baseDN)&&r.bindDNs.includes(c.bindDN)&&r.secretRefs.includes(c.bindSecretRef)
    &&['uid','sAMAccountName','userPrincipalName'].includes(c.loginAttribute)&&c.subjectAttribute==='entryUUID';
}
