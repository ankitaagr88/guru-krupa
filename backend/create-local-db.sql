-- One-time local setup. Run as the postgres superuser:
--   "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -h localhost -f create-local-db.sql
CREATE ROLE gurukrupa LOGIN PASSWORD 'gurukrupa';
CREATE DATABASE gurukrupa OWNER gurukrupa;
