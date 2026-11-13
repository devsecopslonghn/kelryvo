SELECT jsonb_build_object('validationCode',validation_code,'createdAt',
  CASE WHEN civil_year BETWEEN 0 AND 9999 THEN lpad(civil_year::text,4,'0')
    ELSE CASE WHEN civil_year<0 THEN '-' ELSE '+' END || lpad(abs(civil_year)::text,6,'0') END
  || to_char(utc,'-MM-DD"T"HH24:MI:SS.MS"Z"'))
FROM (
  SELECT validation_code,created_at AT TIME ZONE 'UTC' AS utc,
    (extract(year FROM created_at AT TIME ZONE 'UTC')
      + CASE WHEN extract(year FROM created_at AT TIME ZONE 'UTC')<0 THEN 1 ELSE 0 END)::integer AS civil_year
  FROM sf_releases WHERE id=$1 AND project_id=$2 AND organization_id=$3
) r
