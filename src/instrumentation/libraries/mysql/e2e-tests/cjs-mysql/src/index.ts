import { TuskDrift } from "./tdInit";
import express, { Request, Response } from "express";
import { getConnection, getPool, connectDb, closeDb } from "./db/index";
import mysql from "mysql";
import Knex from "knex";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Initialize database tables
async function initializeDatabase() {
  const connection = getConnection();

  console.log("Initializing database tables...");

  return new Promise<void>((resolve, reject) => {
    // Create tables and insert seed data
    const initScript = `
      CREATE TABLE IF NOT EXISTS cache (
        id INT AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(255) NOT NULL UNIQUE,
        value TEXT NOT NULL,
        expires_at DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_key (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(100) NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
        INDEX idx_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

      INSERT IGNORE INTO cache (\`key\`, value, expires_at)
      VALUES
        ('test_key_1', 'test_value_1', DATE_ADD(NOW(), INTERVAL 1 DAY)),
        ('test_key_2', 'test_value_2', DATE_ADD(NOW(), INTERVAL 2 DAY)),
        ('test_key_3', 'test_value_3', DATE_ADD(NOW(), INTERVAL 3 DAY));

      INSERT IGNORE INTO users (name, email)
      VALUES
        ('Alice Johnson', 'alice@example.com'),
        ('Bob Smith', 'bob@example.com'),
        ('Charlie Brown', 'charlie@example.com');
    `;

    connection.query(initScript, (error, results) => {
      if (error) {
        console.error("Error initializing database:", error);
        reject(error);
      } else {
        console.log("Database initialization complete");
        resolve();
      }
    });
  });
}

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", ready: true });
});

// ===== CONNECTION TESTS =====

// Test basic query with callback
app.get("/connection/query-callback", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    connection.query("SELECT * FROM cache LIMIT 3", (error, results, fields) => {
      if (error) {
        console.error("Error executing query:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        message: "Query executed with callback",
        count: results.length,
        data: results,
      });
    });
  } catch (error: any) {
    console.error("Error in query-callback:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test query with parameters and callback
app.get("/connection/query-params", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();
    const key = (req.query.key as string) || "test_key_1";

    connection.query("SELECT * FROM cache WHERE `key` = ?", [key], (error, results, fields) => {
      if (error) {
        console.error("Error executing query:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        message: "Query executed with parameters",
        data: results,
      });
    });
  } catch (error: any) {
    console.error("Error in query-params:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test query with options object
app.get("/connection/query-options", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const options = {
      sql: "SELECT * FROM users WHERE email = ?",
      values: ["alice@example.com"],
    };

    connection.query(options, (error, results, fields) => {
      if (error) {
        console.error("Error executing query:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        message: "Query executed with options object",
        data: results,
      });
    });
  } catch (error: any) {
    console.error("Error in query-options:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test query using event emitter mode
app.get("/connection/query-stream", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const results: any[] = [];
    const query = connection.query("SELECT * FROM users");

    query
      .on("error", (err) => {
        console.error("Query error:", err);
        res.status(500).json({ error: err.message });
      })
      .on("result", (row) => {
        results.push(row);
      })
      .on("end", () => {
        res.json({
          message: "Query executed with event emitter",
          count: results.length,
          data: results,
        });
      });
  } catch (error: any) {
    console.error("Error in query-stream:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test multi-statement queries
app.get("/connection/multi-statement", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const multiQuery = `
      SELECT COUNT(*) as cache_count FROM cache;
      SELECT COUNT(*) as user_count FROM users;
      SELECT * FROM cache LIMIT 1;
    `;

    connection.query(multiQuery, (error, results, fields) => {
      if (error) {
        console.error("Error executing multi-statement query:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        message: "Multi-statement query executed",
        results: results,
      });
    });
  } catch (error: any) {
    console.error("Error in multi-statement:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== POOL TESTS =====

// Test pool query
app.get("/pool/query", async (req: Request, res: Response) => {
  try {
    const pool = getPool();

    pool.query("SELECT * FROM cache ORDER BY created_at DESC LIMIT 2", (error, results, fields) => {
      if (error) {
        console.error("Error executing pool query:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        message: "Pool query executed",
        count: results.length,
        data: results,
      });
    });
  } catch (error: any) {
    console.error("Error in pool query:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test pool getConnection
app.get("/pool/get-connection", async (req: Request, res: Response) => {
  try {
    const pool = getPool();

    pool.getConnection((error, connection) => {
      if (error) {
        console.error("Error getting connection from pool:", error);
        return res.status(500).json({ error: error.message });
      }

      // Use the pooled connection
      connection.query("SELECT * FROM users WHERE id = ?", [1], (queryError, results, fields) => {
        // Release the connection back to the pool
        connection.release();

        if (queryError) {
          console.error("Error executing query on pooled connection:", queryError);
          return res.status(500).json({ error: queryError.message });
        }

        res.json({
          message: "Query executed on pooled connection",
          data: results,
        });
      });
    });
  } catch (error: any) {
    console.error("Error in pool get-connection:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/test/pool-events", async (req: Request, res: Response) => {
  try {
    const events: string[] = [];

    // Create a new pool to track events
    const eventPool = mysql.createPool({
      host: process.env.MYSQL_HOST || "mysql",
      port: parseInt(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER || "testuser",
      password: process.env.MYSQL_PASSWORD || "testpass",
      database: process.env.MYSQL_DB || "testdb",
      connectionLimit: 1, // Force queueing
    });

    eventPool.on("connection", (connection: any) => {
      events.push("connection");
    });

    eventPool.on("acquire", (connection: any) => {
      events.push("acquire");
    });

    eventPool.on("release", (connection: any) => {
      events.push("release");
    });

    eventPool.on("enqueue", () => {
      events.push("enqueue");
    });

    // Get connection to trigger events
    eventPool.getConnection((error: any, connection: any) => {
      if (error) {
        eventPool.end(() => {});
        return res.status(500).json({ error: error.message });
      }

      connection.query("SELECT 1 as test", (queryError: any, results: any) => {
        connection.release();

        // Give time for release event to fire
        setTimeout(() => {
          eventPool.end((endError: any) => {
            res.json({
              message: "Pool events test completed",
              events: events,
              queryResults: results,
            });
          });
        }, 100);
      });
    });
  } catch (error: any) {
    console.error("Error in pool-events:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/test/pool-namespace-query", async (req: Request, res: Response) => {
  try {
    // Create a pool cluster
    const poolCluster = mysql.createPoolCluster();

    poolCluster.add("NODE1", {
      host: process.env.MYSQL_HOST || "mysql",
      port: parseInt(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER || "testuser",
      password: process.env.MYSQL_PASSWORD || "testpass",
      database: process.env.MYSQL_DB || "testdb",
    });

    // Use the namespace to query
    const namespace = poolCluster.of("NODE*");
    namespace.query("SELECT COUNT(*) as count FROM cache", (err, results) => {
      poolCluster.end(() => {});

      if (err) {
        return res.status(500).json({ error: err.message });
      }

      res.json({
        message: "PoolNamespace.query test completed",
        data: results,
      });
    });
  } catch (error: any) {
    console.error("Error in pool-namespace-query:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== TRANSACTION TESTS =====

// Test beginTransaction(callback) signature
app.post("/transaction/commit", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    connection.beginTransaction((beginError) => {
      if (beginError) {
        console.error("Error beginning transaction:", beginError);
        return res.status(500).json({ error: beginError.message });
      }

      const timestamp = Date.now();
      const key = `tx_commit_${timestamp}`;
      const value = `Transaction test value ${timestamp}`;

      connection.query(
        "INSERT INTO cache (`key`, value, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))",
        [key, value],
        (insertError, insertResults) => {
          if (insertError) {
            return connection.rollback(() => {
              console.error("Error in transaction insert, rolled back:", insertError);
              res.status(500).json({ error: insertError.message });
            });
          }

          connection.commit((commitError) => {
            if (commitError) {
              return connection.rollback(() => {
                console.error("Error committing transaction:", commitError);
                res.status(500).json({ error: commitError.message });
              });
            }

            res.json({
              message: "Transaction committed",
            });
          });
        },
      );
    });
  } catch (error: any) {
    console.error("Error in transaction commit:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test beginTransaction(options, callback) signature
app.post("/test/transaction-with-options", async (req: Request, res: Response) => {
  try {
    // Create a temporary connection for this test
    const tempConnection = mysql.createConnection({
      host: process.env.MYSQL_HOST || "mysql",
      port: parseInt(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER || "testuser",
      password: process.env.MYSQL_PASSWORD || "testpass",
      database: process.env.MYSQL_DB || "testdb",
    });

    tempConnection.connect((connectError: any) => {
      if (connectError) {
        return res.status(500).json({ error: connectError.message });
      }

      // Begin transaction with options object (timeout) - cast to any for extended options
      (tempConnection as any).beginTransaction({ timeout: 10000 }, (beginError: any) => {
        if (beginError) {
          tempConnection.end(() => {});
          return res.status(500).json({ error: beginError.message });
        }

        const timestamp = Date.now();
        const key = `tx_options_${timestamp}`;

        tempConnection.query(
          "INSERT INTO cache (`key`, value, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))",
          [key, `Options transaction test ${timestamp}`],
          (insertError: any, insertResults: any) => {
            if (insertError) {
              return tempConnection.rollback(() => {
                tempConnection.end(() => {});
                res.status(500).json({ error: insertError.message });
              });
            }

            // Commit with options - cast to any for extended options
            (tempConnection as any).commit({ timeout: 10000 }, (commitError: any) => {
              tempConnection.end(() => {});

              if (commitError) {
                return res.status(500).json({ error: commitError.message });
              }

              res.json({
                message: "Transaction with options executed",
                insertId: insertResults.insertId,
              });
            });
          },
        );
      });
    });
  } catch (error: any) {
    console.error("Error in transaction-with-options:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test transaction with rollback
app.post("/transaction/rollback", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    connection.beginTransaction((beginError) => {
      if (beginError) {
        console.error("Error beginning transaction:", beginError);
        return res.status(500).json({ error: beginError.message });
      }

      const timestamp = Date.now();
      const key = `tx_rollback_${timestamp}`;
      const value = `This should be rolled back ${timestamp}`;

      connection.query(
        "INSERT INTO cache (`key`, value, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))",
        [key, value],
        (insertError, insertResults) => {
          if (insertError) {
            return connection.rollback(() => {
              console.error("Error in transaction insert:", insertError);
              res.status(500).json({ error: insertError.message });
            });
          }

          // Intentionally rollback
          connection.rollback((rollbackError) => {
            if (rollbackError) {
              console.error("Error during rollback:", rollbackError);
              return res.status(500).json({ error: rollbackError.message });
            }

            res.json({
              message: "Transaction rolled back intentionally",
            });
          });
        },
      );
    });
  } catch (error: any) {
    console.error("Error in transaction rollback:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== INSERT/UPDATE/DELETE TESTS =====

// Test INSERT
app.post("/crud/insert", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const timestamp = Date.now();
    const { key, value } = req.body;
    const finalKey = key || `insert_test_${timestamp}`;
    const finalValue = value || `Insert test value ${timestamp}`;

    connection.query(
      "INSERT INTO cache (`key`, value, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))",
      [finalKey, finalValue],
      (error, results, fields) => {
        if (error) {
          console.error("Error executing INSERT:", error);
          return res.status(500).json({ error: error.message });
        }

        res.json({
          message: "INSERT executed",
          insertId: results.insertId,
          affectedRows: results.affectedRows,
          key: finalKey,
        });
      },
    );
  } catch (error: any) {
    console.error("Error in insert:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test UPDATE
app.put("/crud/update", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const { key, value } = req.body;
    const finalKey = key || "test_key_1";
    const finalValue = value || `Updated value ${Date.now()}`;

    connection.query(
      "UPDATE cache SET value = ?, updated_at = NOW() WHERE `key` = ?",
      [finalValue, finalKey],
      (error, results, fields) => {
        if (error) {
          console.error("Error executing UPDATE:", error);
          return res.status(500).json({ error: error.message });
        }

        res.json({
          message: "UPDATE executed",
          affectedRows: results.affectedRows,
          changedRows: results.changedRows,
          key: finalKey,
        });
      },
    );
  } catch (error: any) {
    console.error("Error in update:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test DELETE
app.delete("/crud/delete", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const { key } = req.body;
    if (!key) {
      return res.status(400).json({ error: "Key is required for DELETE" });
    }

    connection.query("DELETE FROM cache WHERE `key` = ?", [key], (error, results, fields) => {
      if (error) {
        console.error("Error executing DELETE:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        message: "DELETE executed",
        affectedRows: results.affectedRows,
        key: key,
      });
    });
  } catch (error: any) {
    console.error("Error in delete:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== ADVANCED QUERY TESTS =====

// Test JOIN query
app.get("/advanced/join", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const query = `
      SELECT u.id, u.name, u.email, COUNT(c.id) as cache_count
      FROM users u
      LEFT JOIN cache c ON u.name LIKE CONCAT('%', SUBSTRING_INDEX(c.key, '_', 1), '%')
      GROUP BY u.id, u.name, u.email
      LIMIT 5
    `;

    connection.query(query, (error, results, fields) => {
      if (error) {
        console.error("Error executing JOIN:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        message: "JOIN query executed",
        count: results.length,
        data: results,
      });
    });
  } catch (error: any) {
    console.error("Error in join:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test aggregate functions
app.get("/advanced/aggregate", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const query = `
      SELECT
        COUNT(*) as total_count,
        COUNT(DISTINCT \`key\`) as unique_keys,
        MIN(created_at) as earliest,
        MAX(created_at) as latest
      FROM cache
    `;

    connection.query(query, (error, results, fields) => {
      if (error) {
        console.error("Error executing aggregate query:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        message: "Aggregate query executed",
        data: results[0],
      });
    });
  } catch (error: any) {
    console.error("Error in aggregate:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test subquery
app.get("/advanced/subquery", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const query = `
      SELECT *
      FROM cache
      WHERE created_at >= (
        SELECT MIN(created_at)
        FROM cache
      )
      ORDER BY created_at ASC
      LIMIT 3
    `;

    connection.query(query, (error, results, fields) => {
      if (error) {
        console.error("Error executing subquery:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        message: "Subquery executed",
        count: results.length,
        data: results,
      });
    });
  } catch (error: any) {
    console.error("Error in subquery:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test prepared statement-like behavior
app.get("/advanced/prepared", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const params = ["test_key_%", "alice@example.com"];
    const query = `
      SELECT c.\`key\`, c.value, u.name, u.email
      FROM cache c
      CROSS JOIN users u
      WHERE c.\`key\` LIKE ? AND u.email = ?
      LIMIT 5
    `;

    connection.query(query, params, (error, results, fields) => {
      if (error) {
        console.error("Error executing prepared query:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        message: "Prepared-like query executed",
        count: results.length,
        data: results,
      });
    });
  } catch (error: any) {
    console.error("Error in prepared:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== LIFECYCLE TESTS =====

// Test connection.ping()
app.get("/lifecycle/ping", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    connection.ping((error) => {
      if (error) {
        console.error("Error pinging connection:", error);
        return res.status(500).json({ error: error.message });
      }

      res.json({
        message: "Ping successful",
        status: "ok",
      });
    });
  } catch (error: any) {
    console.error("Error in ping:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test connection.end() and reconnect
app.get("/lifecycle/end-and-reconnect", async (req: Request, res: Response) => {
  try {
    // Create a temporary connection for this test
    const tempConnection = mysql.createConnection({
      host: process.env.MYSQL_HOST || "mysql",
      port: parseInt(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER || "testuser",
      password: process.env.MYSQL_PASSWORD || "testpass",
      database: process.env.MYSQL_DB || "testdb",
    });

    let endEventReceived = false;

    // Listen for end event
    tempConnection.on("end", () => {
      endEventReceived = true;
    });

    // Connect first
    tempConnection.connect((connectError) => {
      if (connectError) {
        console.error("Error connecting temporary connection:", connectError);
        return res.status(500).json({ error: connectError.message });
      }

      // Now end the connection
      tempConnection.end((endError) => {
        if (endError) {
          console.error("Error ending connection:", endError);
          return res.status(500).json({ error: endError.message });
        }

        // Give time for end event to fire
        setTimeout(() => {
          res.json({
            message: "Connection ended successfully",
            endEventReceived,
            status: "ok",
          });
        }, 100);
      });
    });
  } catch (error: any) {
    console.error("Error in end-and-reconnect:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test connection.changeUser()
app.post("/lifecycle/change-user", async (req: Request, res: Response) => {
  try {
    // Create a temporary connection for this test
    const tempConnection = mysql.createConnection({
      host: process.env.MYSQL_HOST || "mysql",
      port: parseInt(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER || "testuser",
      password: process.env.MYSQL_PASSWORD || "testpass",
      database: process.env.MYSQL_DB || "testdb",
    });

    tempConnection.connect((connectError) => {
      if (connectError) {
        console.error("Error connecting temporary connection:", connectError);
        return res.status(500).json({ error: connectError.message });
      }

      // Change user to the same credentials (simpler than creating a test user)
      const changeUserOptions = {
        user: process.env.MYSQL_USER || "testuser",
        password: process.env.MYSQL_PASSWORD || "testpass",
        database: process.env.MYSQL_DB || "testdb",
      };

      tempConnection.changeUser(changeUserOptions, (changeError) => {
        // Close the temporary connection
        tempConnection.end(() => {
          if (changeError) {
            console.error("Error changing user:", changeError);
            return res.status(500).json({ error: changeError.message });
          }

          res.json({
            message: "User changed successfully",
            status: "ok",
          });
        });
      });
    });
  } catch (error: any) {
    console.error("Error in change-user:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test connection.pause() and resume()
app.get("/lifecycle/pause-resume", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const results: any[] = [];
    let isPaused = false;
    let isResumed = false;
    let resumePromise: Promise<void> | null = null;

    const query = connection.query("SELECT * FROM users");

    query
      .on("result", (row) => {
        if (results.length === 1 && !isPaused) {
          // Pause after first result
          connection.pause();
          isPaused = true;

          // Resume after a short delay
          resumePromise = new Promise((resolve) => {
            setTimeout(() => {
              connection.resume();
              isResumed = true;
              resolve();
            }, 50);
          });
        }
        results.push(row);
      })
      .on("error", (err) => {
        console.error("Query error:", err);
        res.status(500).json({ error: err.message });
      })
      .on("end", async () => {
        // Wait for resume to complete if it was triggered
        if (resumePromise) {
          await resumePromise;
        }

        res.json({
          message: "Pause and resume executed",
          isPaused,
          isResumed,
          count: results.length,
          data: results,
        });
      });
  } catch (error: any) {
    console.error("Error in pause-resume:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== POOL LIFECYCLE TESTS =====

// Test pool.end() and recreate
app.get("/pool/end-and-recreate", async (req: Request, res: Response) => {
  try {
    // Create a temporary pool for this test
    const tempPool = mysql.createPool({
      host: process.env.MYSQL_HOST || "mysql",
      port: parseInt(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER || "testuser",
      password: process.env.MYSQL_PASSWORD || "testpass",
      database: process.env.MYSQL_DB || "testdb",
      connectionLimit: 5,
    });

    // First, execute a query to ensure pool is active
    tempPool.query("SELECT 1 as test", (queryError, queryResults) => {
      if (queryError) {
        console.error("Error executing test query on temp pool:", queryError);
        return res.status(500).json({ error: queryError.message });
      }

      // Now end the pool
      tempPool.end((endError) => {
        if (endError) {
          console.error("Error ending pool:", endError);
          return res.status(500).json({ error: endError.message });
        }

        res.json({
          message: "Pool ended successfully",
          status: "ok",
        });
      });
    });
  } catch (error: any) {
    console.error("Error in pool end-and-recreate:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== EVENT TESTS =====

// Test 'connect' event emission
app.get("/events/connect", async (req: Request, res: Response) => {
  try {
    let connectEventReceived = false;

    // Create a new connection to test connect event
    const testConnection = mysql.createConnection({
      host: process.env.MYSQL_HOST || "mysql",
      port: parseInt(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER || "testuser",
      password: process.env.MYSQL_PASSWORD || "testpass",
      database: process.env.MYSQL_DB || "testdb",
    });

    // Listen for connect event
    testConnection.on("connect", () => {
      connectEventReceived = true;
    });

    // Initiate connection
    testConnection.connect((error) => {
      // Close connection after testing
      testConnection.end(() => {
        if (error) {
          console.error("Error connecting:", error);
          return res.status(500).json({ error: error.message });
        }

        res.json({
          message: "Connect event tested",
          connectEventReceived,
          status: "ok",
        });
      });
    });
  } catch (error: any) {
    console.error("Error in connect event test:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test: Connection.destroy() - not patched
app.get("/test/connection-destroy", async (req: Request, res: Response) => {
  try {
    // Create a temporary connection for this test
    const tempConnection = mysql.createConnection({
      host: process.env.MYSQL_HOST || "mysql",
      port: parseInt(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER || "testuser",
      password: process.env.MYSQL_PASSWORD || "testpass",
      database: process.env.MYSQL_DB || "testdb",
    });

    tempConnection.connect((connectError) => {
      if (connectError) {
        return res.status(500).json({ error: connectError.message });
      }

      // Query before destroy
      tempConnection.query("SELECT 1 as test", (queryError1, results1) => {
        if (queryError1) {
          return res.status(500).json({ error: queryError1.message });
        }

        tempConnection.destroy();

        setTimeout(() => {
          res.json({
            message: "Connection destroyed successfully",
            resultBeforeDestroy: results1,
          });
        }, 100);
      });
    });
  } catch (error: any) {
    console.error("Unexpected error in connection-destroy:", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== STREAM TESTS =====

// Test Query.prototype.stream() method
app.get("/stream/query-stream-method", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    const results: any[] = [];
    const query = connection.query("SELECT * FROM users ORDER BY id ASC");

    // Call the stream() method on the query instance
    const stream = query.stream();

    stream
      .on("error", (err) => {
        console.error("Stream error:", err);
        res.status(500).json({ error: err.message });
      })
      .on("data", (row) => {
        results.push(row);
      })
      .on("end", () => {
        res.json({
          message: "Stream query executed",
          count: results.length,
          data: results,
        });
      });
  } catch (error: any) {
    console.error("Error in query-stream-method:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/test/query-object-reuse", async (req: Request, res: Response) => {
  try {
    const connection = getConnection();

    // Create a query object manually using Connection.createQuery
    const queryObj = (mysql as any).createQuery(
      "SELECT * FROM cache LIMIT 2",
      (error: any, results: any, fields: any) => {
        if (error) {
          console.error("Error executing query:", error);
          return res.status(500).json({ error: error.message });
        }

        res.json({
          message: "Query object direct execution completed",
          data: results,
        });
      },
    );

    // Pass the query object directly to connection.query
    connection.query(queryObj);
  } catch (error: any) {
    console.error("Error in query-object-reuse:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test PoolNamespace.query().stream()
app.get("/test/pool-namespace-query-stream", async (req: Request, res: Response) => {
  try {
    // Create a pool cluster
    const poolCluster = mysql.createPoolCluster();

    poolCluster.add("NODE1", {
      host: process.env.MYSQL_HOST || "mysql",
      port: parseInt(process.env.MYSQL_PORT || "3306"),
      user: process.env.MYSQL_USER || "testuser",
      password: process.env.MYSQL_PASSWORD || "testpass",
      database: process.env.MYSQL_DB || "testdb",
    });

    const results: any[] = [];

    // Use the namespace to query and then call stream()
    const namespace = poolCluster.of("NODE*");
    const query = namespace.query("SELECT * FROM users ORDER BY id ASC");

    // This is the critical call - stream() may not exist in REPLAY mode
    const stream = query.stream();

    stream
      .on("error", (err) => {
        console.error("Stream error:", err);
        poolCluster.end(() => {});
        res.status(500).json({ error: err.message });
      })
      .on("data", (row) => {
        results.push(row);
      })
      .on("end", () => {
        poolCluster.end(() => {});
        res.json({
          message: "PoolNamespace.query().stream() test completed",
          count: results.length,
          data: results,
        });
      });
  } catch (error: any) {
    console.error("Error in pool-namespace-query-stream:", error);
    res.status(500).json({ error: error.message });
  }
});

// Pool connection with beginTransaction(options, callback) signature
app.post("/test/pool-connection-transaction-options", async (req: Request, res: Response) => {
  try {
    const pool = getPool();

    pool.getConnection((err, connection) => {
      if (err) {
        console.error("Error getting pool connection:", err);
        return res.status(500).json({ error: err.message });
      }

      // Use beginTransaction with (options, callback) signature
      (connection as any).beginTransaction({ timeout: 10000 }, (beginError: any) => {
        if (beginError) {
          connection.release();
          console.error("Error beginning transaction:", beginError);
          return res.status(500).json({ error: beginError.message });
        }

        const timestamp = Date.now();
        const key = `pool_tx_options_${timestamp}`;

        connection.query(
          "INSERT INTO cache (`key`, value, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 DAY))",
          [key, `Pool transaction with options test ${timestamp}`],
          (insertError: any, insertResults: any) => {
            if (insertError) {
              return connection.rollback(() => {
                connection.release();
                res.status(500).json({ error: insertError.message });
              });
            }

            // Commit with (options, callback) signature
            (connection as any).commit({ timeout: 10000 }, (commitError: any) => {
              connection.release();

              if (commitError) {
                return res.status(500).json({ error: commitError.message });
              }

              res.json({
                message: "Pool connection transaction with options completed",
                insertId: insertResults.insertId,
              });
            });
          },
        );
      });
    });
  } catch (error: any) {
    console.error("Error in pool-connection-transaction-options:", error);
    res.status(500).json({ error: error.message });
  }
});

// Test pool.getConnection() then query with pre-created Query object having internal _callback
// Tests if TdMysqlConnectionMock properly handles Query objects with _callback
app.get(
  "/test/pool-getconnection-query-with-internal-callback",
  async (req: Request, res: Response) => {
    try {
      const pool = getPool();

      pool.getConnection((err, connection) => {
        if (err) {
          console.error("Error getting connection:", err);
          return res.status(500).json({ error: err.message });
        }

        // Create a Query object with internal callback using mysql.createQuery
        const queryObj = (mysql as any).createQuery(
          "SELECT * FROM cache LIMIT 2",
          (queryErr: any, results: any, fields: any) => {
            connection.release();

            if (queryErr) {
              console.error("Query callback error:", queryErr);
              return res.status(500).json({ error: queryErr.message });
            }

            res.json({
              message: "pool.getConnection().query with internal callback completed",
              count: results.length,
              data: results,
            });
          },
        );

        // Pass the Query object directly to connection.query
        connection.query(queryObj);
      });
    } catch (error: any) {
      console.error("Error in pool-getconnection-query-with-internal-callback:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

// Test PoolNamespace.query with pre-created Query object that has internal _callback
app.get(
  "/test/pool-namespace-query-with-internal-callback",
  async (req: Request, res: Response) => {
    try {
      // Create a pool cluster
      const poolCluster = mysql.createPoolCluster();

      poolCluster.add("NODE1", {
        host: process.env.MYSQL_HOST || "mysql",
        port: parseInt(process.env.MYSQL_PORT || "3306"),
        user: process.env.MYSQL_USER || "testuser",
        password: process.env.MYSQL_PASSWORD || "testpass",
        database: process.env.MYSQL_DB || "testdb",
      });

      // Create a Query object with internal callback using mysql.createQuery
      // This is exactly how PoolNamespace.query internally works
      const queryObj = (mysql as any).createQuery(
        "SELECT * FROM users LIMIT 2",
        (err: any, results: any, fields: any) => {
          poolCluster.end(() => {});

          if (err) {
            console.error("Query callback error:", err);
            return res.status(500).json({ error: err.message });
          }

          res.json({
            message: "PoolNamespace.query with internal callback completed",
            count: results.length,
            data: results,
          });
        },
      );

      // Use the namespace to query by passing the pre-created Query object
      const namespace = poolCluster.of("NODE*");
      namespace.query(queryObj);
    } catch (error: any) {
      console.error("Error in pool-namespace-query-with-internal-callback:", error);
      res.status(500).json({ error: error.message });
    }
  },
);

// ===== KNEX TESTS =====

// Initialize knex instance
const knex = Knex({
  client: "mysql",
  connection: {
    host: process.env.MYSQL_HOST || "mysql",
    port: parseInt(process.env.MYSQL_PORT || "3306"),
    user: process.env.MYSQL_USER || "testuser",
    password: process.env.MYSQL_PASSWORD || "testpass",
    database: process.env.MYSQL_DB || "testdb",
  },
  pool: { min: 0, max: 5 },
});

app.get("/knex/basic-select", async (req: Request, res: Response) => {
  try {
    const results = await knex("cache").select("*").limit(3);
    res.json({
      message: "Knex basic select completed",
      count: results.length,
      data: results,
    });
  } catch (error: any) {
    console.error("Error in knex basic-select:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/knex/raw-query", async (req: Request, res: Response) => {
  try {
    const results = await knex.raw("SELECT COUNT(*) as count FROM cache");
    res.json({
      message: "Knex raw query completed",
      data: results[0],
    });
  } catch (error: any) {
    console.error("Error in knex raw-query:", error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const server = app.listen(PORT, async () => {
  try {
    await connectDb();
    await initializeDatabase();
    TuskDrift.markAppAsReady();
    console.log(`Server running on port ${PORT}`);
    console.log(`TUSK_DRIFT_MODE: ${process.env.TUSK_DRIFT_MODE || "DISABLED"}`);
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
});

// Graceful shutdown
async function shutdown() {
  console.log("Shutting down gracefully...");
  server.close(async () => {
    try {
      await closeDb();
    } catch (error) {
      console.error("Error during database cleanup:", error);
    }
    process.exit(0);
  });
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
