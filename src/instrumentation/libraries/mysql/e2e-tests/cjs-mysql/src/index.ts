import { TuskDrift } from "./tdInit";
import express, { Request, Response } from "express";
import { getConnection, getPool, connectDb, closeDb } from "./db/index";
import mysql from "mysql";

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
    console.log("Testing connection.query with callback...");
    const connection = getConnection();

    connection.query("SELECT * FROM cache LIMIT 3", (error, results, fields) => {
      if (error) {
        console.error("Error executing query:", error);
        return res.status(500).json({ error: error.message });
      }

      console.log("Query results:", results);
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
    console.log("Testing connection.query with parameters...");
    const connection = getConnection();
    const key = (req.query.key as string) || "test_key_1";

    connection.query("SELECT * FROM cache WHERE `key` = ?", [key], (error, results, fields) => {
      if (error) {
        console.error("Error executing query:", error);
        return res.status(500).json({ error: error.message });
      }

      console.log("Query results:", results);
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
    console.log("Testing connection.query with options object...");
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

      console.log("Query results:", results);
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
    console.log("Testing connection.query with event emitter...");
    const connection = getConnection();

    const results: any[] = [];
    const query = connection.query("SELECT * FROM users");

    query
      .on("error", (err) => {
        console.error("Query error:", err);
        res.status(500).json({ error: err.message });
      })
      .on("fields", (fields) => {
        console.log(
          "Received fields:",
          fields.map((f: any) => f.name),
        );
      })
      .on("result", (row) => {
        console.log("Received row:", row);
        results.push(row);
      })
      .on("end", () => {
        console.log("Query completed");
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
    console.log("Testing multi-statement query...");
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

      console.log("Multi-statement results:", results);
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
    console.log("Testing pool.query...");
    const pool = getPool();

    pool.query("SELECT * FROM cache ORDER BY created_at DESC LIMIT 2", (error, results, fields) => {
      if (error) {
        console.error("Error executing pool query:", error);
        return res.status(500).json({ error: error.message });
      }

      console.log("Pool query results:", results);
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
    console.log("Testing pool.getConnection...");
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

        console.log("Pooled connection query results:", results);
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

// ===== TRANSACTION TESTS =====

// Test transaction with commit
app.post("/transaction/commit", async (req: Request, res: Response) => {
  try {
    console.log("Testing transaction with commit...");
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

            console.log("Transaction committed successfully");
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

// Test transaction with rollback
app.post("/transaction/rollback", async (req: Request, res: Response) => {
  try {
    console.log("Testing transaction with rollback...");
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

            console.log("Transaction rolled back successfully");
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
    console.log("Testing INSERT query...");
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

        console.log("INSERT results:", results);
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
    console.log("Testing UPDATE query...");
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

        console.log("UPDATE results:", results);
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
    console.log("Testing DELETE query...");
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

      console.log("DELETE results:", results);
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
    console.log("Testing JOIN query...");
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

      console.log("JOIN results:", results);
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
    console.log("Testing aggregate query...");
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

      console.log("Aggregate results:", results);
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
    console.log("Testing subquery...");
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

      console.log("Subquery results:", results);
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
    console.log("Testing prepared statement-like query...");
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

      console.log("Prepared query results:", results);
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
    console.log("Testing connection.ping()...");
    const connection = getConnection();

    connection.ping((error) => {
      if (error) {
        console.error("Error pinging connection:", error);
        return res.status(500).json({ error: error.message });
      }

      console.log("Ping successful");
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
    console.log("Testing connection.end()...");

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
      console.log("'end' event received");
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

        console.log("Connection ended successfully");

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
    console.log("Testing connection.changeUser()...");

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

          console.log("User changed successfully");
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
    console.log("Testing connection.pause() and resume()...");
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
          console.log("Connection paused");

          // Resume after a short delay
          resumePromise = new Promise((resolve) => {
            setTimeout(() => {
              connection.resume();
              isResumed = true;
              console.log("Connection resumed");
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

        console.log("Pause/Resume query completed");
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
    console.log("Testing pool.end()...");

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

      console.log("Test query executed on temp pool");

      // Now end the pool
      tempPool.end((endError) => {
        if (endError) {
          console.error("Error ending pool:", endError);
          return res.status(500).json({ error: endError.message });
        }

        console.log("Pool ended successfully");
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
    console.log("Testing 'connect' event...");

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
      console.log("'connect' event received");
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

        console.log("Connect event test completed");
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
    console.log("Testing connection.destroy()...");

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
    console.log("Testing query.stream() method...");
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
        console.log("Received data from stream:", row);
        results.push(row);
      })
      .on("end", () => {
        console.log("Stream ended");
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

// Start server
const server = app.listen(PORT, async () => {
  try {
    await connectDb();
    await initializeDatabase();
    TuskDrift.markAppAsReady();
    console.log(`Server running on port ${PORT}`);
    console.log(`TUSK_DRIFT_MODE: ${process.env.TUSK_DRIFT_MODE || "DISABLED"}`);
    console.log("Available endpoints:");
    console.log("  GET    /health - Health check");
    console.log("");
    console.log("  Connection Tests:");
    console.log("  GET    /connection/query-callback - Basic query with callback");
    console.log("  GET    /connection/query-params - Query with parameters");
    console.log("  GET    /connection/query-options - Query with options object");
    console.log("  GET    /connection/query-stream - Query with event emitter");
    console.log("  GET    /connection/multi-statement - Multi-statement query");
    console.log("");
    console.log("  Pool Tests:");
    console.log("  GET    /pool/query - Pool query");
    console.log("  GET    /pool/get-connection - Pool getConnection");
    console.log("");
    console.log("  Transaction Tests:");
    console.log("  POST   /transaction/commit - Transaction with commit");
    console.log("  POST   /transaction/rollback - Transaction with rollback");
    console.log("");
    console.log("  CRUD Tests:");
    console.log("  POST   /crud/insert - INSERT query");
    console.log("  PUT    /crud/update - UPDATE query");
    console.log("  DELETE /crud/delete - DELETE query");
    console.log("");
    console.log("  Advanced Tests:");
    console.log("  GET    /advanced/join - JOIN query");
    console.log("  GET    /advanced/aggregate - Aggregate functions");
    console.log("  GET    /advanced/subquery - Subquery");
    console.log("  GET    /advanced/prepared - Prepared statement-like query");
    console.log("");
    console.log("  Lifecycle Tests:");
    console.log("  GET    /lifecycle/ping - Connection ping");
    console.log("  GET    /lifecycle/end-and-reconnect - Connection end");
    console.log("  POST   /lifecycle/change-user - Connection changeUser");
    console.log("  GET    /lifecycle/pause-resume - Connection pause/resume");
    console.log("");
    console.log("  Pool Lifecycle Tests:");
    console.log("  GET    /pool/end-and-recreate - Pool end");
    console.log("");
    console.log("  Event Tests:");
    console.log("  GET    /events/connect - Connect event emission");
    console.log("  GET    /test/connection-destroy - Connection destroy");
    console.log("");
    console.log("  Stream Tests:");
    console.log("  GET    /stream/query-stream-method - Query.stream() method");
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
