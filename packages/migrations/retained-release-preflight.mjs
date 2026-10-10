import { MAX_RELEASE_BYTES, MAX_RELEASE_FILES } from '../../experiments/db-devops-wp0/parser-release.mjs';
import { MAX_INPUT_BYTES, MAX_STDOUT_BYTES } from '../../experiments/db-devops-wp0/parser-envelope.mjs';

const MAX_METADATA_BYTES = MAX_STDOUT_BYTES;
const MAX_RETAINED_JSON_BYTES = 6 * (MAX_RELEASE_BYTES + MAX_STDOUT_BYTES) + MAX_RELEASE_FILES * 1024;

/** Return only database-computed scalar facts for one scoped retained release.
 * Call while holding the caller's established project/plan/release locks. The
 * returned row deliberately contains no JSONB payload; load files only after
 * `valid` is true.
 */
/** @param {any} tx @param {{id:string,projectId?:string,organizationId:string,repositoryId?:string,folder?:string,parserProfile?:string,requestedPath?:string}} options */
export async function preflightRetainedRelease(tx, options) {
  const { id, projectId, organizationId, repositoryId, folder, parserProfile, requestedPath } = options;
  const row = (await tx`SELECT id,project_id,(validation_status='VALID') AS validation_valid,
    octet_length(id::text) AS id_bytes,octet_length(project_id::text) AS project_id_bytes,
    octet_length(organization_id::text) AS organization_id_bytes,octet_length(validation_status) AS validation_status_bytes,
    jsonb_typeof(files) AS files_type,
    CASE WHEN jsonb_typeof(files)='array' THEN jsonb_array_length(files) ELSE NULL END AS file_count,
    octet_length(files::text) AS files_bytes,
    (object_format IN ('sha1','sha256')) AS format_valid,(object_format='sha1') AS format_sha1,
    (commit_id ~ CASE WHEN object_format='sha1' THEN '^[a-f0-9]{40}$' WHEN object_format='sha256' THEN '^[a-f0-9]{64}$' ELSE '^$' END) AS commit_valid,
    char_length(commit_id) AS commit_chars,char_length(folder) AS folder_chars,octet_length(folder) AS folder_bytes,
    char_length(parser_profile) AS parser_profile_chars,octet_length(parser_profile) AS parser_profile_bytes,
    char_length(manifest_digest) AS manifest_chars,octet_length(manifest_digest) AS manifest_bytes,
    (manifest_digest ~ '^[a-f0-9]{64}$') AS manifest_valid,
    (folder ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$') AS folder_valid,
    char_length(repository_id) AS repository_id_chars,octet_length(repository_id) AS repository_id_bytes,
    (repository_id=${repositoryId ?? null} AND folder=${folder ?? null}) AS binding_matches,
    (${parserProfile ?? null}::text IS NULL OR parser_profile=${parserProfile ?? null}) AS parser_profile_matches,
    (SELECT COALESCE(sum(octet_length((CASE WHEN jsonb_typeof(item)='object' THEN item-'content' ELSE '{}'::jsonb END)::text)),0)::bigint
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)) AS metadata_bytes,
    (SELECT count(*)::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)
      WHERE COALESCE(jsonb_typeof(item),'')<>'object' OR COALESCE(jsonb_typeof(item->'path'),'')<>'string'
        OR COALESCE(jsonb_typeof(item->'version'),'')<>'string' OR COALESCE(jsonb_typeof(item->'content'),'')<>'string'
        OR COALESCE(jsonb_typeof(item->'sha256'),'')<>'string' OR COALESCE(item->>'sha256','') !~ '^[a-f0-9]{64}$'
        OR COALESCE(jsonb_typeof(item->'validationStatus'),'')<>'string' OR COALESCE(item->>'validationStatus','')<>'VALID'
        OR COALESCE(char_length(item->>'path'),0) NOT BETWEEN 1 AND ${MAX_INPUT_BYTES}
        OR COALESCE(char_length(item->>'version'),0) NOT BETWEEN 1 AND ${MAX_INPUT_BYTES}
        OR COALESCE(item->>'path','') !~ '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$'
        OR COALESCE(item->>'path','') ~ '(^|/)\\.{1,2}(/|$)'
        OR left(COALESCE(item->>'path',''),char_length(folder)+1)<>(folder || '/')
        OR COALESCE(item->>'version','') !~ '^([0-9]+)(\\.[0-9]+)*$'
        OR COALESCE((CASE WHEN jsonb_typeof(item->'bytes')='number' AND char_length(item->>'bytes') BETWEEN 1 AND 7
          AND item->>'bytes' ~ '^[0-9]{1,7}$' THEN (item->>'bytes')::integer END),0) NOT BETWEEN 1 AND ${MAX_INPUT_BYTES}
        OR COALESCE(octet_length(item->>'content'),0) NOT BETWEEN 1 AND ${MAX_INPUT_BYTES}
        OR NOT COALESCE(CASE WHEN jsonb_typeof(item->'statementCount')='null' THEN true
          WHEN jsonb_typeof(item->'statementCount')='number' THEN CASE
            WHEN char_length(item->>'statementCount') BETWEEN 1 AND 16 AND item->>'statementCount' ~ '^[0-9]{1,16}$'
              THEN (item->>'statementCount')::numeric <= 9007199254740991 ELSE false END ELSE false END,false)) AS invalid_files,
    (SELECT count(DISTINCT item->>'path')::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)) AS distinct_paths,
    (SELECT count(DISTINCT item->>'version')::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)) AS distinct_versions,
    (SELECT COALESCE(sum(octet_length(item->>'content')),0)::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)
      WHERE jsonb_typeof(item)='object' AND jsonb_typeof(item->'content')='string') AS content_bytes,
    ${requestedPath ?? null}::text AS requested_path,
    (SELECT count(*)::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)
      WHERE jsonb_typeof(item)='object' AND item->>'path'=${requestedPath ?? null}) AS requested_file_count,
    (SELECT CASE WHEN jsonb_typeof(item)='object' AND jsonb_typeof(item->'content')='string'
      THEN octet_length(item->>'content') ELSE NULL END
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)
      WHERE item->>'path'=${requestedPath ?? null} LIMIT 1) AS requested_file_bytes
    FROM sf_releases WHERE id=${id} AND organization_id=${organizationId}
      AND (${projectId ?? null}::uuid IS NULL OR project_id=${projectId ?? null}::uuid) FOR SHARE`)[0];
  if (!row) return { row: null, valid: false };
  const valid = row.validation_valid && row.files_type === 'array'
    && Number.isInteger(row.file_count) && row.file_count >= 1 && row.file_count <= MAX_RELEASE_FILES
    && Number.isInteger(row.files_bytes) && row.files_bytes <= MAX_RETAINED_JSON_BYTES
    && row.format_valid && row.commit_valid && row.commit_chars === (row.format_sha1 ? 40 : 64)
    && Number.isInteger(row.folder_chars) && row.folder_chars >= 1 && row.folder_chars <= 200
    && Number.isInteger(row.parser_profile_chars) && row.parser_profile_chars >= 1 && row.parser_profile_chars <= MAX_INPUT_BYTES
    && row.manifest_valid && row.manifest_chars === 64
    && row.folder_valid && Number.isInteger(row.repository_id_chars) && row.repository_id_chars >= 1 && row.repository_id_chars <= 200
    && row.validation_status_bytes <= 20
    && Number.isSafeInteger(Number(row.metadata_bytes)) && Number(row.metadata_bytes) >= 0
    && Number(row.metadata_bytes) + Number(row.folder_bytes) + Number(row.parser_profile_bytes)
      + Number(row.repository_id_bytes) + Number(row.commit_chars) + Number(row.manifest_bytes)
      + Number(row.id_bytes) + Number(row.project_id_bytes) + Number(row.organization_id_bytes)
      + Number(row.validation_status_bytes) + 2 + 2 * row.file_count <= MAX_METADATA_BYTES
    && row.invalid_files === 0 && row.distinct_paths === row.file_count && row.distinct_versions === row.file_count
    && Number.isSafeInteger(Number(row.content_bytes)) && Number(row.content_bytes) <= MAX_RELEASE_BYTES
    && Number(row.content_bytes) <= 16 * MAX_INPUT_BYTES
    && row.parser_profile_matches
    && (repositoryId == null || row.binding_matches)
    && (requestedPath == null || (row.requested_file_count === 1 && Number.isInteger(row.requested_file_bytes)
      && row.requested_file_bytes >= 1 && row.requested_file_bytes <= MAX_INPUT_BYTES));
  return { row, valid };
}
