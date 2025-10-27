# Supabase API Gap Analysis

This document analyzes the API surface area of the official @supabase/supabase-js client library and identifies which routes and features are currently supported by supabase-lite versus what's missing.

**Analysis Date**: 2025-10-27
**Last Updated**: 2025-10-27
**Packages Analyzed**:
- @supabase/postgrest-js (PostgREST database operations)
- @supabase/auth-js (GoTrue authentication)
- @supabase/storage-js (Storage operations)

**Note**: Realtime features are explicitly excluded from this analysis as requested.

---

## 1. Currently Supported Routes

### 1.1 PostgREST/Database Routes (via `supabase.from()`)

**Base Endpoint**: `GET/POST/PATCH/DELETE /rest/v1/:table`

#### Fully Supported
- ✅ **SELECT queries** - `GET /:table`
  - Column selection: `select=id,name,email`
  - Wildcard selection: `select=*`
  - Resource embedding (foreign keys): `select=id,author:users(name,email)`
  - Nested embedding: `select=title,author:users(name,posts(title))`

- ✅ **Filtering** - Query parameters on GET
  - Basic operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`
  - Pattern matching: `like`, `ilike`
  - List operations: `in`
  - Null checks: `is`, `not.is`
  - Logical operators: `or()`, implicit AND with multiple filters

- ✅ **Ordering** - `order` parameter
  - Ascending/descending: `order=age.asc`, `order=age.desc`
  - Multiple columns supported

- ✅ **Pagination**
  - `limit` parameter
  - `offset` parameter
  - `range()` function support (via client library)

- ✅ **INSERT** - `POST /:table`
  - Single row insert
  - Multiple row insert (bulk)
  - Return inserted rows with `select=*`

- ✅ **UPDATE** - `PATCH /:table`
  - With filters
  - Return updated rows with `select=*`

- ✅ **DELETE** - `DELETE /:table`
  - With filters
  - Return deleted rows with `select=*`

- ✅ **Count with Content-Range** - `Prefer: count=exact`
  - Exact count via Content-Range header: `0-24/3573458`
  - Works with all queries (filters, ordering, embedding)
  - Essential for pagination UIs

- ✅ **Single Object Response** - `single()` and `maybeSingle()`
  - Via `Accept: application/vnd.pgrst.object+json` header
  - `single()`: Returns object (not array), errors if 0 or >1 results
  - `maybeSingle()`: Returns object or null, errors if >1 results
  - Works with all query features

- ✅ **HEAD Requests** - `HEAD /:table`
  - Get count/metadata without fetching data
  - Returns Content-Range header with empty body
  - Efficient for count-only queries

#### Partially Supported
- ⚠️ **Aggregates** - Limited support
  - COUNT is supported via `count=exact` and array length
  - No SUM, AVG, MIN, MAX aggregate functions

### 1.2 Auth Routes (via `supabase.auth`)

**Base Endpoint**: `/auth/v1/*`

#### Fully Supported (GoTrue-compatible endpoints)
- ✅ **POST /auth/v1/signup** - `signUp()`
  - Email/password registration
  - Returns user and session

- ✅ **POST /auth/v1/token?grant_type=password** - `signInWithPassword()`
  - Email/password login
  - Returns user, session, access_token

- ✅ **GET /auth/v1/user** - `getUser()`
  - Get current user with JWT verification
  - Requires Authorization header

- ✅ **GET /auth/v1/session** - `getSession()` (via token storage)
  - Session retrieval from local storage/cookies

### 1.3 Storage Routes

**Status**: ❌ **Not implemented**

No storage routes are currently supported.

---

## 2. Missing PostgREST Routes

### 2.1 Query Modifiers (Medium Priority)

#### Response Format Modifiers
| Feature | Endpoint/Header | Complexity | Importance | Description |
|---------|----------------|------------|------------|-------------|
| **csv()** | Accept: text/csv | Medium | Low | Return results as CSV format |
| **geojson()** | Accept: application/geo+json | Medium | Low | Return results as GeoJSON |
| **explain()** | Accept: application/vnd.pgrst.plan+json | High | Low | Return query execution plan (requires db_plan_enabled) |

**Implementation Notes**:
- CSV/GeoJSON are niche features but straightforward to add

#### Count Options
| Feature | Header | Complexity | Importance | Description |
|---------|--------|------------|------------|-------------|
| **count=planned** | Prefer: count=planned | Medium | Medium | Return estimated count from query planner |
| **count=estimated** | Prefer: count=estimated | Medium | Low | Use exact for small, planned for large |

**Implementation Notes**:
- Planned count would use SQLite's `sqlite_stat1` table
- Low priority since exact count is already supported

### 2.2 Advanced Filtering (High Priority)

#### Array and JSON Operators
| Operator | Syntax | Complexity | Importance | Description |
|----------|--------|------------|------------|-------------|
| **contains** | `cs` | Medium | Medium | Array/JSONB contains values |
| **containedBy** | `cd` | Medium | Medium | Array/JSONB is contained by values |
| **overlaps** | `ov` | Medium | Medium | Array/JSONB overlaps with values |

**Implementation Notes**:
- SQLite doesn't have native array types, but JSON support exists
- Would need to check JSON containment using `json_each()` and `json_extract()`

#### Range Operators
| Operator | Syntax | Complexity | Importance | Description |
|----------|--------|------------|------------|-------------|
| **rangeGt** | `sr` | Low | Low | Range strictly right of value |
| **rangeGte** | `nxl` | Low | Low | Range not left of value |
| **rangeLt** | `sl` | Low | Low | Range strictly left of value |
| **rangeLte** | `nxr` | Low | Low | Range not right of value |
| **rangeAdjacent** | `adj` | Low | Low | Range adjacent to value |

**Implementation Notes**:
- These are PostgreSQL range type operators
- SQLite doesn't have native range types
- Could be implemented as two-column comparisons (low_value, high_value)
- Low usage in typical applications

#### Text Search
| Operator | Syntax | Complexity | Importance | Description |
|----------|--------|------------|------------|-------------|
| **textSearch** | `fts/plfts/phfts/wfts` | High | Medium | Full-text search with websearch, phrase, plain modes |

**Implementation Notes**:
- SQLite has FTS5 full-text search extension
- Would require detecting FTS virtual tables
- Different query syntax than PostgreSQL's `@@` operator
- PostgREST supports multiple FTS types (plain, phrase, websearch)

#### Pattern Quantifiers
| Feature | Syntax | Complexity | Importance | Description |
|---------|--------|------------|------------|-------------|
| **likeAllOf** | Multiple LIKE with AND | Low | Low | Match all patterns |
| **likeAnyOf** | Multiple LIKE with OR | Low | Low | Match any pattern |
| **ilikeAllOf** | Case-insensitive likeAllOf | Low | Low | Case-insensitive variant |
| **ilikeAnyOf** | Case-insensitive likeAnyOf | Low | Low | Case-insensitive variant |

**Implementation Notes**:
- Simple SQL generation with multiple LIKE clauses
- Already have like/ilike support, just need to handle arrays

#### Filter Helpers
| Feature | Syntax | Complexity | Importance | Description |
|---------|--------|------------|------------|-------------|
| **match()** | Object with key-value pairs | Low | Medium | Shorthand for multiple eq filters |
| **filter()** | Generic filter with operator string | Low | Medium | Generic filter: `column.operator.value` |

**Implementation Notes**:
- Convenience methods that generate standard filters
- Low complexity, just sugar over existing filter system

### 2.3 Embedded Resource Filtering (Medium Priority)

| Feature | Syntax | Complexity | Importance | Description |
|---------|--------|------------|------------|-------------|
| **Filters on embedded resources** | `author.filter(age.gte.18)` | High | High | Filter on joined table columns |
| **Order on embedded resources** | `order=author.name.asc` | Medium | Medium | Order by joined table columns |
| **Limit on embedded resources** | `author.limit(1)` | Medium | Medium | Limit results from joined tables |

**Implementation Notes**:
- Currently we support embedding but not filtering the embedded results
- Requires modifying the JOIN/subquery to apply WHERE/ORDER/LIMIT to the joined table
- PostgREST uses the `referencedTable` option for this

### 2.4 Database Functions (RPC) (Low Priority)

| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **rpc()** | POST/GET /rpc/:function_name | High | Medium | Call database stored procedures/functions |

**Implementation Notes**:
- Endpoint: `POST /rpc/function_name` with JSON body of arguments
- SQLite doesn't have stored procedures in the PostgreSQL sense
- Could potentially support custom application-level functions
- Low priority for SQLite-based implementation

### 2.5 Upsert Operations (High Priority)

| Feature | Method | Complexity | Importance | Description |
|---------|--------|------------|------------|-------------|
| **upsert()** | POST with Prefer: resolution=merge-duplicates | High | High | Insert or update on conflict |

**Implementation Notes**:
- SQLite supports `INSERT ... ON CONFLICT DO UPDATE`
- Need to detect primary key or unique constraints
- Requires `onConflict` parameter to specify which column(s) to check
- `ignoreDuplicates` option uses `INSERT OR IGNORE`

### 2.6 Bulk Operations

| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **Bulk insert** | POST /:table with array | Low | High | Already supported! |
| **Bulk upsert** | POST /:table with Prefer header | High | Medium | Upsert multiple rows |
| **defaultToNull** | Option on insert/upsert | Low | Low | Missing columns default to NULL vs default value |

**Implementation Notes**:
- Bulk insert already works
- Bulk upsert needs same conflict resolution as single upsert

### 2.7 Response Modifiers

| Feature | Header/Option | Complexity | Importance | Description |
|---------|--------------|------------|------------|-------------|
| **rollback()** | Prefer: tx=rollback | Low | Low | Execute query but rollback (for testing) |
| **abortSignal()** | AbortController support | Low | Medium | Cancel in-flight requests |
| **maxAffected()** | Prefer: max-affected=N | Low | Low | Error if more than N rows affected (safety) |

**Implementation Notes**:
- `rollback()` is mainly for testing, low priority
- `abortSignal()` is client-side, may already work through fetch
- `maxAffected()` is a safety feature for UPDATE/DELETE

### 2.8 Schema Selection

| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **schema()** | Header: Accept-Profile/Content-Profile | Medium | Low | Switch between database schemas |

**Implementation Notes**:
- SQLite doesn't have schemas in the PostgreSQL sense
- Could potentially support ATTACH-ed databases
- Very low priority for SQLite

---

## 3. Missing Auth Routes

### 3.1 Core Authentication (Medium-High Priority)

#### Session Management
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **refreshSession()** | POST /auth/v1/token?grant_type=refresh_token | Medium | High | Refresh access token using refresh token |
| **setSession()** | Client-side only | Low | High | Set session from external source |
| **signOut()** | POST /auth/v1/logout | Low | High | Invalidate session and refresh tokens |

**Implementation Notes**:
- Refresh token flow is critical for long-lived sessions
- signOut should invalidate the refresh token in database
- setSession is mostly client-side validation

#### OAuth/Social Login
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **signInWithOAuth()** | GET /auth/v1/authorize | High | High | OAuth2 flow for social providers |
| **linkIdentity()** | POST /auth/v1/user/identities/authorize | High | Medium | Link OAuth provider to existing user |
| **unlinkIdentity()** | DELETE /auth/v1/user/identities/:id | Medium | Medium | Remove linked identity |
| **getUserIdentities()** | GET /auth/v1/user/identities | Low | Medium | List all linked identities |

**Implementation Notes**:
- Requires OAuth2 integration with providers (Google, GitHub, etc.)
- Complex redirect flows
- High implementation cost but high user demand
- Would need separate OAuth provider configuration

#### Passwordless Authentication
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **signInWithOtp()** | POST /auth/v1/otp | Medium | Medium | Magic link or OTP via email/SMS |
| **verifyOtp()** | POST /auth/v1/verify | Medium | Medium | Verify OTP code |
| **resend()** | POST /auth/v1/resend | Low | Medium | Resend OTP/magic link |

**Implementation Notes**:
- Requires email/SMS sending capability
- OTP generation and storage
- Time-based expiration
- Magic links need email templates

#### PKCE Flow
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **exchangeCodeForSession()** | POST /auth/v1/token?grant_type=pkce | Medium | Low | Exchange PKCE code for session |

**Implementation Notes**:
- Enhanced security for OAuth flows
- Less critical for server-side applications
- Mainly for mobile/SPA security

### 3.2 Advanced Authentication (Low-Medium Priority)

#### Multi-Factor Authentication (MFA)
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **mfa.enroll()** | POST /auth/v1/factors | High | Medium | Enroll TOTP/WebAuthn MFA |
| **mfa.challenge()** | POST /auth/v1/factors/:id/challenge | Medium | Medium | Create MFA challenge |
| **mfa.verify()** | POST /auth/v1/factors/:id/verify | Medium | Medium | Verify MFA response |
| **mfa.unenroll()** | DELETE /auth/v1/factors/:id | Low | Medium | Remove MFA factor |
| **mfa.listFactors()** | GET /auth/v1/factors | Low | Medium | List user's MFA factors |
| **mfa.getAuthenticatorAssuranceLevel()** | Client-side | Low | Low | Get current AAL level |

**Implementation Notes**:
- TOTP requires crypto library for secret generation/verification
- WebAuthn requires passkey/U2F support (very complex)
- QR code generation for TOTP enrollment
- Recovery codes for lost MFA devices

#### Web3 Authentication
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **signInWithWeb3()** | POST /auth/v1/token?grant_type=web3 | High | Low | Ethereum/Solana wallet sign-in |

**Implementation Notes**:
- Sign-In-With-Ethereum (EIP-4361) standard
- Solana sign-in variant
- Requires crypto signature verification
- Niche use case for web3 apps

#### SSO (Enterprise)
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **signInWithSSO()** | GET /auth/v1/sso | High | Low | SAML SSO for enterprise |

**Implementation Notes**:
- SAML protocol implementation
- Enterprise feature
- Very low priority for lite implementation

#### ID Token Flow
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **signInWithIdToken()** | POST /auth/v1/token?grant_type=id_token | High | Low | Sign in with OIDC ID token |

**Implementation Notes**:
- For integrating with external OIDC providers
- Complex JWT validation requirements

### 3.3 User Management (Medium Priority)

#### Profile Updates
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **updateUser()** | PUT /auth/v1/user | Medium | High | Update user metadata, email, password |
| **reauthenticate()** | POST /auth/v1/reauthenticate | Medium | Medium | Re-verify user before sensitive operations |

**Implementation Notes**:
- updateUser needs validation for email changes
- Password changes require bcrypt/secure hashing
- Email change requires confirmation flow

#### Password Management
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **resetPasswordForEmail()** | POST /auth/v1/recover | Medium | High | Send password reset email |
| **Password recovery flow** | GET /auth/v1/verify (via email link) | Medium | High | Complete password reset |

**Implementation Notes**:
- Requires email sending
- Secure token generation
- Time-based expiration
- Email templates

#### Session Events
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **onAuthStateChange()** | Client-side event listener | Low | High | Listen to auth state changes |

**Implementation Notes**:
- Client-side feature, mostly already works
- May need server-sent events for multi-tab sync

### 3.4 Admin API (Low Priority - Server Only)

| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **admin.createUser()** | POST /auth/v1/admin/users | Medium | Medium | Create user server-side |
| **admin.listUsers()** | GET /auth/v1/admin/users | Low | Medium | List all users with pagination |
| **admin.getUserById()** | GET /auth/v1/admin/users/:id | Low | Medium | Get user by ID |
| **admin.updateUserById()** | PUT /auth/v1/admin/users/:id | Medium | Medium | Update user by ID |
| **admin.deleteUser()** | DELETE /auth/v1/admin/users/:id | Medium | Medium | Delete user (hard or soft) |
| **admin.generateLink()** | POST /auth/v1/admin/generate_link | Medium | Low | Generate magic link server-side |
| **admin.inviteUserByEmail()** | POST /auth/v1/admin/invite | Medium | Low | Send invite email |
| **admin.signOut()** | POST /auth/v1/admin/signout | Low | Low | Sign out user by JWT |

**Implementation Notes**:
- Requires service_role key authentication
- Should never be exposed to client
- Useful for admin dashboards
- Medium complexity overall

### 3.5 JWT/Claims

| Feature | Method | Complexity | Importance | Description |
|---------|--------|------------|------------|-------------|
| **getClaims()** | Client-side JWT parsing | Low | Medium | Extract and verify JWT claims |

**Implementation Notes**:
- Can use JWKS endpoint for verification
- Faster than calling getUser() repeatedly
- Requires asymmetric key support (RSA/ECC)

---

## 4. Missing Storage Routes

**Status**: ❌ **None implemented**

All storage functionality is missing. This is a completely separate service from PostgREST.

### 4.1 Bucket Management (Low Priority)

| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **listBuckets()** | GET /storage/v1/bucket | Low | Medium | List all buckets |
| **getBucket()** | GET /storage/v1/bucket/:id | Low | Medium | Get bucket details |
| **createBucket()** | POST /storage/v1/bucket | Medium | Medium | Create new bucket |
| **updateBucket()** | PUT /storage/v1/bucket/:id | Medium | Low | Update bucket settings |
| **emptyBucket()** | POST /storage/v1/bucket/:id/empty | Medium | Low | Delete all objects in bucket |
| **deleteBucket()** | DELETE /storage/v1/bucket/:id | Low | Low | Delete empty bucket |

**Implementation Notes**:
- Buckets are containers for files, similar to S3 buckets
- Need to track public/private visibility
- File size limits
- Allowed MIME types
- Would likely use filesystem or object storage backend

### 4.2 File Operations (Medium-High Priority)

#### Upload/Download
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **upload()** | POST /storage/v1/object/:bucket/:path | High | High | Upload file to bucket |
| **update()** | PUT /storage/v1/object/:bucket/:path | High | Medium | Replace existing file |
| **download()** | GET /storage/v1/object/:bucket/:path | Medium | High | Download file |
| **createSignedUrl()** | POST /storage/v1/object/sign/:bucket/:path | Medium | High | Create temporary signed URL |
| **createSignedUrls()** | POST /storage/v1/object/sign/:bucket (bulk) | Medium | Medium | Create multiple signed URLs |
| **createSignedUploadUrl()** | POST /storage/v1/object/upload/sign/:bucket/:path | Medium | Medium | Create upload URL for client |
| **uploadToSignedUrl()** | PUT /storage/v1/object/:bucket/:path?token=... | Medium | Medium | Upload using signed URL |

**Implementation Notes**:
- File handling, multipart uploads for large files
- Content-Type detection
- Signed URLs need cryptographic signing
- Access control via RLS or bucket policies

#### File Management
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **list()** | POST /storage/v1/object/list/:bucket | Medium | High | List files in path |
| **listV2()** | POST /storage/v1/object/list/:bucket (v2) | Medium | Medium | Enhanced list with search |
| **move()** | POST /storage/v1/object/move | Medium | Medium | Move/rename file |
| **copy()** | POST /storage/v1/object/copy | Medium | Medium | Copy file to new path |
| **remove()** | DELETE /storage/v1/object/:bucket | Medium | High | Delete file(s) |
| **getPublicUrl()** | Client-side URL construction | Low | High | Get public URL for file |

**Implementation Notes**:
- File metadata storage (size, mimetype, created_at)
- Folder structure emulation
- Search and filtering capabilities

#### File Metadata
| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **info()** | GET /storage/v1/object/info/:bucket/:path | Low | Medium | Get file metadata |
| **exists()** | HEAD /storage/v1/object/:bucket/:path | Low | Medium | Check if file exists |

**Implementation Notes**:
- Quick metadata lookups without downloading

### 4.3 Image Transformation (Low Priority)

| Feature | Query Parameters | Complexity | Importance | Description |
|---------|-----------------|------------|------------|-------------|
| **Image resize** | ?width=X&height=Y | High | Medium | Resize images on-the-fly |
| **Image format** | ?format=webp | High | Low | Convert image format |
| **Image quality** | ?quality=80 | Medium | Low | Adjust JPEG quality |

**Implementation Notes**:
- Requires image processing library (sharp, imagemagick)
- Can be CPU intensive
- Often cached with CDN
- Transform options passed in download/signed URL requests

### 4.4 Vector Storage (Very Low Priority)

| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **vectors.** | /storage/v1/vectors/* | Very High | Very Low | Vector embeddings storage |

**Implementation Notes**:
- Beta feature for AI/ML workloads
- Very specialized use case
- Out of scope for lite implementation

### 4.5 Analytics (Very Low Priority)

| Feature | Endpoint | Complexity | Importance | Description |
|---------|----------|------------|------------|-------------|
| **analytics.** | /storage/v1/analytics/* | High | Very Low | Storage analytics via Iceberg |

**Implementation Notes**:
- Analytics bucket operations
- Requires Apache Iceberg integration
- Enterprise/advanced feature

---

## 5. Priority Matrix Summary

### High Priority (Should Implement Soon)
**PostgREST**:
1. `single()` / `maybeSingle()` - Very commonly used
2. `count=exact` support with Content-Range headers
3. `upsert()` - Critical for many CRUD apps
4. Filtering on embedded resources
5. HEAD requests for count-only queries

**Auth**:
1. `refreshSession()` - Required for production apps
2. `signOut()` - Basic auth requirement
3. `updateUser()` - Profile management
4. `resetPasswordForEmail()` - Password recovery

**Storage**:
1. Basic file upload/download
2. Bucket creation/listing
3. `getPublicUrl()` / `createSignedUrl()`
4. File listing and deletion

### Medium Priority (Nice to Have)
**PostgREST**:
1. Advanced filtering: `contains`, `overlaps`, `textSearch`
2. Pattern quantifiers: `likeAllOf`, `ilikeAnyOf`
3. `filter()` and `match()` helpers
4. Embedded resource ordering/limiting

**Auth**:
1. OAuth/social login (`signInWithOAuth`)
2. Passwordless (`signInWithOtp`, `verifyOtp`)
3. MFA enrollment and verification
4. User admin API (server-side)

**Storage**:
1. File move/copy operations
2. Image transformation
3. Signed upload URLs
4. File metadata operations

### Low Priority (Future Considerations)
**PostgREST**:
1. CSV/GeoJSON export formats
2. `explain()` for query plans
3. Range operators for PostgreSQL range types
4. `rpc()` function calls
5. Schema selection

**Auth**:
1. Web3 authentication
2. SSO/SAML
3. ID token flow
4. Advanced MFA (WebAuthn)

**Storage**:
1. Vector storage
2. Analytics buckets
3. Advanced image transformations

---

## 6. Implementation Complexity Estimates

### Quick Wins (< 1 day each)
- `single()` / `maybeSingle()` response modifiers
- HEAD request support
- `signOut()` endpoint
- `match()` filter helper
- Pattern quantifiers (`likeAllOf`, etc.)

### Medium Effort (2-5 days each)
- `count=exact` with Content-Range headers
- `upsert()` with conflict resolution
- `refreshSession()` token flow
- Basic file upload/download
- Bucket management
- `updateUser()` with validation

### Large Projects (1-2 weeks each)
- OAuth/social login integration
- OTP/magic link authentication
- Full-text search with SQLite FTS5
- Image transformation pipeline
- MFA (TOTP) implementation
- Filtering on embedded resources

### Complex Features (2+ weeks)
- WebAuthn/passkey support
- Web3 authentication
- SSO/SAML integration
- Complete storage service with RLS
- Advanced query planning/optimization

---

## 7. Recommendations

### Phase 1: Core PostgREST Completeness
Focus on making the PostgREST implementation feature-complete for common use cases:
1. Implement `single()` / `maybeSingle()`
2. Add `count=exact` support with Content-Range
3. Implement `upsert()` operations
4. Add HEAD request support

**Estimated effort**: 1-2 weeks
**Impact**: High - covers 90% of common database operations

### Phase 2: Auth Essentials
Complete the basic auth flow that every production app needs:
1. Token refresh flow
2. Sign out functionality
3. Password reset flow
4. User profile updates

**Estimated effort**: 1 week
**Impact**: High - makes auth production-ready

### Phase 3: Storage Basics
Add basic file storage capabilities:
1. Bucket CRUD
2. File upload/download
3. Public URLs and signed URLs
4. Basic file listing

**Estimated effort**: 2-3 weeks
**Impact**: Medium-High - enables file storage use cases

### Phase 4: Advanced Features
Based on user demand:
1. OAuth social login (highest demand)
2. Embedded resource filtering
3. Text search
4. OTP/magic link authentication

**Estimated effort**: 4-6 weeks
**Impact**: Medium - enhances capabilities significantly

---

## 8. Breaking Changes / Compatibility Notes

### Currently Compatible With
- ✅ Basic CRUD operations from @supabase/supabase-js
- ✅ Simple filtering and ordering
- ✅ Resource embedding (one-to-many, many-to-one)
- ✅ Basic auth signup/login
- ✅ RLS policy enforcement

### Incompatible / Not Yet Supported
- ❌ Count with Content-Range headers
- ❌ Single/maybeSingle response formats
- ❌ Upsert operations
- ❌ Token refresh (sessions will expire)
- ❌ OAuth/social login
- ❌ All storage operations
- ❌ RPC function calls
- ❌ Advanced filtering (contains, overlaps, fts)

### Migration Path
For applications migrating from Supabase to postgrest-lite:
1. Audit usage of advanced features (upsert, single, count)
2. Replace OAuth with email/password if needed
3. Handle file storage separately (or wait for storage implementation)
4. Check for RPC calls (may need to convert to direct queries)
5. Test thoroughly with actual client library

---

**Document Version**: 1.0
**Last Updated**: 2025-10-27
**Next Review**: After Phase 1 completion
