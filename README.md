# Obsync

**Version history for Obsidian** — Google Docs-like version tracking for your notes.

Obsync automatically tracks changes to your markdown files and stores version history locally using diffs. View what changed between versions and restore previous versions with ease.

## Features

- **Automatic version tracking** — Saves versions automatically when files are modified
- **Efficient diff storage** — Uses a hybrid approach with diffs and periodic checkpoints to minimize storage
- **Local-first** — All data stored in a SQLite database within your vault
- **Startup scan** — Detects new, modified, and deleted files when Obsidian launches
- **Configurable checkpoints** — Adjust the checkpoint interval to balance storage vs. reconstruction speed

## How it works

Obsync monitors your markdown files and creates version snapshots:

1. **Diffs** — Most versions are stored as compact diffs from the previous version
2. **Checkpoints** — Full snapshots are saved periodically (default: every 10 versions) for fast reconstruction
3. **SQLite database** — All history is stored in `history.db` within the plugin folder

## Installation

### From community plugins

1. Open **Settings → Community plugins**
2. Select **Browse** and search for "Obsync"
3. Select **Install**, then **Enable**

### Manual installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder: `<YourVault>/.obsidian/plugins/obsync/`
3. Copy the downloaded files into the folder
4. Restart Obsidian and enable the plugin in **Settings → Community plugins**

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Checkpoint interval | 10 | Number of versions between full snapshots. Lower values mean faster version reconstruction but more storage usage. |

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
npm install
```

### Development (watch mode)

```bash
npm run dev
```

### Production build

```bash
npm run build
```

### Linting

```bash
npm run lint
```

### Testing

```bash
npm run test
```

## Architecture

See [docs/architecture.md](docs/architecture.md) for detailed technical documentation.

**Key design decisions:**

- **Markdown only** — Focuses on `.md` files; binary files don't diff efficiently
- **UUIDv7 IDs** — Time-sortable and globally unique for future sync support
- **sql.js** — WebAssembly SQLite that works in Obsidian's Electron environment
- **diff-match-patch** — Battle-tested diffing algorithm for text

## License

[MIT](LICENSE)

## API Documentation

See https://docs.obsidian.md
