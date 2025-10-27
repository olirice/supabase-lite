/**
 * Authentication & RLS Demo
 *
 * Simple demonstration of auth and RLS:
 * - JWT-based authentication (anon key and user tokens)
 * - User signup and login (GoTrue-compatible)
 * - Row-Level Security (RLS) policies
 * - Unauthenticated users: Can only see published posts
 * - Authenticated users: Can see all posts (published + unpublished)
 *
 * Run: npm run dev:auth-demo
 */

import { createServer } from '../src/api/server.js';
import { SqliteAdapter } from '../src/database/sqlite-adapter.js';
import { SqliteRLSProvider } from '../src/rls/storage.js';
import { generateAnonKey } from '../src/auth/jwt.js';
import { policy } from '../src/rls/policy-builder.js';
import Database from 'better-sqlite3';
import { serve } from '@hono/node-server';

const PORT = 3000;
const JWT_SECRET = 'demo-secret-change-in-production';
const ANON_KEY = generateAnonKey(JWT_SECRET);

async function main() {
  console.log('Starting Auth & RLS Demo Server...\n');

  // Create database
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');

  // Initialize database adapters
  const adapter = new SqliteAdapter(db);
  const rlsProvider = new SqliteRLSProvider(db);

  // Initialize auth provider FIRST (creates auth_users and auth_sessions tables)
  console.log('Setting up schema...');
  const { SqliteAuthProvider } = await import('../src/auth/provider.js');
  const authProvider = new SqliteAuthProvider(db, {
    jwtSecret: JWT_SECRET,
  });

  db.exec(`
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT,
      user_id TEXT,
      published INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      post_id INTEGER NOT NULL,
      user_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
  `);

  // Create some sample users for the demo
  const bcrypt = await import('bcryptjs');
  const systemUserId = '00000000-0000-0000-0000-000000000001';
  const demoUserId = '00000000-0000-0000-0000-000000000002';

  db.exec(`
    INSERT INTO auth_users (id, username, password_hash, created_at, updated_at) VALUES
      ('${systemUserId}', 'system', '${await bcrypt.hash('system123', 10)}', datetime('now'), datetime('now')),
      ('${demoUserId}', 'demo', '${await bcrypt.hash('demo123', 10)}', datetime('now'), datetime('now'));
  `);

  db.exec(`
    INSERT INTO posts (id, title, content, user_id, published) VALUES
      (1, 'Welcome to PostgREST-Lite', 'This is a public post everyone can see', '${systemUserId}', 1),
      (2, 'Getting Started Guide', 'Learn how to use this API', '${systemUserId}', 1),
      (3, 'Draft: Private Thoughts', 'Only I can see this', '${demoUserId}', 0);

    INSERT INTO comments (content, post_id, user_id) VALUES
      ('Great introduction!', 1, '${demoUserId}'),
      ('Looking forward to trying this', 1, '${systemUserId}'),
      ('Very helpful guide', 2, '${demoUserId}');
  `);

  console.log('Configuring RLS policies...\n');

  // Enable RLS on posts table
  await rlsProvider.enableRLS('posts');

  // Policy 1: Anonymous users can only read published posts
  await rlsProvider.createPolicy({
    name: 'anon_read_published',
    tableName: 'posts',
    command: 'SELECT',
    role: 'anon',
    using: policy.eq('published', 1),
  });

  // Policy 2: Authenticated users can read all posts (published + unpublished)
  await rlsProvider.createPolicy({
    name: 'auth_read_all',
    tableName: 'posts',
    command: 'SELECT',
    role: 'authenticated',
    using: policy.alwaysAllow(),  // No restrictions - can see everything
  });

  // Create server with auth and RLS enabled
  const app = createServer({
    db: adapter,
    cors: {
      origin: '*',
      credentials: true,
    },
    auth: {
      enabled: true,
      jwtSecret: JWT_SECRET,
      goTrue: true, // Enable GoTrue-compatible endpoints for Supabase client
    },
    rls: {
      enabled: true,
    },
  });

  // Start HTTP server
  const server = serve({
    fetch: app.fetch,
    port: PORT,
  });

  console.log('✅ Server started successfully!\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔑 Authentication & RLS Demo');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📋 Your Anon Key (use for unauthenticated requests):');
  console.log(`   ${ANON_KEY}\n`);

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📚 STEP 1: Unauthenticated - Read Posts');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Unauthenticated users can ONLY see published posts:\n');
  console.log(`curl http://localhost:${PORT}/posts \\`);
  console.log(`  -H "apikey: ${ANON_KEY}"\n`);
  console.log('Expected: 2 published posts (id=1, id=2)\n');
  console.log('The draft post (id=3) is hidden by RLS.\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📚 STEP 2: Create User Account');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Sign up a new user using GoTrue-compatible endpoint:\n');
  console.log(`curl -X POST http://localhost:${PORT}/auth/v1/signup \\`);
  console.log(`  -H "apikey: ${ANON_KEY}" \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"email":"alice@example.com","password":"password123"}'\n`);
  console.log('Expected: User object with access_token\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📚 STEP 3: Login');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Login to get an auth token:\n');
  console.log(`curl -X POST http://localhost:${PORT}/auth/v1/token \\`);
  console.log(`  -H "apikey: ${ANON_KEY}" \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"email":"alice@example.com","password":"password123"}'\n`);
  console.log('Expected: Session with access_token\n');
  console.log('💡 Save the access_token for the next step!\n');
  console.log('Note: ?grant_type=password is optional (for compatibility)\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📚 STEP 4: Authenticated - Read All Posts');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Authenticated users can see ALL posts (published + unpublished):\n');
  console.log(`curl http://localhost:${PORT}/posts \\`);
  console.log(`  -H "Authorization: Bearer <YOUR_TOKEN>"\n`);
  console.log('Expected: 3 posts (id=1, id=2, id=3)\n');
  console.log('Now you can see the draft post (id=3)!\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📚 STEP 5: Resource Embedding - Get Posts with Comments');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('Embed related resources using PostgREST syntax:\n');
  console.log(`curl "http://localhost:${PORT}/posts?select=*,comments(id,content)" \\`);
  console.log(`  -H "Authorization: Bearer <YOUR_TOKEN>"\n`);
  console.log('Expected: Posts with embedded comments array\n');
  console.log('Syntax: select=*,table_name(columns)\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('📚 BONUS: Using Supabase JS Client');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('You can also use the official @supabase/supabase-js client:\n');
  console.log('```javascript');
  console.log('import { createClient } from \'@supabase/supabase-js\';');
  console.log('');
  console.log(`const supabase = createClient('http://localhost:${PORT}', '${ANON_KEY}');`);
  console.log('');
  console.log('// Sign up');
  console.log('const { data, error } = await supabase.auth.signUp({');
  console.log('  email: \'alice@example.com\',');
  console.log('  password: \'password123\'');
  console.log('});');
  console.log('');
  console.log('// Query data (automatically includes auth token)');
  console.log('const { data: posts } = await supabase.from(\'posts\').select(\'*\');');
  console.log('```\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('🎯 KEY FEATURES:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log('✅ JWT-based authentication');
  console.log('✅ GoTrue-compatible auth endpoints (Supabase client support)');
  console.log('✅ Row-Level Security (RLS) policies');
  console.log('✅ Resource embedding (foreign key relationships)');
  console.log('✅ Unauthenticated: See published posts only');
  console.log('✅ Authenticated: See all posts\n');

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  console.log(`\n🌐 Server running at http://localhost:${PORT}`);
  console.log('📖 Press Ctrl+C to stop\n');

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('\n👋 Shutting down gracefully...');
    server.close();
    db.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});
