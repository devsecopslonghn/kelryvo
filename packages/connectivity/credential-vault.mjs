import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { constants as cryptoConstants, createCipheriv, createDecipheriv, createHash, createPrivateKey, createPublicKey,
  publicEncrypt, privateDecrypt, randomBytes } from 'node:crypto';

const reject = () => Object.assign(new Error('Oracle credential vault unavailable'), {
  productCode: 'ORACLE_CREDENTIAL_VAULT_UNAVAILABLE', connectivityStatus: 503,
});
const uuid = v => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v);
const fields = ['organizationId', 'connectionId', 'credentialId', 'username', 'purpose', 'endpointDigest'];
function contextBytes(context) {
  if (!context || Object.keys(context).sort().join(',') !== [...fields].sort().join(',')
      || ![context.organizationId, context.connectionId, context.credentialId].every(uuid)
      || !/^[A-Za-z][A-Za-z0-9_$#]{0,127}$/.test(context.username ?? '')
      || !['INSTANCE_MASTER', 'DEPLOY', 'OBSERVER', 'LEDGER'].includes(context.purpose)
      || !/^[a-f0-9]{64}$/.test(context.endpointDigest ?? '')) throw reject();
  return Buffer.from(JSON.stringify(fields.map(k => [k, context[k]])));
}
export const validOraclePassword = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
  && Buffer.byteLength(value) <= 8192 && !/[\u0000\r\n]/.test(value) && Buffer.from(value).toString() === value;
export function oracleCredentialEndpointDigest(connection) {
  if (!connection || typeof connection.host !== 'string' || !Number.isInteger(connection.port)
      || typeof connection.service !== 'string' || !['TCP', 'TCPS'].includes(connection.transport)) throw reject();
  return createHash('sha256').update(JSON.stringify([connection.host, connection.port, connection.service, connection.transport])).digest('hex');
}
function publicKey(value) {
  if (!(typeof value === 'string' || Buffer.isBuffer(value)) || !value.toString().startsWith('-----BEGIN PUBLIC KEY-----')) throw reject();
  const key = createPublicKey(value);
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails.modulusLength < 3072
      || key.asymmetricKeyDetails.modulusLength > 8192) throw reject();
  return key;
}
export function oracleVaultKeyId(value) {
  return createHash('sha256').update(publicKey(value).export({ type: 'spki', format: 'der' })).digest('hex');
}

/** The API holds only this public key. Database backups contain authenticated
 * ciphertext; possession of metadata or API configuration cannot decrypt it. */
export async function readOracleVaultPublicKey() {
  const file = '/run/kelryvo/runtime/api/secrets/oracle-vault-public.pem';
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await handle.stat();
    if (!s.isFile() || s.uid !== process.getuid() || s.nlink !== 1 || (s.mode & 0o077)
        || s.size < 1 || s.size > 16384) throw reject();
    const bytes = await handle.readFile();
    publicKey(bytes);
    return bytes;
  } catch { throw reject(); }
  finally { await handle.close(); }
}
export function sealOracleCredential(password, context, publicPem) {
  let dataKey, plaintext;
  try {
    if (!validOraclePassword(password)) throw reject();
    const aad = contextBytes(context), key = publicKey(publicPem), nonce = randomBytes(12);
    dataKey = randomBytes(32); plaintext = Buffer.from(password);
    const cipher = createCipheriv('aes-256-gcm', dataKey, nonce); cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const wrappedKey = publicEncrypt({ key, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256', oaepLabel: aad }, dataKey);
    return { format: 1, keyId: oracleVaultKeyId(publicPem), wrappedKey: wrappedKey.toString('base64'),
      nonce: nonce.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  } catch { throw reject(); }
  finally { dataKey?.fill(0); plaintext?.fill(0); }
}
/** Privileged runtime only. Never register a decrypt/read-secret API. */
export function openOracleCredential(envelope, context, privatePem) {
  let dataKey, plaintext;
  try {
    if (!envelope || Object.keys(envelope).sort().join(',') !== 'ciphertext,format,keyId,nonce,tag,wrappedKey'
        || envelope.format !== 1) throw reject();
    const key = createPrivateKey(privatePem), publicPem = createPublicKey(key).export({ type: 'spki', format: 'pem' });
    if (oracleVaultKeyId(publicPem) !== envelope.keyId) throw reject();
    const decode = (value, min, max) => {
      if (typeof value !== 'string' || value.length > max * 2) throw reject();
      const bytes = Buffer.from(value, 'base64');
      if (bytes.length < min || bytes.length > max || bytes.toString('base64') !== value) throw reject();
      return bytes;
    };
    const aad = contextBytes(context);
    dataKey = privateDecrypt({ key, padding: cryptoConstants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256', oaepLabel: aad }, decode(envelope.wrappedKey, 384, 1024));
    if (dataKey.length !== 32) throw reject();
    const decipher = createDecipheriv('aes-256-gcm', dataKey, decode(envelope.nonce, 12, 12));
    decipher.setAAD(aad); decipher.setAuthTag(decode(envelope.tag, 16, 16));
    plaintext = Buffer.concat([decipher.update(decode(envelope.ciphertext, 1, 8192)), decipher.final()]);
    const password = plaintext.toString();
    if (!validOraclePassword(password) || !Buffer.from(password).equals(plaintext)) throw reject();
    return password;
  } catch { throw reject(); }
  finally { dataKey?.fill(0); plaintext?.fill(0); }
}

/** A private runtime must resolve against the current connection, not a request's
 * supplied ciphertext/reference. Rotation and revocation are checked on each use. */
export async function resolveManagedOracleCredential(sql, expected, privatePem) {
  try {
    const id = /^vault:\/\/kelryvo\/([a-f0-9-]{36})$/.exec(expected?.credentialRef ?? '')?.[1];
    if (!uuid(id) || !uuid(expected?.id) || !uuid(expected?.organizationId)) throw reject();
    const row = (await sql`SELECT v.* FROM sf_oracle_credentials v
      JOIN sf_database_connections c ON c.id=v.connection_id AND c.organization_id=v.organization_id
      JOIN sf_metadata_current mc ON mc.singleton
      JOIN sf_metadata_generations mg ON mg.id=mc.generation_id AND mg.state='ACTIVE'
      WHERE v.id=${id} AND c.id=${expected.id} AND c.organization_id=${expected.organizationId}
        AND c.credential_ref=${expected.credentialRef} AND c.username=${expected.username}
        AND c.host=${expected.host} AND c.port=${expected.port} AND c.service=${expected.service}
        AND c.transport=${expected.transport} AND c.revision::text=${String(expected.revision)}
        AND c.credential_mode='INSTANCE_MASTER' AND c.service_kind='SERVICE_NAME'
        AND c.enabled AND c.retired_at IS NULL AND v.purpose='INSTANCE_MASTER' AND v.username=c.username
        AND NOT EXISTS(SELECT 1 FROM sf_oracle_credential_revocations r WHERE r.credential_id=v.id)`)[0];
    if (!row || row.key_id !== row.envelope?.keyId || row.endpoint_digest !== oracleCredentialEndpointDigest(expected)) throw reject();
    return openOracleCredential(row.envelope, { organizationId: row.organization_id, connectionId: row.connection_id,
      credentialId: row.id, username: row.username, purpose: row.purpose, endpointDigest: row.endpoint_digest }, privatePem);
  } catch { throw reject(); }
}
