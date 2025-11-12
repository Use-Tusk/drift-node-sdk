import mysql from 'mysql';

let connection: mysql.Connection | null = null;
let pool: mysql.Pool | null = null;

export function getConnection(): mysql.Connection {
  if (!connection) {
    const connectionConfig = {
      host: process.env.MYSQL_HOST || 'mysql',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'testuser',
      password: process.env.MYSQL_PASSWORD || 'testpass',
      database: process.env.MYSQL_DB || 'testdb',
      multipleStatements: true, // Enable multi-statement queries
    };

    connection = mysql.createConnection(connectionConfig);
  }
  return connection;
}

export function getPool(): mysql.Pool {
  if (!pool) {
    const poolConfig = {
      host: process.env.MYSQL_HOST || 'mysql',
      port: parseInt(process.env.MYSQL_PORT || '3306'),
      user: process.env.MYSQL_USER || 'testuser',
      password: process.env.MYSQL_PASSWORD || 'testpass',
      database: process.env.MYSQL_DB || 'testdb',
      connectionLimit: 10,
      multipleStatements: true, // Enable multi-statement queries
    };

    pool = mysql.createPool(poolConfig);
  }
  return pool;
}

export async function connectDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = getConnection();
    conn.connect((err) => {
      if (err) {
        console.error('Error connecting to MySQL:', err);
        reject(err);
      } else {
        console.log('Connected to MySQL database');
        resolve();
      }
    });
  });
}

export async function closeDb(): Promise<void> {
  const promises: Promise<void>[] = [];

  if (connection) {
    promises.push(
      new Promise((resolve, reject) => {
        connection!.end((err) => {
          if (err) reject(err);
          else {
            connection = null;
            resolve();
          }
        });
      })
    );
  }

  if (pool) {
    promises.push(
      new Promise((resolve, reject) => {
        pool!.end((err) => {
          if (err) reject(err);
          else {
            pool = null;
            resolve();
          }
        });
      })
    );
  }

  await Promise.all(promises);
}
