const mysql = require('mysql2/promise');
const fs = require('node:fs');
const path = require('node:path');

const localMysqlEnv = path.resolve(__dirname, '..', '..', '.env.mysql');
if (fs.existsSync(localMysqlEnv)) {
  require('dotenv').config({ path: localMysqlEnv, override: false });
}

let pool;

function getPool() {
  if (!pool) {
    const required = ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD'];
    const missing = required.filter((key) => !process.env[key]);
    if (missing.length) {
      throw new Error(`Missing MySQL configuration: ${missing.join(', ')}.`);
    }
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: Number(process.env.MYSQL_PORT || 3306),
      database: process.env.MYSQL_DATABASE,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      waitForConnections: true,
      connectionLimit: Number(process.env.MYSQL_POOL_SIZE || 10),
      queueLimit: 0,
      timezone: 'Z',
      charset: 'utf8mb4'
    });
  }
  return pool;
}

async function withTransaction(callback, options = {}) {
  const connection = await getPool().getConnection();
  try {
    if (options.readOnly) {
      await connection.query('SET TRANSACTION READ ONLY');
    }
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function closePool() {
  if (!pool) return;
  const currentPool = pool;
  pool = null;
  await currentPool.end();
}

async function connectDatabase() {
  const connection = await getPool().getConnection();
  try {
    await connection.query('SELECT 1');
    return connection;
  } finally {
    connection.release();
  }
}

module.exports = {
  getPool,
  withTransaction,
  closePool,
  connectDatabase,
  pool: {
    execute(...args) { return getPool().execute(...args); },
    query(...args) { return getPool().query(...args); },
    getConnection(...args) { return getPool().getConnection(...args); }
  }
};
