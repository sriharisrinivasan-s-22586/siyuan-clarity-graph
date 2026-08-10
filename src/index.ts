import { Plugin, openTab, showMessage } from "siyuan";
import "./index.css";

type ColorMode = "path" | "component" | "notebook" | "tag";

type Settings = {
  version: number;
  colorMode: ColorMode;
  includeOrphans: boolean;
  arrows: boolean;
  labelThreshold: number;
  nodeSize: number;
  linkThickness: number;
  lineOpacity: number;
  centerStrength: number;
  repelForce: number;
  linkDistance: number;
  colors: Record<string, string>;
};

type FileTreeDoc = {
  id: string;
  title: string;
  hpath: string;
  box: string;
  boxName: string;
};

type NotebookInfo = {
  id: string;
  name: string;
  closed?: boolean;
};

type FileTreeEntry = {
  id?: string;
  name?: string;
  title?: string;
  path?: string;
  hPath?: string;
  files?: FileTreeEntry[];
  subFileCount?: number;
};

type GraphNode = {
  id: string;
  title: string;
  hpath: string;
  box: string;
  boxName: string;
  tag: string;
  updated: string;
  pathGroup: string;
  isTopLevel: boolean;
  hasSubLinks: boolean;
  component: string;
  groupKey: string;
  color: string;
  inbound: number;
  outbound: number;
  hierarchyCount: number;
  degree: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
};

type GraphLink = {
  source: string;
  target: string;
  count: number;
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

const TAB_TYPE = "clarity-graph";
const SETTINGS_KEY = "siyuan-clarity-graph-settings";
const SETTINGS_VERSION = 3;
const DEFAULT_COLORS = ["#3b82f6", "#ef4444", "#a855f7", "#22c55e", "#f59e0b", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6"];
const DEFAULT_SETTINGS: Settings = {
  version: SETTINGS_VERSION,
  colorMode: "path",
  includeOrphans: true,
  arrows: true,
  labelThreshold: 0.14,
  nodeSize: 2.45,
  linkThickness: 1.8,
  lineOpacity: 0.5,
  centerStrength: 0.18,
  repelForce: 7.5,
  linkDistance: 86,
  colors: {}
};

export default class ClarityGraphPlugin extends Plugin {
  private root?: HTMLElement;
  private graph: GraphData = { nodes: [], links: [] };
  private settings: Settings = loadSettings();
  private view = { x: 0, y: 0, scale: 1 };
  private viewFrame?: number;
  private cachedBounds?: { minX: number; maxX: number; minY: number; maxY: number };
  private cachedStageDims = { width: 900, height: 620 };
  private cachedCanvasRect = { left: 0, top: 0 };
  private cachedVisibleNodes: GraphNode[] = [];
  private cachedVisibleLinks: Array<{ source: GraphNode; target: GraphNode; count: number }> = [];
  private hoveredNodeId?: string;
  private openTopBarElement?: HTMLElement;
  private pulseFrame?: number;
  private simFrame?: number;
  private draggedNode?: GraphNode;
  private stageResizeObserver?: ResizeObserver;
  private simState?: {
    nodes: GraphNode[];
    links: Array<{ source: GraphNode | undefined; target: GraphNode | undefined; count: number }>;
    groupCenters: Map<string, { x: number; y: number }>;
    tick: number;
  };

  async onload() {
    const plugin = this;

    this.addTab({
      type: TAB_TYPE,
      init() {
        plugin.root = this.element;
        plugin.renderShell();
        void plugin.refresh();
      },
      beforeDestroy() {
        plugin.hideTooltip();
        plugin.cancelViewFrame();
        plugin.stopPulseLoop();
        plugin.stopSimFrame();
        plugin.stageResizeObserver?.disconnect();
        plugin.stageResizeObserver = undefined;
        plugin.root?.classList.remove("cg-host");
        plugin.root = undefined;
      }
    });

    this.addCommand({
      langKey: "open-clarity-graph",
      langText: "Open Clarity Graph",
      hotkey: "⌥⇧G",
      callback: () => this.openGraph()
    });
  }

  onLayoutReady() {
    this.openTopBarElement = this.addTopBar({
      icon: "iconGraph",
      title: "Clarity Graph",
      position: "right",
      callback: () => this.openGraph()
    });
  }

  private openGraph() {
    openTab({
      app: this.app,
      custom: {
        icon: "iconGraph",
        title: "Clarity Graph",
        data: {},
        id: `${this.name}${TAB_TYPE}`
      }
    });
  }

  private renderShell() {
    if (!this.root) return;

    this.root.classList.add("cg-host");
    this.root.innerHTML = `
      <div class="cg-root">
        <header class="cg-header">
          <div>
            <strong>Global Graph</strong>
            <span class="cg-subtitle">All notes, references, groups, and orphans</span>
          </div>
          <input class="cg-search" type="search" placeholder="Search notes, paths, tags" />
          <button class="cg-icon cg-fit" type="button" title="Fit graph">Fit</button>
          <button class="cg-icon cg-toggle-controls" type="button" title="Show or hide controls">Controls</button>
          <button class="cg-icon cg-refresh" type="button" title="Refresh graph">Refresh</button>
        </header>
        <main class="cg-layout">
          <section class="cg-stage">
            <canvas class="cg-canvas"></canvas>
            <div class="cg-tooltip"></div>
            <div class="cg-empty">Loading global graph...</div>
          </section>
          <aside class="cg-controls">
            <h2>Filters</h2>
            <label class="cg-switch"><span>Show orphans</span><input class="cg-setting" data-setting="includeOrphans" type="checkbox" /></label>
            <label class="cg-switch"><span>Arrows</span><input class="cg-setting" data-setting="arrows" type="checkbox" /></label>
            <label><span>Color by</span><select class="cg-setting" data-setting="colorMode">
              <option value="path">Top-level note</option>
              <option value="component">Connected group</option>
              <option value="notebook">Notebook</option>
              <option value="tag">Tag</option>
            </select></label>
            <h2>Display</h2>
            ${rangeControl("labelThreshold", "Label threshold", 0, 1, 0.01)}
            ${rangeControl("nodeSize", "Node size", 0.8, 4, 0.05)}
            ${rangeControl("linkThickness", "Link thickness", 0.5, 7, 0.1)}
            ${rangeControl("lineOpacity", "Line opacity", 0.05, 1, 0.01)}
            <h2>Forces</h2>
            ${rangeControl("centerStrength", "Center force", 0.05, 1, 0.01)}
            ${rangeControl("repelForce", "Repel force", 2, 28, 0.25)}
            ${rangeControl("linkDistance", "Link distance", 40, 260, 5)}
            <h2>Colors</h2>
            <div class="cg-groups"></div>
            <button class="cg-reset" type="button">Reset</button>
          </aside>
        </main>
      </div>
    `;

    this.bindControls();
    this.syncControls();
  }

  private bindControls() {
    if (!this.root) return;
    this.root.querySelector(".cg-refresh")?.addEventListener("click", () => void this.refresh());
    this.root.querySelector(".cg-fit")?.addEventListener("click", () => this.fitView(this.visibleNodes()));
    this.root.querySelector(".cg-toggle-controls")?.addEventListener("click", () => {
      this.root?.querySelector(".cg-layout")?.classList.toggle("is-controls-hidden");
      window.setTimeout(() => this.fitView(this.visibleNodes()), 0);
    });
    this.root.querySelector(".cg-search")?.addEventListener("input", () => this.draw());
    this.root.querySelector(".cg-stage")?.addEventListener("pointerleave", () => {
      this.hideTooltip();
      if (this.hoveredNodeId !== undefined) {
        this.hoveredNodeId = undefined;
        this.scheduleViewTransform();
      }
    });
    this.root.addEventListener("scroll", () => this.hideTooltip(), true);
    this.root.querySelector(".cg-reset")?.addEventListener("click", () => {
      this.settings = { ...DEFAULT_SETTINGS, colors: {} };
      saveSettings(this.settings);
      this.syncControls();
      this.applyGroupsAndColors();
      this.simulate();
      this.fitView(this.visibleNodes());
      this.draw();
    });

    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".cg-setting").forEach((control) => {
      control.addEventListener("input", () => {
        const key = control.dataset.setting as keyof Settings;
        if (control instanceof HTMLInputElement && control.type === "checkbox") {
          (this.settings[key] as boolean) = control.checked;
        } else if (control instanceof HTMLInputElement && control.type === "range") {
          (this.settings[key] as number) = Number(control.value);
        } else {
          (this.settings[key] as ColorMode) = control.value as ColorMode;
        }
        saveSettings(this.settings);
        this.syncRangeValues();
        this.applyGroupsAndColors();
        this.simulate();
        this.draw();
      });
    });
  }

  private syncControls() {
    if (!this.root) return;
    this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(".cg-setting").forEach((control) => {
      const key = control.dataset.setting as keyof Settings;
      const value = this.settings[key];
      if (control instanceof HTMLInputElement && control.type === "checkbox") {
        control.checked = Boolean(value);
      } else {
        control.value = String(value);
      }
    });
    this.syncRangeValues();
  }

  private syncRangeValues() {
    this.root?.querySelectorAll<HTMLElement>(".cg-range-value").forEach((node) => {
      const key = node.dataset.for as keyof Settings;
      node.textContent = String(this.settings[key]);
    });
  }

  private async refresh() {
    if (!this.root) return;
    this.hideTooltip();
    const empty = this.root.querySelector<HTMLElement>(".cg-empty");
    if (empty) {
      empty.style.display = "grid";
      empty.textContent = "Refreshing SiYuan index...";
    }

    try {
      await this.flushIndex();
      if (empty) empty.textContent = "Loading every note reference...";
      this.graph = await this.loadGraph();
      this.applyGroupsAndColors();
      this.scatterPositions();
      this.draw();
      this.fitView(this.cachedVisibleNodes);
      this.startAnimatedSim();
      showMessage(`Clarity Graph refreshed: ${this.graph.nodes.length} notes, ${this.graph.links.length} links`, 2600);
    } catch (error) {
      console.error(error);
      showMessage("Clarity Graph failed to load global references");
      if (empty) empty.textContent = "Could not load graph data.";
    }
  }

  private async loadGraph(): Promise<GraphData> {
    const sqlDocs = await this.sql(`
      SELECT id, content, hpath, box, tag, updated
      FROM blocks
      WHERE type = 'd'
      ORDER BY hpath ASC
    `);
    const sqlById = new Map(sqlDocs.map((row) => [String(row.id), row]));
    const treeDocs = await this.loadFileTreeDocs();
    const sourceDocs = treeDocs.length ? treeDocs : sqlDocs.map((row) => ({
      id: String(row.id),
      title: String(row.content || lastPathSegment(String(row.hpath || "")) || "Untitled"),
      hpath: String(row.hpath || ""),
      box: String(row.box || ""),
      boxName: String(row.box || "Notebook")
    }));

    const nodes = sourceDocs.map((doc, index) => {
      const sql = sqlById.get(doc.id);
      const hpath = String(sql?.hpath || doc.hpath || `/${doc.title}`);
      return {
        id: doc.id,
        title: String(sql?.content || doc.title || lastPathSegment(hpath) || "Untitled"),
        hpath,
        box: String(sql?.box || doc.box || ""),
        boxName: doc.boxName || String(sql?.box || "Notebook"),
        tag: String(sql?.tag || ""),
        updated: String(sql?.updated || ""),
        pathGroup: firstPathSegment(hpath),
        isTopLevel: pathDepth(hpath) <= 1,
        hasSubLinks: false,
        component: "",
        groupKey: "",
        color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
        inbound: 0,
        outbound: 0,
        hierarchyCount: 0,
        degree: 0,
        x: seededRange(`${doc.id}:x`, -260, 260),
        y: seededRange(`${doc.id}:y`, -210, 210),
        vx: 0,
        vy: 0
      };
    });
    const docIds = new Set(nodes.map((node) => node.id));

    const refs = await this.sql(`
      SELECT root_id, def_block_root_id
      FROM refs
      WHERE root_id != '' AND def_block_root_id != '' AND root_id != def_block_root_id
    `);
    const counts = new Map<string, number>();

    for (const row of refs) {
      const source = String(row.root_id);
      const target = String(row.def_block_root_id);
      if (!docIds.has(source) || !docIds.has(target)) continue;
      counts.set(`${source}->${target}`, (counts.get(`${source}->${target}`) ?? 0) + 1);
    }

    await this.addSpanReferenceCounts(counts, docIds);

    const links = Array.from(counts, ([key, count]) => {
      const [source, target] = key.split("->");
      return { source, target, count };
    });

    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const link of links) {
      const source = byId.get(link.source);
      const target = byId.get(link.target);
      if (source) source.outbound += link.count;
      if (target) target.inbound += link.count;
      if (source && target) {
        if (source.isTopLevel && !target.isTopLevel && target.pathGroup === source.pathGroup) source.hasSubLinks = true;
        if (target.isTopLevel && !source.isTopLevel && source.pathGroup === target.pathGroup) target.hasSubLinks = true;
      }
    }
    for (const node of nodes) {
      node.degree = node.inbound + node.outbound;
    }

    assignComponents(nodes, links);
    return { nodes, links };
  }

  private async addSpanReferenceCounts(counts: Map<string, number>, docIds: Set<string>) {
    const spans = await this.sql(`
      SELECT root_id, markdown, content
      FROM spans
      WHERE type = 'textmark block-ref' AND root_id != ''
    `);
    const unresolvedTargets = new Set<string>();
    const spanRefs: Array<{ source: string; targetBlock: string }> = [];

    for (const row of spans) {
      const source = String(row.root_id || "");
      if (!docIds.has(source)) continue;

      const targetIds = explicitRefIds(`${String(row.markdown || "")} ${String(row.content || "")}`);
      for (const targetBlock of targetIds) {
        if (!targetBlock || targetBlock === source) continue;
        spanRefs.push({ source, targetBlock });
        if (!docIds.has(targetBlock)) unresolvedTargets.add(targetBlock);
      }
    }

    const blockRoots = await this.blockRootMap([...unresolvedTargets]);
    for (const ref of spanRefs) {
      const target = docIds.has(ref.targetBlock) ? ref.targetBlock : blockRoots.get(ref.targetBlock);
      if (!target || !docIds.has(target) || target === ref.source) continue;
      counts.set(`${ref.source}->${target}`, Math.max(counts.get(`${ref.source}->${target}`) ?? 0, 1));
    }
  }

  private async blockRootMap(ids: string[]) {
    const roots = new Map<string, string>();
    const validIds = uniqueSorted(ids.filter((id) => /^[0-9a-z-]+$/i.test(id)));
    for (let index = 0; index < validIds.length; index += 180) {
      const batch = validIds.slice(index, index + 180);
      if (!batch.length) continue;
      const rows = await this.sql(`
        SELECT id, root_id
        FROM blocks
        WHERE id IN (${batch.map(sqlQuote).join(",")}) AND root_id != ''
      `);
      for (const row of rows) {
        roots.set(String(row.id), String(row.root_id));
      }
    }
    return roots;
  }

  private async flushIndex() {
    try {
      await this.kernelPost("/api/sqlite/flushTransaction", {});
      await delay(250);
    } catch (error) {
      console.warn("Clarity Graph could not flush SQLite transaction before refresh", error);
    }
  }

  private async kernelPost(path: string, body: Record<string, unknown>) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(payload.msg || `${path} failed`);
    return payload.data;
  }

  private async sql(stmt: string): Promise<Record<string, unknown>[]> {
    return await this.kernelPost("/api/query/sql", { stmt }) ?? [];
  }

  private async loadFileTreeDocs(): Promise<FileTreeDoc[]> {
    const data = await this.kernelPost("/api/notebook/lsNotebooks", {});
    const notebooks = ((data?.notebooks ?? []) as NotebookInfo[]).filter((notebook) => !notebook.closed);
    const docs: FileTreeDoc[] = [];

    for (const notebook of notebooks) {
      docs.push(...await this.collectNotebookDocs(notebook, "/", []));
    }

    return docs;
  }

  private async collectNotebookDocs(notebook: NotebookInfo, path: string, ancestors: string[]): Promise<FileTreeDoc[]> {
    const data = await this.kernelPost("/api/filetree/listDocsByPath", { notebook: notebook.id, path });
    const files = ((data?.files ?? []) as FileTreeEntry[]);
    const docs: FileTreeDoc[] = [];

    for (const file of files) {
      if (!file.id) continue;
      const title = cleanDocTitle(String(file.title || file.name || "Untitled"));
      const hpath = String(file.hPath || `/${[...ancestors, title].join("/")}`);
      const filePath = String(file.path || joinDocPath(path, file.id));
      docs.push({
        id: file.id,
        title,
        hpath,
        box: notebook.id,
        boxName: notebook.name
      });

      if (Array.isArray(file.files) && file.files.length) {
        docs.push(...flattenInlineDocs(file.files, notebook, [...ancestors, title]));
      } else if ((file.subFileCount ?? 0) > 0 || filePath !== path) {
        try {
          docs.push(...await this.collectNotebookDocs(notebook, filePath, [...ancestors, title]));
        } catch (error) {
          console.warn("Clarity Graph could not read child docs", filePath, error);
        }
      }
    }

    return docs;
  }

  private applyGroupsAndColors() {
    const seen = new Map<string, number>();
    for (const node of this.graph.nodes) {
      const key = this.groupKeyFor(node);
      node.groupKey = key;
      if (!seen.has(key)) seen.set(key, seen.size);
      const fallback = DEFAULT_COLORS[(seen.get(key) ?? 0) % DEFAULT_COLORS.length];
      node.color = this.settings.colors[key] ?? fallback;
    }
    this.renderInsights();
  }

  private seedPositions() {
    const nodes = this.graph.nodes;
    const centers = centersForGroups(nodes);
    const groupSeen = new Map<string, number>();

    for (const node of nodes) {
      const groupIndex = groupSeen.get(node.groupKey) ?? 0;
      groupSeen.set(node.groupKey, groupIndex + 1);

      const center = centers.get(node.groupKey) ?? { x: 0, y: 0 };
      const orbit = node.degree === 0 ? 95 + seededRange(`${node.id}:orphanOrbit`, 0, 170) : 28 + node.degree * 8;
      const angle = seededRange(`${node.id}:angle`, 0, Math.PI * 2) + groupIndex * 0.47;
      const jitterX = seededRange(`${node.id}:jx`, -64, 64);
      const jitterY = seededRange(`${node.id}:jy`, -64, 64);

      node.x = center.x + Math.cos(angle) * orbit + jitterX;
      node.y = center.y + Math.sin(angle) * orbit + jitterY;
      node.vx = 0;
      node.vy = 0;
    }
  }

  private scatterPositions() {
    const nodes = this.graph.nodes;
    const centers = centersForGroups(nodes);
    for (const node of nodes) {
      const center = centers.get(node.groupKey) ?? { x: 0, y: 0 };
      const angle = Math.random() * Math.PI * 2;
      const r = node.degree === 0 ? 180 + Math.random() * 160 : 40 + Math.random() * 140;
      node.x = center.x + Math.cos(angle) * r;
      node.y = center.y + Math.sin(angle) * r;
      node.vx = 0;
      node.vy = 0;
    }
  }

  private groupKeyFor(node: GraphNode) {
    if (this.settings.colorMode === "component") return node.degree === 0 ? `Orphan: ${node.title}` : node.component;
    if (this.settings.colorMode === "notebook") return node.box || "No notebook";
    if (this.settings.colorMode === "tag") return firstTag(node.tag);
    return node.degree === 0 ? `${node.pathGroup} / ${node.title}` : node.pathGroup;
  }

  private renderInsights() {
    if (!this.root) return;
    const stats = this.root.querySelector<HTMLElement>(".cg-stats");
    const groups = this.root.querySelector<HTMLElement>(".cg-groups");
    if (!groups) return;
    if (stats) stats.innerHTML = "";

    const groupKeys = uniqueSorted(this.graph.nodes.map((node) => node.groupKey)).slice(0, 24);
    const notebookKeys = uniqueSorted(this.graph.nodes.map((node) => notebookColorKey(node)));
    groups.innerHTML = `
      <div class="cg-color-section">
        <strong>Notebook areas</strong>
        ${this.renderColorRows(notebookKeys, true)}
      </div>
      <div class="cg-color-section">
        <strong>Node groups</strong>
        ${this.renderColorRows(groupKeys, false)}
      </div>
    `;
    this.bindColorRows(groups);
  }

  private renderColorRows(keys: string[], useLightFallback: boolean) {
    return keys.map((key) => {
      const value = this.settings.colors[key] ?? colorFor(key, keys, useLightFallback);
      return `
        <label class="cg-color-row" title="${escapeAttr(key)}">
          <button class="cg-color-swatch" type="button" data-group="${escapeAttr(key)}" style="--group-color: ${value}" aria-label="Choose color for ${escapeAttr(key)}"></button>
          <span>${escapeHtml(displayColorKey(key))}</span>
          <input type="color" data-group="${escapeAttr(key)}" value="${value}" />
        </label>
      `;
    }).join("");
  }

  private bindColorRows(groups: HTMLElement) {
    groups.querySelectorAll<HTMLButtonElement>(".cg-color-swatch").forEach((button) => {
      button.addEventListener("click", () => {
        const group = button.dataset.group;
        if (!group) return;
        groups.querySelector<HTMLInputElement>(`input[type='color'][data-group="${cssEscape(group)}"]`)?.click();
      });
    });
    groups.querySelectorAll<HTMLInputElement>("input[type='color']").forEach((input) => {
      input.addEventListener("input", () => {
        const group = input.dataset.group;
        if (!group) return;
        this.settings.colors[group] = input.value;
        saveSettings(this.settings);
        this.applyGroupsAndColors();
        this.draw();
      });
    });
  }

  private simulate() {
    const nodes = this.visibleNodes();
    const visible = new Set(nodes.map((node) => node.id));
    const byId = new Map(this.graph.nodes.map((node) => [node.id, node]));
    const links = this.graph.links
      .filter((link) => visible.has(link.source) && visible.has(link.target))
      .map((link) => ({ source: byId.get(link.source), target: byId.get(link.target), count: link.count }));
    const groupCenters = centersForGroups(nodes);

    for (let tick = 0; tick < 260; tick += 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x || 0.01;
          const dy = a.y - b.y || 0.01;
          const dist2 = dx * dx + dy * dy;
          const force = Math.min((this.settings.repelForce * 680) / dist2, 4);
          a.vx += dx * force * 0.01;
          a.vy += dy * force * 0.01;
          b.vx -= dx * force * 0.01;
          b.vy -= dy * force * 0.01;
        }
      }

      for (const link of links) {
        if (!link.source || !link.target) continue;
        const dx = link.target.x - link.source.x;
        const dy = link.target.y - link.source.y;
        const distance = Math.max(Math.hypot(dx, dy), 1);
        const desired = this.settings.linkDistance / Math.max(Math.sqrt(link.count), 1);
        const force = (distance - desired) * 0.004;
        link.source.vx += (dx / distance) * force;
        link.source.vy += (dy / distance) * force;
        link.target.vx -= (dx / distance) * force;
        link.target.vy -= (dy / distance) * force;
      }

      for (const node of nodes) {
        const center = groupCenters.get(node.groupKey) ?? { x: 0, y: 0 };
        const centerForce = this.settings.centerStrength * (node.degree === 0 ? 0.018 : 0.01);
        node.vx += (center.x - node.x) * centerForce;
        node.vy += (center.y - node.y) * centerForce;
        node.x += node.vx;
        node.y += node.vy;
        node.vx *= 0.76;
        node.vy *= 0.76;
      }
    }
  }

  private physicsStep(
    nodes: GraphNode[],
    links: Array<{ source: GraphNode | undefined; target: GraphNode | undefined; count: number }>,
    groupCenters: Map<string, { x: number; y: number }>
  ) {
    const pinned = this.draggedNode;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = a.x - b.x || 0.01;
        const dy = a.y - b.y || 0.01;
        const dist2 = dx * dx + dy * dy;
        const force = Math.min((this.settings.repelForce * 680) / dist2, 4);
        if (a !== pinned) { a.vx += dx * force * 0.01; a.vy += dy * force * 0.01; }
        if (b !== pinned) { b.vx -= dx * force * 0.01; b.vy -= dy * force * 0.01; }
      }
    }
    for (const link of links) {
      if (!link.source || !link.target) continue;
      const dx = link.target.x - link.source.x;
      const dy = link.target.y - link.source.y;
      const distance = Math.max(Math.hypot(dx, dy), 1);
      const desired = this.settings.linkDistance / Math.max(Math.sqrt(link.count), 1);
      const force = (distance - desired) * 0.004;
      if (link.source !== pinned) { link.source.vx += (dx / distance) * force; link.source.vy += (dy / distance) * force; }
      if (link.target !== pinned) { link.target.vx -= (dx / distance) * force; link.target.vy -= (dy / distance) * force; }
    }
    for (const node of nodes) {
      if (node === pinned) continue;
      const center = groupCenters.get(node.groupKey) ?? { x: 0, y: 0 };
      const centerForce = this.settings.centerStrength * (node.degree === 0 ? 0.018 : 0.01);
      node.vx += (center.x - node.x) * centerForce;
      node.vy += (center.y - node.y) * centerForce;
      node.x += node.vx;
      node.y += node.vy;
      node.vx *= 0.76;
      node.vy *= 0.76;
    }
  }

  private startAnimatedSim() {
    this.stopSimFrame();
    const nodes = this.cachedVisibleNodes;
    const visible = new Set(nodes.map((n) => n.id));
    const byId = new Map(this.graph.nodes.map((n) => [n.id, n]));
    this.simState = {
      nodes,
      links: this.graph.links
        .filter((l) => visible.has(l.source) && visible.has(l.target))
        .map((l) => ({ source: byId.get(l.source), target: byId.get(l.target), count: l.count })),
      groupCenters: centersForGroups(nodes),
      tick: 0,
    };
    this.tickSimFrame();
  }

  private tickSimFrame() {
    const state = this.simState;
    if (!state || state.tick >= 300) {
      this.simState = undefined;
      this.fitView(this.cachedVisibleNodes);
      this.draw();
      return;
    }
    const ticksPerFrame = 6;
    for (let t = 0; t < ticksPerFrame; t++) {
      this.physicsStep(state.nodes, state.links, state.groupCenters);
      state.tick++;
      if (state.tick >= 300) break;
    }
    this.cachedBounds = this.graphBounds(state.nodes);
    this.paintCanvas();
    this.simFrame = window.requestAnimationFrame(() => this.tickSimFrame());
  }

  private stopSimFrame() {
    if (this.simFrame === undefined) return;
    window.cancelAnimationFrame(this.simFrame);
    this.simFrame = undefined;
    this.simState = undefined;
  }

  private visibleNodes() {
    const query = this.root?.querySelector<HTMLInputElement>(".cg-search")?.value.trim().toLowerCase() ?? "";
    return this.graph.nodes.filter((node) => {
      if (!this.settings.includeOrphans && node.degree === 0) return false;
      if (!query) return true;
      return `${node.title} ${node.hpath} ${node.tag} ${node.groupKey}`.toLowerCase().includes(query);
    });
  }

  private draw() {
    if (!this.root) return;
    this.cancelViewFrame();
    const canvas = this.root.querySelector<HTMLCanvasElement>(".cg-canvas");
    const stage = this.root.querySelector<HTMLElement>(".cg-stage");
    const empty = this.root.querySelector<HTMLElement>(".cg-empty");
    if (!canvas || !stage || !empty) return;

    const width = stage.clientWidth || 900;
    const height = stage.clientHeight || 620;
    this.cachedStageDims = { width, height };
    const canvasRect = canvas.getBoundingClientRect();
    this.cachedCanvasRect = { left: canvasRect.left, top: canvasRect.top };

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const nodes = this.visibleNodes();
    const visible = new Set(nodes.map((node) => node.id));
    const byId = new Map(this.graph.nodes.map((node) => [node.id, node]));
    this.cachedVisibleNodes = nodes;
    this.cachedVisibleLinks = this.graph.links
      .filter((link) => visible.has(link.source) && visible.has(link.target))
      .map((link) => ({ source: byId.get(link.source)!, target: byId.get(link.target)!, count: link.count }))
      .filter((link) => link.source && link.target);
    this.cachedBounds = this.graphBounds(nodes);

    empty.style.display = nodes.length ? "none" : "grid";
    empty.textContent = "No notes match this graph filter.";

    this.paintCanvas();
    this.attachPanZoom(canvas);
    if (nodes.some((n) => n.hasSubLinks)) this.startPulseLoop();
    else this.stopPulseLoop();
  }

  private paintCanvas() {
    const canvas = this.root?.querySelector<HTMLCanvasElement>(".cg-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { x, y, scale } = this.view;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.translate(x, y);
    ctx.scale(scale, scale);

    // Notebook areas
    const byNotebook = new Map<string, GraphNode[]>();
    for (const node of this.cachedVisibleNodes) {
      const key = notebookColorKey(node);
      byNotebook.set(key, [...(byNotebook.get(key) ?? []), node]);
    }
    const notebookKeys = [...byNotebook.keys()];
    for (const [key, nbNodes] of byNotebook) {
      if (!nbNodes.length) continue;
      const minX = Math.min(...nbNodes.map((n) => n.x - this.nodeRadius(n))) - 170;
      const maxX = Math.max(...nbNodes.map((n) => n.x + this.nodeRadius(n))) + 170;
      const minY = Math.min(...nbNodes.map((n) => n.y - this.nodeRadius(n))) - 140;
      const maxY = Math.max(...nbNodes.map((n) => n.y + this.nodeRadius(n))) + 140;
      const color = this.settings.colors[key] ?? colorFor(key, notebookKeys, true);

      ctx.beginPath();
      ctx.rect(minX, minY, maxX - minX, maxY - minY);
      ctx.fillStyle = hexToRgba(color, 0.08);
      ctx.fill();
      ctx.strokeStyle = hexToRgba(color, 0.36);
      ctx.lineWidth = 1.8 / scale;
      ctx.setLineDash([14, 9]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.save();
      ctx.font = "700 20px Inter, ui-sans-serif, sans-serif";
      ctx.lineJoin = "round";
      ctx.lineWidth = 5;
      ctx.strokeStyle = "rgba(18, 20, 26, 0.92)";
      ctx.strokeText(displayColorKey(key), minX + 18, minY + 28);
      ctx.fillStyle = "rgba(230, 236, 246, 0.82)";
      ctx.fillText(displayColorKey(key), minX + 18, minY + 28);
      ctx.restore();
    }

    // Links
    ctx.globalAlpha = this.settings.lineOpacity;
    for (const link of this.cachedVisibleLinks) {
      const sw = this.settings.linkThickness * Math.min(Math.sqrt(link.count), 3) / scale;
      const points = linkBoundaryPoints(link.source, link.target, this.nodeRadius(link.source), this.nodeRadius(link.target), this.settings.arrows ? 9 : 2);
      ctx.strokeStyle = "#7a8495";
      ctx.lineWidth = sw;
      ctx.beginPath();
      ctx.moveTo(points.x1, points.y1);
      ctx.lineTo(points.x2, points.y2);
      ctx.stroke();

      if (this.settings.arrows) {
        const angle = Math.atan2(points.y2 - points.y1, points.x2 - points.x1);
        const head = 9 / scale;
        ctx.fillStyle = "#9aa4b5";
        ctx.beginPath();
        ctx.moveTo(points.x2, points.y2);
        ctx.lineTo(points.x2 - head * Math.cos(angle - Math.PI / 6), points.y2 - head * Math.sin(angle - Math.PI / 6));
        ctx.lineTo(points.x2 - head * Math.cos(angle + Math.PI / 6), points.y2 - head * Math.sin(angle + Math.PI / 6));
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Halos (behind nodes)
    for (const node of this.cachedVisibleNodes) {
      if (!node.hasSubLinks) continue;
      const radius = this.nodeRadius(node);
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + 4, 0, Math.PI * 2);
      ctx.strokeStyle = lightenHex(node.color, 0.38);
      ctx.lineWidth = 2.5 / scale;
      ctx.globalAlpha = 0.88;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Nodes
    for (const node of this.cachedVisibleNodes) {
      const radius = this.nodeRadius(node);
      const isHovered = node.id === this.hoveredNodeId;

      if (node.hasSubLinks) {
        const pulse = (Math.sin(performance.now() / 700) + 1) / 2;
        ctx.shadowBlur = (14 + pulse * 12) / scale;
        ctx.shadowColor = "rgba(255, 210, 90, 0.72)";
      } else if (node.isTopLevel) {
        ctx.shadowBlur = 14 / scale;
        ctx.shadowColor = "rgba(255, 255, 255, 0.40)";
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = node.hasSubLinks ? darkenHex(node.color, 0.24) : node.color;
      ctx.fill();
      ctx.shadowBlur = 0;

      let strokeColor = "rgba(255, 255, 255, 0.86)";
      let strokeWidth = 1.6 / scale;
      if (node.isTopLevel) { strokeColor = "#ffffff"; strokeWidth = 4 / scale; }
      if (node.hasSubLinks) { strokeColor = "#fff7d6"; strokeWidth = 3 / scale; }
      if (isHovered) { strokeColor = "#ffffff"; strokeWidth = (node.isTopLevel || node.hasSubLinks) ? 3.6 / scale : 2.6 / scale; }
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeWidth;
      ctx.stroke();
    }

    // Labels — font size in graph coords so they scale with zoom, same as SVG did
    ctx.font = "650 15px Inter, ui-sans-serif, sans-serif";
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    for (const node of this.cachedVisibleNodes) {
      const radius = this.nodeRadius(node);
      const labelScore = Math.min(1, (node.degree + 1) / 9);
      if (labelScore < this.settings.labelThreshold && this.cachedVisibleNodes.length >= 160) continue;
      const labelText = truncate(node.title, 28);
      const labelX = node.x + radius + 5;
      const labelY = node.y + 4;
      ctx.strokeStyle = "rgba(13, 14, 18, 0.96)";
      ctx.strokeText(labelText, labelX, labelY);
      ctx.fillStyle = "#f6f7fb";
      ctx.fillText(labelText, labelX, labelY);
    }

    ctx.restore();
  }

  private fitView(nodes: GraphNode[]) {
    if (!this.root || !nodes.length) return;
    const stage = this.root.querySelector<HTMLElement>(".cg-stage");
    if (!stage) return;
    const xs = nodes.map((node) => node.x);
    const ys = nodes.map((node) => node.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = stage.clientWidth || 900;
    const height = stage.clientHeight || 620;
    this.cachedStageDims = { width, height };
    const scale = Math.min(width / Math.max(maxX - minX + 110, 1), height / Math.max(maxY - minY + 110, 1), 1.7);
    this.view = {
      scale,
      x: width / 2 - ((minX + maxX) / 2) * scale,
      y: height / 2 - ((minY + maxY) / 2) * scale
    };
    this.applyViewTransform();
  }

  private focusNode(id: string) {
    const node = this.graph.nodes.find((item) => item.id === id);
    const stage = this.root?.querySelector<HTMLElement>(".cg-stage");
    if (!node || !stage) return;
    this.cachedStageDims = { width: stage.clientWidth || 900, height: stage.clientHeight || 620 };
    this.view = {
      scale: 1.25,
      x: this.cachedStageDims.width / 2 - node.x * 1.25,
      y: this.cachedStageDims.height / 2 - node.y * 1.25
    };
    this.applyViewTransform();
  }

  private nodeRadius(node: GraphNode) {
    const baseRadius = (5.2 + Math.sqrt(node.degree + 1) * 2.1) * this.settings.nodeSize;
    return node.isTopLevel ? baseRadius * 1.18 : baseRadius;
  }

  private attachPanZoom(canvas: HTMLCanvasElement) {
    if (canvas.dataset.bound === "true") return;
    canvas.dataset.bound = "true";

    const stage = canvas.parentElement;
    if (stage) {
      stage.addEventListener("wheel", (e) => { e.preventDefault(); }, { passive: false, capture: true });

      this.stageResizeObserver?.disconnect();
      this.stageResizeObserver = new ResizeObserver(() => {
        if (!this.root) return;
        const w = stage.clientWidth || 900;
        const h = stage.clientHeight || 620;
        this.cachedStageDims = { width: w, height: h };
        const rect = canvas.getBoundingClientRect();
        this.cachedCanvasRect = { left: rect.left, top: rect.top };
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        this.paintCanvas();
      });
      this.stageResizeObserver.observe(stage);
    }

    let panning = false;
    let didDrag = false;
    let lastX = 0;
    let lastY = 0;

    canvas.addEventListener("pointerdown", (event) => {
      didDrag = false;
      lastX = event.clientX;
      lastY = event.clientY;
      canvas.setPointerCapture(event.pointerId);
      const hitNode = this.nodeAtPointer(event);
      if (hitNode) {
        this.draggedNode = hitNode;
        this.hoveredNodeId = hitNode.id;
        canvas.style.cursor = "grabbing";
      } else {
        panning = true;
        canvas.style.cursor = "grabbing";
      }
    });
    canvas.addEventListener("pointermove", (event) => {
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (this.draggedNode) {
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag = true;
        const gx = (event.clientX - this.cachedCanvasRect.left - this.view.x) / this.view.scale;
        const gy = (event.clientY - this.cachedCanvasRect.top - this.view.y) / this.view.scale;
        this.draggedNode.x = gx;
        this.draggedNode.y = gy;
        this.draggedNode.vx = 0;
        this.draggedNode.vy = 0;
        lastX = event.clientX;
        lastY = event.clientY;
        this.cachedBounds = this.graphBounds(this.cachedVisibleNodes);
        this.scheduleViewTransform();
        return;
      }
      if (panning) {
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag = true;
        this.hideTooltip();
        this.view.x += dx;
        this.view.y += dy;
        lastX = event.clientX;
        lastY = event.clientY;
        this.clampView();
        this.scheduleViewTransform();
        return;
      }
      this.updateHoverFromPointer(event);
    });
    canvas.addEventListener("pointerup", (event) => {
      if (this.draggedNode) {
        if (!didDrag) {
          this.hideTooltip();
          void openTab({ app: this.app, doc: { id: this.draggedNode.id } });
        }
        this.draggedNode = undefined;
        canvas.style.cursor = this.hoveredNodeId ? "pointer" : "grab";
        return;
      }
      panning = false;
      canvas.style.cursor = this.hoveredNodeId ? "pointer" : "grab";
    });
    canvas.addEventListener("pointerleave", () => {
      if (!panning && !this.draggedNode) {
        this.hoveredNodeId = undefined;
        canvas.style.cursor = "grab";
        this.scheduleViewTransform();
      }
    });
    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const anchorX = event.clientX - this.cachedCanvasRect.left;
      const anchorY = event.clientY - this.cachedCanvasRect.top;
      const graphX = (anchorX - this.view.x) / this.view.scale;
      const graphY = (anchorY - this.view.y) / this.view.scale;
      const factor = Math.max(0.82, Math.min(1.22, Math.exp(-event.deltaY * 0.004)));
      const nextScale = Math.max(0.04, Math.min(5, this.view.scale * factor));

      this.view.scale = nextScale;
      this.view.x = anchorX - graphX * nextScale;
      this.view.y = anchorY - graphY * nextScale;
      this.clampView();
      this.scheduleViewTransform();
    }, { passive: false });
  }

  private clampView() {
    const bounds = this.cachedBounds;
    if (!bounds) return;

    const { width, height } = this.cachedStageDims;
    const margin = 80;

    const rawMinX = margin - bounds.maxX * this.view.scale;
    const rawMaxX = width - margin - bounds.minX * this.view.scale;
    this.view.x = rawMinX <= rawMaxX
      ? clamp(this.view.x, rawMinX, rawMaxX)
      : clamp(this.view.x, rawMaxX, rawMinX);

    const rawMinY = margin - bounds.maxY * this.view.scale;
    const rawMaxY = height - margin - bounds.minY * this.view.scale;
    this.view.y = rawMinY <= rawMaxY
      ? clamp(this.view.y, rawMinY, rawMaxY)
      : clamp(this.view.y, rawMaxY, rawMinY);
  }

  private graphBounds(nodes: GraphNode[]) {
    if (!nodes.length) return undefined;
    const padding = 220;
    const minX = Math.min(...nodes.map((node) => node.x - this.nodeRadius(node))) - padding;
    const maxX = Math.max(...nodes.map((node) => node.x + this.nodeRadius(node))) + padding;
    const minY = Math.min(...nodes.map((node) => node.y - this.nodeRadius(node))) - padding;
    const maxY = Math.max(...nodes.map((node) => node.y + this.nodeRadius(node))) + padding;
    return { minX, maxX, minY, maxY };
  }

  private applyViewTransform() {
    this.cancelViewFrame();
    this.applyViewTransformNow();
  }

  private scheduleViewTransform() {
    if (this.viewFrame !== undefined) return;
    this.viewFrame = window.requestAnimationFrame(() => {
      this.viewFrame = undefined;
      this.applyViewTransformNow();
    });
  }

  private applyViewTransformNow() {
    this.paintCanvas();
  }

  private cancelViewFrame() {
    if (this.viewFrame === undefined) return;
    window.cancelAnimationFrame(this.viewFrame);
    this.viewFrame = undefined;
  }

  private startPulseLoop() {
    if (this.pulseFrame !== undefined) return;
    const loop = () => {
      this.paintCanvas();
      this.pulseFrame = window.requestAnimationFrame(loop);
    };
    this.pulseFrame = window.requestAnimationFrame(loop);
  }

  private stopPulseLoop() {
    if (this.pulseFrame === undefined) return;
    window.cancelAnimationFrame(this.pulseFrame);
    this.pulseFrame = undefined;
  }

  private showTooltip(event: MouseEvent, node: GraphNode) {
    const tooltip = this.root?.querySelector<HTMLElement>(".cg-tooltip");
    if (!tooltip) return;
    tooltip.innerHTML = `
      <strong>${escapeHtml(node.title)}</strong>
      <span>${escapeHtml(node.hpath || "No path")}</span>
      <span>${node.inbound} incoming · ${node.outbound} outgoing links · ${node.degree} total</span>
      <span>${escapeHtml(node.groupKey)}</span>
      ${node.tag ? `<span>${escapeHtml(node.tag)}</span>` : ""}
      ${node.updated ? `<span>Updated ${formatDate(node.updated)}</span>` : ""}
    `;
    tooltip.style.display = "block";
    this.positionTooltip(event);
  }

  private updateHoverFromPointer(event: PointerEvent) {
    const canvas = this.root?.querySelector<HTMLCanvasElement>(".cg-canvas");
    const node = this.nodeAtPointer(event);
    const prevId = this.hoveredNodeId;
    if (!node) {
      this.hoveredNodeId = undefined;
      if (canvas) canvas.style.cursor = "grab";
      this.hideTooltip();
      if (prevId !== undefined) this.scheduleViewTransform();
      return;
    }
    if (node.id !== prevId) {
      this.hoveredNodeId = node.id;
      if (canvas) canvas.style.cursor = "pointer";
      this.scheduleViewTransform();
    }
    this.showTooltip(event as unknown as MouseEvent, node);
  }

  private nodeAtPointer(event: PointerEvent) {
    const graphX = (event.clientX - this.cachedCanvasRect.left - this.view.x) / this.view.scale;
    const graphY = (event.clientY - this.cachedCanvasRect.top - this.view.y) / this.view.scale;
    const nodes = this.cachedVisibleNodes;

    for (const node of nodes) {
      const radius = this.nodeRadius(node);
      if (Math.hypot(graphX - node.x, graphY - node.y) <= Math.max(radius + 12, 24)) return node;

      const labelScore = Math.min(1, (node.degree + 1) / 9);
      if (labelScore >= this.settings.labelThreshold || nodes.length < 160) {
        const labelText = truncate(node.title, 28);
        const labelX = node.x + radius + 5;
        const labelY = node.y + 4;
        if (graphX >= labelX - 6 && graphX <= labelX + labelText.length * 7.8 + 12 && graphY >= labelY - 16 && graphY <= labelY + 8) return node;
      }
    }

    return undefined;
  }

  private hideTooltip() {
    const tooltip = this.root?.querySelector<HTMLElement>(".cg-tooltip");
    if (!tooltip) return;
    tooltip.style.display = "none";
    tooltip.innerHTML = "";
  }

  private positionTooltip(event: MouseEvent) {
    const tooltip = this.root?.querySelector<HTMLElement>(".cg-tooltip");
    const stage = this.root?.querySelector<HTMLElement>(".cg-stage");
    if (!tooltip || !stage) return;
    const rect = stage.getBoundingClientRect();
    tooltip.style.left = `${Math.min(event.clientX - rect.left + 14, rect.width - 300)}px`;
    tooltip.style.top = `${Math.min(event.clientY - rect.top + 14, rect.height - 150)}px`;
  }
}

function rangeControl(key: keyof Settings, label: string, min: number, max: number, step: number) {
  return `<label><span>${label} <small class="cg-range-value" data-for="${key}"></small></span><input class="cg-setting" data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" /></label>`;
}

function linkBoundaryPoints(source: GraphNode, target: GraphNode, sourceRadius: number, targetRadius: number, arrowPadding: number) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const unitX = dx / distance;
  const unitY = dy / distance;
  const start = Math.min(sourceRadius + 3, distance * 0.42);
  const end = Math.min(targetRadius + arrowPadding, distance * 0.42);

  return {
    x1: source.x + unitX * start,
    y1: source.y + unitY * start,
    x2: target.x - unitX * end,
    y2: target.y - unitY * end
  };
}

function assignComponents(nodes: GraphNode[], links: GraphLink[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const neighbors = new Map<string, string[]>();
  for (const node of nodes) neighbors.set(node.id, []);
  for (const link of links) {
    neighbors.get(link.source)?.push(link.target);
    neighbors.get(link.target)?.push(link.source);
  }

  let componentNumber = 1;
  const visited = new Set<string>();
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const stack = [node.id];
    const component: string[] = [];
    visited.add(node.id);
    while (stack.length) {
      const id = stack.pop() ?? "";
      component.push(id);
      for (const neighbor of neighbors.get(id) ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        stack.push(neighbor);
      }
    }
    const name = component.length === 1 && (byId.get(component[0])?.degree ?? 0) === 0 ? "Orphan" : `Group ${componentNumber++}`;
    for (const id of component) {
      const item = byId.get(id);
      if (item) item.component = name;
    }
  }
}

function centersForGroups(nodes: GraphNode[]) {
  const keys = [...new Set(nodes.map((node) => node.groupKey))];
  const spread = Math.max(190, Math.sqrt(keys.length) * 150);
  return new Map(keys.map((key, index) => {
    const angle = seededRange(`${key}:centerAngle`, 0, Math.PI * 2);
    const radius = seededRange(`${key}:centerRadius`, 20, spread);
    const rowBias = ((index % 3) - 1) * seededRange(`${key}:bias`, 25, 95);
    return [key, { x: Math.cos(angle) * radius + rowBias, y: Math.sin(angle) * radius - rowBias * 0.35 }];
  }));
}

function countComponents(nodes: GraphNode[]) {
  return new Set(nodes.filter((node) => node.degree > 0).map((node) => node.component)).size;
}

function firstTag(tag: string) {
  return tag.match(/#([^#]+)#/)?.[1] || "No tag";
}

function firstPathSegment(hpath: string) {
  return hpath.split("/").filter(Boolean)[0] || "Root";
}

function flattenInlineDocs(files: FileTreeEntry[], notebook: NotebookInfo, ancestors: string[]): FileTreeDoc[] {
  const docs: FileTreeDoc[] = [];
  for (const file of files) {
    if (!file.id) continue;
    const title = cleanDocTitle(String(file.title || file.name || "Untitled"));
    docs.push({
      id: file.id,
      title,
      hpath: String(file.hPath || `/${[...ancestors, title].join("/")}`),
      box: notebook.id,
      boxName: notebook.name
    });
    if (Array.isArray(file.files) && file.files.length) {
      docs.push(...flattenInlineDocs(file.files, notebook, [...ancestors, title]));
    }
  }
  return docs;
}

function cleanDocTitle(value: string) {
  return value.replace(/\.sy$/i, "") || "Untitled";
}

function joinDocPath(parent: string, id: string) {
  const normalizedParent = parent === "/" ? "" : parent.replace(/\/$/, "");
  return `${normalizedParent}/${id}.sy`;
}

function pathDepth(hpath: string) {
  return hpath.split("/").filter(Boolean).length;
}

function lastPathSegment(hpath: string) {
  const parts = hpath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function truncate(value: string, length: number) {
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}

function seededRange(seed: string, min: number, max: number) {
  return min + seededUnit(seed) * (max - min);
}

function seededUnit(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash += hash << 13;
  hash ^= hash >>> 7;
  hash += hash << 3;
  hash ^= hash >>> 17;
  hash += hash << 5;
  return ((hash >>> 0) % 10000) / 10000;
}

function formatDate(value: string) {
  if (value.length < 8) return value;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function colorFor(key: string, keys: string[], light = false) {
  const index = Math.max(keys.indexOf(key), 0);
  const color = DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  return light ? lightenHex(color, 0.28) : color;
}

function notebookColorKey(node: GraphNode) {
  return `notebook:${node.boxName || node.box || "Notebook"}`;
}

function displayColorKey(key: string) {
  return key.startsWith("notebook:") ? key.slice("notebook:".length) : key;
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function explicitRefIds(value: string) {
  const ids = new Set<string>();
  const patterns = [
    /\(\(([0-9a-z-]+)(?:\s+["'][^"']*["'])?\)\)/gi,
    /siyuan:\/\/blocks\/([0-9a-z-]+)/gi
  ];

  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      if (match[1]) ids.add(match[1]);
    }
  }

  return [...ids];
}

function sqlQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return `rgba(148, 163, 184, ${alpha})`;
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lightenHex(hex: string, amount: number) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16);
    return Math.min(255, Math.round(value + (255 - value) * amount)).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function darkenHex(hex: string, amount: number) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16);
    return Math.max(0, Math.round(value * (1 - amount))).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char] ?? char);
}

function escapeAttr(value: string) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function cssEscape(value: string) {
  return CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function loadSettings(): Settings {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (!stored) return { ...DEFAULT_SETTINGS, colors: {} };
    const parsed = JSON.parse(stored);
    if (parsed.version !== SETTINGS_VERSION) {
      return { ...DEFAULT_SETTINGS, colors: parsed.colors ?? {} };
    }
    return { ...DEFAULT_SETTINGS, ...parsed, colors: parsed.colors ?? {} };
  } catch {
    return { ...DEFAULT_SETTINGS, colors: {} };
  }
}

function saveSettings(settings: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
