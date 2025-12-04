import { TuskDrift } from "./tdInit.js";
import http from "http";
import mysql from "mysql2";
import mysqlPromise from "mysql2/promise";
import { sequelize, User, Product, initializeSequelize } from "./sequelizeSetup.js";
import { Op, QueryTypes } from "sequelize";

const PORT = process.env.PORT || 3000;

// Database configuration
const dbConfig = {
  host: process.env.MYSQL_HOST || "mysql",
  port: parseInt(process.env.MYSQL_PORT || "3306"),
  database: process.env.MYSQL_DB || "testdb",
  user: process.env.MYSQL_USER || "testuser",
  password: process.env.MYSQL_PASSWORD || "testpass",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let connection: mysql.Connection;
let pool: mysql.Pool;
let promisePool: mysqlPromise.Pool;

async function initializeDatabase() {
  console.log(`Connecting to database: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);

  // Initialize connection
  connection = mysql.createConnection(dbConfig);

  // Connect
  await new Promise<void>((resolve, reject) => {
    connection.connect((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  // Initialize pool
  pool = mysql.createPool(dbConfig);

  // Initialize promise pool
  promisePool = mysqlPromise.createPool(dbConfig);

  // Create test tables
  await new Promise<void>((resolve, reject) => {
    connection.query(
      `
      CREATE TABLE IF NOT EXISTS test_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
      `,
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });

  // Insert test data
  await new Promise<void>((resolve, reject) => {
    connection.query(
      `
      INSERT IGNORE INTO test_users (id, name, email) VALUES
      (1, 'John Doe', 'john@example.com'),
      (2, 'Jane Smith', 'jane@example.com'),
      (3, 'Bob Johnson', 'bob@example.com')
      `,
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });

  // Create a larger table for testing
  await new Promise<void>((resolve, reject) => {
    connection.query(
      `
      CREATE TABLE IF NOT EXISTS large_data (
        id INT AUTO_INCREMENT PRIMARY KEY,
        data_value VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
      `,
      (err) => {
        if (err) reject(err);
        else resolve();
      },
    );
  });

  // Insert some test data
  for (let i = 1; i <= 10; i++) {
    await new Promise<void>((resolve, reject) => {
      connection.query(
        `INSERT IGNORE INTO large_data (id, data_value) VALUES (?, ?)`,
        [i, `test_data_${i}`],
        (err) => {
          if (err) reject(err);
          else resolve();
        },
      );
    });
  }

  console.log("Database initialized successfully");
}

// Create HTTP server with test endpoints
const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  console.log(`Received request: ${method} ${url}`);

  try {
    // Health check endpoint
    if (url === "/health" && method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // Test endpoint for connection query
    if (url === "/test/connection-query" && method === "GET") {
      connection.query("SELECT * FROM test_users ORDER BY id", (error, results) => {
        if (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: results,
            rowCount: Array.isArray(results) ? results.length : 0,
          }),
        );
      });
      return;
    }

    // Test endpoint for connection parameterized query
    if (url === "/test/connection-parameterized" && method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { userId } = JSON.parse(body);
        connection.query("SELECT * FROM test_users WHERE id = ?", [userId], (error, results) => {
          if (error) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: error.message }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              data: results,
              rowCount: Array.isArray(results) ? results.length : 0,
            }),
          );
        });
      });
      return;
    }

    // Test endpoint for connection execute (prepared statements)
    if (url === "/test/connection-execute" && method === "GET") {
      connection.execute("SELECT * FROM test_users ORDER BY id", (error, results) => {
        if (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: results,
            rowCount: Array.isArray(results) ? results.length : 0,
          }),
        );
      });
      return;
    }

    // Test endpoint for connection execute with params
    if (url === "/test/connection-execute-params" && method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { userId } = JSON.parse(body);
        connection.execute("SELECT * FROM test_users WHERE id = ?", [userId], (error, results) => {
          if (error) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: error.message }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              data: results,
              rowCount: Array.isArray(results) ? results.length : 0,
            }),
          );
        });
      });
      return;
    }

    // Pool test endpoint
    if (url === "/test/pool-query" && method === "GET") {
      pool.query("SELECT * FROM test_users ORDER BY id LIMIT 5", (error, results) => {
        if (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: results,
            rowCount: Array.isArray(results) ? results.length : 0,
            queryType: "pool",
          }),
        );
      });
      return;
    }

    // Pool parameterized query
    if (url === "/test/pool-parameterized" && method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { userId } = JSON.parse(body);
        pool.query("SELECT * FROM test_users WHERE id = ?", [userId], (error, results) => {
          if (error) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: error.message }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              data: results,
              rowCount: Array.isArray(results) ? results.length : 0,
              queryType: "pool-parameterized",
            }),
          );
        });
      });
      return;
    }

    // Pool execute test
    if (url === "/test/pool-execute" && method === "GET") {
      pool.execute("SELECT * FROM test_users ORDER BY id", (error, results) => {
        if (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: results,
            rowCount: Array.isArray(results) ? results.length : 0,
            queryType: "pool-execute",
          }),
        );
      });
      return;
    }

    // Pool execute with params
    if (url === "/test/pool-execute-params" && method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { userId } = JSON.parse(body);
        pool.execute("SELECT * FROM test_users WHERE id = ?", [userId], (error, results) => {
          if (error) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: error.message }));
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              data: results,
              rowCount: Array.isArray(results) ? results.length : 0,
              queryType: "pool-execute-params",
            }),
          );
        });
      });
      return;
    }

    // Pool getConnection test
    if (url === "/test/pool-getConnection" && method === "GET") {
      pool.getConnection((error, poolConnection) => {
        if (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }

        poolConnection.query("SELECT COUNT(*) as total FROM test_users", (queryError, results) => {
          poolConnection.release();

          if (queryError) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: queryError.message }));
            return;
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              data: results,
              queryType: "pool-getConnection",
            }),
          );
        });
      });
      return;
    }

    // Connection connect test
    if (url === "/test/connection-connect" && method === "GET") {
      const newConnection = mysql.createConnection(dbConfig);
      newConnection.connect((error) => {
        if (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }

        newConnection.end();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      });
      return;
    }

    // Connection ping test
    if (url === "/test/connection-ping" && method === "GET") {
      connection.ping((error) => {
        if (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: error.message }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true }));
      });
      return;
    }

    // Stream query test
    if (url === "/test/stream-query" && method === "GET") {
      const results: any[] = [];
      const query = connection.query("SELECT * FROM large_data ORDER BY id");

      query
        .on("error", (error) => {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: error.message }));
        })
        .on("result", (row) => {
          results.push(row);
        })
        .on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              data: results,
              rowCount: results.length,
              queryType: "stream",
            }),
          );
        });
      return;
    }

    // Sequelize authenticate test - this triggers internal queries like SELECT VERSION()
    if (url === "/test/sequelize-authenticate" && method === "GET") {
      try {
        await sequelize.authenticate();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            message: "Sequelize authentication successful",
            queryType: "sequelize-authenticate",
          }),
        );
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    // Sequelize findAll test - ORM query
    if (url === "/test/sequelize-findall" && method === "GET") {
      try {
        const users = await User.findAll({
          order: [["id", "ASC"]],
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: users,
            rowCount: users.length,
            queryType: "sequelize-findAll",
          }),
        );
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    // Sequelize findOne test - parameterized ORM query
    if (url === "/test/sequelize-findone" && method === "POST") {
      try {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        await new Promise<void>((resolve) => req.on("end", () => resolve()));

        const { userId } = JSON.parse(body);
        const user = await User.findOne({
          where: { id: userId },
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: user,
            queryType: "sequelize-findOne",
          }),
        );
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    // Sequelize complex query with joins and aggregations
    if (url === "/test/sequelize-complex" && method === "GET") {
      try {
        // This will trigger multiple internal queries
        const [users, products] = await Promise.all([
          User.findAll({
            attributes: ["id", "name", "email"],
            limit: 5,
          }),
          Product.findAll({
            attributes: ["id", "name", "price", "stock"],
            where: {
              stock: {
                [Op.gt]: 0,
              },
            },
            order: [["price", "DESC"]],
          }),
        ]);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: {
              users,
              products,
            },
            queryType: "sequelize-complex",
          }),
        );
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    // Sequelize raw query test
    if (url === "/test/sequelize-raw" && method === "GET") {
      try {
        const results = await sequelize.query(
          "SELECT * FROM test_users WHERE id <= ? ORDER BY id",
          {
            replacements: [3],
            type: QueryTypes.SELECT,
          },
        );

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: results,
            rowCount: Array.isArray(results) ? results.length : 0,
            queryType: "sequelize-raw",
          }),
        );
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    // Sequelize transaction test - this will create multiple queries
    if (url === "/test/sequelize-transaction" && method === "POST") {
      try {
        const result = await sequelize.transaction(async (t) => {
          // Multiple queries within a transaction
          const user = await User.findOne({
            where: { id: 1 },
            transaction: t,
          });

          const products = await Product.findAll({
            where: { stock: { [Op.gt]: 10 } },
            transaction: t,
          });

          return { user, products };
        });

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: result,
            queryType: "sequelize-transaction",
          }),
        );
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    // Promise API test - uses mysql2/promise
    if (url === "/test/promise-connection-query" && method === "GET") {
      try {
        const promiseConnection = await mysqlPromise.createConnection(dbConfig);
        const [rows] = await promiseConnection.query(
          "SELECT * FROM test_users ORDER BY id LIMIT 3",
        );
        await promiseConnection.end();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: rows,
            rowCount: Array.isArray(rows) ? rows.length : 0,
            queryType: "promise-connection",
          }),
        );
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    // Promise Pool API test - uses mysql2/promise with pool
    if (url === "/test/promise-pool-query" && method === "GET") {
      try {
        const [rows] = await promisePool.query("SELECT * FROM test_users ORDER BY id LIMIT 5");

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: rows,
            rowCount: Array.isArray(rows) ? rows.length : 0,
            queryType: "promise-pool",
          }),
        );
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    // Promise Pool getConnection test - uses mysql2/promise pool.getConnection()
    if (url === "/test/promise-pool-getconnection" && method === "GET") {
      try {
        const connection = await promisePool.getConnection();
        const [rows] = await connection.query("SELECT COUNT(*) as total FROM test_users");
        connection.release();

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            data: rows,
            queryType: "promise-pool-getconnection",
          }),
        );
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return;
    }

    if (url === "/test/transaction-methods" && method === "GET") {
      const txConnection = mysql.createConnection(dbConfig);

      txConnection.connect((connectErr) => {
        if (connectErr) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: connectErr.message }));
          return;
        }

        txConnection.beginTransaction((beginErr) => {
          if (beginErr) {
            txConnection.end();
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: beginErr.message }));
            return;
          }

          txConnection.query(
            "INSERT INTO test_users (name, email) VALUES (?, ?)",
            ["TX User", `tx_${Date.now()}@example.com`],
            (insertErr, insertResults) => {
              if (insertErr) {
                txConnection.rollback(() => {
                  txConnection.end();
                  res.writeHead(500, { "Content-Type": "application/json" });
                  res.end(JSON.stringify({ success: false, error: insertErr.message }));
                });
                return;
              }

              txConnection.commit((commitErr) => {
                if (commitErr) {
                  txConnection.rollback(() => {
                    txConnection.end();
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ success: false, error: commitErr.message }));
                  });
                  return;
                }

                txConnection.end();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(
                  JSON.stringify({
                    success: true,
                    data: insertResults,
                    queryType: "transaction",
                  }),
                );
              });
            },
          );
        });
      });
      return;
    }

    if (url === "/test/prepare-statement" && method === "GET") {
      const prepConnection = mysql.createConnection(dbConfig);

      prepConnection.connect((connectErr) => {
        if (connectErr) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: connectErr.message }));
          return;
        }

        prepConnection.prepare("SELECT * FROM test_users WHERE id = ?", (prepErr, statement) => {
          if (prepErr) {
            prepConnection.end();
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: prepErr.message }));
            return;
          }

          statement.execute([1], (execErr, results) => {
            statement.close();
            prepConnection.end();

            if (execErr) {
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ success: false, error: execErr.message }));
              return;
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                data: results,
                rowCount: Array.isArray(results) ? results.length : 0,
                queryType: "prepare-statement",
              }),
            );
          });
        });
      });
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    console.error("Error handling request:", error);
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

// Start server and initialize database
server.listen(PORT, async () => {
  try {
    await initializeDatabase();
    await initializeSequelize();
    TuskDrift.markAppAsReady();
    console.log(`MySQL2 integration test server running on port ${PORT}`);
    console.log(`Test mode: ${process.env.TUSK_DRIFT_MODE}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down gracefully...");
  try {
    connection.end();
    pool.end();
    await promisePool.end();
    await sequelize.close();
  } catch (error) {
    console.error("Error during shutdown:", error);
  }
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Handle uncaught exceptions
process.on("uncaughtException", async (error) => {
  console.error("Uncaught exception:", error);
  await shutdown();
});

process.on("unhandledRejection", async (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  await shutdown();
});
