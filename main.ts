import {
    Plugin,
    Modal,
    FuzzySuggestModal,
    setIcon,
    getIconIds,
    TFolder,
    TFile,
    Notice,
    debounce,
    App,
    TAbstractFile,
    FuzzyMatch,
    ItemView,
    PluginSettingTab,
    Setting,
    MarkdownView,
    TextComponent,
    ButtonComponent
} from 'obsidian';

// ==========================================
// 1. 统一类型定义 (Types & Interfaces)
// ==========================================
export interface Shortcut {
    path: string;
    icon: string;
    color?: string;
    isBroken?: boolean;
}

export interface FolderLimitRule {
    path: string;
    limit: string | number;
    direction: 'top' | 'bottom';
}

export interface CombinedSettings {
    shortcuts: Record<string, Shortcut[]>;
    lockedFolders: Record<string, boolean>;
    inlineShortcuts: Record<string, Shortcut[]>;
    autoSourceEnabled: boolean;
    autoCollapseProperties: boolean;
    targetFiles: string;
    hiddenFolders: string;
    folderLimits: FolderLimitRule[];
}

const DEFAULT_SETTINGS: CombinedSettings = {
    shortcuts: {},
    lockedFolders: {},
    inlineShortcuts: {},
    autoSourceEnabled: false,
    autoCollapseProperties: false,
    targetFiles: '排序配置\n',
    hiddenFolders: '',
    folderLimits: []
};

// ==========================================
// 2. 共用弹窗与UI组件
// ==========================================
class IconPickerModal extends FuzzySuggestModal<string> {
    onChoose: (item: string) => void;
    constructor(app: App, onChoose: (item: string) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder("搜索图标 (如 'star', 'file')...");
    }
    getItems(): string[] { return getIconIds(); }
    getItemText(item: string): string { return item; }
    renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement) {
        el.addClass('icon-picker-suggestion');
        const iconContainer = el.createDiv(); setIcon(iconContainer, match.item);
        el.createSpan({ text: match.item });
    }
    onChooseItem(item: string) { this.onChoose(item); }
}

class FilePickerModal extends FuzzySuggestModal<TFile> {
    files: TFile[]; onChoose: (file: TFile) => void;
    constructor(app: App, files: TFile[], onChoose: (file: TFile) => void) {
        super(app); this.files = files; this.onChoose = onChoose;
        this.setPlaceholder("搜索或选择文件...");
    }
    getItems(): TFile[] { return this.files; }
    getItemText(file: TFile): string { return file.name; }
    onChooseItem(file: TFile) { if (file) this.onChoose(file); }
}

class FolderSuggestModal extends FuzzySuggestModal<TFolder> {
    onChoose: (folderPath: string) => void;
    constructor(app: App, onChoose: (folderPath: string) => void) {
        super(app); this.onChoose = onChoose;
        this.setPlaceholder("搜索并选择要添加的文件夹...");
    }
    getItems(): TFolder[] { return this.app.vault.getAllLoadedFiles().filter((file): file is TFolder => file instanceof TFolder && file.path !== '/'); }
    getItemText(folder: TFolder): string { return folder.path; }
    onChooseItem(folder: TFolder) { this.onChoose(folder.path); }
}

// ==========================================
// 3. 核心大一统插件类
// ==========================================
export default class UltimateExplorerPlugin extends Plugin {
    settings: CombinedSettings;
    
    // --- SuperShortcuts 引擎变量 ---
    // 修复：使用 CSSStyleSheet 替代 HTMLStyleElement
    private hiddenSheet: CSSStyleSheet | null = null;
    private autoSourceSheet: CSSStyleSheet | null = null;
    private originalSheets: CSSStyleSheet[] = [];
    domObservers: Map<string, MutationObserver> = new Map();
    
    // 修复 1：使用正确的函数类型替代 any
    debouncedUpdate: () => void;
    debouncedSave: () => void;
    
    shortcutClickHandler: (e: MouseEvent) => void;

    // --- AutoSource 引擎变量 ---
    foldersHidden: boolean = true;
    expandedLimits: Set<string> = new Set();
    autoSourceClickHandler: (e: MouseEvent) => void;
    
    // 修复 2：添加内存泄漏防护
    private _isUnloading = false;
    private _timeouts: Set<ReturnType<typeof window.setTimeout>> = new Set();

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new CombinedSettingTab(this.app, this));

        // 修复：使用 adoptedStyleSheets 替代 createElement('style')
        this.originalSheets = [...activeDocument.adoptedStyleSheets];
        this.hiddenSheet = new CSSStyleSheet();
        this.autoSourceSheet = new CSSStyleSheet();
        activeDocument.adoptedStyleSheets = [...this.originalSheets, this.hiddenSheet, this.autoSourceSheet];

        this.updateDynamicHiddenStyles(); 
        this.updateAutoSourceStyles();

        this.debouncedUpdate = debounce(() => {
            this.updateAllFolders();
            this.updateAllFiles();
        }, 150, true);
        
        this.debouncedSave = debounce(async () => {
            await this.saveData(this.settings);
        }, 500, true);

        // 注册拦截器 (SuperShortcuts)
        this.shortcutClickHandler = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const titleEl = target.closest('.is-locked-folder');
            if (!titleEl) return;
            const folderNode = titleEl.closest('.nav-folder');
            const isCollapsed = folderNode && folderNode.classList.contains('is-collapsed');
            if (!isCollapsed) return; 
            
            if (target.closest('.folder-shortcut-container')) {
                if (!target.closest('.folder-shortcut-icon')) { e.stopPropagation(); e.preventDefault(); }
                return;
            }
            if (target.closest('.tree-item-icon.collapse-icon')) return;
            
            e.stopPropagation(); e.preventDefault();
            new Notice("文件夹已锁定", 1000);
        };
        activeDocument.addEventListener('click', this.shortcutClickHandler, true);
        activeDocument.addEventListener('dblclick', this.shortcutClickHandler, true);

        // 注册拦截器 (AutoSource)
        this.autoSourceClickHandler = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (!target) return;
            const titleEl = target.closest('.nav-file-title') as HTMLElement | null;
            if (!titleEl) return;
            const rect = titleEl.getBoundingClientRect();
            if (e.clientX < rect.right - 35) return; 

            const fileEl = titleEl.closest('.nav-file') as HTMLElement | null;
            if (!fileEl) return;
            const childrenContainer = fileEl.parentElement;
            if (!childrenContainer || !childrenContainer.classList.contains('nav-folder-children')) return;
            const folderEl = childrenContainer.parentElement;
            if (!folderEl) return;
            const folderTitle = folderEl.querySelector(':scope > .nav-folder-title') as HTMLElement | null;
            if (!folderTitle) return;

            const path = folderTitle.getAttribute('data-path');
            if (!path) return;

            const rule = this.settings.folderLimits.find(r => r.path === path);
            if (!rule) return;

            const limit = typeof rule.limit === 'string' ? parseInt(rule.limit) : rule.limit;
            const direction = rule.direction || 'top';
            const files = Array.from(childrenContainer.children).filter(el => el.classList.contains('nav-file'));
            const fileCount = files.length;
            const fileIndex = files.indexOf(fileEl) + 1;

            let isTarget = false;
            if (direction === 'top' && fileIndex === limit) isTarget = true;
            else if (direction === 'bottom' && fileIndex === (fileCount - limit + 1)) isTarget = true;

            if (isTarget) {
                e.preventDefault(); e.stopPropagation();
                if (this.expandedLimits.has(path)) this.expandedLimits.delete(path);
                else this.expandedLimits.add(path);
                this.updateAutoSourceStyles();
            }
        };
        this.registerDomEvent(activeDocument, 'click', this.autoSourceClickHandler, true);

        // 右键菜单 (SuperShortcuts)
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (file instanceof TFolder && file.path !== '/') {
                    menu.addItem((item) => {
                        item.setTitle('设置快捷文件').setIcon('settings-2')
                            .onClick(() => new FolderShortcutSettingModal(this.app, this, file).open());
                    });
                    const isLocked = this.settings.lockedFolders[file.path];
                    menu.addItem((item) => {
                        item.setTitle(isLocked ? '解锁文件夹' : '锁定文件夹').setIcon(isLocked ? 'unlock' : 'lock')
                            .onClick(async () => {
                                if (isLocked) {
                                    delete this.settings.lockedFolders[file.path];
                                    this.forceToggleFolderNode(file.path, true);
                                    new Notice(`已解锁: ${file.name}`);
                                } else {
                                    this.settings.lockedFolders[file.path] = true;
                                    this.forceToggleFolderNode(file.path, false);
                                    new Notice(`已锁定: ${file.name}`);
                                }
                                await this.saveSettings();
                            });
                    });
                }
                else if (file instanceof TFile) {
                    menu.addItem((item) => {
                        item.setTitle('设置内联文件').setIcon('link')
                            .onClick(() => new FileShortcutSettingModal(this.app, this, file).open());
                    });
                }
            })
        );

        this.registerEvent(this.app.workspace.on('layout-change', () => {
            this.registerObservers();
            this.debouncedUpdate();
        }));
        this.app.workspace.onLayoutReady(() => {
            this.registerObservers();
            this.debouncedUpdate();
        });

        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (!file || this._isUnloading) return;
                if (this.settings.autoCollapseProperties) {
                    const timeout = window.setTimeout(() => {
                        this._timeouts.delete(timeout);
                        if (this._isUnloading) return;
                        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (activeView && activeView.containerEl) {
                            const metadataContainer = activeView.containerEl.querySelector('.metadata-container');
                            if (metadataContainer && !metadataContainer.classList.contains('is-collapsed')) {
                                const heading = metadataContainer.querySelector('.metadata-properties-heading') as HTMLElement | null;
                                if (heading) heading.click();
                            }
                        }
                    }, 100);
                    this._timeouts.add(timeout);
                }
                if (this.settings.autoSourceEnabled) {
                    const targets = this.settings.targetFiles.split('\n').map(t => t.trim()).filter(t => t.length > 0);
                    const isTargetFile = targets.includes(file.basename) || targets.includes(file.name);
                    const cache = this.app.metadataCache.getFileCache(file);
                    const isFrontmatterTarget = cache?.frontmatter?.['obsidianEditingMode'] === 'source';
                    this.changeViewState(isTargetFile || isFrontmatterTarget);
                }
            })
        );

        this.registerEvent(this.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
            let isSettingsUpdated = false;
            const updatePathLogic = (oldObj: any, isFolderDict: boolean) => {
                const newObj: any = {};
                for (let [keyPath, value] of Object.entries(oldObj)) {
                    let newKeyPath = keyPath;
                    if (keyPath === oldPath) { newKeyPath = file.path; isSettingsUpdated = true; } 
                    else if (keyPath.startsWith(oldPath + "/")) { newKeyPath = file.path + keyPath.substring(oldPath.length); isSettingsUpdated = true; }

                    if (isFolderDict) newObj[newKeyPath] = value;
                    else {
                        newObj[newKeyPath] = (value as Shortcut[]).map(sc => {
                            if (sc.path === oldPath) { isSettingsUpdated = true; return { ...sc, path: file.path }; } 
                            else if (sc.path.startsWith(oldPath + "/")) { isSettingsUpdated = true; return { ...sc, path: file.path + sc.path.substring(oldPath.length) }; }
                            return sc;
                        });
                    }
                }
                return newObj;
            };
            this.settings.shortcuts = updatePathLogic(this.settings.shortcuts, false);
            this.settings.lockedFolders = updatePathLogic(this.settings.lockedFolders, true);
            this.settings.inlineShortcuts = updatePathLogic(this.settings.inlineShortcuts, false);

            if (isSettingsUpdated) { this.updateDynamicHiddenStyles(); this.debouncedSave(); }
            this.debouncedUpdate();
        }));

        this.registerEvent(this.app.vault.on('delete', (file: TAbstractFile) => {
            let isSettingsUpdated = false;
            if (this.settings.shortcuts[file.path]) { delete this.settings.shortcuts[file.path]; isSettingsUpdated = true; }
            if (this.settings.lockedFolders[file.path]) { delete this.settings.lockedFolders[file.path]; isSettingsUpdated = true; }
            if (this.settings.inlineShortcuts[file.path]) { delete this.settings.inlineShortcuts[file.path]; isSettingsUpdated = true; }

            const cleanMainKeys = (obj: Record<string, any>) => {
                for (const key in obj) { if (key.startsWith(file.path + "/")) { delete obj[key]; isSettingsUpdated = true; } }
            };
            cleanMainKeys(this.settings.shortcuts); cleanMainKeys(this.settings.lockedFolders); cleanMainKeys(this.settings.inlineShortcuts);

            const cleanTargets = (obj: Record<string, Shortcut[]>) => {
                for (const mainPath in obj) {
                    const originalLength = obj[mainPath].length;
                    obj[mainPath] = obj[mainPath].filter(sc => sc.path !== file.path && !sc.path.startsWith(file.path + "/"));
                    if (obj[mainPath].length !== originalLength) {
                        isSettingsUpdated = true;
                        if (obj[mainPath].length === 0) delete obj[mainPath];
                    }
                }
            };
            cleanTargets(this.settings.shortcuts); cleanTargets(this.settings.inlineShortcuts);

            if (isSettingsUpdated) { this.updateDynamicHiddenStyles(); this.debouncedSave(); } 
            else this.updateDynamicHiddenStyles(); 
            this.debouncedUpdate(); 
        }));

        this.addCommand({
            id: 'toggle-hidden-folders',
            name: '切换隐藏文件夹的显示状态',
            callback: () => {
                this.foldersHidden = !this.foldersHidden;
                this.updateAutoSourceStyles();
                new Notice(this.foldersHidden ? '文件夹已隐藏' : '文件夹已显示');
            }
        });
    }

    onunload() {
        // 修复 3：设置卸载标志，防止异步操作继续执行
        this._isUnloading = true;
        
        // 清理所有定时器
        this._timeouts.forEach(t => window.clearTimeout(t));
        this._timeouts.clear();
        
        // 修复：恢复原始样式表
        activeDocument.adoptedStyleSheets = this.originalSheets;
        this.hiddenSheet = null;
        this.autoSourceSheet = null;
        
        // 修复 4：清理所有事件监听器
        activeDocument.removeEventListener('click', this.shortcutClickHandler, true);
        activeDocument.removeEventListener('dblclick', this.shortcutClickHandler, true);
        activeDocument.removeEventListener('click', this.autoSourceClickHandler, true);
        
        // 清理MutationObserver
        this.domObservers.forEach(observer => observer.disconnect());
        this.domObservers.clear();
        
        // 清理DOM元素
        activeDocument.querySelectorAll('.folder-shortcut-container, .file-inline-shortcut-container').forEach(el => el.remove());
        activeDocument.querySelectorAll('.is-locked-folder').forEach(el => el.classList.remove('is-locked-folder'));
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        if (!this.settings.folderLimits) this.settings.folderLimits = [];
        if (!this.settings.lockedFolders) this.settings.lockedFolders = {};
        if (!this.settings.inlineShortcuts) this.settings.inlineShortcuts = {};
        if (!this.settings.shortcuts) this.settings.shortcuts = {};
    }

    async saveSettings() {
        const currentLimitPaths = new Set(this.settings.folderLimits.map(r => r.path.trim()));
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
        let cssRules = '';
        const hiddenPaths = new Set<string>();
        for (const shortcuts of Object.values(this.settings.inlineShortcuts)) {
            if (shortcuts && shortcuts.length > 0) shortcuts.forEach(sc => hiddenPaths.add(sc.path));
        }
        if (hiddenPaths.size === 0) { this.hiddenSheet.replaceSync(''); return; }

        hiddenPaths.forEach(path => {
            const safePath = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
            cssRules += `
                .nav-file-title[data-path="${safePath}"] { display: none !important; }
                .nav-file:has(> .nav-file-title[data-path="${safePath}"]) { display: none !important; height: 0 !important; margin: 0 !important; padding: 0 !important; border: none !important; }
            `;
        });
        this.hiddenSheet.replaceSync(cssRules);
    }

    escapeCssAttributeString(str: string): string { return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
    
    updateAutoSourceStyles() {
        if (!this.autoSourceSheet) return;
        let cssRules = '';
        const hiddenFolders = this.settings.hiddenFolders.split('\n').map(f => f.trim()).filter(f => f.length > 0);
        
        if (this.foldersHidden && hiddenFolders.length > 0) {
            hiddenFolders.forEach(path => {
                const safePath = this.escapeCssAttributeString(path);
                cssRules += `.nav-folder:has(> .nav-folder-title[data-path="${safePath}"]) { display: none !important; }\n`;
            });
        }

        if (this.settings.folderLimits && this.settings.folderLimits.length > 0) {
            this.settings.folderLimits.forEach(rule => {
                if (!rule.path || rule.limit === null || rule.limit === '') return;
                const safePath = this.escapeCssAttributeString(rule.path.trim());
                const limit = typeof rule.limit === 'string' ? parseInt(rule.limit) : rule.limit;
                if (isNaN(limit) || limit < 0) return;

                const isExpanded = this.expandedLimits.has(rule.path.trim());
                const iconVar = isExpanded ? 'var(--auto-source-icon-minus)' : 'var(--auto-source-icon-plus)';
                const direction = rule.direction || 'top';
                const nthSelector = direction === 'top' ? `nth-child` : `nth-last-child`;
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
                    cssRules += `.nav-folder:has(> .nav-folder-title[data-path="${safePath}"]) > .nav-folder-children > .nav-file:${nthSelector}(n+${limit + 1} of .nav-file) { display: none !important; }\n`;
                }
            });
        }
        this.autoSourceSheet.replaceSync(cssRules);
    }

    changeViewState(forceSource: boolean) {
        const timeout = window.setTimeout(() => {
            this._timeouts.delete(timeout);
            if (this._isUnloading) return;
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view) return;
            const leaf = view.leaf; const state = leaf.getViewState();
            if (state.type !== 'markdown') return;

            // 修复 5：使用更安全的方式访问配置
            const vault = this.app.vault as Record<string, unknown>;
            const getConfig = vault.getConfig as ((key: string) => unknown) | undefined;
            const defaultViewMode = (getConfig?.('defaultViewMode') as string) || 'source';
            const livePreview = getConfig?.('livePreview');
            
            let targetMode = forceSource ? 'source' : defaultViewMode;
            let targetSource = forceSource ? true : (livePreview === false);

            let changed = false;
            const mdState = state.state as Record<string, unknown>;
            if (mdState.mode !== targetMode) { mdState.mode = targetMode; changed = true; }
            if (mdState.source !== targetSource) { mdState.source = targetSource; changed = true; }
            if (changed) leaf.setViewState(state, { ephemeral: true });
        }, 50);
        this._timeouts.add(timeout);
    }

    forceToggleFolderNode(folderPath: string, expand: boolean) {
        const fileExplorers = this.app.workspace.getLeavesOfType('file-explorer');
        fileExplorers.forEach(leaf => {
            const titles = (leaf.view as ItemView).containerEl.querySelectorAll('.nav-folder-title') as NodeListOf<HTMLElement>;
            for (let i = 0; i < titles.length; i++) {
                if (titles[i].dataset.path === folderPath) {
                    const parent = titles[i].parentElement;
                    if (expand) {
                        titles[i].classList.remove('is-locked-folder');
                        if (parent && parent.classList.contains('is-collapsed')) titles[i].click();
                    } else {
                        if (parent && !parent.classList.contains('is-collapsed')) titles[i].click();
                    }
                    break;
                }
            }
        });
    }

    getSmartIconData(path: string): { icon: string, color: string } {
        let icon = 'file'; let color = '';
        const file = this.app.vault.getAbstractFileByPath(path);
        if (file instanceof TFile) {
            const cache = this.app.metadataCache.getFileCache(file);
            if (cache?.frontmatter) {
                if (cache.frontmatter.icon) icon = cache.frontmatter.icon;
                if (cache.frontmatter.iconColor) color = cache.frontmatter.iconColor;
            }
        }
        const iconize = (this.app as any).plugins.getPlugin('obsidian-icon-folder');
        if (iconize?.data?.[path]) {
            const data = iconize.data[path];
            if (typeof data === 'string') icon = data;
            else if (typeof data === 'object') {
                if (data.iconName) icon = data.iconName;
                if (data.iconColor) color = data.iconColor;
            }
        }
        return { icon, color };
    }

    renderIconSafe(el: HTMLElement, iconName: string, isInline: boolean = false) {
        el.empty(); if (!iconName) iconName = 'file';
        let hasRendered = false;
        try {
            const app = this.app as Record<string, unknown>;
            const plugins = app.plugins as { getPlugin: (id: string) => Record<string, unknown> | null } | undefined;
            const iconize = plugins?.getPlugin('obsidian-icon-folder');
            if (iconize?.api) {
                const api = iconize.api as { getIconByName: (name: string) => { svgElement?: string } | null };
                const iconObj = api.getIconByName(iconName);
                if (iconObj?.svgElement) {
                    // 修复：使用 DOMParser 替代 innerHTML
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(iconObj.svgElement, 'image/svg+xml');
                    const svg = doc.querySelector('svg');
                    if (svg) {
                        svg.style.width = isInline ? '14px' : '16px';
                        svg.style.height = isInline ? '14px' : '16px';
                        el.appendChild(document.adoptNode(svg));
                        hasRendered = true;
                    }
                }
            }
        } catch (_e) { /* iconize plugin not available */ }

        if (!hasRendered) {
            setIcon(el, iconName);
            if (el.children.length === 0 && iconName.startsWith('lucide-')) setIcon(el, iconName.replace('lucide-', ''));
            if (el.children.length === 0 && iconName.startsWith('Li')) setIcon(el, iconName.substring(2).replace(/([A-Z])/g, '-$1').toLowerCase().substring(1));
            if (el.children.length === 0) setIcon(el, 'file');
        }
    }

    updateAllFolders() {
        const fileExplorers = this.app.workspace.getLeavesOfType('file-explorer');
        if (fileExplorers.length === 0) return;
        const activeFolderPaths = new Set<string>();
        for (const [folderPath, shortcuts] of Object.entries(this.settings.shortcuts)) { if (shortcuts && shortcuts.length > 0) activeFolderPaths.add(folderPath); }
        for (const folderPath of Object.keys(this.settings.lockedFolders)) activeFolderPaths.add(folderPath);

        fileExplorers.forEach(leaf => {
            const containerEl = (leaf.view as ItemView).containerEl;
            containerEl.querySelectorAll('.folder-shortcut-container').forEach(container => {
                const path = (container as HTMLElement).dataset.fsPath;
                if (path && (!this.settings.shortcuts[path] || this.settings.shortcuts[path].length === 0)) container.remove();
            });
            containerEl.querySelectorAll('.is-locked-folder').forEach(title => {
                const path = (title as HTMLElement).dataset.path;
                if (path && !this.settings.lockedFolders[path]) title.classList.remove('is-locked-folder');
            });

            const folderNodesMap = new Map<string, HTMLElement>();
            const titleNodes = containerEl.querySelectorAll('.nav-folder-title') as NodeListOf<HTMLElement>;
            for (let i = 0; i < titleNodes.length; i++) { const path = titleNodes[i].dataset.path; if (path) folderNodesMap.set(path, titleNodes[i]); }

            activeFolderPaths.forEach(folderPath => {
                const titleEl = folderNodesMap.get(folderPath); if (!titleEl) return;
                if (this.settings.lockedFolders[folderPath]) titleEl.classList.add('is-locked-folder');

                const shortcuts = this.settings.shortcuts[folderPath]; if (!shortcuts || shortcuts.length === 0) return;
                const existingContainer = titleEl.querySelector('.folder-shortcut-container') as HTMLElement;
                const stateToTrack = shortcuts.map(sc => ({ ...sc, isBroken: !this.app.vault.getAbstractFileByPath(sc.path) }));
                const currentStateStr = JSON.stringify(stateToTrack);

                if (existingContainer && existingContainer.dataset.fsState === currentStateStr && existingContainer.dataset.fsPath === folderPath) return;
                if (existingContainer) existingContainer.remove();

                const container = activeDocument.createElement('div');
                container.className = 'folder-shortcut-container'; container.dataset.fsState = currentStateStr; container.dataset.fsPath = folderPath;

                shortcuts.forEach(sc => {
                    const iconEl = activeDocument.createElement('div'); iconEl.className = 'folder-shortcut-icon'; iconEl.tabIndex = 0;
                    const targetFile = this.app.vault.getAbstractFileByPath(sc.path);
                    const isBroken = !targetFile || !targetFile.path.startsWith(folderPath + "/");

                    if (isBroken) {
                        iconEl.classList.add('is-broken'); iconEl.setAttribute('aria-label', !targetFile ? "文件已删除" : "文件已移出");
                        this.renderIconSafe(iconEl, "alert-circle", false);
                    } else {
                        iconEl.style.color = sc.color || "var(--text-muted)";
                        iconEl.setAttribute('aria-label', targetFile.name);
                        this.renderIconSafe(iconEl, sc.icon || "file", false);
                    }

                    const openFile = async (e: MouseEvent | KeyboardEvent) => {
                        e.preventDefault(); e.stopPropagation();
                        if (targetFile instanceof TFile) {
                            const isMiddleClick = e.type === 'auxclick' && (e as MouseEvent).button === 1;
                            const openInNewTab = isMiddleClick || e.ctrlKey || e.metaKey;
                            if (!openInNewTab && this.app.workspace.getActiveFile()?.path === targetFile.path) return;
                            await this.app.workspace.getLeaf(openInNewTab ? 'tab' : false).openFile(targetFile);
                        } else new Notice("无法打开：文件不存在或已被移动！");
                    };
                    iconEl.addEventListener('click', openFile); iconEl.addEventListener('auxclick', openFile);
                    iconEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') openFile(e); });
                    container.appendChild(iconEl);
                });
                titleEl.appendChild(container);
            });
        });
    }

    updateAllFiles() {
        const fileExplorers = this.app.workspace.getLeavesOfType('file-explorer');
        if (fileExplorers.length === 0) return;

        fileExplorers.forEach(leaf => {
            const containerEl = (leaf.view as ItemView).containerEl;
            containerEl.querySelectorAll('.file-inline-shortcut-container').forEach(container => {
                const path = (container as HTMLElement).dataset.fsPath;
                if (path && (!this.settings.inlineShortcuts[path] || this.settings.inlineShortcuts[path].length === 0)) container.remove();
            });

            for (const [mainFilePath, shortcuts] of Object.entries(this.settings.inlineShortcuts)) {
                if (!shortcuts || shortcuts.length === 0) continue;
                const titleNode = containerEl.querySelector(`.nav-file-title[data-path="${CSS.escape(mainFilePath)}"]`); if (!titleNode) continue;

                const currentStateStr = JSON.stringify(shortcuts.map(sc => ({ ...sc, isBroken: !this.app.vault.getAbstractFileByPath(sc.path) })));
                const existingContainer = titleNode.querySelector('.file-inline-shortcut-container') as HTMLElement;
                if (existingContainer && existingContainer.dataset.fsState === currentStateStr) continue;
                if (existingContainer) existingContainer.remove();

                const container = activeDocument.createElement('div'); container.className = 'file-inline-shortcut-container';
                container.dataset.fsState = currentStateStr; container.dataset.fsPath = mainFilePath;

                shortcuts.forEach(sc => {
                    const iconEl = activeDocument.createElement('div'); iconEl.className = 'file-inline-shortcut-icon';
                    const targetFile = this.app.vault.getAbstractFileByPath(sc.path);
                    const isBroken = !targetFile;

                    if (isBroken) {
                        iconEl.classList.add('is-broken'); iconEl.setAttribute('aria-label', "附属文件已丢失");
                        this.renderIconSafe(iconEl, "alert-circle", true);
                    } else {
                        iconEl.style.color = sc.color || "var(--text-muted)";
                        iconEl.setAttribute('aria-label', `打开: ${targetFile.name}`);
                        this.renderIconSafe(iconEl, sc.icon || "file", true);
                    }

                    const openFile = async (e: MouseEvent) => {
                        e.preventDefault(); e.stopPropagation();
                        if (targetFile instanceof TFile) {
                            const isMiddleClick = e.type === 'auxclick' && e.button === 1;
                            const openInNewTab = isMiddleClick || e.ctrlKey || e.metaKey;
                            await this.app.workspace.getLeaf(openInNewTab ? 'tab' : false).openFile(targetFile);
                        } else new Notice("无法打开：附属文件不存在！");
                    };
                    iconEl.addEventListener('click', openFile); iconEl.addEventListener('auxclick', openFile);
                    container.appendChild(iconEl);
                });
                const titleContent = titleNode.querySelector('.nav-file-title-content');
                if (titleContent && titleContent.nextSibling) titleNode.insertBefore(container, titleContent.nextSibling);
                else titleNode.appendChild(container);
            }
        });
    }

    registerObservers() {
        const fileExplorerLeaves = this.app.workspace.getLeavesOfType('file-explorer');
        // 修复 2：绕过 WorkspaceLeaf 缺少 id 的类型校验
        const currentLeafIds = new Set(fileExplorerLeaves.map(leaf => (leaf as any).id));
        for (const leafId of this.domObservers.keys()) {
            if (!currentLeafIds.has(leafId)) { this.domObservers.get(leafId)?.disconnect(); this.domObservers.delete(leafId); }
        }

        fileExplorerLeaves.forEach(leaf => {
            const containerEl = (leaf.view as ItemView).containerEl;
            const leafId = (leaf as any).id;
            if (!this.domObservers.has(leafId)) {
                const uiObserver = new MutationObserver((mutations) => {
                    // 修复 6：添加插件卸载状态检查
                    if (this._isUnloading) return;
                    let shouldUpdate = false;
                    for (let i = 0; i < mutations.length; i++) {
                        const m = mutations[i];
                        if (m.type === 'childList') {
                            for (let j = 0; j < m.addedNodes.length; j++) {
                                const node = m.addedNodes[j] as HTMLElement;
                                if (node.nodeType === Node.ELEMENT_NODE) {
                                    if (node.classList && (node.classList.contains('folder-shortcut-container') || node.classList.contains('file-inline-shortcut-container'))) continue;
                                    if (node.classList && (node.classList.contains('nav-folder') || node.classList.contains('nav-file'))) { shouldUpdate = true; break; }
                                    if (node.querySelector && node.querySelector('.nav-folder-title')) { shouldUpdate = true; break; }
                                }
                            }
                        } else if (m.type === 'attributes' && m.attributeName === 'class') {
                            const target = m.target as HTMLElement;
                            // 【性能优化】：移除 nav-file 监听，避免点击文件高亮时触发全盘重新渲染
                            if (target?.classList?.contains('nav-folder')) { shouldUpdate = true; break; }
                        }
                        if (shouldUpdate) break;
                    }
                    if (shouldUpdate) this.debouncedUpdate();
                });
                uiObserver.observe(containerEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
                this.domObservers.set(leafId, uiObserver);
            }
        });
    }
}

// ==========================================
// 4. Modal 共享接口与实现
// ==========================================
interface IShortcutSettingModal {
    contentEl: HTMLElement; plugin: UltimateExplorerPlugin; currentShortcuts: Shortcut[];
    autoSave(): Promise<void>; display(): void; app: App; modalType: 'folder' | 'file';
}

class FolderShortcutSettingModal extends Modal implements IShortcutSettingModal {
    plugin: UltimateExplorerPlugin; folder: TFolder; folderPath: string;
    currentShortcuts: Shortcut[]; modalType: 'folder' | 'file' = 'folder';

    constructor(app: App, plugin: UltimateExplorerPlugin, folder: TFolder) {
        super(app); this.plugin = plugin; this.folder = folder; this.folderPath = folder.path;
        let savedShortcuts = this.plugin.settings.shortcuts[this.folderPath];
        this.currentShortcuts = Array.isArray(savedShortcuts) ? JSON.parse(JSON.stringify(savedShortcuts)) : [];
        this.setTitle(`文件夹快捷图标: ${this.folder.name}`);
    }
    onOpen() { this.display(); }
    async autoSave() {
        if (this.currentShortcuts.length === 0) delete this.plugin.settings.shortcuts[this.folderPath];
        else this.plugin.settings.shortcuts[this.folderPath] = this.currentShortcuts;
        await this.plugin.saveSettings();
    }
    getAvailableFiles(): TFile[] {
        const mountedPaths = new Set<string>(); this.currentShortcuts.forEach(sc => mountedPaths.add(sc.path));
        return this.app.vault.getFiles().filter(f => f.path.startsWith(this.folderPath + '/') && !mountedPaths.has(f.path));
    }
    display() { renderSettingModal(this, this.getAvailableFiles(), '+ 添加文件夹内部快捷文件'); }
}

class FileShortcutSettingModal extends Modal implements IShortcutSettingModal {
    plugin: UltimateExplorerPlugin; file: TFile; filePath: string;
    currentShortcuts: Shortcut[]; modalType: 'folder' | 'file' = 'file';

    constructor(app: App, plugin: UltimateExplorerPlugin, file: TFile) {
        super(app); this.plugin = plugin; this.file = file; this.filePath = file.path;
        let savedShortcuts = this.plugin.settings.inlineShortcuts[this.filePath];
        this.currentShortcuts = Array.isArray(savedShortcuts) ? JSON.parse(JSON.stringify(savedShortcuts)) : [];
        this.setTitle(`为主文件添加附属: ${this.file.name}`);
    }
    onOpen() { this.display(); }
    async autoSave() {
        if (this.currentShortcuts.length === 0) delete this.plugin.settings.inlineShortcuts[this.filePath];
        else this.plugin.settings.inlineShortcuts[this.filePath] = this.currentShortcuts;
        await this.plugin.saveSettings();
    }
    getAvailableFiles(): TFile[] {
        const mountedPaths = new Set<string>();
        for (const shortcuts of Object.values(this.plugin.settings.inlineShortcuts)) { if (shortcuts) shortcuts.forEach(sc => mountedPaths.add(sc.path)); }
        this.currentShortcuts.forEach(sc => mountedPaths.add(sc.path));
        return this.app.vault.getFiles().filter(f => f.parent?.path === this.file.parent?.path && f.path !== this.filePath && !mountedPaths.has(f.path));
    }
    display() { renderSettingModal(this, this.getAvailableFiles(), '+ 挂载同级目录下的附属文件'); }
}

function renderSettingModal(modalInstance: IShortcutSettingModal, cachedFiles: TFile[], addBtnText: string) {
    const { contentEl, plugin, currentShortcuts, modalType } = modalInstance;
    contentEl.empty();
    const isFileModal = modalType === 'file';
    const descText = isFileModal ? '选择的附属文件将在左侧列表中隐藏，并紧贴在当前主文件名后。' : '按住列表即可上下拖拽排序。任何修改自动保存。';
    
    // 修复 3：使用 CSS 类替代静态样式赋值
    const pEl = contentEl.createEl('p', { text: descText, cls: 'setting-item-description setting-item-description-spaced' });

    const listContainer = contentEl.createDiv('fs-shortcut-list');
    currentShortcuts.forEach((sc, index) => {
        const itemEl = listContainer.createDiv({ cls: 'fs-shortcut-item', attr: { 'draggable': 'true' } });
        const currentFile = cachedFiles.find(f => f.path === sc.path) || plugin.app.vault.getAbstractFileByPath(sc.path);

        const selectBtn = itemEl.createDiv({ cls: 'fs-file-select-btn' });
        selectBtn.createEl('span', { text: currentFile ? currentFile.name : "文件已丢失(点击重选)" });

        const iconBtn = itemEl.createDiv('fs-icon-btn');
        // 修复：使用 setProperty 替代直接赋值
        iconBtn.style.setProperty('color', sc.color || 'var(--text-normal)');
        plugin.renderIconSafe(iconBtn, sc.icon, isFileModal);

        selectBtn.onclick = () => {
            if (cachedFiles.length === 0) { new Notice("目录下没有更多可供挂载的文件了！"); return; }
            new FilePickerModal(plugin.app, cachedFiles, async (selectedFile: TFile) => {
                sc.path = selectedFile.path; const smartData = plugin.getSmartIconData(sc.path);
                sc.icon = smartData.icon; if (smartData.color) sc.color = smartData.color; else delete sc.color;
                await modalInstance.autoSave(); modalInstance.display();
            }).open();
        };

        iconBtn.onclick = () => {
            new IconPickerModal(plugin.app, async (selectedIcon: string) => {
                sc.icon = selectedIcon; plugin.renderIconSafe(iconBtn, sc.icon, isFileModal); await modalInstance.autoSave();
            }).open();
        };

        const colorInput = itemEl.createEl('input', { cls: 'fs-color-picker', attr: { type: 'color', value: sc.color || '#808080' } });
        colorInput.addEventListener('change', async (e: Event) => { sc.color = (e.target as HTMLInputElement).value; await modalInstance.autoSave(); });

        const resetBtn = itemEl.createEl('button', { cls: 'fs-btn-action fs-btn-reset-color', attr: { 'aria-label': '重置为文件默认图标和颜色' } });
        setIcon(resetBtn, 'rotate-ccw');
        resetBtn.onclick = async () => {
            if (!currentFile) { new Notice("无法重置：文件已丢失", 2000); return; }
            const smartData = plugin.getSmartIconData(sc.path); sc.icon = smartData.icon;
            if (smartData.color) sc.color = smartData.color; else delete sc.color;
            new Notice(`已重置为最新图标和颜色`); await modalInstance.autoSave(); modalInstance.display();
        };

        const delBtn = itemEl.createEl('button', { cls: 'fs-btn-action fs-btn-delete' });
        setIcon(delBtn, 'trash-2');
        delBtn.onclick = async () => { currentShortcuts.splice(index, 1); await modalInstance.autoSave(); modalInstance.display(); };

        itemEl.ondragstart = (e: DragEvent) => { if(e.dataTransfer) e.dataTransfer.setData('text/plain', index.toString()); itemEl.classList.add('is-dragging'); };
        itemEl.ondragover = (e: DragEvent) => { e.preventDefault(); itemEl.classList.add('drag-over'); };
        itemEl.ondragleave = () => itemEl.classList.remove('drag-over');
        itemEl.ondrop = async (e: DragEvent) => {
            e.preventDefault(); itemEl.classList.remove('drag-over');
            if(!e.dataTransfer) return;
            const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
            if (dragIndex !== index && !isNaN(dragIndex)) {
                const [draggedItem] = currentShortcuts.splice(dragIndex, 1);
                currentShortcuts.splice(index, 0, draggedItem);
                await modalInstance.autoSave(); modalInstance.display();
            }
        };
        itemEl.ondragend = () => activeDocument.querySelectorAll('.fs-shortcut-item').forEach(el => el.classList.remove('drag-over', 'is-dragging'));
    });

    const btnContainer = contentEl.createDiv({ cls: 'setting-btn-container' });
    const addBtn = btnContainer.createEl('button', { text: addBtnText });
    addBtn.onclick = () => {
        if (cachedFiles.length === 0) return new Notice("目录下没有符合条件(且未被挂载)的文件！");
        new FilePickerModal(plugin.app, cachedFiles, async (selectedFile: TFile) => {
            const smartData = plugin.getSmartIconData(selectedFile.path);
            currentShortcuts.push({ path: selectedFile.path, icon: smartData.icon, color: smartData.color || '' });
            await modalInstance.autoSave(); modalInstance.display();
        }).open();
    };
}

// ==========================================
// 5. 设置面板 UI
// ==========================================
class CombinedSettingTab extends PluginSettingTab {
    plugin: UltimateExplorerPlugin;

    constructor(app: App, plugin: UltimateExplorerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        

        new Setting(containerEl).setName('自动源码模式与隐藏文件夹设置').setHeading();

        new Setting(containerEl)
            .setName('启用自动源码模式')
            .setDesc('关闭此开关后，打开特定文件时不再自动切换到源码模式。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSourceEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.autoSourceEnabled = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('需要开启源码模式的文件名').addTextArea(text => {
            text.inputEl.rows = 5; text.inputEl.addClass('setting-textarea-full');
            text.setValue(this.plugin.settings.targetFiles).onChange(async (v) => { this.plugin.settings.targetFiles = v; await this.plugin.saveSettings(); });
        });

        new Setting(containerEl)
            .setName('自动收起笔记属性面板')
            .setDesc('开启后，每次打开 Markdown 文件时会自动折叠顶部的笔记属性 (Properties) 区域。')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoCollapseProperties)
                .onChange(async (value) => {
                    this.plugin.settings.autoCollapseProperties = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('隐藏文件夹设置').setHeading();

        new Setting(containerEl)
            .setName('完全隐藏的文件夹')
            .setDesc('手动输入路径，或点击右侧"浏览"按钮搜索添加（每行一个）。')
            .addTextArea(text => {
                text.inputEl.rows = 5; text.inputEl.addClass('setting-textarea-full');
                text.setValue(this.plugin.settings.hiddenFolders).onChange(async (v) => {
                    this.plugin.settings.hiddenFolders = v;
                    await this.plugin.saveSettings();
                });
            })
            .addButton(btn => btn
                .setButtonText('🔍 浏览...')
                .setTooltip('在仓库中搜索并选择文件夹')
                .onClick(() => {
                    new FolderSuggestModal(this.app, async (folderPath: string) => {
                        let currentVal = this.plugin.settings.hiddenFolders.trim();
                        let newVal = currentVal ? currentVal + '\n' + folderPath : folderPath;
                        this.plugin.settings.hiddenFolders = newVal + '\n';
                        await this.plugin.saveSettings();
                        this.display(); 
                    }).open();
                })
            );

        new Setting(containerEl).setName('文件夹文件显示个数限制').setHeading();
        containerEl.createEl('p', { text: '只显示前（或后）N 个文件。超出的部分将在边缘文件右侧显示折叠按钮。', cls: 'setting-item-description' });

        const limitsContainer = containerEl.createDiv();

        const renderLimits = () => {
            limitsContainer.empty();
            this.plugin.settings.folderLimits.forEach((rule, index) => {
                const row = limitsContainer.createDiv({ cls: 'auto-source-setting-row' });

                const pathInput = new TextComponent(row).setPlaceholder('文件夹路径').setValue(rule.path);
                pathInput.inputEl.classList.add('auto-source-flex-2');

                // 修复 4：使用 CSS 类替代静态样式赋值
                const statusIcon = row.createDiv({ cls: 'status-icon-container' });

                const validatePath = (pathVal: string) => {
                    statusIcon.empty();
                    statusIcon.removeClass('status-icon-success', 'status-icon-error');
                    const cleanPath = pathVal.trim(); if (!cleanPath) return;
                    const folder = this.plugin.app.vault.getAbstractFileByPath(cleanPath);
                    if (folder instanceof TFolder) {
                        setIcon(statusIcon, 'check-circle');
                        statusIcon.addClass('status-icon-success');
                        statusIcon.setAttribute('aria-label', '验证通过：文件夹存在');
                    } else {
                        setIcon(statusIcon, 'alert-circle');
                        statusIcon.addClass('status-icon-error');
                        statusIcon.setAttribute('aria-label', '未找到该文件夹，请检查路径拼写');
                    }
                };
                validatePath(rule.path);
                pathInput.onChange(async (v) => { rule.path = v; validatePath(v); await this.plugin.saveSettings(); });

                new ButtonComponent(row).setIcon('search').setTooltip('搜索文件夹')
                    .onClick(() => {
                        new FolderSuggestModal(this.app, async (folderPath: string) => {
                            rule.path = folderPath; await this.plugin.saveSettings(); renderLimits();
                        }).open();
                    });

                const currentDir = rule.direction || 'top';
                const dirIcon = currentDir === 'bottom' ? 'arrow-up' : 'arrow-down';
                const dirTooltip = currentDir === 'bottom' ? '当前：保留【后】N个 (点击切换)' : '当前：保留【前】N个 (点击切换)';

                new ButtonComponent(row).setIcon(dirIcon).setTooltip(dirTooltip)
                    .onClick(async () => { rule.direction = currentDir === 'top' ? 'bottom' : 'top'; await this.plugin.saveSettings(); renderLimits(); });

                const limitInput = new TextComponent(row).setPlaceholder('个数')
                    .setValue(rule.limit !== null ? rule.limit.toString() : '')
                    .onChange(async (v) => { rule.limit = v; await this.plugin.saveSettings(); });
                limitInput.inputEl.type = 'number'; limitInput.inputEl.min = '0';
                limitInput.inputEl.classList.add('auto-source-flex-1');

                new ButtonComponent(row).setIcon('trash').setTooltip('删除')
                    .onClick(async () => { this.plugin.settings.folderLimits.splice(index, 1); await this.plugin.saveSettings(); renderLimits(); });
            });
        };
        renderLimits();

        new Setting(containerEl).addButton(btn => btn
            .setButtonText('添加文件显示个数').setCta()
            .onClick(async () => {
                this.plugin.settings.folderLimits.push({ path: '', limit: 5, direction: 'top' });
                await this.plugin.saveSettings();
                renderLimits();
            })
        );
    }
}