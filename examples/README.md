# PostgREST-Lite Examples

## 🔑 Authentication & RLS Demo

**Files:**
- `auth-rls-demo.ts` - Interactive TypeScript demo
- `auth-rls-demo.ipynb` - Jupyter notebook with step-by-step walkthrough

A comprehensive, interactive demo showcasing authentication and Row-Level Security (RLS):

- **JWT-based authentication** with anon keys and user tokens
- **GoTrue-compatible endpoints** for Supabase client support
- **Official Supabase client integration** (@supabase/supabase-js)
- **User signup and login** endpoints
- **RLS policies** for different roles (anonymous vs authenticated)
- **Policy builder API** for type-safe policy construction
- **Resource embedding** (foreign key relationships)

### Quick Start

```bash
npm run dev:auth-demo
```

The demo will:
1. Start a local server on port 3000
2. Set up a sample database with posts
3. Configure RLS policies using the policy builder API
4. Print out step-by-step curl commands to try

### What You'll Learn

- How anonymous users have limited read access (published posts only)
- How to create user accounts and login
- How authenticated users get expanded permissions (see all posts)
- How RLS automatically filters data based on user context
- How to use the structured policy builder API

### Using cURL

The server prints all the commands you need, but here's the basic flow:

```bash
# 1. Read posts as anonymous (only sees published)
curl http://localhost:3000/posts \
  -H "apikey: <ANON_KEY>"

# 2. Sign up a new user (GoTrue-compatible endpoint)
curl -X POST http://localhost:3000/auth/v1/signup \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123"}'

# 3. Login to get JWT token
curl -X POST http://localhost:3000/auth/v1/token \
  -H "apikey: <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"password123"}'

# 4. Use JWT to see ALL posts (including unpublished)
curl http://localhost:3000/posts \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```

### Using Supabase JS Client

The demo is fully compatible with the official Supabase JavaScript client:

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient('http://localhost:3000', '<ANON_KEY>');

// Sign up
await supabase.auth.signUp({
  email: 'alice@example.com',
  password: 'password123'
});

// Query data (auth token automatically included)
const { data: posts } = await supabase.from('posts').select('*');
console.log(posts); // Will show ALL 3 posts (including unpublished)
```

### Using the Jupyter Notebook

For an interactive, step-by-step experience:

1. Install dependencies:
   ```bash
   pip install jupyter supabase
   ```

2. Open the notebook:
   ```bash
   jupyter notebook examples/auth-rls-demo.ipynb
   ```

3. Run through the cells to see authentication and RLS in action!

### Key Features Demonstrated

✅ **JWT-based authentication**
✅ **GoTrue-compatible auth endpoints**
✅ **Row-Level Security (RLS) policies**
✅ **Policy builder API** (type-safe, deterministic)
✅ **Resource embedding** (foreign key relationships)
✅ **Unauthenticated users**: See published posts only
✅ **Authenticated users**: See all posts
✅ **Supabase client compatibility**

## Policy Builder Example

The demo uses the structured policy builder API instead of SQL strings:

```typescript
import { policy } from '../src/rls/policy-builder.js';

// Policy 1: Anonymous users can only read published posts
await rlsProvider.createPolicy({
  name: 'anon_read_published',
  tableName: 'posts',
  command: 'SELECT',
  role: 'anon',
  using: policy.eq('published', 1),
});

// Policy 2: Authenticated users can read ALL posts
await rlsProvider.createPolicy({
  name: 'auth_read_all',
  tableName: 'posts',
  command: 'SELECT',
  role: 'authenticated',
  using: policy.alwaysAllow(), // No restrictions
});
```

This approach is:
- **Type-safe** - Compile-time checks
- **Deterministic** - Zero parsing edge cases
- **Readable** - Clear intent
- **Composable** - Build complex policies with `policy.and()` and `policy.or()`

## 💡 Tips

- The demo uses an **in-memory database** - data resets on restart
- The server prints all curl commands with the actual anon key
- You can modify the demo to test your own schemas
- Both TypeScript and Python (Jupyter) examples are provided
- Use the demo as a template for your own applications
