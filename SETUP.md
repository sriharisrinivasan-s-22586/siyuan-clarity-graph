# Setting Up Clarity Graph in SiYuan

This guide explains how to install and run Clarity Graph in the SiYuan desktop app on macOS, Windows, and Linux.

## 1. Build The Plugin

From the plugin folder:

```bash
npm install
npm run build
```

After the build, confirm these files exist:

```text
plugin.json
dist/index.js
dist/index.css
```

## 2. Find Your SiYuan Workspace

Open SiYuan and find your workspace path from SiYuan settings. The exact location depends on where you created your workspace.

Common examples:

macOS:

```text
/Users/<you>/Documents/SiYuan
```

Windows:

```text
C:\Users\<you>\Documents\SiYuan
```

Linux:

```text
/home/<you>/Documents/SiYuan
```

Inside that workspace, plugins live here:

```text
<SiYuan workspace>/data/plugins/
```

## 3. Copy The Plugin Folder

Copy the whole `siyuan-clarity-graph` folder into SiYuan's plugin directory.

The final folder structure must be:

```text
<SiYuan workspace>/data/plugins/siyuan-clarity-graph/plugin.json
<SiYuan workspace>/data/plugins/siyuan-clarity-graph/dist/index.js
<SiYuan workspace>/data/plugins/siyuan-clarity-graph/dist/index.css
```

Do not accidentally create a nested folder like this:

```text
<SiYuan workspace>/data/plugins/siyuan-clarity-graph/siyuan-clarity-graph/plugin.json
```

## macOS Setup

Example workspace:

```text
/Users/<you>/Documents/SiYuan
```

Example plugin destination:

```text
/Users/<you>/Documents/SiYuan/data/plugins/siyuan-clarity-graph
```

Using Finder:

1. Open your SiYuan workspace folder.
2. Open `data/plugins`.
3. Copy `siyuan-clarity-graph` into that folder.
4. Quit SiYuan completely.
5. Reopen SiYuan.

Using Terminal:

```bash
cp -R /path/to/siyuan-clarity-graph /Users/<you>/Documents/SiYuan/data/plugins/
```

## Windows Setup

Example workspace:

```text
C:\Users\<you>\Documents\SiYuan
```

Example plugin destination:

```text
C:\Users\<you>\Documents\SiYuan\data\plugins\siyuan-clarity-graph
```

Using File Explorer:

1. Open your SiYuan workspace folder.
2. Open `data\plugins`.
3. Copy `siyuan-clarity-graph` into that folder.
4. Fully close SiYuan.
5. Reopen SiYuan.

Using PowerShell:

```powershell
Copy-Item -Recurse -Force "C:\path\to\siyuan-clarity-graph" "C:\Users\<you>\Documents\SiYuan\data\plugins\"
```

## Linux Setup

Example workspace:

```text
/home/<you>/Documents/SiYuan
```

Example plugin destination:

```text
/home/<you>/Documents/SiYuan/data/plugins/siyuan-clarity-graph
```

Using Files:

1. Open your SiYuan workspace folder.
2. Open `data/plugins`.
3. Copy `siyuan-clarity-graph` into that folder.
4. Fully close SiYuan.
5. Reopen SiYuan.

Using Terminal:

```bash
cp -R /path/to/siyuan-clarity-graph /home/<you>/Documents/SiYuan/data/plugins/
```

## 4. Enable The Plugin In SiYuan

After copying the folder:

1. Restart SiYuan.
2. Open SiYuan settings.
3. Go to the plugin section.
4. Find **Clarity Graph**.
5. Enable it.

If the plugin detail page opens, close that page and return to the plugin list to make sure the enable toggle is turned on.

## 5. Open The Graph

After enabling the plugin:

1. Look at SiYuan's top bar.
2. Click the graph icon for **Clarity Graph**.
3. A new **Global Graph** tab should open.

Inside the graph:

- hover a node to see note details
- click a node to open the note
- search to filter notes
- change color mode from the controls panel
- use group color pickers to customize colors
- use **Fit** if the graph is off-screen
- use **Refresh** after changing references

## Updating The Plugin

When you change the source code:

```bash
npm run build
```

Then replace the old plugin folder inside:

```text
<SiYuan workspace>/data/plugins/siyuan-clarity-graph
```

Restart SiYuan after replacing the folder.

## Optional: Use A Symlink During Development

Instead of copying the plugin folder after every change, you can symlink it.

macOS/Linux:

```bash
ln -s /path/to/siyuan-clarity-graph <SiYuan workspace>/data/plugins/siyuan-clarity-graph
```

Windows PowerShell as Administrator:

```powershell
New-Item -ItemType SymbolicLink -Path "C:\Users\<you>\Documents\SiYuan\data\plugins\siyuan-clarity-graph" -Target "C:\path\to\siyuan-clarity-graph"
```

With a symlink, run this after code changes:

```bash
npm run build
```

Then restart or reload SiYuan.

## Troubleshooting

Plugin does not appear:

- check the folder path
- check that `plugin.json` is directly inside `siyuan-clarity-graph`
- restart SiYuan

Graph icon does not appear:

- make sure the plugin is enabled
- disable and re-enable the plugin
- restart SiYuan

Graph opens but has no useful links:

- make sure your notes reference each other in SiYuan
- turn on **Show orphans**
- clear the search field
- click **Refresh**

Custom colors disappeared:

- group colors are stored locally in the app/browser storage
- reinstalling or clearing app data may reset them
