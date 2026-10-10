export const ORG = '00000000-0000-4000-8000-000000000001';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (code = 'INVALID_DECLARATION') => Object.assign(new Error(code), { code });
const operatorUid = () => process.geteuid?.() ?? process.getuid();

export function validateReferenceDeclaration(input) {
  const keys = [
    'databaseKey', 'databaseLabel', 'containerKey', 'containerName', 'containerKind',
    'environment', 'host', 'port', 'service', 'transport', 'owner',
  ];
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).sort().join(',') !== keys.sort().join(',')) throw fail();

  const bounded = (value, limit = 128) => typeof value === 'string'
    && value.length > 0 && value.length <= limit
    && !/[\u0000-\u001f\u007f]/.test(value)
    && Buffer.from(value, 'utf8').toString('utf8') === value;
  if (![input.databaseKey, input.containerKey].every(value => bounded(value, 100)
      && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value))
      || !bounded(input.databaseLabel, 120)
      || !bounded(input.containerName, 120)
      || !['PDB', 'NON_CDB'].includes(input.containerKind)
      || !['DEV', 'SIT', 'UAT', 'PROD'].includes(input.environment)
      || !['TCP', 'TCPS'].includes(input.transport)
      || typeof input.host !== 'string'
      || input.host.length > 253
      || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?|\[[0-9A-Fa-f:]+\])$/.test(input.host)
      || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535
      || !/^[A-Za-z0-9_$#.-]{1,128}$/.test(input.service)
      || typeof input.owner !== 'string' || !input.owner.trim()
      || [...input.owner].length > 128 || /[\u0000-\u001f\u007f]/.test(input.owner)
      || Buffer.from(input.owner, 'utf8').toString('utf8') !== input.owner) throw fail();

  return { ...input, host: input.host.toLowerCase() };
}

export async function declareReference(sql, raw) {
  const declaration = validateReferenceDeclaration(raw);
  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${ORG}, 31))`;

    let database = (await tx`SELECT * FROM sf_reference_databases
      WHERE organization_id=${ORG} AND operator_key=${declaration.databaseKey} FOR UPDATE`)[0];
    const databaseAdded = !database;
    if (!database) {
      database = (await tx`INSERT INTO sf_reference_databases(organization_id,operator_key,display_label)
        VALUES(${ORG},${declaration.databaseKey},${declaration.databaseLabel}) RETURNING *`)[0];
    } else if (database.display_label !== declaration.databaseLabel) {
      throw fail('IMMUTABLE_FACT_CONFLICT');
    }

    const siblings = await tx`SELECT * FROM sf_reference_containers
      WHERE database_id=${database.id} ORDER BY id FOR UPDATE`;
    if (siblings.some(row => row.kind !== declaration.containerKind)
        || (declaration.containerKind === 'NON_CDB'
          && siblings.some(row => row.registration_key !== declaration.containerKey))) {
      throw fail('CONTAINER_KIND_CONFLICT');
    }
    let container = siblings.find(row => row.registration_key === declaration.containerKey);
    const containerAdded = !container;
    if (!container) {
      container = (await tx`INSERT INTO sf_reference_containers(
          organization_id,database_id,registration_key,name,kind,environment)
        VALUES(${ORG},${database.id},${declaration.containerKey},${declaration.containerName},
          ${declaration.containerKind},${declaration.environment}) RETURNING *`)[0];
    } else if (container.name !== declaration.containerName
        || container.kind !== declaration.containerKind
        || container.environment !== declaration.environment) {
      throw fail('IMMUTABLE_FACT_CONFLICT');
    }

    const route = (await tx`SELECT * FROM sf_reference_services
      WHERE organization_id=${ORG} AND host=${declaration.host} AND port=${declaration.port}
        AND service=${declaration.service} AND transport=${declaration.transport} FOR UPDATE`)[0];
    if (route && route.container_id !== container.id) throw fail('ROUTE_CONTAINER_CONFLICT');
    const service = route || (await tx`INSERT INTO sf_reference_services(
        organization_id,container_id,host,port,service,transport)
      VALUES(${ORG},${container.id},${declaration.host},${declaration.port},
        ${declaration.service},${declaration.transport}) RETURNING *`)[0];

    let schema = (await tx`SELECT * FROM sf_reference_schemas
      WHERE container_id=${container.id} AND exact_owner=${declaration.owner} AND generation=1 FOR UPDATE`)[0];
    const schemaAdded = !schema;
    if (!schema) {
      schema = (await tx`INSERT INTO sf_reference_schemas(organization_id,container_id,exact_owner)
        VALUES(${ORG},${container.id},${declaration.owner}) RETURNING *`)[0];
    }
    if (databaseAdded || containerAdded || !route || schemaAdded) {
      await tx`INSERT INTO sf_reference_operator_audit(
          organization_id,schema_id,action,operator_os_uid,facts)
        VALUES(${ORG},${schema.id},'REGISTER',${operatorUid()},${tx.json({
          databaseId: database.id,
          containerId: container.id,
          serviceId: service.id,
          schemaId: schema.id,
          provenance: 'MANUAL_REFERENCE',
          generation: 1,
        })})`;
    }

    return {
      databaseId: database.id,
      databaseServerId: database.server_uuid,
      containerId: container.id,
      containerServerId: container.server_uuid,
      serviceId: service.id,
      schemaId: schema.id,
      generation: 1,
      provenance: 'MANUAL_REFERENCE',
    };
  });
}

export async function assignReference(sql, { schemaId, projectId, expectedRevision, reason }) {
  if (!uuid.test(schemaId)
      || (projectId !== null && !uuid.test(projectId))
      || typeof expectedRevision !== 'string'
      || !/^(0|[1-9][0-9]{0,18})$/.test(expectedRevision)
      || BigInt(expectedRevision) > 9223372036854775807n
      || typeof reason !== 'string' || !reason.trim() || reason.length > 500
      || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)
      || Buffer.from(reason, 'utf8').toString('utf8') !== reason) throw fail();

  return sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${schemaId}, 29))`;
    const schema = (await tx`SELECT *,revision::text AS revision_text
      FROM sf_reference_schemas WHERE id=${schemaId} AND organization_id=${ORG} FOR UPDATE`)[0];
    if (!schema) throw fail('NOT_FOUND');
    if (schema.revision_text !== expectedRevision) throw fail('STALE_REVISION');

    const current = (await tx`SELECT * FROM sf_reference_assignments
      WHERE schema_id=${schemaId} AND closed_at IS NULL FOR UPDATE`)[0];
    let target;
    if (projectId !== null) {
      target = (await tx`SELECT id FROM sf_projects
        WHERE id=${projectId} AND organization_id=${ORG} AND archived_at IS NULL FOR UPDATE`)[0];
      if (!target) throw fail('INVALID_PROJECT');
    }
    if (current?.project_id === projectId || (!current && projectId === null)) {
      return { revision: expectedRevision, changed: false };
    }
    if (schema.revision_text === '9223372036854775807') throw fail('REVISION_EXHAUSTED');

    if (current) {
      await tx`UPDATE sf_reference_assignments SET closed_at=clock_timestamp() WHERE id=${current.id}`;
    }
    if (target) {
      await tx`INSERT INTO sf_reference_assignments(
          organization_id,schema_id,project_id,reason,operator_os_uid)
        VALUES(${ORG},${schemaId},${projectId},${reason},${operatorUid()})`;
    }
    const action = current ? (target ? 'TRANSFER' : 'RELEASE') : 'ASSIGN';
    const revision = (BigInt(expectedRevision) + 1n).toString();
    await tx`UPDATE sf_reference_schemas SET revision=${revision}::bigint WHERE id=${schemaId}`;
    await tx`INSERT INTO sf_reference_operator_audit(
        organization_id,schema_id,action,operator_os_uid,facts)
      VALUES(${ORG},${schemaId},${action},${operatorUid()},${tx.json({
        fromProjectId: current?.project_id ?? null,
        toProjectId: projectId,
        revision,
        reason,
      })})`;
    return { revision, changed: true, action };
  });
}
