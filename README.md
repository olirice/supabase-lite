# PostgREST-Lite

A lightweight PostgREST-compatible query interface for SQLite, optimized for **Cloudflare Workers** with **D1**, built with strict TypeScript and comprehensive test coverage.

```bash
# Local development
npm run dev:example

# Query your data
curl "http://localhost:3000/users?select=id,name&age=gte.18"
curl "http://localhost:3000/posts?select=title,author(name,email)"
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

### ✅ Universal Deployment

The same codebase works on:
- **Cloudflare Workers** (with D1)
- **Node.js** (with better-sqlite3)
- **Bun, Deno** (via adapters)

### ✅ Production-Ready

- **182 tests** with 100% pass rate
- **Strict TypeScript** with zero `any` types
- **E2E tests** with complete isolation
- **Modular architecture** for easy extension
- **Error handling** with proper HTTP status codes
- **CORS support**
- **Health check endpoint**

---

## Quick Start

### Installation

```bash
npm install postgrest-lite
```

### Local Development

```typescript
import { startServer } from 'postgrest-lite/local';

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

### Cloudflare Workers

```typescript
import { createServer } from 'postgrest-lite/api';
import { D1Adapter } from 'postgrest-lite/database';

export default {
  async fetch(request, env, ctx) {
    const adapter = new D1Adapter(env.DB);
    const app = createServer({ db: adapter });
    return app.fetch(request, env, ctx);
  },
};
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

---

## Architecture

### Layered Design

```
┌─────────────────────────────────────────┐
│         HTTP Layer (Hono)               │
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

1. **Parser** - Converts PostgREST query strings to AST
2. **Compiler** - Compiles AST to SQL with resource embedding
3. **Schema** - Introspects database for relationships
4. **Adapters** - Abstract SQLite and D1 differences
5. **API Service** - Orchestrates query execution
6. **HTTP Server** - Hono-based REST endpoints

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
name = "postgrest-lite"
main = "src/workers/index.ts"
compatibility_date = "2024-01-01"

[[d1_databases]]
binding = "DB"
database_name = "postgrest-db"
database_id = "your-database-id"
```

**Deploy**:
```bash
# Create D1 database
wrangler d1 create postgrest-db

# Run migrations
wrangler d1 execute postgrest-db --file=./migrations/schema.sql

# Deploy
wrangler deploy
```

### Node.js

```typescript
import { startServer } from 'postgrest-lite/local';

await startServer({
  port: process.env.PORT || 3000,
  databasePath: process.env.DATABASE_PATH || 'data.db',
});
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

### Future Phases

- **Phase 6**: Mutations (INSERT, UPDATE, DELETE)
- **Phase 7**: Advanced filtering (full-text search, JSON operators)
- **Phase 8**: Performance optimizations (caching, connection pooling)
- **Phase 9**: Additional adapters (Postgres, Turso, PGlite)

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
