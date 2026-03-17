# Instrumentation Bug Hunting

## Arguments

$ARGUMENTS - The library name to test (e.g., mysql2, redis, pg, mongodb, ioredis, postgres, prisma, firestore, grpc, fetch, http, mysql, nextjs, upstash-redis-js)

## Library-to-GitHub-Repo Mapping

Use this mapping to clone the package source code for analysis:

| Library          | GitHub Repo                                    | Notes                                   |
| ---------------- | ---------------------------------------------- | --------------------------------------- |
| mysql2           | https://github.com/sidorares/node-mysql2       |                                         |
| redis            | https://github.com/redis/node-redis            | Monorepo — focus on `packages/client/`  |
| pg               | https://github.com/brianc/node-postgres        | Monorepo — focus on `packages/pg/`      |
| mongodb          | https://github.com/mongodb/node-mongodb-native |                                         |
| ioredis          | https://github.com/redis/ioredis               |                                         |
| postgres         | https://github.com/porsager/postgres           | (postgres.js)                           |
| prisma           | https://github.com/prisma/prisma               | Monorepo — focus on `packages/client/`  |
| firestore        | https://github.com/googleapis/nodejs-firestore |                                         |
| grpc             | https://github.com/grpc/grpc-node              | Monorepo — focus on `packages/grpc-js/` |
| fetch            | N/A                                            | Built-in Node.js API — no repo to clone |
| http             | N/A                                            | Built-in Node.js API — no repo to clone |
| mysql            | https://github.com/mysqljs/mysql               |                                         |
| nextjs           | https://github.com/vercel/next.js              | Monorepo — focus on `packages/next/`    |
| upstash-redis-js | https://github.com/upstash/redis-js            |                                         |

## E2E Test Variants

Each library has ESM and CJS variants. Use the **ESM variant** as the primary target for bug hunting:

| Library          | ESM variant path                                                                 |
| ---------------- | -------------------------------------------------------------------------------- |
| mysql2           | `src/instrumentation/libraries/mysql2/e2e-tests/esm-mysql2/`                     |
| redis            | `src/instrumentation/libraries/redis/e2e-tests/esm-redis/`                       |
| pg               | `src/instrumentation/libraries/pg/e2e-tests/esm-pg/`                             |
| mongodb          | `src/instrumentation/libraries/mongodb/e2e-tests/esm-mongodb/`                   |
| ioredis          | `src/instrumentation/libraries/ioredis/e2e-tests/esm-ioredis/`                   |
| postgres         | `src/instrumentation/libraries/postgres/e2e-tests/esm-postgres/`                 |
| prisma           | `src/instrumentation/libraries/prisma/e2e-tests/esm-prisma/`                     |
| firestore        | `src/instrumentation/libraries/firestore/e2e-tests/esm-firestore/`               |
| grpc             | `src/instrumentation/libraries/grpc/e2e-tests/esm-grpc/`                         |
| fetch            | `src/instrumentation/libraries/fetch/e2e-tests/esm-fetch/`                       |
| http             | `src/instrumentation/libraries/http/e2e-tests/esm-http/`                         |
| mysql            | `src/instrumentation/libraries/mysql/e2e-tests/esm-mysql/`                       |
| nextjs           | `src/instrumentation/libraries/nextjs/e2e-tests/esm-nextjs/`                     |
| upstash-redis-js | `src/instrumentation/libraries/upstash-redis-js/e2e-tests/esm-upstash-redis-js/` |

---

## Phase 0: Environment Setup

### 0.1 Validate the library argument

The library must be one of: fetch, firestore, grpc, http, ioredis, mongodb, mysql, mysql2, nextjs, pg, postgres, prisma, redis, upstash-redis-js.

If the argument is invalid, list the valid options and stop.

### 0.2 Docker Setup (Claude Code Web only)

Check if Docker is running. If not, start it:

```bash
dockerd --storage-driver=vfs &>/tmp/dockerd.log &
# Wait for Docker to be ready
for i in $(seq 1 30); do
  docker info &>/dev/null 2>&1 && break
  sleep 1
done
docker info &>/dev/null 2>&1 || { echo "Docker failed to start. Check /tmp/dockerd.log"; exit 1; }
```

If Docker is already running, skip this step.

### 0.3 Clone the package source code (for analysis only)

If the library has a GitHub repo (see mapping above), clone it for reference:

```bash
git clone --depth 1 <repo-url> /tmp/<library-name>-source
```

This is read-only reference material — you will NOT modify this repo.

### 0.4 Create a working branch

```bash
git checkout -b bug-hunt/<library>-$(date +%Y-%m-%d)
```

---

## Phase 1: Develop Understanding

### 1.1 Analyze the Instrumentation Code

Read the instrumentation code at:

```
src/instrumentation/libraries/$ARGUMENTS/Instrumentation.ts
```

Identify:

- Which functions from the package are patched/instrumented
- The patching strategy (what gets wrapped, when, and how)
- Any helper files in the same directory

### 1.2 Analyze Existing E2E Tests

Review the ESM variant's test files:

- `src/instrumentation/libraries/$ARGUMENTS/e2e-tests/esm-$ARGUMENTS/src/index.ts` — all test endpoints
- `src/instrumentation/libraries/$ARGUMENTS/e2e-tests/esm-$ARGUMENTS/src/test_requests.mjs` — which endpoints are called

Understand what functionality is already tested and identify coverage gaps.

### 1.3 Analyze the Package Source Code

If you cloned the package source, read it to understand:

- The package's entry points and full API surface
- Functions that are currently patched vs functions that exist but aren't patched
- Alternative call patterns, overloads, and edge cases

---

## Phase 2: Identify Potential Gaps

Reason about potential issues. Consider:

- **Untested parameters**: Parameter combinations not covered by existing tests
- **Alternative call patterns**: Can patched functions be invoked differently (callbacks vs promises, different overloads)?
- **Missing patches**: Functions that should be instrumented but aren't
- **Edge cases**: Null/undefined values, empty results, large payloads, streaming, connection errors
- **ORM/wrapper usage**: Libraries like Sequelize, Knex, Prisma that wrap the base driver — are those call paths instrumented?
- **Real-world usage patterns**: How is the package typically used in production apps?

Produce a prioritized list of potential bugs to investigate.

---

## Phase 3: Initialize Bug Tracking Document

Create `BUG_TRACKING.md` in the ESM e2e test directory:

```bash
# Path: src/instrumentation/libraries/$ARGUMENTS/e2e-tests/esm-$ARGUMENTS/BUG_TRACKING.md
```

```markdown
# $ARGUMENTS Instrumentation Bug Tracking

Generated: <current date and time>

## Summary

- Total tests attempted: 0
- Confirmed bugs: 0
- No bugs found: 0
- Skipped tests: 0

---

## Test Results

(Tests will be documented below as they are completed)
```

---

## Phase 4: Write Tests and Verify Issues

For each potential bug, follow this workflow:

### 4.1 Initial Setup (Once)

Navigate to the ESM e2e test directory:

```bash
cd src/instrumentation/libraries/$ARGUMENTS/e2e-tests/esm-$ARGUMENTS/
```

Start Docker containers:

```bash
docker compose up -d --build --wait
```

Install dependencies:

```bash
docker compose exec -T app npm install
```

### 4.2 Test Each Potential Bug (Repeat for each)

#### A. Clean Previous Test Data

```bash
rm -rf .tusk/traces/* .tusk/logs/*
```

#### B. Write New Test Endpoint

Add a new endpoint to `src/index.ts` that exercises the potential bug. Also add the corresponding request to `src/test_requests.mjs`.

Example:

```typescript
app.get("/test/my-new-test", async (req, res) => {
  // Your test code here
  res.json({ success: true });
});
```

#### C. Test in DISABLED Mode (No Instrumentation)

Start server without instrumentation:

```bash
docker compose exec -e TUSK_DRIFT_MODE=DISABLED app sh -c "npm run build && npm run dev"
```

Wait for server to start:

```bash
sleep 5
```

Hit the endpoint:

```bash
docker compose exec app curl -s http://localhost:3000/test/my-new-test
```

**Verify**: Response is correct and endpoint works.

Stop the server:

```bash
docker compose exec app pkill -f "node" || true
sleep 2
```

**If the endpoint fails in DISABLED mode**:

- Update `BUG_TRACKING.md` with status: "Skipped - Failed in DISABLED mode"
- Fix the test code or move on to next potential bug

#### D. Test in RECORD Mode (With Instrumentation)

Clean traces and logs:

```bash
rm -rf .tusk/traces/* .tusk/logs/*
```

Start server in RECORD mode:

```bash
docker compose exec -e TUSK_DRIFT_MODE=RECORD app sh -c "npm run build && npm run dev"
```

Wait for server to start:

```bash
sleep 5
```

Hit the endpoint:

```bash
docker compose exec app curl -s http://localhost:3000/test/my-new-test
```

Wait for spans to export:

```bash
sleep 3
```

Stop the server:

```bash
docker compose exec app pkill -f "node" || true
sleep 2
```

**Check for issues:**

1. **Endpoint returns error or wrong response vs DISABLED mode**:
   - BUG FOUND: Instrumentation breaks functionality
   - Update `BUG_TRACKING.md`: Status "Confirmed Bug - RECORD mode failure", Failure Point "RECORD"
   - Keep the endpoint, move to next

2. **No traces created** (`ls .tusk/traces/`):
   - BUG FOUND: Instrumentation failed to capture traffic
   - Update `BUG_TRACKING.md`: Status "Confirmed Bug - No traces captured", Failure Point "RECORD"
   - Keep the endpoint, move to next

#### E. Test in REPLAY Mode

Run the Tusk CLI to replay:

```bash
docker compose exec -T -e TUSK_ANALYTICS_DISABLED=1 app tusk run --print --output-format "json" --enable-service-logs --disable-sandbox
```

**Check for issues:**

1. **Test fails** (`"passed": false` in JSON output):
   - BUG FOUND: Replay doesn't match recording
   - Update `BUG_TRACKING.md`: Status "Confirmed Bug - REPLAY mismatch", Failure Point "REPLAY"

2. **No logs created** (`ls .tusk/logs/`):
   - BUG FOUND: Replay failed to produce logs
   - Update `BUG_TRACKING.md`: Status "Confirmed Bug - No replay logs", Failure Point "REPLAY"

3. **Logs contain TCP warnings**:
   ```bash
   docker compose exec app cat .tusk/logs/*.log | grep -i "TCP called from inbound request context"
   ```

   - BUG FOUND: Unpatched dependency detected
   - Update `BUG_TRACKING.md`: Status "Confirmed Bug - Unpatched dependency", Failure Point "REPLAY"

#### F. No Bug Found

If all modes pass with no issues:

- Update `BUG_TRACKING.md`: Status "No Bug - Test passed all modes"
- **Remove the test endpoint** from `src/index.ts` and `src/test_requests.mjs`
- Move to next potential bug

---

## Phase 5: Bug Tracking Documentation Format

After each test, append to `BUG_TRACKING.md`:

```markdown
### Test N: [Brief description]

**Status**: [Confirmed Bug | No Bug | Skipped]

**Endpoint**: `/test/endpoint-name`

**Failure Point**: [DISABLED | RECORD | REPLAY | N/A]

**Description**:
[What this test was trying to uncover]

**Expected Behavior**:
[What should happen]

**Actual Behavior**:
[What actually happened]

**Error Logs**:
```

[Relevant error messages, stack traces, or warnings]

```

**Additional Notes**:
[Observations, potential root causes, context]

---
```

**Important**: Update `BUG_TRACKING.md` immediately after each test — do not batch updates.

---

## Phase 6: Cleanup and Commit

After testing all potential bugs:

```bash
docker compose down
```

Clean up cloned package source:

```bash
rm -rf /tmp/*-source
```

**Final state of the e2e test files:**

- `src/index.ts` should contain ONLY the original endpoints + new endpoints that expose confirmed bugs
- `src/test_requests.mjs` should be updated to include requests to bug-exposing endpoints
- `BUG_TRACKING.md` should have accurate summary counts and all test results

Commit the changes:

```bash
git add src/instrumentation/libraries/$ARGUMENTS/e2e-tests/esm-$ARGUMENTS/
git commit -m "bug-hunt($ARGUMENTS): add e2e tests exposing instrumentation bugs

Found N confirmed bugs in $ARGUMENTS instrumentation.
See BUG_TRACKING.md for details.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

Push the branch:

```bash
git push origin bug-hunt/$ARGUMENTS-$(date +%Y-%m-%d)
```

---

## Success Criteria

1. Created `BUG_TRACKING.md` before starting any tests
2. Tested all identified potential bugs
3. Updated `BUG_TRACKING.md` after each individual test
4. Only bug-exposing endpoints remain in test files
5. Removed test endpoints that didn't expose bugs
6. Accurate summary counts in `BUG_TRACKING.md`
7. Changes committed and pushed to a `bug-hunt/` branch
