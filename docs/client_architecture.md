# Obsync Architecture

## Overview

Obsync is an Obsidian plugin that tracks file versions using diffs, storing history in a SQLite database. It provides Google Docs-like version history - users can view diffs and restore previous versions.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Trigger** | On file save | Aligns with user expectations; saves are intentional checkpoints |
| **Storage** | Hybrid (diffs + snapshots) | Balances storage efficiency with reconstruction speed |
| **Snapshot strategy** | Daemon-based (default: 10 min) | First version is always a snapshot; daemon creates periodic snapshots for files with changes |
| **Max snapshots per file** | 2 (first + daemon) | Keeps storage bounded while ensuring fast reconstruction |
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
        snapshotDaemon[Snapshot Daemon]
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
    onload --> snapshotDaemon
    onload --> Events

    modify --> onFileModify
    delete --> History
    rename --> DB

    onFileModify --> History
    snapshotDaemon --> History
    History --> DB
    History --> DMP
    History --> UUID
    DB --> SQLite

    onunload --> snapshotDaemon
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
    P->>H: new HistoryService(db, vault)
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
    P->>P: startSnapshotDaemon()
    P->>H: runSnapshotDaemon() (immediate)
    P->>P: setInterval(runSnapshotDaemon)
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

        alt First version (no previous)
            H->>H: Store full content (snapshot)
        else Subsequent version
            H->>H: reconstructVersion(previous)
            H->>DMP: patch_make(previous, current)
            H->>H: Store patch (diff)
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

### Snapshot Daemon

The snapshot daemon runs periodically (default: every 10 minutes) to create snapshots for files that have been modified since the last snapshot. This ensures reconstruction never requires applying too many diffs.

```mermaid
sequenceDiagram
    participant P as Plugin
    participant H as HistoryService
    participant DB as DbService

    P->>H: runSnapshotDaemon()
    H->>DB: getAllFiles()
    DB-->>H: files[]

    loop For each non-deleted file
        H->>DB: getLatestVersion(fileId)

        alt Latest is NOT a snapshot
            H->>H: reconstructVersion(latest)
            H->>DB: insertVersion(new snapshot)
            H->>DB: deleteNonFirstCheckpoints(fileId, newId)
            Note over H,DB: Keeps first version + new snapshot
        end
    end

    H->>DB: save()
```

**Key behaviors:**
- Runs immediately on plugin startup, then every N minutes
- Only creates snapshot if latest version is a diff
- Deletes previous daemon-created snapshots (keeps max 2 per file: first + latest)
- Restarts when settings change

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
    subgraph "Version Chain (daemon-based snapshots)"
        V1[v1<br/>First Snapshot]
        V2[v2<br/>Diff]
        V3[v3<br/>Diff]
        V4[...]
        V10[v10<br/>Diff]
        V11[v11<br/>Daemon Snapshot]
        V12[v12<br/>Diff]
        V13[...]
        V20[v20<br/>Diff]
        V21[v21<br/>Daemon Snapshot]
    end

    V1 --> V2 --> V3 --> V4 --> V10 --> V11
    V11 --> V12 --> V13 --> V20 --> V21

    style V1 fill:#4CAF50,color:#fff
    style V11 fill:#2196F3,color:#fff
    style V21 fill:#2196F3,color:#fff
```

**Legend:**
- 🟢 Green: First version snapshot (kept forever)
- 🔵 Blue: Daemon-created snapshot (only latest kept)

**Snapshot lifecycle:**
1. First save → v1 is always a full snapshot
2. Subsequent saves → diffs only
3. Daemon runs (every 10 min) → creates snapshot if latest is a diff
4. When daemon creates v21, it deletes v11 (keeps only first + latest snapshot)

**Reconstruction example (v15):**
1. Find nearest checkpoint: v11 (daemon snapshot)
2. Load v11 (full content)
3. Apply patches: v12, v13, v14, v15
4. Result: content at v15

## File Structure

```
src/
├── main.ts           # Plugin lifecycle, event hooks, snapshot daemon
├── settings.ts       # Settings interface (snapshotIntervalMinutes)
├── history.ts        # HistoryService (save, diff, reconstruct, restore, runSnapshotDaemon)
├── db.ts             # SQLite wrapper (connection, migrations, queries)
├── ui/
│   └── HistoryModal.ts  # Version history UI
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

    InDB -->|No| NewFile[Create file record<br/>+ initial snapshot]
    InDB -->|Yes| Changed{Content changed?}

    Changed -->|Yes| SaveVersion[Create new version<br/>diff only]
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
    NextD -->|Done| StartDaemon[Start Snapshot Daemon]
    StartDaemon --> RunImmediate[Run daemon immediately]
    RunImmediate --> SetInterval[Set interval for periodic runs]
    SetInterval --> Done[Startup complete]
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `sql.js` | Pure JavaScript SQLite via WebAssembly |
| `diff-match-patch-ts` | Text diffing and patching |
| `obsidian` | Obsidian plugin API |
