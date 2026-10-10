import path from 'node:path';
import { parseArgs } from 'node:util';
import postgres from 'postgres';
import { initializeDatabase } from '../packages/database/index.ts';
import {
  ORG,
  assignReference,
  declareReference,
  validateReferenceDeclaration,
} from '../packages/catalog-reference/index.mjs';
import { authorizeLocalMetadataUrl } from './local-operator-config.mjs';

const fail = () => new Error('Local inventory operation failed; inspect private local state and retry.');
const uuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const declarationKeys = [
  'databaseKey', 'databaseLabel', 'containerKey', 'containerName', 'containerKind',
  'environment', 'host', 'port', 'service', 'transport', 'owner',
];

function validate(action, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw fail();
  const allowed = action === 'declare'
    ? ['config', ...declarationKeys]
    : action === 'assign'
      ? ['config', 'schemaId', 'projectId', 'expectedRevision', 'reason']
      : action === 'release'
        ? ['config', 'schemaId', 'expectedRevision', 'reason']
        : action === 'status' ? ['config'] : null;
  if (!allowed || Object.keys(values).some(key => !allowed.includes(key))
      || allowed.filter(key => key !== 'config').some(key => !Object.hasOwn(values, key))) throw fail();

  if (action === 'declare') {
    if (typeof values.port !== 'string' || !/^[1-9][0-9]{0,4}$/.test(values.port)) throw fail();
    validateReferenceDeclaration({
      ...Object.fromEntries(declarationKeys.map(key => [key, values[key]])),
      port: Number(values.port),
    });
  }
  if (action === 'assign' || action === 'release') {
    if (!uuid(values.schemaId)
        || (action === 'assign' && !uuid(values.projectId))
        || typeof values.expectedRevision !== 'string'
        || !/^(0|[1-9][0-9]{0,18})$/.test(values.expectedRevision)
        || BigInt(values.expectedRevision) > 9223372036854775807n
        || typeof values.reason !== 'string' || !values.reason.trim() || values.reason.length > 500
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(values.reason)
        || Buffer.from(values.reason, 'utf8').toString('utf8') !== values.reason) throw fail();
  }
}

export async function operateLocalInventory({ action, values, configPath, databaseUrl }) {
  validate(action, values);
  if (values.config && configPath && values.config !== configPath) throw fail();
  configPath = configPath || values.config;
  await authorizeLocalMetadataUrl(configPath, databaseUrl);

  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 3, onnotice: () => {} });
  try {
    await initializeDatabase(sql);
    if (action === 'declare') {
      const declaration = Object.fromEntries(declarationKeys.map(key => [key, values[key]]));
      return await declareReference(sql, { ...declaration, port: Number(values.port) });
    }
    if (action === 'assign' || action === 'release') {
      return await assignReference(sql, {
        schemaId: values.schemaId,
        projectId: action === 'release' ? null : values.projectId,
        expectedRevision: values.expectedRevision,
        reason: values.reason,
      });
    }
    return await sql`SELECT d.id AS database_id,d.operator_key,d.display_label,d.server_uuid,
        c.id AS container_id,c.name,c.kind,c.environment,s.id AS service_id,s.host,s.port,s.service,s.transport,
        r.id AS schema_id,r.exact_owner,r.revision::text,r.generation,
        p.id AS current_project_id,p.name AS current_project_name,a.id AS assignment_id
      FROM sf_reference_databases d
      LEFT JOIN sf_reference_containers c ON c.database_id=d.id
      LEFT JOIN sf_reference_services s ON s.container_id=c.id
      LEFT JOIN sf_reference_schemas r ON r.container_id=c.id
      LEFT JOIN sf_reference_assignments a ON a.schema_id=r.id AND a.closed_at IS NULL
      LEFT JOIN sf_projects p ON p.id=a.project_id
      WHERE d.organization_id=${ORG} ORDER BY d.id,c.id,s.id,r.id`;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    const [action, ...args] = process.argv.slice(2);
    const options = Object.fromEntries([
      'config', ...declarationKeys, 'schemaId', 'projectId', 'expectedRevision', 'reason',
    ].map(name => [name, { type: 'string' }]));
    const parsed = parseArgs({ args, options, strict: true, allowPositionals: false, tokens: true });
    const seen = new Set();
    for (const token of parsed.tokens) {
      if (token.kind !== 'option') continue;
      if (seen.has(token.name)) throw fail();
      seen.add(token.name);
    }
    validate(action, parsed.values);
    const result = await operateLocalInventory({
      action,
      values: parsed.values,
      databaseUrl: process.env.SCHEMAFORGE_LOCAL_DATABASE_URL,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch {
    process.stderr.write('Local inventory operation failed.\n');
    process.exitCode = 1;
  }
}
