const { CompositeDisposable, Disposable } = require("lumine");
const { Liquid } = require("liquidjs");
const path = require("path");

const templateEngine = new Liquid({ jsTruthy: true });
const presetTemplates = Object.freeze({
  Project: "{% if projectTitle %}{{ projectTitle }}{% else %}{{ projectName }}{% endif %}",
  File: "{{ fileName }}",
  "Project and File":
    "{% if projectTitle %}{{ projectTitle }}{% else %}{{ projectName }}{% endif %}{% if fileName %} — {{ fileName }}{% endif %}",
  "Full Path": "{{ filePath }}",
});

module.exports = {
  activeItem() {
    return lumine.workspace.getCenter().getActiveTiledPane()?.getActiveItem() ?? null;
  },

  activate() {
    this.active = true;
    this.templateSelection = "";
    this.customTemplate = "";
    this.template = "";
    this.parsedTemplate = null;
    this.projectList = null;
    this.indexRequested = false;

    this.disposables = new CompositeDisposable(
      lumine.config.observe("window-title.template", (value) => {
        this.templateSelection = value || "";
        this.updateTemplate();
      }),
      lumine.config.observe("window-title.custom", (value) => {
        this.customTemplate = value || "";
        this.updateTemplate();
      }),
      lumine.project.onDidChangePaths(() => {
        this.subscribeToRepository();
        this.updateTitle();
      }),
      lumine.workspace.onDidChangeActivePaneItem(() => this.subscribeToActiveItem()),
    );
    this.subscribeToActiveItem();
    this.subscribeToRepository();
  },

  updateTemplate() {
    this.template =
      presetTemplates[this.templateSelection] ||
      (this.templateSelection === "Custom" ? this.customTemplate : this.templateSelection);
    this.parsedTemplate = null;
    if (this.template.trim()) {
      try {
        this.parsedTemplate = templateEngine.parse(this.template);
      } catch (error) {
        lumine.notifications.addWarning("window-title: invalid template", {
          detail: error.message || String(error),
        });
      }
    }
    this.requestProjectListIndex();
    this.updateTitle();
  },

  deactivate() {
    this.active = false;
    this.disposables.dispose();
    this.activeItemSubscription?.dispose();
    this.activeItemSubscription = null;
    this.repositorySubscription?.dispose();
    this.repositorySubscription = null;
    this.setDefaultTitle();
  },

  // Resolve the repository whose branch the title reflects, mirroring the
  // lookup in variables().
  currentRepository() {
    const activeItem = this.activeItem();
    const itemPath =
      activeItem && typeof activeItem.getPath === "function" ? activeItem.getPath() : null;
    const projectPath = lumine.project.getPaths()[0];
    return (
      lumine.repositories.getForPath(itemPath) ||
      lumine.repositories.getForPath(projectPath) ||
      lumine.repositories.getRepositories()[0] ||
      null
    );
  },

  // The short head is read synchronously from the repository's status snapshot,
  // which loads lazily on its first subscriber. Subscribe here so the branch in
  // the title appears once the snapshot loads and updates when it changes.
  subscribeToRepository() {
    this.repositorySubscription?.dispose();
    this.repositorySubscription = null;

    const repository = this.currentRepository();
    if (repository && typeof repository.onDidChangeStatusSnapshot === "function") {
      this.repositorySubscription = repository.onDidChangeStatusSnapshot(() => this.updateTitle());
    }
  },

  consumeProjectList(projectList) {
    this.projectList = projectList;
    const subscription = projectList.onDidChangeCurrentProject(() => {
      this.updateTitle();
    });
    this.requestProjectListIndex();
    this.updateTitle();
    return new Disposable(() => {
      subscription.dispose();
      this.projectList = null;
      this.indexRequested = false;
      this.updateTitle();
    });
  },

  subscribeToActiveItem() {
    this.activeItemSubscription?.dispose();
    this.activeItemSubscription = null;

    const activeItem = this.activeItem();
    if (activeItem && typeof activeItem.onDidChangeTitle === "function") {
      this.activeItemSubscription = activeItem.onDidChangeTitle(() => this.updateTitle());
    }

    this.subscribeToRepository();
    this.updateTitle();
  },

  updateTitle() {
    if (!this.active) {
      this.setDefaultTitle();
      return;
    }
    document.title = this.render() || "Lumine";
    lumine.applicationDelegate?.setRepresentedFilename?.(this.representedFilename());
  },

  setDefaultTitle() {
    document.title = "Lumine";
    lumine.applicationDelegate?.setRepresentedFilename?.("");
  },

  representedFilename() {
    const activeItem = this.activeItem();
    const itemPath = activeItem?.getPath?.();
    return itemPath || lumine.project.getPaths()[0] || "";
  },

  // the project list indexes lazily; trigger it only when the template needs it
  requestProjectListIndex() {
    if (this.indexRequested || !this.projectList) {
      return;
    }
    if (this.template.includes("projectTitle")) {
      this.indexRequested = true;
      this.projectList.updateView();
    }
  },

  render() {
    if (!this.parsedTemplate) {
      return null;
    }
    let title;
    try {
      title = templateEngine.renderSync(this.parsedTemplate, this.variables());
    } catch {
      // a template that fails at render time falls back to the application title
      return null;
    }
    title = title
      .replace(/\[\s*\]|\(\s*\)/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s\-–—|:·]+|[\s\-–—|:·]+$/g, "");
    return title || null;
  },

  variables() {
    const activeItem = this.activeItem();
    const itemPath =
      activeItem && typeof activeItem.getPath === "function" ? activeItem.getPath() : null;
    const itemTitle =
      activeItem && typeof activeItem.getTitle === "function" ? activeItem.getTitle() : "";
    const projectPaths = lumine.project.getPaths();
    const projectPath = projectPaths[0];
    const repository = this.currentRepository();
    const currentProject = this.projectList ? this.projectList.getCurrentProject() : null;
    const relativeFilePath = itemPath ? lumine.project.relativizePath(itemPath)[1] : null;
    return {
      projectTitle: currentProject ? currentProject.title : "",
      projectPaths: projectPaths.join(", "),
      projectCount: projectPaths.length,
      projectName: projectPath ? path.basename(projectPath) : "",
      projectPath: projectPath || "",
      fileName: itemPath ? path.basename(itemPath) : itemTitle || "",
      filePath: itemPath || "",
      relativeFilePath: relativeFilePath || "",
      gitHead:
        repository && typeof repository.getShortHead === "function"
          ? repository.getShortHead() || ""
          : "",
      appName: lumine.application.getName(),
      devMode: lumine.window.isDevMode(),
      safeMode: lumine.window.isSafeMode(),
    };
  },
};
