import pg from 'pg';

// Parse COUNT and other bigint results as JS numbers
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => parseInt(v, 10));

let pool;

function createPool() {
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
      process.env.DATABASE_URL?.includes('supabase') ||
      process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    max: 3,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
}

export function getPool() {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

// Convert ? placeholders to $1, $2, ...
function toPositional(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export async function query(sql, params = []) {
  const pgSql = toPositional(sql);
  return getPool().query(pgSql, params);
}

export async function getRow(sql, params = []) {
  const r = await query(sql, params);
  return r.rows[0] || null;
}

export async function getRows(sql, params = []) {
  const r = await query(sql, params);
  return r.rows;
}

export async function run(sql, params = []) {
  return query(sql, params);
}
