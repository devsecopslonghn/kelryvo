import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, chmod, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} failed: ${(result.stderr || result.stdout || '').slice(0, 1500)}`);
  return result.stdout.trim();
};
const freePort = async () => {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
};
const waitFor = async (check, timeout = 120_000) => {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try { if (await check()) return; } catch (error) { last = error; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error(`Disposable provider did not become ready${last ? `: ${String(last.message).slice(0, 300)}` : ''}`);
};
const docker = (...args) => run('docker', args, { maxBuffer: 4 * 1024 * 1024 });

export async function createIdentityProviderLab({ includeOidc = true } = {}) {
  docker('info');
  const root = await mkdtemp(path.join(tmpdir(), 'kelryvo-identity-integration-'));
  const certDir = path.join(root, 'tls');
  await mkdir(certDir);
  await chmod(certDir, 0o777);
  const cert = path.join(certDir, 'tls.crt'), key = path.join(certDir, 'tls.key');
  run('openssl', ['req', '-x509', '-nodes', '-newkey', 'rsa:2048', '-days', '2', '-keyout', key, '-out', cert,
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1']);
  run('openssl', ['genpkey', '-genparam', '-algorithm', 'DH', '-pkeyopt', 'group:ffdhe2048', '-out', path.join(certDir, 'dhparam.pem')]);
  await chmod(key, 0o644);
  const keycloakCertDir = path.join(root, 'keycloak-tls');
  await mkdir(keycloakCertDir);
  await copyFile(cert, path.join(keycloakCertDir, 'tls.crt'));
  await copyFile(key, path.join(keycloakCertDir, 'tls.key'));
  await chmod(path.join(keycloakCertDir, 'tls.key'), 0o644);
  const containers = [];
  const name = prefix => `kelryvo-identity-${prefix}-${randomUUID().slice(0, 8)}`;
  try {
    const ldapName = name('ldap');
    docker('run', '-d', '--name', ldapName, '-p', '127.0.0.1::636',
      '-e', 'LDAP_ORGANISATION=Kelryvo Test', '-e', 'LDAP_DOMAIN=example.test', '-e', 'LDAP_ADMIN_PASSWORD=integration-only-secret',
      '-e', 'LDAP_TLS=true', '-e', 'LDAP_TLS_CRT_FILENAME=tls.crt', '-e', 'LDAP_TLS_KEY_FILENAME=tls.key',
      '-e', 'LDAP_TLS_CA_CRT_FILENAME=tls.crt', '-e', 'LDAP_TLS_VERIFY_CLIENT=never',
      '-e', 'LDAP_TLS_DH_PARAM_FILENAME=dhparam.pem',
      '-v', `${certDir}:/container/service/slapd/assets/certs`,
      'osixia/openldap:1.5.0@sha256:18742e9c449c9c1afe129d3f2f3ee15fb34cc43e5f940a20f3399728f41d7c28');
    containers.push(ldapName);
    const ldapPort = docker('port', ldapName, '636/tcp').split(':').at(-1);
    const ldapBase = 'dc=example,dc=test';
    const ldif = path.join(root, 'identities.ldif');
    await writeFile(ldif, [
      `dn: ou=people,${ldapBase}`, 'objectClass: organizationalUnit', 'ou: people', '',
      `dn: ou=groups,${ldapBase}`, 'objectClass: organizationalUnit', 'ou: groups', '',
      `dn: ou=contractors,${ldapBase}`, 'objectClass: organizationalUnit', 'ou: contractors', '',
      `dn: uid=alice,ou=people,${ldapBase}`, 'objectClass: inetOrgPerson', 'objectClass: posixAccount',
      'cn: Alice Example', 'sn: Example', 'uid: alice', 'uidNumber: 10001', 'gidNumber: 10001', 'homeDirectory: /home/alice',
      `memberOf: cn=release-approvers,ou=groups,${ldapBase}`, 'userPassword: alice-integration-password', '',
      `dn: cn=release-approvers,ou=groups,${ldapBase}`, 'objectClass: groupOfNames', 'cn: release-approvers',
      `member: uid=alice,ou=people,${ldapBase}`, '',
      `dn: cn=alice-duplicate,ou=contractors,${ldapBase}`, 'objectClass: inetOrgPerson', 'cn: Alice Duplicate', 'sn: Duplicate',
      'uid: alice', 'userPassword: duplicate-integration-password', '',
    ].join('\n'));
    await waitFor(() => docker('exec', ldapName, 'ldapwhoami', '-x', '-H', 'ldaps://localhost',
      '-D', `cn=admin,${ldapBase}`, '-w', 'integration-only-secret').includes('dn:'));
    docker('cp', ldif, `${ldapName}:/tmp/identities.ldif`);
    docker('exec', ldapName, 'ldapadd', '-x', '-H', 'ldaps://localhost', '-D', `cn=admin,${ldapBase}`,
      '-w', 'integration-only-secret', '-f', '/tmp/identities.ldif');
    const duplicateLdif = path.join(root, 'duplicate.ldif');
    await writeFile(duplicateLdif, [`dn: cn=alice-second,ou=people,${ldapBase}`, 'objectClass: inetOrgPerson',
      'cn: Alice Second', 'sn: Second', 'uid: alice', 'userPassword: second-integration-password', ''].join('\n'));

    let keycloakPort, issuer, callback;
    const applicationPort=await freePort();
    if (includeOidc) {
    keycloakPort = await freePort();
    const realmPath = path.join(root, 'kelryvo-test-realm.json');
    issuer = `https://localhost:${keycloakPort}/realms/kelryvo-test`;
    callback = `https://localhost:${keycloakPort}/api/auth/oidc/main/callback`;
    const realm = {
      realm: 'kelryvo-test', enabled: true, sslRequired: 'none', registrationAllowed: false,
      clients: [{ clientId: 'kelryvo-integration', name: 'Kelryvo integration fixture', enabled: true,
        protocol: 'openid-connect', publicClient: false, secret: 'oidc-integration-only-secret', standardFlowEnabled: true,
        directAccessGrantsEnabled: false, redirectUris: [callback,`https://localhost:${applicationPort}/*`], webOrigins: [`https://localhost:${keycloakPort}`],
        defaultClientScopes: ['profile', 'email'], protocolMappers: [{ name: 'groups', protocol: 'openid-connect',
          protocolMapper: 'oidc-group-membership-mapper', consentRequired: false,
          config: { 'full.path': 'false', 'id.token.claim': 'true', 'access.token.claim': 'false',
            'userinfo.token.claim': 'true', 'claim.name': 'groups' } }] }],
      groups: [{ name: 'release-approvers', path: '/release-approvers' }],
      users: [{ username: 'oidc-alice', enabled: true, email: 'oidc-alice@example.test', emailVerified: true,
        firstName: 'Alice', lastName: 'OIDC', requiredActions: [],
        groups: ['/release-approvers'], credentials: [{ type: 'password', value: 'oidc-alice-integration-password', temporary: false }] }],
    };
    await writeFile(realmPath, JSON.stringify(realm));
    const keycloakName = name('oidc');
    docker('run', '-d', '--name', keycloakName, '-p', `127.0.0.1:${keycloakPort}:8443`,
      '-e', 'KC_BOOTSTRAP_ADMIN_USERNAME=admin', '-e', 'KC_BOOTSTRAP_ADMIN_PASSWORD=integration-admin-only',
      '-e', `KC_HOSTNAME=https://localhost:${keycloakPort}`, '-e', 'KC_HOSTNAME_STRICT=false', '-e', 'KC_HTTP_ENABLED=false',
      '-v', `${keycloakCertDir}:/opt/keycloak/conf/tls:ro`, '-v', `${realmPath}:/opt/keycloak/data/import/kelryvo-test-realm.json:ro`,
      'quay.io/keycloak/keycloak:26.3.3@sha256:6a7217a100bd3e5de4063a27a538ef999a3c5a88c4b4ec0ffc0a642aee7b2597', 'start-dev', '--https-certificate-file=/opt/keycloak/conf/tls/tls.crt',
      '--https-certificate-key-file=/opt/keycloak/conf/tls/tls.key', '--https-port=8443', '--import-realm');
    containers.push(keycloakName);
    await waitFor(async () => {
      const result = spawnSync('curl', ['--silent', '--show-error', '--fail', '--cacert',path.join(keycloakCertDir,'tls.crt'), `${issuer}/.well-known/openid-configuration`], { encoding: 'utf8' });
      return result.status === 0 && JSON.parse(result.stdout).issuer === issuer;
    }, 180_000);
    }
    return { root, cert:path.join(keycloakCertDir,'tls.crt'), key:path.join(keycloakCertDir,'tls.key'), ldapPort: Number(ldapPort), ldapBase, issuer, callback, keycloakPort, applicationPort,
      addAmbiguousLdapEntry: async () => {
        docker('cp', duplicateLdif, `${ldapName}:/tmp/duplicate.ldif`);
        docker('exec', ldapName, 'ldapadd', '-x', '-H', 'ldaps://localhost', '-D', `cn=admin,${ldapBase}`,
          '-w', 'integration-only-secret', '-f', '/tmp/duplicate.ldif');
      },
      cleanup: async () => {
        for (const container of containers.reverse()) {
          try { docker('rm', '-f', container); } catch { /* already removed */ }
        }
        await rm(root, { recursive: true, force: true });
      } };
  } catch (error) {
    for (const container of containers.reverse()) { try { docker('rm', '-f', container); } catch { /* best effort */ } }
    await rm(root, { recursive: true, force: true });
    throw error;
  }
}

export function runTrustedNode(caFile, source, timeout=30_000) {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    encoding: 'utf8', timeout, env: { ...process.env, NODE_EXTRA_CA_CERTS: caFile },
  });
  if (result.status !== 0) throw new Error(`Identity provider client failed: ${(result.stderr || result.stdout || '').slice(0, 2000)}`);
  return JSON.parse(result.stdout);
}
