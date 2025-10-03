Here we talk about PII redaction rules.
Tentatively I have just called them "filters".

## Proposed syntax

Each filter is made up of two parts: a matcher, and a transform.

**Matcher**

A matcher denotes which part we want to act on.
For example
```
  "matcher": {
    "pathPattern": "/api/user/*",
    "method": "POST",
    "jsonPath": "$.user.password"
  }
```
says we want to run a transform on only the JSON field at this `jsonPath` for
requests that match the `pathPattern` and is `POST`.

For example
```
  "matcher": { "jsonPath": "$.user.ssn" },
```
says we want to run a transform on all JSON fields matching this `jsonPath`.

This configuration syntax was chosen mainly because of simplicity.
It is easy to explain, and to understand.
The thing that matches, is the thing that satisfies all conditions at the same
time.
Some pseudo code gets the idea across
```
def matched(matcher, method, path, jsonBody, queryParams, etc...):
  if matcher.pathPattern:
    if !matcher.pathPattern.find(path):
      return false
  if matcher.method:
    if matcher.method != method:
      return false
  if matcher.jsonPath:
    if matcher.jsonPath not in jsonBody:
      return false

  ...

  return true
```

The hairy thing now is that we need to introduce some kind of precedence or
"operator binding" for it to work.
Look at the first code example.
It is currently ambiguous if we want to redact the path or the JSON body.
Common sense tells us it is the body, but that still leaves room for confusion.
What if both a query param and a json path is provided?
Here is a quick set of rules to make it work and still be common sensical
enough:
- We can split matches into "common fields" and "matching fields".
- There can only be one matching field. There can be many common fields.
- Common fields are like `method`, `pathPattern`, etc.
- Matching fields are like `jsonPath`, `queryPath`, etc.
- Common fields are things nobody really cares to redact. They're just used to
narrow down the search.
- Matching fields are things that will be redacted. Only one is allowed to be
present so that it's clear what is going to be modified.

Available common fields:
- `method`
- `pathPattern`
- `host` (have to investigate what the SDK sees, `127.0.0.1` might not always
represent localhost for example)

Available matching fields:
- `jsonPath`
- `queryPath`
- `headerPath`

Questions:
- Does this cover most (sensible) cases? Are most things matchable with this
syntax?
- Is this intuitive enough?


**Transforms**

Transforms specify how to mutate the span.
This is relatively simple.
There only need to be three kinds of transforms:
1. Redact. This replaces the value with a hash.
2. Masking. This replaces the value with a repeated (or random) character. This
   satisfies the use case of fixed width strings (phone numbers, zip codes,
etc.)
3. Custom. User specifies a string to act as replacement. This can be used for
   things like testing token, etc.
4. Drop. Just drops the whole span.

An example config:
```
{
  "matcher": {
    "pathPattern": "/api/user/*",
    "method": "POST",
    "jsonPath": "$.user.password"
  },
  "transform": {
    "type": "redact"
  }
}
```

## Configuration

Each instrumentation will have their own configuration.
The user will specify this during `initialize` under the `<xyz>Config` field,
where xyz is the instrumentation module they're configuring.
For example, `httpConfig` holds stuff regarding the HTTP instrumentation (not
necessarily just filters!).
The big class then just injects the configurations to the right instrumentation
module.

One idea I had is, since it's all in code anyway, we could just have users
provide functions that we call.
That's great iff we don't want to be able to serialize configs.
In other words, we can consider doing it this way only if
- We don't really need users to provide a config file, just do it in code
- We don't really need to save the config file (for example to share with other
  services)
Which actually we can get by with?

## Refined Transform Configuration Format

```typescript

```

## Examples

### 1. Inbound Requests

#### Example: Redact
```json
{
  "matcher": {
    "direction": "inbound",
    "method": "POST",
    "pathPattern": "/api/auth/login",
    "jsonPath": "$.password"
  },
  "transform": {
    "type": "redact"
  }
}
```

**Before**: `{"username": "john@example.com", "password": "secretPassword123"}`
**After**: `{"username": "john@example.com", "password": "REDACTED_a7b9c1d2e3f4..."}`

#### Example: Mask
```json
{
  "matcher": {
    "direction": "inbound",
    "pathPattern": "/api/user/lookup",
    "queryParam": "ssn"
  },
  "transform": {
    "type": "mask",
    "maskChar": "X",
    "preserveLength": true
  }
}
```

**Before**: `/api/user/lookup?ssn=123-45-6789&name=john`
**After**: `/api/user/lookup?ssn=XXX-XX-XXXX&name=john`

#### Example: Replace
```json
{
  "matcher": {
    "direction": "inbound",
    "headerName": "Authorization"
  },
  "transform": {
    "type": "replace",
    "replaceWith": "Bearer test-token-12345"
  }
}
```

**Before**: `Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...`
**After**: `Authorization: Bearer test-token-12345`

#### Example: Drop
```json
{
  "matcher": {
    "direction": "inbound",
    "pathPattern": "/admin/internal/*"
  },
  "transform": {
    "type": "drop"
  }
}
```

**Before**: Span recorded for `/admin/internal/user-data`
**After**: No span recorded

### 2. Inbound Response

#### Example: Redact
```json
{
  "matcher": {
    "direction": "inbound",
    "pathPattern": "/api/user/profile",
    "jsonPath": "$.data.creditCard"
  },
  "transform": {
    "type": "redact"
  }
}
```

**Before**: `{"data": {"name": "John", "creditCard": "4111-1111-1111-1111"}}`
**After**: `{"data": {"name": "John", "creditCard": "REDACTED_b8c9d1e2f3g4..."}}`

#### Example: Mask
```json
{
  "matcher": {
    "direction": "inbound",
    "pathPattern": "/api/users",
    "jsonPath": "$.users[*].phone"
  },
  "transform": {
    "type": "mask",
    "maskChar": "*",
    "preserveLength": false
  }
}
```

**Before**: `{"users": [{"name": "John", "phone": "+1-555-123-4567"}]}`
**After**: `{"users": [{"name": "John", "phone": "***-***-****"}]}`

### 3. Outbound Request

#### Example: Redact
```json
{
  "matcher": {
    "direction": "outbound",
    "host": "api.stripe.com",
    "headerName": "Authorization"
  },
  "transform": {
    "type": "redact"
  },
  "description": "Redact Stripe API keys"
}
```

**Before**: `Authorization: Bearer sk_live_51234567890abcdef...`
**After**: `Authorization: REDACTED_c1d2e3f4a5b6...`

#### Example: Mask
```json
{
  "matcher": {
    "direction": "outbound",
    "host": "payments.example.com",
    "method": "POST",
    "jsonPath": "$.customer.creditCard.number"
  },
  "transform": {
    "type": "mask",
    "maskChar": "*",
    "preserveLength": true
  }
}
```

**Before**: `{"customer": {"creditCard": {"number": "4111111111111111"}}}`
**After**: `{"customer": {"creditCard": {"number": "************1111"}}}`

#### Example: Replace
```json
{
  "matcher": {
    "direction": "outbound",
    "host": "database.internal.com",
    "jsonPath": "$.auth.password"
  },
  "transform": {
    "type": "replace",
    "replaceWith": "test-db-password"
  }
}
```

**Before**: `{"auth": {"username": "dbuser", "password": "prod-secret-123"}}`
**After**: `{"auth": {"username": "dbuser", "password": "test-db-password"}}`

### 4. Outbound Response

#### Example: Redact
```json
{
  "matcher": {
    "direction": "outbound",
    "host": "api.external-service.com",
    "jsonPath": "$.users[*].email"
  },
  "transform": {
    "type": "redact"
  }
}
```

**Before**: `{"users": [{"id": 123, "email": "user@example.com"}]}`
**After**: `{"users": [{"id": 123, "email": "REDACTED_d1e2f3g4h5i6..."}]}`

#### Example: Mask
```json
{
  "matcher": {
    "direction": "outbound",
    "host": "api.bank.com",
    "jsonPath": "$.accounts[*].accountNumber"
  },
  "transform": {
    "type": "mask",
    "maskChar": "X",
    "preserveLength": false
  }
}
```

**Before**: `{"accounts": [{"type": "checking", "accountNumber": "1234567890123456"}]}`
**After**: `{"accounts": [{"type": "checking", "accountNumber": "XXXXXXXXXXXX3456"}]}`

## Configuration Integration

We can just set it up like this at the start.

```typescript
// During SDK initialization
TuskDrift.initialize({
  httpConfig: {
    filters: [
      // Inbound request filters
      {
        matcher: {
          direction: "inbound",
          method: "POST",
          pathPattern: "/api/auth/*",
          jsonPath: "$.password"
        },
        transform: { type: "redact" }
      }
    ]
  },
  pgConfig: {
    filters: [
      // Database query filters
      {
        matcher: {
          direction: "outbound",
          jsonPath: "$.query"
        },
        transform: {
          type: "replace",
          replaceWith: "SELECT * FROM users WHERE id = ?"
        }
      }
    ]
  }
});
```

We could choose to keep this configuration method in the future.
Or, we can migrate to a JSON file most likely.

# Some things to think about

- Conditional matching? Redact only if something else is true
- Other protocols or serialization formats?
- Do we want to use regex over substring matches? More powerful, but performance
  cost is more unbounded.
- Matcher for HTTP codes?
- Validation of configs?
- Other targets: cookies, path params (instead of just query params), form
fields, files?, graphql?, raw regex search and replace?
- Detectors: don't care what the field name is, match content on some regex,
like email, jwt, ipv4 ipv6, uuid, etc. This is definitely a big performance hog.
- Rule conflicts? Priority system, or allow two rules to run after the other?
- More granular `drop`. Perhaps just drop the JSON key? Or drop the body only,
keeping headers etc.?
