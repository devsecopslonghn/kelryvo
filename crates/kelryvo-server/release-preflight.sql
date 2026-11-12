-- Scalar allocation and identity checks before materializing a retained release.
-- Keep the release share lock through its complete snapshot verification.
SELECT to_jsonb(bounds) FROM (
  SELECT id, validation_status='VALID' AS validation_valid,
    char_length(repository_id) BETWEEN 1 AND 200 AS repository_valid,
    octet_length(folder) BETWEEN 1 AND 200 AS folder_valid,
    char_length(parser_profile) BETWEEN 1 AND 2097152 AS profile_valid,
    octet_length(commit_id) BETWEEN 1 AND 128 AS commit_valid,
    octet_length(manifest_digest)=64 AS manifest_valid,
    isfinite(created_at) AS created_at_valid,
    jsonb_typeof(files)='array' AS files_array,
    CASE WHEN jsonb_typeof(files)='array' THEN jsonb_array_length(files) ELSE 0 END AS file_count,
    octet_length(files::text) AS payload_bytes,
    octet_length(repository_id)+octet_length(folder)+COALESCE(octet_length(parser_profile),0)
      +octet_length(commit_id)+octet_length(manifest_digest)+octet_length(validation_status)+108 AS identity_bytes,
    (SELECT COALESCE(sum(octet_length((CASE WHEN jsonb_typeof(f)='object' THEN f-'content' ELSE '{}'::jsonb END)::text)),0)::bigint
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(f)) AS metadata_bytes,
    (SELECT COALESCE(sum(octet_length(f->>'content')),0)::bigint
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(f)
      WHERE jsonb_typeof(f->'content')='string') AS content_bytes,
    (SELECT count(*)::integer
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(f)
      WHERE jsonb_typeof(f)<>'object'
        OR COALESCE(jsonb_typeof(f->'path'),'')<>'string'
        OR COALESCE(jsonb_typeof(f->'version'),'')<>'string'
        OR COALESCE(jsonb_typeof(f->'content'),'')<>'string'
        OR COALESCE(jsonb_typeof(f->'sha256'),'')<>'string'
        OR COALESCE(jsonb_typeof(f->'validationStatus'),'')<>'string'
        OR COALESCE(f->>'validationStatus','')<>'VALID'
        OR COALESCE(octet_length(f->>'path'),0) NOT BETWEEN 1 AND 2097152
        OR COALESCE(octet_length(f->>'version'),0) NOT BETWEEN 1 AND 2097152
        OR COALESCE(octet_length(f->>'content'),0) NOT BETWEEN 1 AND 2097152
        OR COALESCE(f->>'sha256','') !~ '^[a-f0-9]{64}$'
        OR NOT COALESCE(CASE WHEN jsonb_typeof(f->'bytes')='number' AND f->>'bytes' ~ '^[0-9]{1,7}$'
          THEN (f->>'bytes')::integer BETWEEN 1 AND 2097152 ELSE false END,false)
        OR NOT COALESCE(CASE WHEN jsonb_typeof(f->'statementCount')='null' THEN true
          WHEN jsonb_typeof(f->'statementCount')='number' AND f->>'statementCount' ~ '^[0-9]{1,16}$'
          THEN (f->>'statementCount')::numeric <= 9007199254740991 ELSE false END,false)) AS invalid_files
  FROM sf_releases WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR SHARE
) bounds
