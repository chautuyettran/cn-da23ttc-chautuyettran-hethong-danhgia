require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');
const { getPool, closePool } = require('../config/mysql');

const version = '001-initial-schema';

async function migrate() {
  const pool = getPool();
  const schema = await fs.readFile(path.join(__dirname, '..', '..', 'database', 'mysql-schema.sql'), 'utf8');
  const connection = await pool.getConnection();
  try {
    await connection.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(100) NOT NULL PRIMARY KEY,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`
    );
    const [rows] = await connection.execute(
      'SELECT version FROM schema_migrations WHERE version = ?',
      [version]
    );
    if (rows.length) {
      return false;
    }
    const statements = schema.split(/;\s*(?:\r?\n|$)/).map((statement) => statement.trim()).filter(Boolean);
    for (const statement of statements) await connection.query(statement);
    await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
    return true;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  migrate()
    .then((applied) => console.log(applied ? 'MySQL schema migration applied.' : 'MySQL schema migration is already applied.'))
    .catch((error) => {
      console.error('MySQL migration failed:', error.code || error.name);
      process.exitCode = 1;
    })
    .finally(() => closePool());
}

module.exports = { migrate };
