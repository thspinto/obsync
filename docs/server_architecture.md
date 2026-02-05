# Obsync Server Architecture

## Overview

The Obsync server provides cloud synchronization for version history data. It uses Auth0 for authentication with the Device Authorization Flow, allowing the Obsidian plugin to authenticate without requiring a browser callback.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Auth provider** | Auth0 | Mature OAuth provider with device flow support |
| **Auth flow** | Device Authorization | Best for CLI/desktop apps; no callback URL needed |
| **Framework** | Hono | Lightweight, fast, modern TypeScript support |
| **Database** | SQLite (better-sqlite3) | Simple deployment, same SQL patterns as client |
| **Sync direction** | One-way (v1) | Clients upload to server; bi-directional in v2 |
| **IDs** | UUIDv7 | Same as client; globally unique, time-sortable |

## Component Architecture

```mermaid
graph TB
    subgraph Client["Obsidian Plugin"]
        SyncService["SyncService"]
    end

    subgraph Server["Hono Server"]
        subgraph Middleware
            AuthMW["auth.ts<br/>JWT Verification"]
        end

        subgraph Routes
            AuthR["routes/auth.ts<br/>/auth/*"]
            SyncR["routes/sync.ts<br/>/sync/*, /vaults/*"]
        end

        subgraph Services
            SyncSvc["services/sync.ts<br/>Sync Logic"]
        end

        subgraph Data
            DB["db.ts<br/>DbService"]
            SQLite["SQLite<br/>(better-sqlite3)"]
        end
    end

    subgraph External
        Auth0["Auth0"]
    end

    SyncService --> AuthR
    SyncService --> SyncR

    AuthR --> Auth0
    SyncR --> AuthMW
    AuthMW --> SyncSvc
    SyncSvc --> DB
    DB --> SQLite
```

## Authentication Flow

### Device Authorization Flow

```mermaid
sequenceDiagram
    participant C as Client (Plugin)
    participant S as Server
    participant A as Auth0
    participant U as User (Browser)

    C->>S: POST /auth/device
    S->>A: POST /oauth/device/code
    A-->>S: device_code, user_code, verification_uri
    S-->>C: device_code, user_code, verification_uri

    C->>C: Display user_code to user
    Note over C: "Enter code XXXX-XXXX at auth0.com/activate"

    U->>A: Opens verification_uri
    U->>A: Enters user_code
    U->>A: Logs in / Authorizes

    loop Poll until authorized
        C->>S: POST /auth/token {device_code}
        S->>A: POST /oauth/token
        alt Authorization pending
            A-->>S: error: authorization_pending
            S-->>C: {status: "authorization_pending"}
        else Authorized
            A-->>S: access_token, refresh_token
            S->>S: Create/get device record
            S-->>C: access_token, refresh_token, device_id
        end
    end

    C->>C: Store tokens & device_id
```

### Token Refresh

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant A as Auth0

    C->>S: POST /auth/refresh {refresh_token}
    S->>A: POST /oauth/token (refresh grant)
    A-->>S: new access_token
    S-->>C: {access_token}
```

## Database Schema

```mermaid
erDiagram
    DEVICES {
        text id PK "UUIDv7"
        text user_id "Auth0 sub"
        text name "optional friendly name"
        integer created_at
    }

    VAULTS {
        text id PK "UUIDv7"
        text user_id "Auth0 sub"
        text name "vault name"
        integer created_at
        integer updated_at
    }

    FILES {
        text id PK "UUIDv7"
        text vault_id FK
        text path "vault-relative"
        integer deleted_at
        integer created_at
        integer updated_at
    }

    VERSIONS {
        text id PK "UUIDv7"
        text file_id FK
        text device_id FK "which device uploaded"
        integer is_checkpoint
        text data "content or patch"
        integer created_at
    }

    VAULTS ||--o{ FILES : "contains"
    FILES ||--o{ VERSIONS : "has"
    DEVICES ||--o{ VERSIONS : "uploaded"
```

**Key differences from client schema:**
- `devices` table: tracks which devices belong to which users
- `vaults` table: users can have multiple vaults
- `files.vault_id`: files belong to vaults instead of having user_id directly
- `versions.device_id`: tracks which device uploaded each version

## API Endpoints

### Auth Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/device` | None | Initiate device auth flow |
| POST | `/auth/token` | None | Poll for tokens |
| POST | `/auth/refresh` | None | Refresh access token |

### Vault Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/vaults` | Required | List user's vaults |
| POST | `/vaults` | Required | Create new vault |

### Sync Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/sync/versions` | Required | Upload versions |

## Sync Data Flow

### Upload Versions

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    participant DB as Database

    C->>S: POST /sync/versions<br/>{vault_id, versions[]}
    S->>S: Verify JWT, extract user_id, device_id

    S->>DB: Get vault, verify ownership

    loop For each version
        S->>DB: Get or create file by path
        S->>DB: Check if version exists
        alt Version doesn't exist
            S->>DB: Insert version with device_id
            S->>S: Add to synced[]
        else Version exists
            S->>S: Skip (idempotent)
        end
    end

    S-->>C: {synced[], errors[]}
```

## File Structure

```
server/
├── src/
│   ├── index.ts              # Hono app entry point
│   ├── db.ts                 # SQLite wrapper
│   ├── config.ts             # Environment configuration
│   ├── middleware/
│   │   └── auth.ts           # JWT verification
│   ├── routes/
│   │   ├── auth.ts           # /auth/* endpoints
│   │   └── sync.ts           # /sync/*, /vaults/* endpoints
│   └── services/
│       └── sync.ts           # Sync business logic
├── package.json
└── tsconfig.json
```

## Configuration

Environment variables:

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3000) |
| `AUTH0_DOMAIN` | Auth0 tenant domain | Yes |
| `AUTH0_CLIENT_ID` | Auth0 application client ID | Yes |
| `AUTH0_CLIENT_SECRET` | Auth0 application client secret | Yes |
| `AUTH0_AUDIENCE` | Auth0 API audience | Yes |
| `DATABASE_PATH` | Path to SQLite database | No (default: ./data/obsync.db) |

## Security Considerations

1. **JWT Verification**: All sync endpoints verify JWT tokens using Auth0's JWKS
2. **User Isolation**: Users can only access their own vaults and data
3. **Device Tracking**: Each version records which device uploaded it
4. **Idempotent Uploads**: Re-uploading the same version ID is a no-op

## Dependencies

| Package | Purpose |
|---------|---------|
| `hono` | Web framework |
| `@hono/node-server` | Node.js adapter for Hono |
| `better-sqlite3` | Synchronous SQLite for Node.js |
| `jose` | JWT verification |

## Future Considerations (v2)

- Bi-directional sync (download versions from server)
- Conflict resolution for concurrent edits
- Vault sharing between users
- Webhook notifications for real-time sync
