# Version History UI Design

## Overview

A modal UI for browsing and restoring file version history in obsync.

## Access Points

- **Command palette**: "Show version history for current file"
- **File menu**: Right-click on .md file → "View version history"

## Modal Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Version History: note.md              [⇄ Diff] [Restore] ✕│
├──────────────────┬──────────────────────────────────────────┤
│                  │                                          │
│  Today 2:34 PM ◀ │  # My Note                               │
│  Today 1:15 PM   │                                          │
│  Today 11:02 AM  │  Some content here that was written      │
│  Yesterday 9:30  │  in this version of the file...          │
│  Jan 15, 4:22 PM │                                          │
│  Jan 15, 2:10 PM │  ## Section                              │
│                  │                                          │
│                  │  More content below.                     │
│                  │                                          │
└──────────────────┴──────────────────────────────────────────┘
```

### Components

- **Header**: File name + action buttons (Diff toggle, Restore, Close)
- **Left pane (~200px)**: Scrollable version list, newest first, with selection indicator
- **Right pane**: Content preview area

### Version List

- Shows timestamps only (e.g., "Today 2:34 PM", "Jan 15, 4:22 PM")
- Selected version highlighted with accent color
- Clicking a version updates the preview

### Content Preview

- **View mode** (default): Shows full content at selected version
- **Diff mode**: Shows diff from previous version (green additions, red deletions)

### Actions

- **Diff toggle**: Switches between view/diff modes
- **Restore**: Restores file to selected version (with confirmation)
- **Close (✕)**: Closes modal

## Implementation

### Files

- `src/ui/HistoryModal.ts` - Main modal class
- `src/main.ts` - Register command and file menu item

### Data Flow

1. Modal receives `HistoryService` and file path
2. On open: `history.getVersions(filePath)` loads version list
3. On version select: `history.reconstructVersion(fileId, versionNum)` loads content
4. On diff toggle: Compute diff between selected and previous version using DiffMatchPatch
5. On restore: `history.restore(filePath, versionNum)` restores file

### Styling

- Use Obsidian CSS variables for native look
- `--background-modifier-hover` for hover states
- `--interactive-accent` for selected version
- `--text-success` / `--text-error` for diff highlighting
- `--font-monospace` for content preview

## Out of Scope

- Deleted files recovery view (future enhancement)
