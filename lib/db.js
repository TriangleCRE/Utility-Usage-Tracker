// Shared Postgres connection pool. Reads the connection string only from
// environment variables (never hard-coded) — Vercel's Neon storage
// integration sets one of these automatically.
const { Pool } = require('pg');

const CONNECTION_STRING =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL_NON_POOLING;

let pool;

function getPool() {
  if (!pool) {
    if (!CONNECTION_STRING) {
      throw new Error(
        'No database connection string found. Set DATABASE_URL (or POSTGRES_URL) in the environment.'
      );
    }
    pool = new Pool({
      connectionString: CONNECTION_STRING,
      // Neon (and most hosted Postgres) require TLS but present certs that
      // aren't in Node's default trust store in every environment — this
      // matches the standard Vercel/Neon serverless setup. A local Postgres
      // without `sslmode=require` in its connection string is unaffected.
      ssl: /sslmode=require|neon\.tech/.test(CONNECTION_STRING)
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return pool;
}

module.exports = { getPool };
