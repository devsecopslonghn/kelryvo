-- Match the retained pair preflight before materializing either source payload.
SELECT to_jsonb(bounds) FROM (
SELECT id,project_id,(validation_status='VALID') AS validation_valid,
          jsonb_typeof(files) AS files_type,
          CASE WHEN jsonb_typeof(files)='array' THEN jsonb_array_length(files) ELSE NULL END AS file_count,
          octet_length(files::text) AS files_bytes,
          (object_format IN ('sha1','sha256')) AS format_valid,(object_format='sha1') AS format_sha1,
          (commit_id ~ CASE WHEN object_format='sha1' THEN '^[a-f0-9]{40}$' WHEN object_format='sha256' THEN '^[a-f0-9]{64}$' ELSE '^$' END) AS commit_valid,
          char_length(commit_id) AS commit_chars,char_length(folder) AS folder_chars,octet_length(folder) AS folder_bytes,
          char_length(parser_profile) AS parser_profile_chars,octet_length(parser_profile) AS parser_profile_bytes,
          char_length(manifest_digest) AS manifest_chars,
          (folder ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$') AS folder_valid,
          (manifest_digest ~ '^[a-f0-9]{64}$') AS manifest_valid,
          char_length(repository_id) AS repository_id_chars,octet_length(repository_id) AS repository_id_bytes,
          (SELECT count(DISTINCT repository_id)::int FROM sf_releases pair WHERE pair.id=ANY($1::uuid[])
            AND pair.project_id=$2 AND pair.organization_id=$3) AS pair_repository_count,
          (SELECT count(DISTINCT folder)::int FROM sf_releases pair WHERE pair.id=ANY($1::uuid[])
            AND pair.project_id=$2 AND pair.organization_id=$3) AS pair_folder_count,
          (SELECT count(DISTINCT parser_profile)::int FROM sf_releases pair WHERE pair.id=ANY($1::uuid[])
            AND pair.project_id=$2 AND pair.organization_id=$3) AS pair_profile_count,
          (SELECT COALESCE(sum(char_length(CASE WHEN jsonb_typeof(item->'path')='string' THEN item->>'path' ELSE '' END)
            +char_length(CASE WHEN jsonb_typeof(item->'version')='string' THEN item->>'version' ELSE '' END)),0)::bigint
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)) AS file_metadata_chars,
          (SELECT COALESCE(sum(octet_length((CASE WHEN jsonb_typeof(item)='object' THEN item-'content' ELSE '{}'::jsonb END)::text)),0)::bigint
            FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)) AS file_metadata_bytes,
          (SELECT count(*)::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)
            WHERE COALESCE(jsonb_typeof(item),'')<>'object' OR COALESCE(jsonb_typeof(item->'content'),'')<>'string'
              OR COALESCE(jsonb_typeof(item->'path'),'')<>'string' OR COALESCE(jsonb_typeof(item->'version'),'')<>'string'
              OR COALESCE(char_length(item->>'path'),0) NOT BETWEEN 1 AND 2097152
              OR COALESCE(char_length(item->>'version'),0) NOT BETWEEN 1 AND 2097152
              OR COALESCE((CASE WHEN jsonb_typeof(item->'bytes')='number' AND char_length(item->>'bytes') BETWEEN 1 AND 7
                AND item->>'bytes' ~ '^[0-9]{1,7}$' THEN (item->>'bytes')::integer END),0) NOT BETWEEN 1 AND 2097152
              OR COALESCE(octet_length(item->>'content'),0) NOT BETWEEN 1 AND 2097152
              OR COALESCE(item->>'path','') !~ '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$'
              OR left(COALESCE(item->>'path',''),char_length(folder)+1)<>(folder || '/')
              OR COALESCE(item->>'version','') !~ '^([0-9]+)(\.[0-9]+)*$'
              OR COALESCE(jsonb_typeof(item->'sha256'),'')<>'string' OR COALESCE(item->>'sha256','') !~ '^[a-f0-9]{64}$'
              OR COALESCE(jsonb_typeof(item->'validationStatus'),'')<>'string' OR COALESCE(item->>'validationStatus','')<>'VALID'
              OR NOT COALESCE(CASE
                WHEN jsonb_typeof(item->'statementCount')='null' THEN true
                WHEN jsonb_typeof(item->'statementCount')='number' THEN CASE
                  WHEN char_length(item->>'statementCount') BETWEEN 1 AND 16
                    AND item->>'statementCount' ~ '^[0-9]{1,16}$'
                    THEN (item->>'statementCount')::numeric <= 9007199254740991
                  ELSE false END
                ELSE false END, false)) AS invalid_files,
          (SELECT count(DISTINCT item->>'path')::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)) AS distinct_paths,
          (SELECT count(DISTINCT item->>'version')::int FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)) AS distinct_versions,
          (SELECT COALESCE(sum(octet_length(item->>'content')),0)::bigint FROM jsonb_array_elements(CASE WHEN jsonb_typeof(files)='array' THEN files ELSE '[]'::jsonb END) e(item)
            WHERE jsonb_typeof(item)='object' AND jsonb_typeof(item->'content')='string') AS content_bytes
          FROM sf_releases WHERE id=ANY($1::uuid[]) AND project_id=$2
            AND organization_id=$3 ORDER BY id FOR SHARE
) bounds
