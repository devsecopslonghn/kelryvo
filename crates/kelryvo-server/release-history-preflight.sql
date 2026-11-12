-- Historical diagnostics may be INVALID/UNAVAILABLE. This establishes allocation
-- bounds only; the caller must still verify source bytes and manifest identity.
SELECT to_jsonb(b) FROM (
  SELECT id,validation_status IN ('VALID','INVALID','UNAVAILABLE') AS status_valid,
    octet_length(validation_status)<=20 AS status_bounded,
    octet_length(repository_id) BETWEEN 1 AND 200 AS repository_valid,
    octet_length(commit_id) BETWEEN 1 AND 128 AS commit_valid,
    object_format IN ('sha1','sha256') AS format_valid,
    octet_length(folder) BETWEEN 1 AND 200 AS folder_valid,
    octet_length(manifest_digest) BETWEEN 1 AND 128 AS manifest_valid,
    parser_profile IS NULL OR octet_length(parser_profile) BETWEEN 1 AND 2097152 AS profile_valid,
    validation_code IS NULL OR (octet_length(validation_code)<=4194304 AND validation_code !~ '[[:cntrl:]]') AS code_valid,
    isfinite(created_at) AND extract(epoch FROM created_at) BETWEEN -8640000000000 AND 8640000000000 AS created_at_valid,
    octet_length(jsonb_build_object('id',id,'projectId',project_id,'organizationId',organization_id,
      'repositoryId',repository_id,'commit',commit_id,'objectFormat',object_format,'folder',folder,
      'manifestDigest',manifest_digest,'validationStatus',validation_status,'validationCode',validation_code,
      'parserProfile',parser_profile,'createdAt',created_at)::text) AS identity_bytes,
    jsonb_typeof(files)='array' AS files_array,
    CASE WHEN jsonb_typeof(files)='array' THEN jsonb_array_length(files) ELSE 0 END AS file_count,
    octet_length(files::text) AS payload_bytes,
    (SELECT COALESCE(sum(octet_length((CASE WHEN jsonb_typeof(f)='object' THEN jsonb_set(f,'{content}','""'::jsonb) ELSE '{}'::jsonb END)::text)),0)::bigint
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(f)) AS metadata_bytes,
    (SELECT COALESCE(sum(octet_length(f->>'content')),0)::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(f)
      WHERE jsonb_typeof(f)='object' AND jsonb_typeof(f->'content')='string') AS content_bytes,
    (SELECT count(*)::integer FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(f)
      WHERE jsonb_typeof(f)<>'object' OR COALESCE(jsonb_typeof(f->'path'),'')<>'string'
        OR COALESCE(jsonb_typeof(f->'version'),'')<>'string' OR COALESCE(jsonb_typeof(f->'sha256'),'')<>'string'
        OR COALESCE(octet_length(f->>'path'),0) NOT BETWEEN 1 AND 2097152
        OR COALESCE(octet_length(f->>'version'),0) NOT BETWEEN 1 AND 2097152
        OR COALESCE(f->>'sha256','') !~ '^[a-f0-9]{64}$'
        OR NOT COALESCE(CASE WHEN jsonb_typeof(f->'bytes')='number' AND f->>'bytes' ~ '^[0-9]{1,7}$' THEN (f->>'bytes')::integer BETWEEN 1 AND 2097152 ELSE false END,false)
        OR NOT COALESCE(CASE WHEN jsonb_typeof(f->'statementCount')='null' THEN true
          WHEN jsonb_typeof(f->'statementCount')='number' AND f->>'statementCount' ~ '^[0-9]{1,16}$' THEN (f->>'statementCount')::numeric<=9007199254740991 ELSE false END,false)
        OR COALESCE(jsonb_typeof(f->'validationStatus'),'') NOT IN ('string','null')
        OR COALESCE(f->>'validationStatus','NOT_VALIDATED') NOT IN ('VALID','INVALID','UNAVAILABLE','NOT_VALIDATED')
        OR COALESCE(jsonb_typeof(f->'content'),'')<>'string'
        OR COALESCE(octet_length(f->>'content'),0) NOT BETWEEN 1 AND 2097152) AS invalid_files,
    (SELECT count(DISTINCT f->>'path')::integer FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(f)) AS distinct_paths
  FROM sf_releases WHERE id=$1 AND project_id=$2 AND organization_id=$3 FOR SHARE
) b
