-- Banco isolado para tests/postgres.test.js (URBANA_POSTGRES_TEST_URL).
-- Executado só na primeira criação do volume do Postgres.
CREATE DATABASE urbana_test;
\connect urbana_test
CREATE EXTENSION IF NOT EXISTS postgis;
