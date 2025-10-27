# Supabase-Lite

**⚠️ Experimental POC / Toy Project - Not Production Ready**

A partially API-compatible implementation of a subset of **Supabase** for **SQLite/D1**. This proof-of-concept implements PostgREST-style queries + Auth/RLS, allowing Supabase client libraries to work (with limitations). Optimized for **Cloudflare Workers** with **D1**, built with strict TypeScript and comprehensive test coverage.

**What works:**
- PostgREST-compatible query syntax (filtering, ordering, embedding)
- JWT authentication with GoTrue-compatible endpoints
- Row-Level Security (RLS) policies
- Runs on SQLite (Node.js) and D1 (Cloudflare Workers)

**What doesn't:**
- Many Supabase features (Storage, Realtime, Edge Functions, etc.)
- Full PostgREST compatibility (many operators and features missing)
- Production-grade performance, security, or reliability

```bash
# Local development
npm run dev:example

# Query your data
curl "http://localhost:3000/users?select=id,name&age=gte.18"
curl "http://localhost:3000/posts?select=title,author(name,email)"

# With authentication & RLS
curl "http://localhost:3000/posts" \
  -H "Authorization: Bearer <token>"
```

---

## Features

### ✅ PostgREST-Compatible Query Syntax

```bash
# Basic queries
GET /users
GET /users?select=id,name,email
GET /users?age=gte.30&active=eq.true

# Ordering and pagination
GET /users?order=age.desc&limit=10&offset=20

# Pattern matching
GET /users?name=like.*Smith*
GET /users?email=ilike.*@gmail.com

# Logical operators
GET /users?and=(age.gte.18,active.eq.true)
GET /users?or=(status.eq.active,status.eq.pending)
```

### ✅ Resource Embedding (Relationships)

```bash
# Many-to-one
GET /posts?select=id,title,author(name,email)

# One-to-many
GET /users?select=id,name,posts(id,title)

# Nested embedding
GET /posts?select=title,author(name,posts(title))

# With aliases
GET /posts?select=id,creator:author(name)
```

### ✅ Authentication & Row-Level Security (RLS)

```typescript
// Enable authentication and RLS
const app = createServer({
  db: adapter,
  auth: {
    enabled: true,
    jwtSecret: 'your-secret-key',
    goTrue: true, // Supabase client compatibility
  },
  rls: {
    enabled: true,
  },
});

// Define RLS policies
await rlsProvider.enableRLS('posts');
await rlsProvider.createPolicy({
  name: 'anon_read_published',
  tableName: 'posts',
  command: 'SELECT',
  role: 'anon',
  using: policy.eq('published', 1), // Only published posts
});

await rlsProvider.createPolicy({
  name: 'auth_read_all',
  tableName: 'posts',
  command: 'SELECT',
  role: 'authenticated',
  using: policy.alwaysAllow(), // All posts
});
```

**Authentication:**
- JWT-based authentication with two roles: `anon` (unauthenticated) and `authenticated`
- GoTrue-compatible endpoints (`/auth/v1/signup`, `/auth/v1/token`) for Supabase client
- Extracts tokens from `Authorization: Bearer <token>` or `apikey` headers
- Injects `RequestContext` with role and user ID into every request

**RLS Policies:**
- Define row-level security policies per table and role
- Type-safe policy builder API with auth functions
- Policies automatically applied based on request context

```bash
# Unauthenticated request (role=anon)
curl "http://localhost:3000/posts" \
  -H "apikey: <anon-key>"
# Returns: Only published posts

# Authenticated request (role=authenticated)
curl "http://localhost:3000/posts" \
  -H "Authorization: Bearer <user-token>"
# Returns: All posts (published + unpublished)
```

**Policy Builder Functions:**
- **Comparisons**: `eq()`, `neq()`, `gt()`, `gte()`, `lt()`, `lte()`, `in()`, `like()`, `ilike()`
- **Null checks**: `isNull()`, `isNotNull()`
- **Logical**: `and()`, `or()`
- **Auth functions**: `authUid()`, `authRole()`
- **Special**: `alwaysAllow()`, `alwaysDeny()`

**Example Policies:**

```typescript
// Users can only see their own posts
policy.eq('user_id', policy.authUid())

// Users can see their own posts OR published posts
policy.or(
  policy.eq('user_id', policy.authUid()),
  policy.eq('published', 1)
)

// Admins only
policy.eq('role', 'admin')

// Public posts in specific categories
policy.and(
  policy.eq('published', 1),
  policy.in('category', ['news', 'blog'])
)
```

---

## Quick Start

### Installation

```bash
npm install supabase-lite
```

### Local Development

```typescript
import { startServer } from 'supabase-lite/local';

const { adapter } = await startServer({
  port: 3000,
  databasePath: 'data.db',
});

// Set up your schema
await adapter.exec(`
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL
  );
`);
```

---

## Examples

### Basic Query

```bash
$ curl "http://localhost:3000/users?age=gte.30&order=age.desc"
```

```json
[
  { "id": 3, "name": "Charlie", "age": 35 },
  { "id": 1, "name": "Alice", "age": 30 }
]
```

### Resource Embedding

```bash
$ curl "http://localhost:3000/posts?select=title,author(name,email)"
```

```json
[
  {
    "title": "First Post",
    "author": {
      "name": "Alice",
      "email": "alice@example.com"
    }
  }
]
```

### Complex Query

```bash
$ curl "http://localhost:3000/posts?select=title,author(name)&status=eq.published&order=published_at.desc&limit=5"
```

```json
[
  {
    "title": "Latest Article",
    "author": { "name": "Alice" }
  },
  {
    "title": "Previous Article",
    "author": { "name": "Bob" }
  }
]
```

### Authentication & RLS

```bash
# Sign up a new user
$ curl -X POST "http://localhost:3000/auth/v1/signup" \
  -H "apikey: <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123"}'

# Login to get access token
$ curl -X POST "http://localhost:3000/auth/v1/token" \
  -H "apikey: <anon-key>" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123"}'

# Access protected data with token
$ curl "http://localhost:3000/posts" \
  -H "Authorization: Bearer <access-token>"
```

```json
{
  "access_token": "eyJhbGc...",
  "token_type": "bearer",
  "expires_in": 86400,
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "alice@example.com"
  }
}
```

---

## Architecture

### Layered Design

```
┌─────────────────────────────────────────┐
│         HTTP Layer (Hono)               │
│      ┌────────────────────────┐         │
│      │  Auth Middleware       │         │
│      │  RLS Middleware        │         │
│      └────────────────────────┘         │
├─────────────────────────────────────────┤
│         API Service                     │
│  ┌──────────┬──────────┬──────────┐    │
│  │  Parser  │ Compiler │  Schema  │    │
│  └──────────┴──────────┴──────────┘    │
├─────────────────────────────────────────┤
│       Database Adapter Interface        │
├──────────────┬──────────────────────────┤
│ SqliteAdapter│      D1Adapter           │
└──────────────┴──────────────────────────┘
```

### Components

1. **Auth Middleware** - JWT validation and context injection
2. **RLS Middleware** - Row-level security policy enforcement
3. **Parser** - Converts PostgREST query strings to AST
4. **Compiler** - Compiles AST to SQL with resource embedding
5. **Schema** - Introspects database for relationships
6. **Adapters** - Abstract SQLite and D1 differences
7. **API Service** - Orchestrates query execution
8. **HTTP Server** - Hono-based REST endpoints

---

## API Reference

### Query Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `select` | Column selection | `select=id,name,email` |
| `{column}` | Filter on column | `age=gte.30` |
| `order` | Sort order | `order=age.desc` |
| `limit` | Limit results | `limit=10` |
| `offset` | Offset results | `offset=20` |
| `and` | Logical AND | `and=(a.eq.1,b.eq.2)` |
| `or` | Logical OR | `or=(a.eq.1,b.eq.2)` |

### Filter Operators

| Operator | Description | Example |
|----------|-------------|---------|
| `eq` | Equals | `age=eq.30` |
| `neq` | Not equals | `age=neq.30` |
| `gt` | Greater than | `age=gt.30` |
| `gte` | Greater than or equal | `age=gte.30` |
| `lt` | Less than | `age=lt.30` |
| `lte` | Less than or equal | `age=lte.30` |
| `like` | Pattern match | `name=like.*Smith*` |
| `ilike` | Case-insensitive pattern | `email=ilike.*@GMAIL.COM` |
| `is` | IS operator | `deleted_at=is.null` |
| `in` | IN operator | `status=in.(active,pending)` |

### Resource Embedding

```
# Syntax: table(columns)
GET /posts?select=id,author(name,email)

# With alias: alias:table(columns)
GET /posts?select=id,creator:author(name)

# Wildcard: table(*)
GET /posts?select=id,author(*)

# Nested: table(column,nested_table(columns))
GET /posts?select=author(name,posts(title))
```

### Authentication Endpoints

When authentication is enabled, the following endpoints are available:

| Endpoint | Method | Description | Headers Required |
|----------|--------|-------------|------------------|
| `/auth/signup` | POST | Create new user account | `apikey`, `Content-Type: application/json` |
| `/auth/login` | POST | Authenticate and get token | `apikey`, `Content-Type: application/json` |
| `/auth/v1/signup` | POST | GoTrue-compatible signup | `apikey`, `Content-Type: application/json` |
| `/auth/v1/token` | POST | GoTrue-compatible login | `apikey`, `Content-Type: application/json` |

**Signup Request Body:**
```json
{
  "email": "user@example.com",
  "password": "secure-password",
  "username": "optional-username"
}
```

**Login Request Body:**
```json
{
  "email": "user@example.com",
  "password": "secure-password"
}
```

**Response:**
```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 86400,
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "username": "username"
  }
}
```

**Using Authentication:**

All authenticated requests should include the access token:

```bash
# Via Authorization header (recommended)
curl "http://localhost:3000/posts" \
  -H "Authorization: Bearer <access-token>"

# Via apikey header (for Supabase client compatibility)
curl "http://localhost:3000/posts" \
  -H "apikey: <access-token>"
```

### RLS Policy Configuration

```typescript
import { SqliteRLSProvider } from 'supabase-lite/rls';
import { policy } from 'supabase-lite/rls/policy-builder';

const rlsProvider = new SqliteRLSProvider(db);

// Enable RLS on a table
await rlsProvider.enableRLS('posts');

// Create a policy
await rlsProvider.createPolicy({
  name: 'policy_name',
  tableName: 'posts',
  command: 'SELECT',  // or 'INSERT', 'UPDATE', 'DELETE'
  role: 'authenticated',  // or 'anon'
  using: policy.eq('user_id', policy.authUid()),
});

// Disable RLS on a table
await rlsProvider.disableRLS('posts');

// Drop a policy
await rlsProvider.dropPolicy('posts', 'policy_name');
```

---

## Development

### Run Tests

```bash
# All tests
npm test

# E2E tests only
npm run test:e2e

# Watch mode
npm run test:watch

# Coverage
npm run test:coverage
```

### Run Example Server

```bash
npm run dev:example
```

Then try:
```bash
curl http://localhost:3000/users
curl "http://localhost:3000/posts?select=title,author(name)"
```

### Build

```bash
npm run build
```

### Type Check

```bash
npm run type-check
```

---

## Deployment

### Cloudflare Workers

**wrangler.toml**:
```toml
name = "supabase-lite"
main = "src/workers/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "supabase-db"
database_id = "your-database-id"
```

**Deploy**:
```bash
# Create D1 database
wrangler d1 create supabase-db

# Run migrations
wrangler d1 execute supabase-db --file=./migrations/schema.sql

# Deploy
wrangler deploy
```

### Node.js

```typescript
import { startServer } from 'supabase-lite/local';

await startServer({
  port: process.env.PORT || 3000,
  databasePath: process.env.DATABASE_PATH || 'data.db',
  auth: {
    enabled: true,
    jwtSecret: process.env.JWT_SECRET,
    goTrue: true,
  },
  rls: {
    enabled: true,
  },
});
```

**Environment Variables:**
```bash
PORT=3000
DATABASE_PATH=./data.db
JWT_SECRET=your-secret-key-min-32-chars
```

---

## Testing

### Test Philosophy

**Complete Isolation** - Each test creates its own database:

```typescript
test('GET /users - all rows', async () => {
  // Create isolated database
  const adapter = createTestDb(
    `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)`,
    `INSERT INTO users (id, name) VALUES (1, 'Alice')`
  );

  // Create server
  const app = createServer({ db: adapter });

  // Make request
  const res = await app.request('/users');

  // Verify
  expect(res.status).toBe(200);
  expect(await res.json()).toHaveLength(1);

  // Cleanup
  adapter.close();
});
```

**Benefits:**
- ✅ Tests can run in parallel
- ✅ No shared state
- ✅ Clear test intent
- ✅ Easy to debug

### Test Statistics

- **182 total tests** (all passing)
  - 102 parser tests
  - 62 integration tests
  - 18 E2E tests
- **~560ms** total execution time
- **100% pass rate**

---

## Performance

### Benchmarks

| Operation | Time | Notes |
|-----------|------|-------|
| Simple query | ~2ms | SELECT with filter |
| Resource embedding | ~5ms | Many-to-one join |
| Nested embedding | ~8ms | Two-level nesting |
| Schema introspection | ~5ms | Cached after first request |

**Environment**: M1 Mac, in-memory SQLite

### Optimizations

- ✅ Schema caching (enabled by default)
- ✅ Prepared statements
- ✅ Minimal JSON parsing overhead
- ✅ Zero-copy where possible

---

## Roadmap

### Phase 1 ✅ Complete
- PostgREST query parser
- 102 parser tests

### Phase 2 ✅ Complete
- SQLite-compatible adaptations
- Pattern quantifiers
- IS operator extensions

### Phase 3 ✅ Complete
- SQL compiler
- 51 integration tests
- Parameterized queries

### Phase 4 ✅ Complete
- Schema introspection
- Resource embedding
- 11 integration tests

### Phase 5 ✅ Complete
- Database adapter abstraction
- REST API server (Hono)
- 18 E2E tests
- Cloudflare Workers support

### Phase 6 ✅ Complete
- JWT-based authentication
- GoTrue-compatible auth endpoints
- Row-Level Security (RLS) policies
- Type-safe policy builder API
- Auth context injection middleware

### Future Phases

- **Phase 7**: Mutations (INSERT, UPDATE, DELETE)
- **Phase 8**: Advanced filtering (full-text search, JSON operators)
- **Phase 9**: Performance optimizations (caching, connection pooling)
- **Phase 10**: Additional adapters (Postgres, Turso, PGlite)

---

## Contributing

Contributions welcome! Please:

1. Write tests first (TDD)
2. Maintain 100% pass rate
3. Follow TypeScript strict mode
4. Update documentation

---

## License

MIT

---

## Acknowledgments

Built with:
- **[Hono](https://hono.dev/)** - Universal web framework
- **[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)** - Fast SQLite for Node.js
- **[Vitest](https://vitest.dev/)** - Fast unit testing
- **[TypeScript](https://www.typescriptlang.org/)** - Type safety

Inspired by:
- **[PostgREST](https://postgrest.org/)** - RESTful API for PostgreSQL
- **[Supabase](https://supabase.com/)** - Open source Firebase alternative

---

## Documentation

- [Phase 1: Parser](./PHASE_1_PARSER_COMPLETE.md)
- [Phase 2: SQLite Adaptations](./PHASE_2_SQLITE_ADAPTATIONS.md)
- [Phase 3: SQL Compiler](./PHASE_3_COMPILER_COMPLETE.md)
- [Phase 4: Resource Embedding](./PHASE_4_RESOURCE_EMBEDDING_COMPLETE.md)
- [Phase 5: REST API Server](./PHASE_5_REST_API_COMPLETE.md)

---

Made with ❤️ using TDD and strict TypeScript
