# Obsync Architecture

## Overview

Obsync is an Obsidian plugin that tracks file versions using diffs, storing history in a SQLite database. It provides Google Docs-like version history - users can view diffs and restore previous versions.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Trigger** | On file save | Aligns with user expectations; saves are intentional checkpoints |
| **Storage** | Hybrid (diffs + checkpoints) | Balances storage efficiency with reconstruction speed |
| **Checkpoint interval** | Configurable (default: 10) | At most 10 patches to reconstruct any version |
| **File scope** | Markdown only (`.md`) | Core Obsidian content; binary files don't diff well |
| **Deleted files** | Keep history forever | History is the point; mark `deleted_at` for UI purposes |
| **Restoration** | In-place | Simple, direct; overwrites or recreates file |
| **IDs** | UUIDv7 | Time-sortable, globally unique, future sync-friendly |
| **Database** | sql.js (WebAssembly) | Pure JS, works in Obsidian's Electron environment |

## Component Architecture

```mermaid
graph TB
    subgraph Plugin["main.ts (Plugin Lifecycle)"]
        onload[onload]
        onunload[onunload]
        startupScan[startupScan]
        onFileModify[onFileModify]
    end

    subgraph Events["Vault Events"]
        modify["vault.on('modify')"]
        delete["vault.on('delete')"]
        rename["vault.on('rename')"]
    end

    subgraph Services
        DB["db.ts<br/>DbService"]
        History["history.ts<br/>HistoryService"]
        Settings["settings.ts<br/>ObsyncSettings"]
    end

    subgraph External
        SQLite["sql.js<br/>(WebAssembly SQLite)"]
        DMP["diff-match-patch-ts"]
        UUID["utils/uuid.ts<br/>UUIDv7"]
    end

    onload --> DB
    onload --> History
    onload --> startupScan
    onload --> Events

    modify --> onFileModify
    delete --> History
    rename --> DB

    onFileModify --> History
    History --> DB
    History --> DMP
    History --> UUID
    DB --> SQLite

    onunload --> DB
```

## Data Flow

### On Plugin Load

```mermaid
sequenceDiagram
    participant P as Plugin
    participant DB as DbService
    participant H as HistoryService
    participant V as Vault

    P->>DB: init()
    DB->>DB: Load or create SQLite DB
    DB->>DB: Run migrations
    P->>H: new HistoryService(db, vault, interval)
    P->>P: startupScan()

    loop For each .md file in vault
        P->>V: read(file)
        P->>H: hasChanged(path, content)?
        alt New or modified
            H->>H: save(path, content)
            H->>DB: insertFile / insertVersion
        end
    end

    loop For each tracked file not in vault
        P->>H: markDeleted(path)
    end

    P->>DB: save()
```

### On File Save

```mermaid
sequenceDiagram
    participant V as Vault
    participant P as Plugin
    participant H as HistoryService
    participant DMP as diff-match-patch
    participant DB as DbService

    V->>P: on('modify', file)
    P->>P: Is .md file?
    P->>V: read(file)
    P->>H: hasChanged(path, content)?

    alt Content changed
        P->>H: save(path, content)
        H->>DB: getFileByPath(path)
        H->>DB: getLatestVersion(fileId)

        alt First version or checkpoint interval
            H->>H: Store full content
        else Regular version
            H->>H: reconstructVersion(previous)
            H->>DMP: patch_make(previous, current)
            H->>H: Store patch
        end

        H->>DB: insertVersion(version)
        H->>DB: save()
    end
```

### Version Reconstruction

```mermaid
sequenceDiagram
    participant H as HistoryService
    participant DB as DbService
    participant DMP as diff-match-patch

    H->>DB: getNearestCheckpoint(fileId, targetVersion)
    DB-->>H: checkpoint (full content)

    H->>DB: getVersionsInRange(checkpoint+1, target)
    DB-->>H: versions[]

    loop For each version after checkpoint
        H->>DMP: patch_fromText(version.data)
        H->>DMP: patch_apply(patches, content)
        DMP-->>H: patched content
    end

    H-->>H: Reconstructed content
```

## Database Schema

```mermaid
erDiagram
    FILES {
        text id PK "UUIDv7"
        text path UK "vault-relative path"
        integer deleted_at "null if active"
        integer created_at
        integer updated_at
    }

    VERSIONS {
        text id PK "UUIDv7"
        text file_id FK
        integer is_checkpoint "1=full, 0=diff"
        text data "content or patch"
        integer created_at
    }

    FILES ||--o{ VERSIONS : "has many"
```

## Storage Strategy

```mermaid
graph LR
    subgraph "Version Chain (interval=10)"
        V1[v1<br/>Checkpoint]
        V2[v2<br/>Diff]
        V3[v3<br/>Diff]
        V4[...]
        V10[v10<br/>Checkpoint]
        V11[v11<br/>Diff]
        V12[...]
        V20[v20<br/>Checkpoint]
    end

    V1 --> V2 --> V3 --> V4 --> V10
    V10 --> V11 --> V12 --> V20

    style V1 fill:#4CAF50,color:#fff
    style V10 fill:#4CAF50,color:#fff
    style V20 fill:#4CAF50,color:#fff
```

**Reconstruction example (v15):**
1. Find nearest checkpoint: v10
2. Load v10 (full content)
3. Apply patches: v11, v12, v13, v14, v15
4. Result: content at v15

## File Structure

```
src/
├── main.ts           # Plugin lifecycle, event hooks
├── settings.ts       # Settings interface (checkpointInterval)
├── history.ts        # HistoryService (save, diff, reconstruct, restore)
├── db.ts             # SQLite wrapper (connection, migrations, queries)
└── utils/
    └── uuid.ts       # UUIDv7 generation
```

## Event Handling

```mermaid
graph TD
    subgraph "Vault Events"
        M["modify"]
        D["delete"]
        R["rename"]
    end

    subgraph "Plugin Handlers"
        HM["onFileModify<br/>Save new version"]
        HD["markDeleted<br/>Set deleted_at"]
        HR["updateFile<br/>Update path"]
    end

    M -->|".md files only"| HM
    D -->|".md files only"| HD
    R -->|".md files only"| HR
```

## Startup Scan Logic

```mermaid
flowchart TD
    Start[Plugin loads] --> Init[Initialize DB & HistoryService]
    Init --> Scan[Scan vault for .md files]

    Scan --> ForEach{For each file}

    ForEach --> InDB{In database?}

    InDB -->|No| NewFile[Create file record<br/>+ initial checkpoint]
    InDB -->|Yes| Changed{Content changed?}

    Changed -->|Yes| SaveVersion[Create new version]
    Changed -->|No| Skip[Skip]

    NewFile --> Next[Next file]
    SaveVersion --> Next
    Skip --> Next

    Next --> ForEach
    Next -->|Done| CheckDeleted[Check for deleted files]

    CheckDeleted --> ForDeleted{For each tracked file}
    ForDeleted --> InVault{Still in vault?}

    InVault -->|No| MarkDeleted[Set deleted_at]
    InVault -->|Yes| SkipD[Skip]

    MarkDeleted --> NextD[Next tracked file]
    SkipD --> NextD
    NextD --> ForDeleted
    NextD -->|Done| Done[Scan complete]
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `sql.js` | Pure JavaScript SQLite via WebAssembly |
| `diff-match-patch-ts` | Text diffing and patching |
| `obsidian` | Obsidian plugin API |
