#!/bin/bash
set -euo pipefail
app_password=$(cat /run/kelryvo/postgresql/app-password)
[[ "$app_password" =~ ^[a-f0-9]{64}$ ]] || exit 1
psql --set ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE kelryvo LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '$app_password';
ALTER DATABASE kelryvo OWNER TO kelryvo;
ALTER SCHEMA public OWNER TO kelryvo;
REVOKE ALL ON DATABASE kelryvo FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
unset app_password
