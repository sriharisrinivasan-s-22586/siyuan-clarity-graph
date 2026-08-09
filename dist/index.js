"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const siyuan = require("siyuan");
const TAB_TYPE = "clarity-graph";
const SETTINGS_KEY = "siyuan-clarity-graph-settings";
const SETTINGS_VERSION = 3;
const DEFAULT_COLORS = ["#3b82f6", "#ef4444", "#a855f7", "#22c55e", "#f59e0b", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#14b8a6"];
const DEFAULT_SETTINGS = {
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
class ClarityGraphPlugin extends siyuan.Plugin {
  constructor() {
    super(...arguments);
    __publicField(this, "root");
    __publicField(this, "graph", { nodes: [], links: [] });
    __publicField(this, "settings", loadSettings());
    __publicField(this, "view", { x: 0, y: 0, scale: 1 });
    __publicField(this, "openTopBarElement");
  }
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
        plugin.root = void 0;
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
  openGraph() {
    siyuan.openTab({
      app: this.app,
      custom: {
        icon: "iconGraph",
        title: "Clarity Graph",
        data: {},
        id: `${this.name}${TAB_TYPE}`
      }
    });
  }
  renderShell() {
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
          <button class="cg-icon cg-toggle-controls" type="button" title="Show or hide controls">Controls</button>
          <button class="cg-icon cg-refresh" type="button" title="Refresh graph">Refresh</button>
        </header>
        <main class="cg-layout">
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
  bindControls() {
    if (!this.root) return;
    this.root.querySelector(".cg-refresh")?.addEventListener("click", () => void this.refresh());
    this.root.querySelector(".cg-fit")?.addEventListener("click", () => this.fitView(this.visibleNodes()));
    this.root.querySelector(".cg-toggle-controls")?.addEventListener("click", () => {
      this.root?.querySelector(".cg-layout")?.classList.toggle("is-controls-hidden");
      window.setTimeout(() => this.fitView(this.visibleNodes()), 0);
    });
    this.root.querySelector(".cg-search")?.addEventListener("input", () => this.draw());
    this.root.querySelector(".cg-stage")?.addEventListener("pointerleave", () => this.hideTooltip());
    this.root.querySelector(".cg-stage")?.addEventListener("wheel", () => this.hideTooltip(), { passive: true });
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
    this.root.querySelectorAll(".cg-setting").forEach((control) => {
      control.addEventListener("input", () => {
        const key = control.dataset.setting;
        if (control instanceof HTMLInputElement && control.type === "checkbox") {
          this.settings[key] = control.checked;
        } else if (control instanceof HTMLInputElement && control.type === "range") {
          this.settings[key] = Number(control.value);
        } else {
          this.settings[key] = control.value;
        }
        saveSettings(this.settings);
        this.syncRangeValues();
        this.applyGroupsAndColors();
        this.simulate();
        this.draw();
      });
    });
  }
  syncControls() {
    if (!this.root) return;
    this.root.querySelectorAll(".cg-setting").forEach((control) => {
      const key = control.dataset.setting;
      const value = this.settings[key];
      if (control instanceof HTMLInputElement && control.type === "checkbox") {
        control.checked = Boolean(value);
      } else {
        control.value = String(value);
      }
    });
    this.syncRangeValues();
  }
  syncRangeValues() {
    this.root?.querySelectorAll(".cg-range-value").forEach((node) => {
      const key = node.dataset.for;
      node.textContent = String(this.settings[key]);
    });
  }
  async refresh() {
    if (!this.root) return;
    this.hideTooltip();
    const empty = this.root.querySelector(".cg-empty");
    if (empty) {
      empty.style.display = "grid";
      empty.textContent = "Refreshing SiYuan index...";
    }
    try {
      await this.flushIndex();
      if (empty) empty.textContent = "Loading every note reference...";
      this.graph = await this.loadGraph();
      this.applyGroupsAndColors();
      this.seedPositions();
      this.simulate();
      this.fitView(this.visibleNodes());
      this.draw();
      siyuan.showMessage(`Clarity Graph refreshed: ${this.graph.nodes.length} notes, ${this.graph.links.length} links`, 2600);
    } catch (error) {
      console.error(error);
      siyuan.showMessage("Clarity Graph failed to load global references");
      if (empty) empty.textContent = "Could not load graph data.";
    }
  }
  async loadGraph() {
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
    const counts = /* @__PURE__ */ new Map();
    for (const row of refs) {
      const source = String(row.root_id);
      const target = String(row.def_block_root_id);
      if (!docIds.has(source) || !docIds.has(target)) continue;
      counts.set(`${source}->${target}`, (counts.get(`${source}->${target}`) ?? 0) + 1);
    }
    const topLevelByPathGroup = new Map(nodes.filter((node) => node.isTopLevel).map((node) => [`${node.box}:${node.pathGroup}`, node]));
    for (const node of nodes) {
      if (node.isTopLevel || pathDepth(node.hpath) < 2) continue;
      const parent = topLevelByPathGroup.get(`${node.box}:${node.pathGroup}`);
      if (!parent || parent.id === node.id) continue;
      counts.set(`${parent.id}->${node.id}`, Math.max(counts.get(`${parent.id}->${node.id}`) ?? 0, 1));
      parent.hierarchyCount += 1;
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
  async flushIndex() {
    try {
      await this.kernelPost("/api/sqlite/flushTransaction", {});
      await delay(250);
    } catch (error) {
      console.warn("Clarity Graph could not flush SQLite transaction before refresh", error);
    }
  }
  async kernelPost(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();
    if (payload.code !== 0) throw new Error(payload.msg || `${path} failed`);
    return payload.data;
  }
  async sql(stmt) {
    return await this.kernelPost("/api/query/sql", { stmt }) ?? [];
  }
  async loadFileTreeDocs() {
    const data = await this.kernelPost("/api/notebook/lsNotebooks", {});
    const notebooks = (data?.notebooks ?? []).filter((notebook) => !notebook.closed);
    const docs = [];
    for (const notebook of notebooks) {
      docs.push(...await this.collectNotebookDocs(notebook, "/", []));
    }
    return docs;
  }
  async collectNotebookDocs(notebook, path, ancestors) {
    const data = await this.kernelPost("/api/filetree/listDocsByPath", { notebook: notebook.id, path });
    const files = data?.files ?? [];
    const docs = [];
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
  applyGroupsAndColors() {
    const seen = /* @__PURE__ */ new Map();
    for (const node of this.graph.nodes) {
      const key = this.groupKeyFor(node);
      node.groupKey = key;
      if (!seen.has(key)) seen.set(key, seen.size);
      const fallback = DEFAULT_COLORS[(seen.get(key) ?? 0) % DEFAULT_COLORS.length];
      node.color = this.settings.colors[key] ?? fallback;
    }
    this.renderInsights();
  }
  seedPositions() {
    const nodes = this.graph.nodes;
    const centers = centersForGroups(nodes);
    const groupSeen = /* @__PURE__ */ new Map();
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
  groupKeyFor(node) {
    if (this.settings.colorMode === "component") return node.degree === 0 ? `Orphan: ${node.title}` : node.component;
    if (this.settings.colorMode === "notebook") return node.box || "No notebook";
    if (this.settings.colorMode === "tag") return firstTag(node.tag);
    return node.degree === 0 ? `${node.pathGroup} / ${node.title}` : node.pathGroup;
  }
  renderInsights() {
    if (!this.root) return;
    const stats = this.root.querySelector(".cg-stats");
    const groups = this.root.querySelector(".cg-groups");
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
  renderColorRows(keys, useLightFallback) {
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
  bindColorRows(groups) {
    groups.querySelectorAll(".cg-color-swatch").forEach((button) => {
      button.addEventListener("click", () => {
        const group = button.dataset.group;
        if (!group) return;
        groups.querySelector(`input[type='color'][data-group="${cssEscape(group)}"]`)?.click();
      });
    });
    groups.querySelectorAll("input[type='color']").forEach((input) => {
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
  simulate() {
    const nodes = this.visibleNodes();
    const visible = new Set(nodes.map((node) => node.id));
    const byId = new Map(this.graph.nodes.map((node) => [node.id, node]));
    const links = this.graph.links.filter((link) => visible.has(link.source) && visible.has(link.target)).map((link) => ({ source: byId.get(link.source), target: byId.get(link.target), count: link.count }));
    const groupCenters = centersForGroups(nodes);
    for (let tick = 0; tick < 260; tick += 1) {
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x || 0.01;
          const dy = a.y - b.y || 0.01;
          const dist2 = dx * dx + dy * dy;
          const force = Math.min(this.settings.repelForce * 680 / dist2, 4);
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
        const force = (distance - desired) * 4e-3;
        link.source.vx += dx / distance * force;
        link.source.vy += dy / distance * force;
        link.target.vx -= dx / distance * force;
        link.target.vy -= dy / distance * force;
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
  visibleNodes() {
    const query = this.root?.querySelector(".cg-search")?.value.trim().toLowerCase() ?? "";
    return this.graph.nodes.filter((node) => {
      if (!this.settings.includeOrphans && node.degree === 0) return false;
      if (!query) return true;
      return `${node.title} ${node.hpath} ${node.tag} ${node.groupKey}`.toLowerCase().includes(query);
    });
  }
  draw() {
    if (!this.root) return;
    const svg = this.root.querySelector(".cg-svg");
    const empty = this.root.querySelector(".cg-empty");
    const tooltip = this.root.querySelector(".cg-tooltip");
    if (!svg || !empty || !tooltip) return;
    const nodes = this.visibleNodes();
    const visible = new Set(nodes.map((node) => node.id));
    const links = this.graph.links.filter((link) => visible.has(link.source) && visible.has(link.target));
    const byId = new Map(this.graph.nodes.map((node) => [node.id, node]));
    svg.innerHTML = "";
    empty.style.display = nodes.length ? "none" : "grid";
    empty.textContent = "No notes match this graph filter.";
    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.innerHTML = `<marker id="cg-arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="6" markerHeight="6" orient="auto" markerUnits="strokeWidth"><path d="M 1 1 L 11 6 L 1 11 z"></path></marker>`;
    svg.appendChild(defs);
    const viewport = document.createElementNS("http://www.w3.org/2000/svg", "g");
    viewport.setAttribute("class", "cg-viewport");
    viewport.setAttribute("transform", `translate(${this.view.x} ${this.view.y}) scale(${this.view.scale})`);
    svg.appendChild(viewport);
    this.drawNotebookAreas(viewport, nodes);
    for (const link of links) {
      const source = byId.get(link.source);
      const target = byId.get(link.target);
      if (!source || !target) continue;
      const points = linkBoundaryPoints(source, target, this.nodeRadius(source), this.nodeRadius(target), this.settings.arrows ? 9 : 2);
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "cg-link");
      line.setAttribute("x1", String(points.x1));
      line.setAttribute("y1", String(points.y1));
      line.setAttribute("x2", String(points.x2));
      line.setAttribute("y2", String(points.y2));
      line.setAttribute("stroke-width", String(this.settings.linkThickness * Math.min(Math.sqrt(link.count), 3)));
      line.setAttribute("stroke-opacity", String(this.settings.lineOpacity));
      if (this.settings.arrows) line.setAttribute("marker-end", "url(#cg-arrow)");
      viewport.appendChild(line);
    }
    for (const node of nodes) {
      const radius = this.nodeRadius(node);
      const targetRadius = Math.max(radius + 10, 22);
      const nodeGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
      nodeGroup.setAttribute("class", "cg-node-group");
      nodeGroup.addEventListener("click", () => {
        this.hideTooltip();
        void siyuan.openTab({ app: this.app, doc: { id: node.id } });
      });
      const target = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      target.setAttribute("class", "cg-node-target");
      target.setAttribute("cx", String(node.x));
      target.setAttribute("cy", String(node.y));
      target.setAttribute("r", String(targetRadius));
      nodeGroup.appendChild(target);
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("class", `cg-node${node.degree === 0 ? " is-orphan" : ""}${node.isTopLevel ? " is-primary" : ""}${node.hasSubLinks ? " is-hub" : ""}`);
      circle.setAttribute("cx", String(node.x));
      circle.setAttribute("cy", String(node.y));
      circle.setAttribute("r", String(radius));
      circle.setAttribute("fill", node.hasSubLinks ? darkenHex(node.color, 0.24) : node.color);
      nodeGroup.appendChild(circle);
      viewport.appendChild(nodeGroup);
      const labelScore = Math.min(1, (node.degree + 1) / 9);
      if (labelScore >= this.settings.labelThreshold || nodes.length < 160) {
        const labelText = truncate(node.title, 28);
        const labelX = node.x + radius + 5;
        const labelY = node.y + 4;
        const labelHit = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        labelHit.setAttribute("class", "cg-label-target");
        labelHit.setAttribute("x", String(labelX - 4));
        labelHit.setAttribute("y", String(labelY - 14));
        labelHit.setAttribute("width", String(labelText.length * 7.4 + 10));
        labelHit.setAttribute("height", "22");
        nodeGroup.appendChild(labelHit);
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("class", "cg-label");
        label.setAttribute("x", String(labelX));
        label.setAttribute("y", String(labelY));
        label.textContent = labelText;
        nodeGroup.appendChild(label);
      }
    }
    this.attachPanZoom(svg);
  }
  fitView(nodes) {
    if (!this.root || !nodes.length) return;
    const stage = this.root.querySelector(".cg-stage");
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
      x: width / 2 - (minX + maxX) / 2 * scale,
      y: height / 2 - (minY + maxY) / 2 * scale
    };
    this.applyViewTransform();
  }
  focusNode(id) {
    const node = this.graph.nodes.find((item) => item.id === id);
    const stage = this.root?.querySelector(".cg-stage");
    if (!node || !stage) return;
    this.view = {
      scale: 1.25,
      x: stage.clientWidth / 2 - node.x * 1.25,
      y: stage.clientHeight / 2 - node.y * 1.25
    };
    this.applyViewTransform();
  }
  drawNotebookAreas(viewport, nodes) {
    const byNotebook = /* @__PURE__ */ new Map();
    for (const node of nodes) {
      const key = notebookColorKey(node);
      byNotebook.set(key, [...byNotebook.get(key) ?? [], node]);
    }
    for (const [key, notebookNodes] of byNotebook) {
      if (!notebookNodes.length) continue;
      const minX = Math.min(...notebookNodes.map((node) => node.x - this.nodeRadius(node))) - 130;
      const maxX = Math.max(...notebookNodes.map((node) => node.x + this.nodeRadius(node))) + 130;
      const minY = Math.min(...notebookNodes.map((node) => node.y - this.nodeRadius(node))) - 110;
      const maxY = Math.max(...notebookNodes.map((node) => node.y + this.nodeRadius(node))) + 110;
      const color = this.settings.colors[key] ?? colorFor(key, [...byNotebook.keys()], true);
      const area = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
      area.setAttribute("class", "cg-notebook-area");
      area.setAttribute("cx", String((minX + maxX) / 2));
      area.setAttribute("cy", String((minY + maxY) / 2));
      area.setAttribute("rx", String(Math.max((maxX - minX) / 2, 150)));
      area.setAttribute("ry", String(Math.max((maxY - minY) / 2, 130)));
      area.setAttribute("fill", hexToRgba(color, 0.08));
      area.setAttribute("stroke", hexToRgba(color, 0.36));
      viewport.appendChild(area);
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("class", "cg-notebook-label");
      label.setAttribute("x", String(minX + 18));
      label.setAttribute("y", String(minY + 24));
      label.textContent = displayColorKey(key);
      viewport.appendChild(label);
    }
  }
  nodeRadius(node) {
    const baseRadius = (5.2 + Math.sqrt(node.degree + 1) * 2.1) * this.settings.nodeSize;
    return node.isTopLevel ? baseRadius * 1.18 : baseRadius;
  }
  attachPanZoom(svg) {
    if (svg.dataset.bound === "true") return;
    svg.dataset.bound = "true";
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    svg.addEventListener("pointerdown", (event) => {
      if (event.target.closest(".cg-node-group")) return;
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      svg.setPointerCapture(event.pointerId);
    });
    svg.addEventListener("pointermove", (event) => {
      if (dragging) {
        this.hideTooltip();
        this.view.x += event.clientX - lastX;
        this.view.y += event.clientY - lastY;
        lastX = event.clientX;
        lastY = event.clientY;
        this.applyViewTransform();
        return;
      }
      this.updateHoverFromPointer(event);
    });
    svg.addEventListener("pointerup", () => {
      dragging = false;
    });
    svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.92 : 1.08;
      const rect = svg.getBoundingClientRect();
      const anchorX = rect.width / 2;
      const anchorY = rect.height / 2;
      const graphX = (anchorX - this.view.x) / this.view.scale;
      const graphY = (anchorY - this.view.y) / this.view.scale;
      const nextScale = Math.max(0.15, Math.min(4, this.view.scale * factor));
      this.view.scale = nextScale;
      this.view.x = anchorX - graphX * nextScale;
      this.view.y = anchorY - graphY * nextScale;
      this.applyViewTransform();
    }, { passive: false });
  }
  applyViewTransform() {
    const viewport = this.root?.querySelector(".cg-viewport");
    viewport?.setAttribute("transform", `translate(${this.view.x} ${this.view.y}) scale(${this.view.scale})`);
  }
  showTooltip(event, node) {
    const tooltip = this.root?.querySelector(".cg-tooltip");
    if (!tooltip) return;
    tooltip.innerHTML = `
      <strong>${escapeHtml(node.title)}</strong>
      <span>${escapeHtml(node.hpath || "No path")}</span>
      <span>${node.inbound} incoming · ${node.outbound} outgoing links · ${node.degree} total</span>
      ${node.hierarchyCount ? `<span>${node.hierarchyCount} child note${node.hierarchyCount === 1 ? "" : "s"} in this section</span>` : ""}
      <span>${escapeHtml(node.groupKey)}</span>
      ${node.tag ? `<span>${escapeHtml(node.tag)}</span>` : ""}
      ${node.updated ? `<span>Updated ${formatDate(node.updated)}</span>` : ""}
    `;
    tooltip.style.display = "block";
    this.positionTooltip(event);
  }
  updateHoverFromPointer(event) {
    const node = this.nodeAtPointer(event);
    if (!node) {
      this.hideTooltip();
      return;
    }
    this.showTooltip(event, node);
  }
  nodeAtPointer(event) {
    const svg = this.root?.querySelector(".cg-svg");
    if (!svg) return void 0;
    const rect = svg.getBoundingClientRect();
    const graphX = (event.clientX - rect.left - this.view.x) / this.view.scale;
    const graphY = (event.clientY - rect.top - this.view.y) / this.view.scale;
    const visibleNodes = this.visibleNodes();
    for (const node of visibleNodes) {
      const radius = this.nodeRadius(node);
      const dx = graphX - node.x;
      const dy = graphY - node.y;
      if (Math.hypot(dx, dy) <= Math.max(radius + 12, 24)) return node;
      const labelScore = Math.min(1, (node.degree + 1) / 9);
      if (labelScore >= this.settings.labelThreshold || visibleNodes.length < 160) {
        const labelText = truncate(node.title, 28);
        const labelX = node.x + radius + 5;
        const labelY = node.y + 4;
        const withinLabelX = graphX >= labelX - 6 && graphX <= labelX + labelText.length * 7.8 + 12;
        const withinLabelY = graphY >= labelY - 16 && graphY <= labelY + 8;
        if (withinLabelX && withinLabelY) return node;
      }
    }
    return void 0;
  }
  hideTooltip() {
    const tooltip = this.root?.querySelector(".cg-tooltip");
    if (!tooltip) return;
    tooltip.style.display = "none";
    tooltip.innerHTML = "";
  }
  positionTooltip(event) {
    const tooltip = this.root?.querySelector(".cg-tooltip");
    const stage = this.root?.querySelector(".cg-stage");
    if (!tooltip || !stage) return;
    const rect = stage.getBoundingClientRect();
    tooltip.style.left = `${Math.min(event.clientX - rect.left + 14, rect.width - 300)}px`;
    tooltip.style.top = `${Math.min(event.clientY - rect.top + 14, rect.height - 150)}px`;
  }
}
function rangeControl(key, label, min, max, step) {
  return `<label><span>${label} <small class="cg-range-value" data-for="${key}"></small></span><input class="cg-setting" data-setting="${key}" type="range" min="${min}" max="${max}" step="${step}" /></label>`;
}
function linkBoundaryPoints(source, target, sourceRadius, targetRadius, arrowPadding) {
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
function assignComponents(nodes, links) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const neighbors = /* @__PURE__ */ new Map();
  for (const node of nodes) neighbors.set(node.id, []);
  for (const link of links) {
    neighbors.get(link.source)?.push(link.target);
    neighbors.get(link.target)?.push(link.source);
  }
  let componentNumber = 1;
  const visited = /* @__PURE__ */ new Set();
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    const stack = [node.id];
    const component = [];
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
function centersForGroups(nodes) {
  const keys = [...new Set(nodes.map((node) => node.groupKey))];
  const spread = Math.max(190, Math.sqrt(keys.length) * 150);
  return new Map(keys.map((key, index) => {
    const angle = seededRange(`${key}:centerAngle`, 0, Math.PI * 2);
    const radius = seededRange(`${key}:centerRadius`, 20, spread);
    const rowBias = (index % 3 - 1) * seededRange(`${key}:bias`, 25, 95);
    return [key, { x: Math.cos(angle) * radius + rowBias, y: Math.sin(angle) * radius - rowBias * 0.35 }];
  }));
}
function firstTag(tag) {
  return tag.match(/#([^#]+)#/)?.[1] || "No tag";
}
function firstPathSegment(hpath) {
  return hpath.split("/").filter(Boolean)[0] || "Root";
}
function flattenInlineDocs(files, notebook, ancestors) {
  const docs = [];
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
function cleanDocTitle(value) {
  return value.replace(/\.sy$/i, "") || "Untitled";
}
function joinDocPath(parent, id) {
  const normalizedParent = parent === "/" ? "" : parent.replace(/\/$/, "");
  return `${normalizedParent}/${id}.sy`;
}
function pathDepth(hpath) {
  return hpath.split("/").filter(Boolean).length;
}
function lastPathSegment(hpath) {
  const parts = hpath.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
function truncate(value, length) {
  return value.length > length ? `${value.slice(0, length - 1)}...` : value;
}
function seededRange(seed, min, max) {
  return min + seededUnit(seed) * (max - min);
}
function seededUnit(seed) {
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
  return (hash >>> 0) % 1e4 / 1e4;
}
function formatDate(value) {
  if (value.length < 8) return value;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
function colorFor(key, keys, light = false) {
  const index = Math.max(keys.indexOf(key), 0);
  const color = DEFAULT_COLORS[index % DEFAULT_COLORS.length];
  return light ? lightenHex(color, 0.28) : color;
}
function notebookColorKey(node) {
  return `notebook:${node.boxName || node.box || "Notebook"}`;
}
function displayColorKey(key) {
  return key.startsWith("notebook:") ? key.slice("notebook:".length) : key;
}
function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return `rgba(148, 163, 184, ${alpha})`;
  const [r, g, b] = [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
function lightenHex(hex, amount) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16);
    return Math.min(255, Math.round(value + (255 - value) * amount)).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}
function darkenHex(hex, amount) {
  const normalized = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16);
    return Math.max(0, Math.round(value * (1 - amount))).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`;
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char] ?? char);
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
function cssEscape(value) {
  return CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}
function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
function loadSettings() {
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
function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
module.exports = ClarityGraphPlugin;
