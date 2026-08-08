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
  collideRadius: number;
  linkDistance: number;
  colors: Record<string, string>;
};

type GraphNode = {
  id: string;
  title: string;
  hpath: string;
  box: string;
  tag: string;
  updated: string;
  pathGroup: string;
  component: string;
  groupKey: string;
  color: string;
  inbound: number;
  outbound: number;
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
const SETTINGS_VERSION = 2;
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
  collideRadius: 1.55,
  linkDistance: 86,
  colors: {}
};

export default class ClarityGraphPlugin extends Plugin {
  private root?: HTMLElement;
  private graph: GraphData = { nodes: [], links: [] };
  private settings: Settings = loadSettings();
  private view = { x: 0, y: 0, scale: 1 };
  private openTopBarElement?: HTMLElement;

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

    this.root.innerHTML = `
      <div class="cg-root">
        <header class="cg-header">
          <div>
            <strong>Global Graph</strong>
            <span class="cg-subtitle">All notes, references, groups, and orphans</span>
          </div>
          <input class="cg-search" type="search" placeholder="Search notes, paths, tags" />
          <button class="cg-icon cg-fit" type="button" title="Fit graph">Fit</button>
          <button class="cg-icon cg-refresh" type="button" title="Refresh graph">Refresh</button>
        </header>
        <main class="cg-layout">
          <aside class="cg-insights">
            <h2>Insights</h2>
            <div class="cg-stats"></div>
            <h2>Groups</h2>
            <div class="cg-groups"></div>
          </aside>
          <section class="cg-stage">
            <svg class="cg-svg" role="img" aria-label="SiYuan global note graph"></svg>
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
            ${rangeControl("collideRadius", "Collide radius", 0.5, 3, 0.05)}
            ${rangeControl("linkDistance", "Link distance", 40, 260, 5)}
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
    this.root.querySelector(".cg-search")?.addEventListener("input", () => this.draw());
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
    const empty = this.root.querySelector<HTMLElement>(".cg-empty");
    if (empty) {
      empty.style.display = "grid";
      empty.textContent = "Loading every note reference...";
    }

    try {
      this.graph = await this.loadGraph();
      this.applyGroupsAndColors();
      this.seedPositions();
      this.simulate();
      this.fitView(this.visibleNodes());
      this.draw();
    } catch (error) {
      console.error(error);
      showMessage("Clarity Graph failed to load global references");
      if (empty) empty.textContent = "Could not load graph data.";
    }
  }

  private async loadGraph(): Promise<GraphData> {
    const docs = await this.sql(`
      SELECT id, content, hpath, box, tag, updated
      FROM blocks
      WHERE type = 'd'
      ORDER BY hpath ASC
    `);
    const docIds = new Set(docs.map((row) => String(row.id)));
    const nodes = docs.map((row, index) => ({
      id: String(row.id),
      title: String(row.content || lastPathSegment(String(row.hpath || "")) || "Untitled"),
      hpath: String(row.hpath || ""),
      box: String(row.box || ""),
      tag: String(row.tag || ""),
      updated: String(row.updated || ""),
      pathGroup: firstPathSegment(String(row.hpath || "")),
      component: "",
      groupKey: "",
      color: DEFAULT_COLORS[index % DEFAULT_COLORS.length],
      inbound: 0,
      outbound: 0,
      degree: 0,
      x: seededRange(`${row.id}:x`, -260, 260),
      y: seededRange(`${row.id}:y`, -210, 210),
      vx: 0,
      vy: 0
    }));

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
    }
    for (const node of nodes) {
      node.degree = node.inbound + node.outbound;
    }

    assignComponents(nodes, links);
    return { nodes, links };
  }

  private async sql(stmt: string): Promise<Record<string, unknown>[]> {
    const response = await fetch("/api/query/sql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stmt })
    });
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(payload.msg || "SQL query failed");
    return payload.data ?? [];
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
    if (!stats || !groups) return;

    const total = this.graph.nodes.length;
    const linked = this.graph.nodes.filter((node) => node.degree > 0).length;
    const orphans = total - linked;
    const hubs = [...this.graph.nodes].sort((a, b) => b.degree - a.degree).slice(0, 5);
    stats.innerHTML = `
      <div><strong>${total}</strong><span>notes</span></div>
      <div><strong>${this.graph.links.length}</strong><span>links</span></div>
      <div><strong>${orphans}</strong><span>orphans</span></div>
      <div><strong>${countComponents(this.graph.nodes)}</strong><span>groups</span></div>
      <section><h3>Most connected</h3>${hubs.map((node) => `<button class="cg-hub" data-id="${node.id}">${escapeHtml(node.title)} <span>${node.degree}</span></button>`).join("")}</section>
    `;
    stats.querySelectorAll<HTMLButtonElement>(".cg-hub").forEach((button) => {
      button.addEventListener("click", () => this.focusNode(button.dataset.id ?? ""));
    });

    const groupCounts = new Map<string, number>();
    for (const node of this.graph.nodes) groupCounts.set(node.groupKey, (groupCounts.get(node.groupKey) ?? 0) + 1);
    groups.innerHTML = [...groupCounts]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map(([key, count]) => `
        <label class="cg-color-row">
          <input type="color" data-group="${escapeAttr(key)}" value="${this.settings.colors[key] ?? colorFor(key, [...groupCounts.keys()])}" />
          <span>${escapeHtml(key)}</span>
          <small>${count}</small>
        </label>
      `)
      .join("");
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
    const svg = this.root.querySelector<SVGSVGElement>(".cg-svg");
    const empty = this.root.querySelector<HTMLElement>(".cg-empty");
    const tooltip = this.root.querySelector<HTMLElement>(".cg-tooltip");
    if (!svg || !empty || !tooltip) return;

    const nodes = this.visibleNodes();
    const visible = new Set(nodes.map((node) => node.id));
    const links = this.graph.links.filter((link) => visible.has(link.source) && visible.has(link.target));
    const byId = new Map(this.graph.nodes.map((node) => [node.id, node]));

    svg.innerHTML = "";
    empty.style.display = nodes.length ? "none" : "grid";
    empty.textContent = "No notes match this graph filter.";

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `<marker id="cg-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>`;
    svg.appendChild(defs);

    const viewport = document.createElementNS("http://www.w3.org/2000/svg", "g");
    viewport.setAttribute("transform", `translate(${this.view.x} ${this.view.y}) scale(${this.view.scale})`);
    svg.appendChild(viewport);

    for (const link of links) {
      const source = byId.get(link.source);
      const target = byId.get(link.target);
      if (!source || !target) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "cg-link");
      line.setAttribute("x1", String(source.x));
      line.setAttribute("y1", String(source.y));
      line.setAttribute("x2", String(target.x));
      line.setAttribute("y2", String(target.y));
      line.setAttribute("stroke-width", String(this.settings.linkThickness * Math.min(Math.sqrt(link.count), 3)));
      line.setAttribute("stroke-opacity", String(this.settings.lineOpacity));
      if (this.settings.arrows) line.setAttribute("marker-end", "url(#cg-arrow)");
      viewport.appendChild(line);
    }

    for (const node of nodes) {
      const radius = (3.8 + Math.sqrt(node.degree + 1) * 1.9) * this.settings.nodeSize;
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("class", `cg-node${node.degree === 0 ? " is-orphan" : ""}`);
      circle.setAttribute("cx", String(node.x));
      circle.setAttribute("cy", String(node.y));
      circle.setAttribute("r", String(radius));
      circle.setAttribute("fill", node.color);
      circle.addEventListener("mouseenter", (event) => this.showTooltip(event as MouseEvent, node));
      circle.addEventListener("mousemove", (event) => this.positionTooltip(event as MouseEvent));
      circle.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
      });
      circle.addEventListener("click", () => {
        void openTab({ app: this.app, doc: { id: node.id } });
      });
      viewport.appendChild(circle);

      const labelScore = Math.min(1, (node.degree + 1) / 9);
      if (labelScore >= this.settings.labelThreshold || nodes.length < 160) {
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", "cg-label");
        label.setAttribute("x", String(node.x + radius + 5));
        label.setAttribute("y", String(node.y + 4));
        label.textContent = truncate(node.title, 28);
        viewport.appendChild(label);
      }
    }

    this.attachPanZoom(svg);
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
    const scale = Math.min(width / Math.max(maxX - minX + 110, 1), height / Math.max(maxY - minY + 110, 1), 1.7);
    this.view = {
      scale,
      x: width / 2 - ((minX + maxX) / 2) * scale,
      y: height / 2 - ((minY + maxY) / 2) * scale
    };
    this.draw();
  }

  private focusNode(id: string) {
    const node = this.graph.nodes.find((item) => item.id === id);
    const stage = this.root?.querySelector<HTMLElement>(".cg-stage");
    if (!node || !stage) return;
    this.view = {
      scale: 1.25,
      x: stage.clientWidth / 2 - node.x * 1.25,
      y: stage.clientHeight / 2 - node.y * 1.25
    };
    this.draw();
  }

  private attachPanZoom(svg: SVGSVGElement) {
    if (svg.dataset.bound === "true") return;
    svg.dataset.bound = "true";
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    svg.addEventListener("pointerdown", (event) => {
      if ((event.target as Element).classList.contains("cg-node")) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      this.view.x += event.clientX - lastX;
      this.view.y += event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      this.draw();
    });
    svg.addEventListener("pointerup", () => {
      dragging = false;
    });
    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.92 : 1.08;
      this.view.scale = Math.max(0.15, Math.min(4, this.view.scale * factor));
      this.draw();
    }, { passive: false });
  }

  private showTooltip(event: MouseEvent, node: GraphNode) {
    const tooltip = this.root?.querySelector<HTMLElement>(".cg-tooltip");
    if (!tooltip) return;
    tooltip.innerHTML = `
      <strong>${escapeHtml(node.title)}</strong>
      <span>${escapeHtml(node.hpath || "No path")}</span>
      <span>${node.inbound} backlinks · ${node.outbound} outgoing · ${node.degree} total</span>
      <span>${escapeHtml(node.groupKey)}</span>
      ${node.tag ? `<span>${escapeHtml(node.tag)}</span>` : ""}
      ${node.updated ? `<span>Updated ${formatDate(node.updated)}</span>` : ""}
    `;
    tooltip.style.display = "block";
    this.positionTooltip(event);
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

function colorFor(key: string, keys: string[]) {
  const index = Math.max(keys.indexOf(key), 0);
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
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
