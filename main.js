var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => UltimateExplorerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var DEFAULT_SETTINGS = {
  shortcuts: {},
  lockedFolders: {},
  inlineShortcuts: {},
  autoSourceEnabled: false,
  autoCollapseProperties: false,
  targetFiles: "\u6392\u5E8F\u914D\u7F6E\n",
  hiddenFolders: "",
  folderLimits: []
};
var IconPickerModal = class extends import_obsidian.FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("\u641C\u7D22\u56FE\u6807 (\u5982 'star', 'file')...");
  }
  getItems() {
    return (0, import_obsidian.getIconIds)();
  }
  getItemText(item) {
    return item;
  }
  renderSuggestion(match, el) {
    el.addClass("icon-picker-suggestion");
    const iconContainer = el.createDiv();
    (0, import_obsidian.setIcon)(iconContainer, match.item);
    el.createSpan({ text: match.item });
  }
  onChooseItem(item) {
    this.onChoose(item);
  }
};
var FilePickerModal = class extends import_obsidian.FuzzySuggestModal {
  constructor(app, files, onChoose) {
    super(app);
    this.files = files;
    this.onChoose = onChoose;
    this.setPlaceholder("\u641C\u7D22\u6216\u9009\u62E9\u6587\u4EF6...");
  }
  getItems() {
    return this.files;
  }
  getItemText(file) {
    return file.name;
  }
  onChooseItem(file) {
    if (file) this.onChoose(file);
  }
};
var FolderSuggestModal = class extends import_obsidian.FuzzySuggestModal {
  constructor(app, onChoose) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("\u641C\u7D22\u5E76\u9009\u62E9\u8981\u6DFB\u52A0\u7684\u6587\u4EF6\u5939...");
  }
  getItems() {
    return this.app.vault.getAllLoadedFiles().filter((file) => file instanceof import_obsidian.TFolder && file.path !== "/");
  }
  getItemText(folder) {
    return folder.path;
  }
  onChooseItem(folder) {
    this.onChoose(folder.path);
  }
};
var UltimateExplorerPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    // --- SuperShortcuts 引擎变量 ---
    // 修复：使用 CSSStyleSheet 替代 HTMLStyleElement
    this.hiddenSheet = null;
    this.autoSourceSheet = null;
    this.originalSheets = [];
    this.domObservers = /* @__PURE__ */ new Map();
    // --- AutoSource 引擎变量 ---
    this.foldersHidden = true;
    this.expandedLimits = /* @__PURE__ */ new Set();
    // 修复 2：添加内存泄漏防护
    this._isUnloading = false;
    this._timeouts = /* @__PURE__ */ new Set();
  }
  async onload() {
    await this.loadSettings();
    this.addSettingTab(new CombinedSettingTab(this.app, this));
    this.originalSheets = [...document.adoptedStyleSheets];
    this.hiddenSheet = new CSSStyleSheet();
    this.autoSourceSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...this.originalSheets, this.hiddenSheet, this.autoSourceSheet];
    this.updateDynamicHiddenStyles();
    this.updateAutoSourceStyles();
    this.debouncedUpdate = (0, import_obsidian.debounce)(() => {
      this.updateAllFolders();
      this.updateAllFiles();
    }, 150, true);
    this.debouncedSave = (0, import_obsidian.debounce)(async () => {
      await this.saveData(this.settings);
    }, 500, true);
    this.shortcutClickHandler = (e) => {
      const target = e.target;
      const titleEl = target.closest(".is-locked-folder");
      if (!titleEl) return;
      const folderNode = titleEl.closest(".nav-folder");
      const isCollapsed = folderNode && folderNode.classList.contains("is-collapsed");
      if (!isCollapsed) return;
      if (target.closest(".folder-shortcut-container")) {
        if (!target.closest(".folder-shortcut-icon")) {
          e.stopPropagation();
          e.preventDefault();
        }
        return;
      }
      if (target.closest(".tree-item-icon.collapse-icon")) return;
      e.stopPropagation();
      e.preventDefault();
      new import_obsidian.Notice("\u6587\u4EF6\u5939\u5DF2\u9501\u5B9A", 1e3);
    };
    activeDocument.addEventListener("click", this.shortcutClickHandler, true);
    activeDocument.addEventListener("dblclick", this.shortcutClickHandler, true);
    this.autoSourceClickHandler = (e) => {
      const target = e.target;
      if (!target) return;
      const titleEl = target.closest(".nav-file-title");
      if (!titleEl) return;
      const rect = titleEl.getBoundingClientRect();
      if (e.clientX < rect.right - 35) return;
      const fileEl = titleEl.closest(".nav-file");
      if (!fileEl) return;
      const childrenContainer = fileEl.parentElement;
      if (!childrenContainer || !childrenContainer.classList.contains("nav-folder-children")) return;
      const folderEl = childrenContainer.parentElement;
      if (!folderEl) return;
      const folderTitle = folderEl.querySelector(":scope > .nav-folder-title");
      if (!folderTitle) return;
      const path = folderTitle.getAttribute("data-path");
      if (!path) return;
      const rule = this.settings.folderLimits.find((r) => r.path === path);
      if (!rule) return;
      const limit = typeof rule.limit === "string" ? parseInt(rule.limit) : rule.limit;
      const direction = rule.direction || "top";
      const files = Array.from(childrenContainer.children).filter((el) => el.classList.contains("nav-file"));
      const fileCount = files.length;
      const fileIndex = files.indexOf(fileEl) + 1;
      let isTarget = false;
      if (direction === "top" && fileIndex === limit) isTarget = true;
      else if (direction === "bottom" && fileIndex === fileCount - limit + 1) isTarget = true;
      if (isTarget) {
        e.preventDefault();
        e.stopPropagation();
        if (this.expandedLimits.has(path)) this.expandedLimits.delete(path);
        else this.expandedLimits.add(path);
        this.updateAutoSourceStyles();
      }
    };
    this.registerDomEvent(activeDocument, "click", this.autoSourceClickHandler, true);
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (file instanceof import_obsidian.TFolder && file.path !== "/") {
          menu.addItem((item) => {
            item.setTitle("\u8BBE\u7F6E\u5FEB\u6377\u6587\u4EF6").setIcon("settings-2").onClick(() => new FolderShortcutSettingModal(this.app, this, file).open());
          });
          const isLocked = this.settings.lockedFolders[file.path];
          menu.addItem((item) => {
            item.setTitle(isLocked ? "\u89E3\u9501\u6587\u4EF6\u5939" : "\u9501\u5B9A\u6587\u4EF6\u5939").setIcon(isLocked ? "unlock" : "lock").onClick(async () => {
              if (isLocked) {
                delete this.settings.lockedFolders[file.path];
                this.forceToggleFolderNode(file.path, true);
                new import_obsidian.Notice(`\u5DF2\u89E3\u9501: ${file.name}`);
              } else {
                this.settings.lockedFolders[file.path] = true;
                this.forceToggleFolderNode(file.path, false);
                new import_obsidian.Notice(`\u5DF2\u9501\u5B9A: ${file.name}`);
              }
              await this.saveSettings();
            });
          });
        } else if (file instanceof import_obsidian.TFile) {
          menu.addItem((item) => {
            item.setTitle("\u8BBE\u7F6E\u5185\u8054\u6587\u4EF6").setIcon("link").onClick(() => new FileShortcutSettingModal(this.app, this, file).open());
          });
        }
      })
    );
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.registerObservers();
      this.debouncedUpdate();
    }));
    this.app.workspace.onLayoutReady(() => {
      this.registerObservers();
      this.debouncedUpdate();
    });
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file || this._isUnloading) return;
        if (this.settings.autoCollapseProperties) {
          const timeout = window.setTimeout(() => {
            this._timeouts.delete(timeout);
            if (this._isUnloading) return;
            const activeView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
            if (activeView && activeView.containerEl) {
              const metadataContainer = activeView.containerEl.querySelector(".metadata-container");
              if (metadataContainer && !metadataContainer.classList.contains("is-collapsed")) {
                const heading = metadataContainer.querySelector(".metadata-properties-heading");
                if (heading) heading.click();
              }
            }
          }, 100);
          this._timeouts.add(timeout);
        }
        if (this.settings.autoSourceEnabled) {
          const targets = this.settings.targetFiles.split("\n").map((t) => t.trim()).filter((t) => t.length > 0);
          const isTargetFile = targets.includes(file.basename) || targets.includes(file.name);
          const cache = this.app.metadataCache.getFileCache(file);
          const isFrontmatterTarget = cache?.frontmatter?.["obsidianEditingMode"] === "source";
          this.changeViewState(isTargetFile || isFrontmatterTarget);
        }
      })
    );
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      let isSettingsUpdated = false;
      const updatePathLogic = (oldObj, isFolderDict) => {
        const newObj = {};
        for (let [keyPath, value] of Object.entries(oldObj)) {
          let newKeyPath = keyPath;
          if (keyPath === oldPath) {
            newKeyPath = file.path;
            isSettingsUpdated = true;
          } else if (keyPath.startsWith(oldPath + "/")) {
            newKeyPath = file.path + keyPath.substring(oldPath.length);
            isSettingsUpdated = true;
          }
          if (isFolderDict) newObj[newKeyPath] = value;
          else {
            newObj[newKeyPath] = value.map((sc) => {
              if (sc.path === oldPath) {
                isSettingsUpdated = true;
                return { ...sc, path: file.path };
              } else if (sc.path.startsWith(oldPath + "/")) {
                isSettingsUpdated = true;
                return { ...sc, path: file.path + sc.path.substring(oldPath.length) };
              }
              return sc;
            });
          }
        }
        return newObj;
      };
      this.settings.shortcuts = updatePathLogic(this.settings.shortcuts, false);
      this.settings.lockedFolders = updatePathLogic(this.settings.lockedFolders, true);
      this.settings.inlineShortcuts = updatePathLogic(this.settings.inlineShortcuts, false);
      if (isSettingsUpdated) {
        this.updateDynamicHiddenStyles();
        this.debouncedSave();
      }
      this.debouncedUpdate();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      let isSettingsUpdated = false;
      if (this.settings.shortcuts[file.path]) {
        delete this.settings.shortcuts[file.path];
        isSettingsUpdated = true;
      }
      if (this.settings.lockedFolders[file.path]) {
        delete this.settings.lockedFolders[file.path];
        isSettingsUpdated = true;
      }
      if (this.settings.inlineShortcuts[file.path]) {
        delete this.settings.inlineShortcuts[file.path];
        isSettingsUpdated = true;
      }
      const cleanMainKeys = (obj) => {
        for (const key in obj) {
          if (key.startsWith(file.path + "/")) {
            delete obj[key];
            isSettingsUpdated = true;
          }
        }
      };
      cleanMainKeys(this.settings.shortcuts);
      cleanMainKeys(this.settings.lockedFolders);
      cleanMainKeys(this.settings.inlineShortcuts);
      const cleanTargets = (obj) => {
        for (const mainPath in obj) {
          const originalLength = obj[mainPath].length;
          obj[mainPath] = obj[mainPath].filter((sc) => sc.path !== file.path && !sc.path.startsWith(file.path + "/"));
          if (obj[mainPath].length !== originalLength) {
            isSettingsUpdated = true;
            if (obj[mainPath].length === 0) delete obj[mainPath];
          }
        }
      };
      cleanTargets(this.settings.shortcuts);
      cleanTargets(this.settings.inlineShortcuts);
      if (isSettingsUpdated) {
        this.updateDynamicHiddenStyles();
        this.debouncedSave();
      } else this.updateDynamicHiddenStyles();
      this.debouncedUpdate();
    }));
    this.addCommand({
      id: "toggle-hidden-folders",
      name: "\u5207\u6362\u9690\u85CF\u6587\u4EF6\u5939\u7684\u663E\u793A\u72B6\u6001",
      callback: () => {
        this.foldersHidden = !this.foldersHidden;
        this.updateAutoSourceStyles();
        new import_obsidian.Notice(this.foldersHidden ? "\u6587\u4EF6\u5939\u5DF2\u9690\u85CF" : "\u6587\u4EF6\u5939\u5DF2\u663E\u793A");
      }
    });
  }
  onunload() {
    this._isUnloading = true;
    this._timeouts.forEach((t) => window.clearTimeout(t));
    this._timeouts.clear();
    document.adoptedStyleSheets = this.originalSheets;
    this.hiddenSheet = null;
    this.autoSourceSheet = null;
    activeDocument.removeEventListener("click", this.shortcutClickHandler, true);
    activeDocument.removeEventListener("dblclick", this.shortcutClickHandler, true);
    activeDocument.removeEventListener("click", this.autoSourceClickHandler, true);
    this.domObservers.forEach((observer) => observer.disconnect());
    this.domObservers.clear();
    activeDocument.querySelectorAll(".folder-shortcut-container, .file-inline-shortcut-container").forEach((el) => el.remove());
    activeDocument.querySelectorAll(".is-locked-folder").forEach((el) => el.classList.remove("is-locked-folder"));
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if (!this.settings.folderLimits) this.settings.folderLimits = [];
    if (!this.settings.lockedFolders) this.settings.lockedFolders = {};
    if (!this.settings.inlineShortcuts) this.settings.inlineShortcuts = {};
    if (!this.settings.shortcuts) this.settings.shortcuts = {};
  }
  async saveSettings() {
    const currentLimitPaths = new Set(this.settings.folderLimits.map((r) => r.path.trim()));
    for (const path of this.expandedLimits) {
      if (!currentLimitPaths.has(path)) this.expandedLimits.delete(path);
    }
    this.updateDynamicHiddenStyles();
    this.updateAutoSourceStyles();
    this.debouncedSave();
    this.debouncedUpdate();
  }
  updateDynamicHiddenStyles() {
    if (!this.hiddenSheet) return;
    let cssRules = "";
    const hiddenPaths = /* @__PURE__ */ new Set();
    for (const shortcuts of Object.values(this.settings.inlineShortcuts)) {
      if (shortcuts && shortcuts.length > 0) shortcuts.forEach((sc) => hiddenPaths.add(sc.path));
    }
    if (hiddenPaths.size === 0) {
      this.hiddenSheet.replaceSync("");
      return;
    }
    hiddenPaths.forEach((path) => {
      const safePath = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      cssRules += `
                .nav-file-title[data-path="${safePath}"] { display: none !important; }
                .nav-file:has(> .nav-file-title[data-path="${safePath}"]) { display: none !important; height: 0 !important; margin: 0 !important; padding: 0 !important; border: none !important; }
            `;
    });
    this.hiddenSheet.replaceSync(cssRules);
  }
  escapeCssAttributeString(str) {
    return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }
  updateAutoSourceStyles() {
    if (!this.autoSourceSheet) return;
    let cssRules = "";
    const hiddenFolders = this.settings.hiddenFolders.split("\n").map((f) => f.trim()).filter((f) => f.length > 0);
    if (this.foldersHidden && hiddenFolders.length > 0) {
      hiddenFolders.forEach((path) => {
        const safePath = this.escapeCssAttributeString(path);
        cssRules += `.nav-folder:has(> .nav-folder-title[data-path="${safePath}"]) { display: none !important; }
`;
      });
    }
    if (this.settings.folderLimits && this.settings.folderLimits.length > 0) {
      this.settings.folderLimits.forEach((rule) => {
        if (!rule.path || rule.limit === null || rule.limit === "") return;
        const safePath = this.escapeCssAttributeString(rule.path.trim());
        const limit = typeof rule.limit === "string" ? parseInt(rule.limit) : rule.limit;
        if (isNaN(limit) || limit < 0) return;
        const isExpanded = this.expandedLimits.has(rule.path.trim());
        const iconVar = isExpanded ? "var(--auto-source-icon-minus)" : "var(--auto-source-icon-plus)";
        const direction = rule.direction || "top";
        const nthSelector = direction === "top" ? `nth-child` : `nth-last-child`;
        const selector = `.nav-folder:has(> .nav-folder-title[data-path="${safePath}"]) > .nav-folder-children > .nav-file:${nthSelector}(${limit} of .nav-file) .nav-file-title`;
        cssRules += `
                    ${selector}::before {
                        content: ''; position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
                        width: 24px; height: 22px; background-color: var(--background-modifier-hover);
                        border-radius: 4px; z-index: 10; pointer-events: none; opacity: 0.6;
                        transition: opacity 0.15s ease, background-color 0.15s ease;
                    }
                    ${selector}::after {
                        content: ''; position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
                        width: 24px; height: 22px; background-color: var(--text-muted);
                        -webkit-mask-image: ${iconVar}; -webkit-mask-size: 14px;
                        -webkit-mask-position: center; -webkit-mask-repeat: no-repeat;
                        z-index: 11; cursor: pointer; pointer-events: auto;
                        transition: background-color 0.15s ease;
                    }
                    ${selector}:hover::before { background-color: var(--interactive-hover); opacity: 1; }
                    ${selector}:hover::after { background-color: var(--text-normal); }
                `;
        if (!isExpanded) {
          cssRules += `.nav-folder:has(> .nav-folder-title[data-path="${safePath}"]) > .nav-folder-children > .nav-file:${nthSelector}(n+${limit + 1} of .nav-file) { display: none !important; }
`;
        }
      });
    }
    this.autoSourceSheet.replaceSync(cssRules);
  }
  changeViewState(forceSource) {
    const timeout = window.setTimeout(() => {
      this._timeouts.delete(timeout);
      if (this._isUnloading) return;
      const view = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
      if (!view) return;
      const leaf = view.leaf;
      const state = leaf.getViewState();
      if (state.type !== "markdown") return;
      const vault = this.app.vault;
      const getConfig = vault.getConfig;
      const defaultViewMode = getConfig?.("defaultViewMode") || "source";
      const livePreview = getConfig?.("livePreview");
      let targetMode = forceSource ? "source" : defaultViewMode;
      let targetSource = forceSource ? true : livePreview === false;
      let changed = false;
      const mdState = state.state;
      if (mdState.mode !== targetMode) {
        mdState.mode = targetMode;
        changed = true;
      }
      if (mdState.source !== targetSource) {
        mdState.source = targetSource;
        changed = true;
      }
      if (changed) leaf.setViewState(state, { ephemeral: true });
    }, 50);
    this._timeouts.add(timeout);
  }
  forceToggleFolderNode(folderPath, expand) {
    const fileExplorers = this.app.workspace.getLeavesOfType("file-explorer");
    fileExplorers.forEach((leaf) => {
      const titles = leaf.view.containerEl.querySelectorAll(".nav-folder-title");
      for (let i = 0; i < titles.length; i++) {
        if (titles[i].dataset.path === folderPath) {
          const parent = titles[i].parentElement;
          if (expand) {
            titles[i].classList.remove("is-locked-folder");
            if (parent && parent.classList.contains("is-collapsed")) titles[i].click();
          } else {
            if (parent && !parent.classList.contains("is-collapsed")) titles[i].click();
          }
          break;
        }
      }
    });
  }
  getSmartIconData(path) {
    let icon = "file";
    let color = "";
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof import_obsidian.TFile) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (cache?.frontmatter) {
        if (cache.frontmatter.icon) icon = cache.frontmatter.icon;
        if (cache.frontmatter.iconColor) color = cache.frontmatter.iconColor;
      }
    }
    const iconize = this.app.plugins.getPlugin("obsidian-icon-folder");
    if (iconize?.data?.[path]) {
      const data = iconize.data[path];
      if (typeof data === "string") icon = data;
      else if (typeof data === "object") {
        if (data.iconName) icon = data.iconName;
        if (data.iconColor) color = data.iconColor;
      }
    }
    return { icon, color };
  }
  renderIconSafe(el, iconName, isInline = false) {
    el.empty();
    if (!iconName) iconName = "file";
    let hasRendered = false;
    try {
      const app = this.app;
      const plugins = app.plugins;
      const iconize = plugins?.getPlugin("obsidian-icon-folder");
      if (iconize?.api) {
        const api = iconize.api;
        const iconObj = api.getIconByName(iconName);
        if (iconObj?.svgElement) {
          const tempDiv = createDiv();
          tempDiv.innerHTML = iconObj.svgElement;
          const svg = tempDiv.querySelector("svg");
          if (svg) {
            svg.style.width = isInline ? "14px" : "16px";
            svg.style.height = isInline ? "14px" : "16px";
            el.appendChild(svg);
            hasRendered = true;
          }
        }
      }
    } catch (e) {
    }
    if (!hasRendered) {
      (0, import_obsidian.setIcon)(el, iconName);
      if (el.children.length === 0 && iconName.startsWith("lucide-")) (0, import_obsidian.setIcon)(el, iconName.replace("lucide-", ""));
      if (el.children.length === 0 && iconName.startsWith("Li")) (0, import_obsidian.setIcon)(el, iconName.substring(2).replace(/([A-Z])/g, "-$1").toLowerCase().substring(1));
      if (el.children.length === 0) (0, import_obsidian.setIcon)(el, "file");
    }
  }
  updateAllFolders() {
    const fileExplorers = this.app.workspace.getLeavesOfType("file-explorer");
    if (fileExplorers.length === 0) return;
    const activeFolderPaths = /* @__PURE__ */ new Set();
    for (const [folderPath, shortcuts] of Object.entries(this.settings.shortcuts)) {
      if (shortcuts && shortcuts.length > 0) activeFolderPaths.add(folderPath);
    }
    for (const folderPath of Object.keys(this.settings.lockedFolders)) activeFolderPaths.add(folderPath);
    fileExplorers.forEach((leaf) => {
      const containerEl = leaf.view.containerEl;
      containerEl.querySelectorAll(".folder-shortcut-container").forEach((container) => {
        const path = container.dataset.fsPath;
        if (path && (!this.settings.shortcuts[path] || this.settings.shortcuts[path].length === 0)) container.remove();
      });
      containerEl.querySelectorAll(".is-locked-folder").forEach((title) => {
        const path = title.dataset.path;
        if (path && !this.settings.lockedFolders[path]) title.classList.remove("is-locked-folder");
      });
      const folderNodesMap = /* @__PURE__ */ new Map();
      const titleNodes = containerEl.querySelectorAll(".nav-folder-title");
      for (let i = 0; i < titleNodes.length; i++) {
        const path = titleNodes[i].dataset.path;
        if (path) folderNodesMap.set(path, titleNodes[i]);
      }
      activeFolderPaths.forEach((folderPath) => {
        const titleEl = folderNodesMap.get(folderPath);
        if (!titleEl) return;
        if (this.settings.lockedFolders[folderPath]) titleEl.classList.add("is-locked-folder");
        const shortcuts = this.settings.shortcuts[folderPath];
        if (!shortcuts || shortcuts.length === 0) return;
        const existingContainer = titleEl.querySelector(".folder-shortcut-container");
        const stateToTrack = shortcuts.map((sc) => ({ ...sc, isBroken: !this.app.vault.getAbstractFileByPath(sc.path) }));
        const currentStateStr = JSON.stringify(stateToTrack);
        if (existingContainer && existingContainer.dataset.fsState === currentStateStr && existingContainer.dataset.fsPath === folderPath) return;
        if (existingContainer) existingContainer.remove();
        const container = document.createElement("div");
        container.className = "folder-shortcut-container";
        container.dataset.fsState = currentStateStr;
        container.dataset.fsPath = folderPath;
        shortcuts.forEach((sc) => {
          const iconEl = document.createElement("div");
          iconEl.className = "folder-shortcut-icon";
          iconEl.tabIndex = 0;
          const targetFile = this.app.vault.getAbstractFileByPath(sc.path);
          const isBroken = !targetFile || !targetFile.path.startsWith(folderPath + "/");
          if (isBroken) {
            iconEl.classList.add("is-broken");
            iconEl.setAttribute("aria-label", !targetFile ? "\u6587\u4EF6\u5DF2\u5220\u9664" : "\u6587\u4EF6\u5DF2\u79FB\u51FA");
            this.renderIconSafe(iconEl, "alert-circle", false);
          } else {
            iconEl.style.color = sc.color || "var(--text-muted)";
            iconEl.setAttribute("aria-label", targetFile.name);
            this.renderIconSafe(iconEl, sc.icon || "file", false);
          }
          const openFile = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (targetFile instanceof import_obsidian.TFile) {
              const isMiddleClick = e.type === "auxclick" && e.button === 1;
              const openInNewTab = isMiddleClick || e.ctrlKey || e.metaKey;
              if (!openInNewTab && this.app.workspace.getActiveFile()?.path === targetFile.path) return;
              await this.app.workspace.getLeaf(openInNewTab ? "tab" : false).openFile(targetFile);
            } else new import_obsidian.Notice("\u65E0\u6CD5\u6253\u5F00\uFF1A\u6587\u4EF6\u4E0D\u5B58\u5728\u6216\u5DF2\u88AB\u79FB\u52A8\uFF01");
          };
          iconEl.addEventListener("click", openFile);
          iconEl.addEventListener("auxclick", openFile);
          iconEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") openFile(e);
          });
          container.appendChild(iconEl);
        });
        titleEl.appendChild(container);
      });
    });
  }
  updateAllFiles() {
    const fileExplorers = this.app.workspace.getLeavesOfType("file-explorer");
    if (fileExplorers.length === 0) return;
    fileExplorers.forEach((leaf) => {
      const containerEl = leaf.view.containerEl;
      containerEl.querySelectorAll(".file-inline-shortcut-container").forEach((container) => {
        const path = container.dataset.fsPath;
        if (path && (!this.settings.inlineShortcuts[path] || this.settings.inlineShortcuts[path].length === 0)) container.remove();
      });
      for (const [mainFilePath, shortcuts] of Object.entries(this.settings.inlineShortcuts)) {
        if (!shortcuts || shortcuts.length === 0) continue;
        const titleNode = containerEl.querySelector(`.nav-file-title[data-path="${CSS.escape(mainFilePath)}"]`);
        if (!titleNode) continue;
        const currentStateStr = JSON.stringify(shortcuts.map((sc) => ({ ...sc, isBroken: !this.app.vault.getAbstractFileByPath(sc.path) })));
        const existingContainer = titleNode.querySelector(".file-inline-shortcut-container");
        if (existingContainer && existingContainer.dataset.fsState === currentStateStr) continue;
        if (existingContainer) existingContainer.remove();
        const container = document.createElement("div");
        container.className = "file-inline-shortcut-container";
        container.dataset.fsState = currentStateStr;
        container.dataset.fsPath = mainFilePath;
        shortcuts.forEach((sc) => {
          const iconEl = document.createElement("div");
          iconEl.className = "file-inline-shortcut-icon";
          const targetFile = this.app.vault.getAbstractFileByPath(sc.path);
          const isBroken = !targetFile;
          if (isBroken) {
            iconEl.classList.add("is-broken");
            iconEl.setAttribute("aria-label", "\u9644\u5C5E\u6587\u4EF6\u5DF2\u4E22\u5931");
            this.renderIconSafe(iconEl, "alert-circle", true);
          } else {
            iconEl.style.color = sc.color || "var(--text-muted)";
            iconEl.setAttribute("aria-label", `\u6253\u5F00: ${targetFile.name}`);
            this.renderIconSafe(iconEl, sc.icon || "file", true);
          }
          const openFile = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (targetFile instanceof import_obsidian.TFile) {
              const isMiddleClick = e.type === "auxclick" && e.button === 1;
              const openInNewTab = isMiddleClick || e.ctrlKey || e.metaKey;
              await this.app.workspace.getLeaf(openInNewTab ? "tab" : false).openFile(targetFile);
            } else new import_obsidian.Notice("\u65E0\u6CD5\u6253\u5F00\uFF1A\u9644\u5C5E\u6587\u4EF6\u4E0D\u5B58\u5728\uFF01");
          };
          iconEl.addEventListener("click", openFile);
          iconEl.addEventListener("auxclick", openFile);
          container.appendChild(iconEl);
        });
        const titleContent = titleNode.querySelector(".nav-file-title-content");
        if (titleContent && titleContent.nextSibling) titleNode.insertBefore(container, titleContent.nextSibling);
        else titleNode.appendChild(container);
      }
    });
  }
  registerObservers() {
    const fileExplorerLeaves = this.app.workspace.getLeavesOfType("file-explorer");
    const currentLeafIds = new Set(fileExplorerLeaves.map((leaf) => leaf.id));
    for (const leafId of this.domObservers.keys()) {
      if (!currentLeafIds.has(leafId)) {
        this.domObservers.get(leafId)?.disconnect();
        this.domObservers.delete(leafId);
      }
    }
    fileExplorerLeaves.forEach((leaf) => {
      const containerEl = leaf.view.containerEl;
      const leafId = leaf.id;
      if (!this.domObservers.has(leafId)) {
        const uiObserver = new MutationObserver((mutations) => {
          if (this._isUnloading) return;
          let shouldUpdate = false;
          for (let i = 0; i < mutations.length; i++) {
            const m = mutations[i];
            if (m.type === "childList") {
              for (let j = 0; j < m.addedNodes.length; j++) {
                const node = m.addedNodes[j];
                if (node.nodeType === Node.ELEMENT_NODE) {
                  if (node.classList && (node.classList.contains("folder-shortcut-container") || node.classList.contains("file-inline-shortcut-container"))) continue;
                  if (node.classList && (node.classList.contains("nav-folder") || node.classList.contains("nav-file"))) {
                    shouldUpdate = true;
                    break;
                  }
                  if (node.querySelector && node.querySelector(".nav-folder-title")) {
                    shouldUpdate = true;
                    break;
                  }
                }
              }
            } else if (m.type === "attributes" && m.attributeName === "class") {
              const target = m.target;
              if (target?.classList?.contains("nav-folder")) {
                shouldUpdate = true;
                break;
              }
            }
            if (shouldUpdate) break;
          }
          if (shouldUpdate) this.debouncedUpdate();
        });
        uiObserver.observe(containerEl, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
        this.domObservers.set(leafId, uiObserver);
      }
    });
  }
};
var FolderShortcutSettingModal = class extends import_obsidian.Modal {
  constructor(app, plugin, folder) {
    super(app);
    this.modalType = "folder";
    this.plugin = plugin;
    this.folder = folder;
    this.folderPath = folder.path;
    let savedShortcuts = this.plugin.settings.shortcuts[this.folderPath];
    this.currentShortcuts = Array.isArray(savedShortcuts) ? JSON.parse(JSON.stringify(savedShortcuts)) : [];
    this.setTitle(`\u6587\u4EF6\u5939\u5FEB\u6377\u56FE\u6807: ${this.folder.name}`);
  }
  onOpen() {
    this.display();
  }
  async autoSave() {
    if (this.currentShortcuts.length === 0) delete this.plugin.settings.shortcuts[this.folderPath];
    else this.plugin.settings.shortcuts[this.folderPath] = this.currentShortcuts;
    await this.plugin.saveSettings();
  }
  getAvailableFiles() {
    const mountedPaths = /* @__PURE__ */ new Set();
    this.currentShortcuts.forEach((sc) => mountedPaths.add(sc.path));
    return this.app.vault.getFiles().filter((f) => f.path.startsWith(this.folderPath + "/") && !mountedPaths.has(f.path));
  }
  display() {
    renderSettingModal(this, this.getAvailableFiles(), "+ \u6DFB\u52A0\u6587\u4EF6\u5939\u5185\u90E8\u5FEB\u6377\u6587\u4EF6");
  }
};
var FileShortcutSettingModal = class extends import_obsidian.Modal {
  constructor(app, plugin, file) {
    super(app);
    this.modalType = "file";
    this.plugin = plugin;
    this.file = file;
    this.filePath = file.path;
    let savedShortcuts = this.plugin.settings.inlineShortcuts[this.filePath];
    this.currentShortcuts = Array.isArray(savedShortcuts) ? JSON.parse(JSON.stringify(savedShortcuts)) : [];
    this.setTitle(`\u4E3A\u4E3B\u6587\u4EF6\u6DFB\u52A0\u9644\u5C5E: ${this.file.name}`);
  }
  onOpen() {
    this.display();
  }
  async autoSave() {
    if (this.currentShortcuts.length === 0) delete this.plugin.settings.inlineShortcuts[this.filePath];
    else this.plugin.settings.inlineShortcuts[this.filePath] = this.currentShortcuts;
    await this.plugin.saveSettings();
  }
  getAvailableFiles() {
    const mountedPaths = /* @__PURE__ */ new Set();
    for (const shortcuts of Object.values(this.plugin.settings.inlineShortcuts)) {
      if (shortcuts) shortcuts.forEach((sc) => mountedPaths.add(sc.path));
    }
    this.currentShortcuts.forEach((sc) => mountedPaths.add(sc.path));
    return this.app.vault.getFiles().filter((f) => f.parent?.path === this.file.parent?.path && f.path !== this.filePath && !mountedPaths.has(f.path));
  }
  display() {
    renderSettingModal(this, this.getAvailableFiles(), "+ \u6302\u8F7D\u540C\u7EA7\u76EE\u5F55\u4E0B\u7684\u9644\u5C5E\u6587\u4EF6");
  }
};
function renderSettingModal(modalInstance, cachedFiles, addBtnText) {
  const { contentEl, plugin, currentShortcuts, modalType } = modalInstance;
  contentEl.empty();
  const isFileModal = modalType === "file";
  const descText = isFileModal ? "\u9009\u62E9\u7684\u9644\u5C5E\u6587\u4EF6\u5C06\u5728\u5DE6\u4FA7\u5217\u8868\u4E2D\u9690\u85CF\uFF0C\u5E76\u7D27\u8D34\u5728\u5F53\u524D\u4E3B\u6587\u4EF6\u540D\u540E\u3002" : "\u6309\u4F4F\u5217\u8868\u5373\u53EF\u4E0A\u4E0B\u62D6\u62FD\u6392\u5E8F\u3002\u4EFB\u4F55\u4FEE\u6539\u81EA\u52A8\u4FDD\u5B58\u3002";
  const pEl = contentEl.createEl("p", { text: descText, cls: "setting-item-description" });
  pEl.style.marginBottom = "20px";
  const listContainer = contentEl.createDiv("fs-shortcut-list");
  currentShortcuts.forEach((sc, index) => {
    const itemEl = listContainer.createDiv({ cls: "fs-shortcut-item", attr: { "draggable": "true" } });
    const currentFile = cachedFiles.find((f) => f.path === sc.path) || plugin.app.vault.getAbstractFileByPath(sc.path);
    const selectBtn = itemEl.createDiv({ cls: "fs-file-select-btn" });
    selectBtn.createEl("span", { text: currentFile ? currentFile.name : "\u6587\u4EF6\u5DF2\u4E22\u5931(\u70B9\u51FB\u91CD\u9009)" });
    const iconBtn = itemEl.createDiv("fs-icon-btn");
    iconBtn.style.color = sc.color || "var(--text-normal)";
    plugin.renderIconSafe(iconBtn, sc.icon, isFileModal);
    selectBtn.onclick = () => {
      if (cachedFiles.length === 0) {
        new import_obsidian.Notice("\u76EE\u5F55\u4E0B\u6CA1\u6709\u66F4\u591A\u53EF\u4F9B\u6302\u8F7D\u7684\u6587\u4EF6\u4E86\uFF01");
        return;
      }
      new FilePickerModal(plugin.app, cachedFiles, async (selectedFile) => {
        sc.path = selectedFile.path;
        const smartData = plugin.getSmartIconData(sc.path);
        sc.icon = smartData.icon;
        if (smartData.color) sc.color = smartData.color;
        else delete sc.color;
        await modalInstance.autoSave();
        modalInstance.display();
      }).open();
    };
    iconBtn.onclick = () => {
      new IconPickerModal(plugin.app, async (selectedIcon) => {
        sc.icon = selectedIcon;
        plugin.renderIconSafe(iconBtn, sc.icon, isFileModal);
        await modalInstance.autoSave();
      }).open();
    };
    const colorInput = itemEl.createEl("input", { cls: "fs-color-picker", attr: { type: "color", value: sc.color || "#808080" } });
    colorInput.addEventListener("change", async (e) => {
      sc.color = e.target.value;
      await modalInstance.autoSave();
    });
    const resetBtn = itemEl.createEl("button", { cls: "fs-btn-action fs-btn-reset-color", attr: { "aria-label": "\u91CD\u7F6E\u4E3A\u6587\u4EF6\u9ED8\u8BA4\u56FE\u6807\u548C\u989C\u8272" } });
    (0, import_obsidian.setIcon)(resetBtn, "rotate-ccw");
    resetBtn.onclick = async () => {
      if (!currentFile) {
        new import_obsidian.Notice("\u65E0\u6CD5\u91CD\u7F6E\uFF1A\u6587\u4EF6\u5DF2\u4E22\u5931", 2e3);
        return;
      }
      const smartData = plugin.getSmartIconData(sc.path);
      sc.icon = smartData.icon;
      if (smartData.color) sc.color = smartData.color;
      else delete sc.color;
      new import_obsidian.Notice(`\u5DF2\u91CD\u7F6E\u4E3A\u6700\u65B0\u56FE\u6807\u548C\u989C\u8272`);
      await modalInstance.autoSave();
      modalInstance.display();
    };
    const delBtn = itemEl.createEl("button", { cls: "fs-btn-action fs-btn-delete" });
    (0, import_obsidian.setIcon)(delBtn, "trash-2");
    delBtn.onclick = async () => {
      currentShortcuts.splice(index, 1);
      await modalInstance.autoSave();
      modalInstance.display();
    };
    itemEl.ondragstart = (e) => {
      if (e.dataTransfer) e.dataTransfer.setData("text/plain", index.toString());
      itemEl.classList.add("is-dragging");
    };
    itemEl.ondragover = (e) => {
      e.preventDefault();
      itemEl.classList.add("drag-over");
    };
    itemEl.ondragleave = () => itemEl.classList.remove("drag-over");
    itemEl.ondrop = async (e) => {
      e.preventDefault();
      itemEl.classList.remove("drag-over");
      if (!e.dataTransfer) return;
      const dragIndex = parseInt(e.dataTransfer.getData("text/plain"));
      if (dragIndex !== index && !isNaN(dragIndex)) {
        const [draggedItem] = currentShortcuts.splice(dragIndex, 1);
        currentShortcuts.splice(index, 0, draggedItem);
        await modalInstance.autoSave();
        modalInstance.display();
      }
    };
    itemEl.ondragend = () => document.querySelectorAll(".fs-shortcut-item").forEach((el) => el.classList.remove("drag-over", "is-dragging"));
  });
  const btnContainer = contentEl.createDiv();
  btnContainer.style.cssText = "display: flex; justify-content: flex-start; margin-top: 15px;";
  const addBtn = btnContainer.createEl("button", { text: addBtnText });
  addBtn.onclick = () => {
    if (cachedFiles.length === 0) return new import_obsidian.Notice("\u76EE\u5F55\u4E0B\u6CA1\u6709\u7B26\u5408\u6761\u4EF6(\u4E14\u672A\u88AB\u6302\u8F7D)\u7684\u6587\u4EF6\uFF01");
    new FilePickerModal(plugin.app, cachedFiles, async (selectedFile) => {
      const smartData = plugin.getSmartIconData(selectedFile.path);
      currentShortcuts.push({ path: selectedFile.path, icon: smartData.icon, color: smartData.color || "" });
      await modalInstance.autoSave();
      modalInstance.display();
    }).open();
  };
}
var CombinedSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("\u81EA\u52A8\u6E90\u7801\u6A21\u5F0F\u4E0E\u9690\u85CF\u6587\u4EF6\u5939\u8BBE\u7F6E").setHeading();
    new import_obsidian.Setting(containerEl).setName("\u542F\u7528\u81EA\u52A8\u6E90\u7801\u6A21\u5F0F").setDesc("\u5173\u95ED\u6B64\u5F00\u5173\u540E\uFF0C\u6253\u5F00\u7279\u5B9A\u6587\u4EF6\u65F6\u4E0D\u518D\u81EA\u52A8\u5207\u6362\u5230\u6E90\u7801\u6A21\u5F0F\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoSourceEnabled).onChange(async (value) => {
      this.plugin.settings.autoSourceEnabled = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u9700\u8981\u5F00\u542F\u6E90\u7801\u6A21\u5F0F\u7684\u6587\u4EF6\u540D").addTextArea((text) => {
      text.inputEl.rows = 5;
      text.inputEl.style.width = "100%";
      text.setValue(this.plugin.settings.targetFiles).onChange(async (v) => {
        this.plugin.settings.targetFiles = v;
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("\u81EA\u52A8\u6536\u8D77\u7B14\u8BB0\u5C5E\u6027\u9762\u677F").setDesc("\u5F00\u542F\u540E\uFF0C\u6BCF\u6B21\u6253\u5F00 Markdown \u6587\u4EF6\u65F6\u4F1A\u81EA\u52A8\u6298\u53E0\u9876\u90E8\u7684\u7B14\u8BB0\u5C5E\u6027 (Properties) \u533A\u57DF\u3002").addToggle((toggle) => toggle.setValue(this.plugin.settings.autoCollapseProperties).onChange(async (value) => {
      this.plugin.settings.autoCollapseProperties = value;
      await this.plugin.saveSettings();
    }));
    new import_obsidian.Setting(containerEl).setName("\u9690\u85CF\u6587\u4EF6\u5939\u8BBE\u7F6E").setHeading();
    new import_obsidian.Setting(containerEl).setName("\u5B8C\u5168\u9690\u85CF\u7684\u6587\u4EF6\u5939").setDesc("\u624B\u52A8\u8F93\u5165\u8DEF\u5F84\uFF0C\u6216\u70B9\u51FB\u53F3\u4FA7\u201C\u6D4F\u89C8\u201D\u6309\u94AE\u641C\u7D22\u6DFB\u52A0\uFF08\u6BCF\u884C\u4E00\u4E2A\uFF09\u3002").addTextArea((text) => {
      text.inputEl.rows = 5;
      text.inputEl.style.width = "100%";
      text.setValue(this.plugin.settings.hiddenFolders).onChange(async (v) => {
        this.plugin.settings.hiddenFolders = v;
        await this.plugin.saveSettings();
      });
    }).addButton(
      (btn) => btn.setButtonText("\u{1F50D} \u6D4F\u89C8...").setTooltip("\u5728\u4ED3\u5E93\u4E2D\u641C\u7D22\u5E76\u9009\u62E9\u6587\u4EF6\u5939").onClick(() => {
        new FolderSuggestModal(this.app, async (folderPath) => {
          let currentVal = this.plugin.settings.hiddenFolders.trim();
          let newVal = currentVal ? currentVal + "\n" + folderPath : folderPath;
          this.plugin.settings.hiddenFolders = newVal + "\n";
          await this.plugin.saveSettings();
          this.display();
        }).open();
      })
    );
    new import_obsidian.Setting(containerEl).setName("\u6587\u4EF6\u5939\u6587\u4EF6\u663E\u793A\u4E2A\u6570\u9650\u5236").setHeading();
    containerEl.createEl("p", { text: "\u53EA\u663E\u793A\u524D\uFF08\u6216\u540E\uFF09N \u4E2A\u6587\u4EF6\u3002\u8D85\u51FA\u7684\u90E8\u5206\u5C06\u5728\u8FB9\u7F18\u6587\u4EF6\u53F3\u4FA7\u663E\u793A\u6298\u53E0\u6309\u94AE\u3002", cls: "setting-item-description" });
    const limitsContainer = containerEl.createDiv();
    const renderLimits = () => {
      limitsContainer.empty();
      this.plugin.settings.folderLimits.forEach((rule, index) => {
        const row = limitsContainer.createDiv({ cls: "auto-source-setting-row" });
        const pathInput = new import_obsidian.TextComponent(row).setPlaceholder("\u6587\u4EF6\u5939\u8DEF\u5F84").setValue(rule.path);
        pathInput.inputEl.classList.add("auto-source-flex-2");
        const statusIcon = row.createDiv({ cls: "status-icon-container" });
        const validatePath = (pathVal) => {
          statusIcon.empty();
          statusIcon.removeClass("status-icon-success", "status-icon-error");
          const cleanPath = pathVal.trim();
          if (!cleanPath) return;
          const folder = this.plugin.app.vault.getAbstractFileByPath(cleanPath);
          if (folder instanceof import_obsidian.TFolder) {
            (0, import_obsidian.setIcon)(statusIcon, "check-circle");
            statusIcon.addClass("status-icon-success");
            statusIcon.setAttribute("aria-label", "\u9A8C\u8BC1\u901A\u8FC7\uFF1A\u6587\u4EF6\u5939\u5B58\u5728");
          } else {
            (0, import_obsidian.setIcon)(statusIcon, "alert-circle");
            statusIcon.addClass("status-icon-error");
            statusIcon.setAttribute("aria-label", "\u672A\u627E\u5230\u8BE5\u6587\u4EF6\u5939\uFF0C\u8BF7\u68C0\u67E5\u8DEF\u5F84\u62FC\u5199");
          }
        };
        validatePath(rule.path);
        pathInput.onChange(async (v) => {
          rule.path = v;
          validatePath(v);
          await this.plugin.saveSettings();
        });
        new import_obsidian.ButtonComponent(row).setIcon("search").setTooltip("\u641C\u7D22\u6587\u4EF6\u5939").onClick(() => {
          new FolderSuggestModal(this.app, async (folderPath) => {
            rule.path = folderPath;
            await this.plugin.saveSettings();
            renderLimits();
          }).open();
        });
        const currentDir = rule.direction || "top";
        const dirIcon = currentDir === "bottom" ? "arrow-up" : "arrow-down";
        const dirTooltip = currentDir === "bottom" ? "\u5F53\u524D\uFF1A\u4FDD\u7559\u3010\u540E\u3011N\u4E2A (\u70B9\u51FB\u5207\u6362)" : "\u5F53\u524D\uFF1A\u4FDD\u7559\u3010\u524D\u3011N\u4E2A (\u70B9\u51FB\u5207\u6362)";
        new import_obsidian.ButtonComponent(row).setIcon(dirIcon).setTooltip(dirTooltip).onClick(async () => {
          rule.direction = currentDir === "top" ? "bottom" : "top";
          await this.plugin.saveSettings();
          renderLimits();
        });
        const limitInput = new import_obsidian.TextComponent(row).setPlaceholder("\u4E2A\u6570").setValue(rule.limit !== null ? rule.limit.toString() : "").onChange(async (v) => {
          rule.limit = v;
          await this.plugin.saveSettings();
        });
        limitInput.inputEl.type = "number";
        limitInput.inputEl.min = "0";
        limitInput.inputEl.classList.add("auto-source-flex-1");
        new import_obsidian.ButtonComponent(row).setIcon("trash").setTooltip("\u5220\u9664").onClick(async () => {
          this.plugin.settings.folderLimits.splice(index, 1);
          await this.plugin.saveSettings();
          renderLimits();
        });
      });
    };
    renderLimits();
    new import_obsidian.Setting(containerEl).addButton(
      (btn) => btn.setButtonText("\u6DFB\u52A0\u6587\u4EF6\u663E\u793A\u4E2A\u6570").setCta().onClick(async () => {
        this.plugin.settings.folderLimits.push({ path: "", limit: 5, direction: "top" });
        await this.plugin.saveSettings();
        renderLimits();
      })
    );
  }
};
