# Clarity Graph for SiYuan

Clarity Graph is a SiYuan plugin that provides a clearer, more explorable global graph for your notes. It is inspired by Obsidian's global graph and SiYuan's built-in graph view, but focuses on readability, grouping, color control, and quick navigation.

## Project Note

This project was vibe-coded with the help of an AI agent, **Codex**. The plugin was iteratively designed, implemented, debugged, and documented through a human-guided Codex workflow.

## What It Does

- Shows a global graph of all SiYuan document notes
- Builds links from SiYuan document references
- Keeps orphan notes visible so disconnected top-level notes are not hidden
- Colors notes by top-level path, connected group, notebook, or tag
- Lets you choose custom colors for visible groups
- Shows useful hover details: note name, path, backlink count, outgoing count, group, tags, and update date
- Opens the clicked note directly in SiYuan
- Includes graph controls for arrows, labels, node size, link thickness, line opacity, center force, repel force, and link distance
- Includes insight panels for note count, link count, orphan count, connected groups, and most connected notes

## Why This Exists

SiYuan's built-in graph is useful, but it can be hard to visually understand larger note collections. This plugin tries to make the graph more useful for thinking:

- top-level areas become visually distinct
- isolated notes are visible instead of forgotten
- connected clusters are easier to recognize
- colors are user-controlled instead of fixed
- hover and click behavior is direct and predictable

## Screens And Controls

The plugin opens a custom **Global Graph** tab in SiYuan.

Main areas:

- **Graph canvas**: pan, zoom, hover, and click notes
- **Insights panel**: summary stats and most connected notes
- **Groups panel**: group color pickers
- **Controls panel**: filters, display settings, and force layout settings

Useful modes:

- **Color by top-level note**: groups notes by the first path segment in SiYuan
- **Color by connected group**: groups notes by graph connectivity
- **Color by notebook**: groups notes by SiYuan notebook
- **Color by tag**: groups notes by first tag

## Installation

See [SETUP.md](./SETUP.md) for macOS, Windows, and Linux setup instructions.

Short version:

1. Build the plugin.
2. Copy this folder into your SiYuan workspace under `data/plugins/siyuan-clarity-graph`.
3. Restart SiYuan.
4. Enable **Clarity Graph** in SiYuan's plugin settings.
5. Click the graph icon in the top bar.

## Development

Install dependencies:

```bash
npm install
```

Run a production build:

```bash
npm run build
```

Run TypeScript checks:

```bash
npm run typecheck
```

Watch and rebuild during development:

```bash
npm run dev
```

## Project Structure

```text
siyuan-clarity-graph/
  plugin.json          SiYuan plugin manifest
  package.json         Build and development scripts
  vite.config.ts       Vite build config
  src/
    index.ts           Plugin logic and graph renderer
    index.css          Graph UI styles
  dist/
    index.js           Built plugin script loaded by SiYuan
    index.css          Built plugin styles loaded by SiYuan
  index.js             Root copy loaded by unpacked local SiYuan installs
  index.css            Root copy loaded by unpacked local SiYuan installs
  scripts/
    copy-dist-to-root.mjs
  SETUP.md             Platform setup guide
```

## How Graph Data Works

The plugin reads SiYuan data through the local SiYuan API:

- `blocks` table: finds document notes
- `refs` table: finds references between documents

Each SiYuan document is rendered as a graph node. Each document reference becomes a directed graph edge.

Node size is based on total reference count:

```text
total degree = backlinks + outgoing references
```

Orphan notes are notes with no document references:

```text
backlinks = 0 and outgoing references = 0
```

## Current Limitations

- The graph currently focuses on document-level notes, not every paragraph/list/code block.
- Very large workspaces may need more performance tuning.
- Custom group colors are stored in browser/local app storage, not synced through SiYuan.
- The plugin depends on SiYuan's local SQL API shape, so future SiYuan schema changes may require updates.

## Troubleshooting

If the plugin appears in SiYuan but the graph does not open:

- confirm the plugin is enabled
- restart SiYuan completely
- confirm `index.js`, `index.css`, `dist/index.js`, and `dist/index.css` exist
- open SiYuan developer tools if available and check for plugin errors

If the graph opens but looks empty:

- make sure your notes have SiYuan references/backlinks
- enable **Show orphans**
- click **Refresh**
- clear the search field

## License

Personal project. Add a license before publishing publicly.
