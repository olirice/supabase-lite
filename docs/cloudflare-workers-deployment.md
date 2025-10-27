# Cloudflare Workers Deployment Guide

This guide walks you through deploying `supabase-lite` to Cloudflare Workers with D1 (Cloudflare's SQLite database).

**⚠️ Note: This is an experimental POC, not production-ready.**

## Table of Contents

- [Prerequisites](#prerequisites)
- [Project Setup](#project-setup)
- [Database Configuration](#database-configuration)
- [Worker Implementation](#worker-implementation)
- [Local Development](#local-development)
- [Deployment](#deployment)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before you begin, ensure you have:

- Node.js 18+ installed
- A Cloudflare account (free tier works fine)
- Wrangler CLI installed: `npm install -g wrangler`
- Authenticated with Wrangler: `wrangler login`

## Project Setup

### 1. Create a new Cloudflare Workers project

```bash
# Create project directory
mkdir my-supabase-api
cd my-supabase-api

# Initialize package.json
npm init -y

# Install dependencies
npm install supabase-lite hono
npm install -D wrangler @cloudflare/workers-types typescript
```

### 2. Initialize TypeScript

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "./dist"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

### 3. Configure Wrangler

Create `wrangler.toml`:

```toml
name = "my-supabase-api"
main = "src/index.ts"
compatibility_date = "2024-01-01"

# D1 Database binding
[[d1_databases]]
binding = "DB"
database_name = "my-supabase-db"
database_id = "YOUR_DATABASE_ID"  # Will be filled in after creating D1 database

# Optional: Environment variables
[vars]
ENVIRONMENT = "production"

# Optional: CORS configuration
[cors]
allow_origins = ["*"]
allow_methods = ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]
allow_headers = ["Content-Type", "Authorization"]
```

## Database Configuration

### 1. Create a D1 Database

```bash
# Create D1 database
wrangler d1 create my-supabase-db

# Copy the database ID from output and update wrangler.toml
```

The output will look like:

```
✅ Successfully created DB 'my-supabase-db'
Created your database using D1's new storage backend.

[[d1_databases]]
binding = "DB"
database_name = "my-supabase-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

Copy the `database_id` into your `wrangler.toml`.

### 2. Create Database Schema

Create `schema.sql`:

```sql
-- Example schema for a blog application

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  content TEXT,
  author_id INTEGER NOT NULL,
  status TEXT DEFAULT 'draft',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (author_id) REFERENCES users(id)
);

CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (post_id) REFERENCES posts(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Insert sample data
INSERT INTO users (name, email) VALUES
  ('Alice', 'alice@example.com'),
  ('Bob', 'bob@example.com');

INSERT INTO posts (title, content, author_id, status) VALUES
  ('First Post', 'Hello world!', 1, 'published'),
  ('Second Post', 'More content', 1, 'draft'),
  ('Third Post', 'Even more', 2, 'published');

INSERT INTO comments (post_id, user_id, content) VALUES
  (1, 2, 'Great post!'),
  (1, 1, 'Thanks!');
```

### 3. Apply Schema

```bash
# Apply schema locally (for development)
wrangler d1 execute my-supabase-db --local --file=./schema.sql

# Apply schema to production
wrangler d1 execute my-supabase-db --remote --file=./schema.sql
```

## Worker Implementation

Create `src/index.ts`:

```typescript
import { createServer } from 'supabase-lite';
import { D1Adapter } from 'supabase-lite/d1-adapter';

export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Create D1 adapter
    const dbAdapter = new D1Adapter(env.DB);

    // Create PostgREST server
    const app = createServer({
      db: dbAdapter,
      cors: {
        origin: '*', // Configure as needed
        credentials: true,
      },
    });

    // Handle request
    return app.fetch(request, env, ctx);
  },
};
```

### Advanced Configuration with Custom Routes

If you need custom routes or authentication:

```typescript
import { createServer } from 'supabase-lite';
import { D1Adapter } from 'supabase-lite/d1-adapter';
import { Hono } from 'hono';
import { cors } from 'hono/cors';

export interface Env {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const dbAdapter = new D1Adapter(env.DB);
    const postgrestApp = createServer({ db: dbAdapter });

    // Create main app with custom routes
    const app = new Hono<{ Bindings: Env }>();

    // Add CORS
    app.use('*', cors({
      origin: ['https://yourdomain.com'],
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization'],
      credentials: true,
    }));

    // Health check endpoint
    app.get('/health', (c) => c.json({ status: 'ok' }));

    // Custom authentication middleware (example)
    app.use('/api/*', async (c, next) => {
      const apiKey = c.req.header('X-API-Key');
      if (!apiKey || apiKey !== 'your-secret-key') {
        return c.json({ error: 'Unauthorized' }, 401);
      }
      await next();
    });

    // Mount PostgREST API at /api
    app.route('/api', postgrestApp);

    return app.fetch(request, env, ctx);
  },
};
```

## Local Development

### 1. Update package.json scripts

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "db:local": "wrangler d1 execute my-supabase-db --local --file=./schema.sql",
    "db:remote": "wrangler d1 execute my-supabase-db --remote --file=./schema.sql"
  }
}
```

### 2. Start development server

```bash
npm run dev
```

The server will start at `http://localhost:8787`.

### 3. Test locally

```bash
# Get all users
curl http://localhost:8787/users

# Get users with their posts
curl http://localhost:8787/users?select=name,posts(title,status)

# Filter users
curl http://localhost:8787/users?age=gte.25

# Create a user
curl -X POST http://localhost:8787/users \
  -H "Content-Type: application/json" \
  -d '{"name":"Charlie","email":"charlie@example.com"}'

# Update a user
curl -X PATCH http://localhost:8787/users?id=eq.1 \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Updated"}'

# Delete a user
curl -X DELETE http://localhost:8787/users?id=eq.3
```

## Deployment

### 1. Deploy to Cloudflare Workers

```bash
npm run deploy
```

This will deploy your worker and output the production URL:

```
Uploaded my-supabase-api (1.23 sec)
Published my-supabase-api (0.45 sec)
  https://my-supabase-api.your-subdomain.workers.dev
```

### 2. Test production deployment

```bash
# Replace with your actual worker URL
WORKER_URL="https://my-supabase-api.your-subdomain.workers.dev"

# Test GET request
curl $WORKER_URL/users

# Test with PostgREST features
curl "$WORKER_URL/users?select=name,posts(title)&posts.status=eq.published"
```

### 3. Set up custom domain (optional)

In Cloudflare dashboard:
1. Go to Workers & Pages → your-worker → Settings → Triggers
2. Click "Add Custom Domain"
3. Enter your domain (e.g., `api.yourdomain.com`)
4. Cloudflare will automatically configure DNS

## Testing

### Integration Tests with Supabase Client

You can use the official Supabase JavaScript client to test your deployment:

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://my-supabase-api.your-subdomain.workers.dev',
  'fake-anon-key', // supabase-lite doesn't require auth by default
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
);

// Query data
const { data: users, error } = await supabase
  .from('users')
  .select('name, posts(title, status)');

console.log(users);
```

### Performance Testing

```bash
# Install artillery
npm install -g artillery

# Create test config (artillery.yml)
cat > artillery.yml << EOF
config:
  target: "https://my-supabase-api.your-subdomain.workers.dev"
  phases:
    - duration: 60
      arrivalRate: 10
scenarios:
  - name: "Get users"
    flow:
      - get:
          url: "/users"
EOF

# Run load test
artillery run artillery.yml
```

## Troubleshooting

### Common Issues

#### 1. "Table does not exist" errors

**Problem**: Database schema not applied.

**Solution**:
```bash
# Check if schema is applied locally
wrangler d1 execute my-supabase-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"

# Re-apply schema
wrangler d1 execute my-supabase-db --local --file=./schema.sql
```

#### 2. CORS errors in browser

**Problem**: CORS not configured or misconfigured.

**Solution**: Update CORS configuration in your worker:
```typescript
const app = createServer({
  db: dbAdapter,
  cors: {
    origin: 'https://yourdomain.com', // Or ['https://domain1.com', 'https://domain2.com']
    credentials: true,
  },
});
```

#### 3. 502 Bad Gateway errors

**Problem**: Worker timeout or uncaught exception.

**Solution**:
- Check Wrangler logs: `wrangler tail`
- Ensure D1 binding is correct in `wrangler.toml`
- Verify database_id matches your D1 database

#### 4. Foreign key errors

**Problem**: D1 doesn't enforce foreign keys by default.

**Solution**: While supabase-lite uses foreign keys for relationship detection, D1 doesn't enforce them. This is usually fine for read operations. For write operations, handle referential integrity in your application logic.

### Viewing Logs

```bash
# Real-time logs
wrangler tail

# Filter logs
wrangler tail --format pretty
```

### Database Inspection

```bash
# List tables
wrangler d1 execute my-supabase-db --local --command "SELECT name FROM sqlite_master WHERE type='table'"

# Query table
wrangler d1 execute my-supabase-db --local --command "SELECT * FROM users"

# Get schema
wrangler d1 execute my-supabase-db --local --command "SELECT sql FROM sqlite_master WHERE type='table'"
```

## Best Practices

### 1. Connection Pooling

D1 handles connection pooling automatically. No configuration needed.

### 2. Caching

Use Cloudflare's Cache API for frequently accessed data:

```typescript
app.get('/users', async (c) => {
  const cache = caches.default;
  const cacheKey = new Request(c.req.url);

  // Try cache first
  let response = await cache.match(cacheKey);
  if (response) {
    return response;
  }

  // Call PostgREST
  response = await postgrestApp.fetch(c.req.raw, c.env, c.executionCtx);

  // Cache for 60 seconds
  response = new Response(response.body, response);
  response.headers.set('Cache-Control', 'max-age=60');
  c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));

  return response;
});
```

### 3. Rate Limiting

Use Cloudflare's Rate Limiting in your worker:

```typescript
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis/cloudflare';

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(env),
  limiter: Ratelimit.slidingWindow(10, '10 s'),
});

app.use('*', async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const { success } = await ratelimit.limit(ip);

  if (!success) {
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  await next();
});
```

### 4. Monitoring

Enable Cloudflare Workers Analytics:
1. Go to Workers & Pages → your-worker → Metrics
2. View request rate, errors, CPU time, etc.

## Next Steps

- [PostgREST API Documentation](https://postgrest.org/en/stable/references/api.html)
- [Cloudflare D1 Documentation](https://developers.cloudflare.com/d1/)
- [Cloudflare Workers Examples](https://developers.cloudflare.com/workers/examples/)
- [Hono Documentation](https://hono.dev/)

## Support

- [GitHub Issues](https://github.com/yourusername/supabase-lite/issues)
- [Cloudflare Discord](https://discord.gg/cloudflaredev)
