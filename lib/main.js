const { CompositeDisposable, Disposable } = require("lumine");
const path = require("path");

let templateEngine = null;
const getTemplateEngine = () => {
  if (!templateEngine) {
    const { Liquid } = require("liquidjs");
    templateEngine = new Liquid({ jsTruthy: true });
  }
  return templateEngine;
};

const presetTemplates = Object.freeze({
  Project: "{% if projectTitle %}{{ projectTitle }}{% else %}{{ projectName }}{% endif %}",
  File: "{{ fileName }}",
  "Project and File":
    "{% if projectTitle %}{{ projectTitle }}{% else %}{{ projectName }}{% endif %}{% if fileName %} — {{ fileName }}{% endif %}",
  "Full Path": "{{ filePath }}",
});
const presetRenderers = Object.freeze({
  Project: ({ projectTitle, projectName }) => projectTitle || projectName,
  File: ({ fileName }) => fileName,
  "Project and File": ({ projectTitle, projectName, fileName }) =>
    [projectTitle || projectName, fileName].filter(Boolean).join(" — "),
  "Full Path": ({ filePath }) => filePath,
});

module.exports = {
  activate() {
    const generation = (this.activationGeneration || 0) + 1;
    this.activationGeneration = generation;
    this.active = true;
    this.initialized = false;
    this.templateSelection = lumine.config.get("window-title.template") || "";
    this.customTemplate = lumine.config.get("window-title.custom") || "";
    this.template = "";
    this.parsedTemplate = null;
    this.presetRenderer = null;
    this.projectList = null;
    this.indexRequested = false;
    this.projectListProviders = new Map();
    this.currentProjectListRecord = null;

    this.disposables = new CompositeDisposable(
      lumine.config.onDidChange("window-title.template", ({ newValue }) => {
        this.templateSelection = newValue || "";
        if (this.initialized) this.updateTemplate();
      }),
      lumine.config.onDidChange("window-title.custom", ({ newValue }) => {
        this.customTemplate = newValue || "";
        if (this.initialized) this.updateTemplate();
      }),
      lumine.project.onDidChangePaths(() => {
        if (!this.initialized) return;
        this.subscribeToRepository();
        this.updateTitle();
      }),
      lumine.workspace.onDidChangeActivePaneItem(() => {
        if (this.initialized) this.subscribeToActiveItem();
      }),
      lumine.workspace.onDidChangePaneItemURI?.(({ item }) => {
        if (this.initialized && item === lumine.workspace.getActivePaneItem()) {
          this.subscribeToActiveItem();
        }
      }) ?? new Disposable(),
    );

    // Parsing Liquid pulls in its tokenizer and parser. The listeners above are
    // the synchronous bootstrap contract; compile and render the initial title
    // after the activation batch, with a generation guard for reloads.
    queueMicrotask(() => {
      if (!this.active || this.activationGeneration !== generation) return;
      this.initialized = true;
      this.subscribeToActiveItem(false);
      this.updateTemplate();
    });
  },

  updateTemplate() {
    this.template =
      presetTemplates[this.templateSelection] ||
      (this.templateSelection === "Custom" ? this.customTemplate : this.templateSelection);
    this.presetRenderer = presetRenderers[this.templateSelection] || null;
    this.parsedTemplate = null;
    if (!this.presetRenderer && this.template.trim()) {
      try {
        this.parsedTemplate = getTemplateEngine().parse(this.template);
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
    this.activationGeneration = (this.activationGeneration || 0) + 1;
    this.active = false;
    this.initialized = false;
    const providers = [...this.projectListProviders.values()];
    this.projectListProviders.clear();
    this.currentProjectListRecord = null;
    this.projectList = null;
    this.indexRequested = false;
    for (const record of providers) record.subscription?.dispose();
    this.disposables.dispose();
    this.activeItemSubscription?.dispose();
    this.activeItemSubscription = null;
    this.repositorySubscription?.dispose();
    this.repositorySubscription = null;
    this.repositoryObservation?.dispose();
    this.repositoryObservation = null;
    this.repository = null;
    this.setDefaultTitle();
  },

  // Resolve the repository whose branch the title reflects, mirroring the
  // lookup in variables().
  currentRepository() {
    return this.repository ?? null;
  },

  // The short head is read synchronously from the repository's status snapshot,
  // which loads lazily on its first subscriber. Subscribe here so the branch in
  // the title appears once the snapshot loads and updates when it changes.
  subscribeToRepository() {
    this.repositorySubscription?.dispose();
    this.repositorySubscription = null;
    this.repositoryObservation?.dispose();
    this.repository = null;
    this.repositoryObservation = lumine.repositories.observeForPath(
      () =>
        lumine.workspace.getActivePaneItem()?.getPath?.() || lumine.project.getPaths()[0] || null,
      (repository, { error }) => {
        if (repository !== this.repository) {
          this.repositorySubscription?.dispose();
          this.repository = repository;
          this.repositorySubscription =
            repository?.onDidChangeStatusSnapshot(() => this.updateTitle()) ?? null;
        }
        if (error) console.error("Unable to load window title Git status", error);
        this.updateTitle();
      },
      { snapshots: "status" },
    );
  },

  consumeProjectList(projectList) {
    if (!this.active) return new Disposable();
    const providers = this.projectListProviders;
    let record = providers.get(projectList);
    if (record) {
      record.references++;
    } else {
      record = { provider: projectList, references: 1, indexRequested: false, subscription: null };
      providers.set(projectList, record);
      this.currentProjectListRecord = record;
      this.projectList = projectList;
      this.indexRequested = false;
      try {
        const subscription = projectList.onDidChangeCurrentProject(() => {
          if (this.initialized && this.currentProjectListRecord === record) this.updateTitle();
        });
        if (providers.get(projectList) === record) record.subscription = subscription;
        else subscription.dispose();
      } catch (error) {
        if (providers.get(projectList) === record) providers.delete(projectList);
        if (this.projectListProviders === providers && this.currentProjectListRecord === record) {
          this.selectProjectList([...providers.values()].at(-1) ?? null);
        }
        throw error;
      }
    }
    if (
      this.active &&
      this.projectListProviders === providers &&
      providers.get(projectList) === record &&
      this.currentProjectListRecord === record
    ) {
      this.selectProjectList(record);
    }
    return new Disposable(() => {
      if (providers.get(projectList) !== record || --record.references > 0) return;
      providers.delete(projectList);
      record.subscription?.dispose();
      if (this.projectListProviders === providers && this.currentProjectListRecord === record) {
        this.selectProjectList([...providers.values()].at(-1) ?? null);
      }
    });
  },

  selectProjectList(record) {
    this.currentProjectListRecord = record;
    this.projectList = record?.provider ?? null;
    this.indexRequested = record?.indexRequested ?? false;
    if (this.initialized) {
      this.requestProjectListIndex();
      this.updateTitle();
    }
  },

  subscribeToActiveItem(updateTitle = true) {
    this.activeItemSubscription?.dispose();
    this.activeItemSubscription = null;

    const activeItem = lumine.workspace.getActivePaneItem();
    if (activeItem && typeof activeItem.onDidChangeTitle === "function") {
      this.activeItemSubscription = activeItem.onDidChangeTitle(() => this.updateTitle());
    }

    this.subscribeToRepository();
    if (updateTitle) this.updateTitle();
  },

  updateTitle() {
    if (!this.active) {
      this.setDefaultTitle();
      return;
    }
    if (!this.initialized) return;
    document.title = this.render() || "Lumine";
    lumine.applicationDelegate?.setRepresentedFilename?.(this.representedFilename());
  },

  setDefaultTitle() {
    document.title = "Lumine";
    lumine.applicationDelegate?.setRepresentedFilename?.("");
  },

  representedFilename() {
    const activeItem = lumine.workspace.getActivePaneItem();
    const itemPath = activeItem?.getPath?.();
    return itemPath || lumine.project.getPaths()[0] || "";
  },

  // the project list indexes lazily; trigger it only when the template needs it
  requestProjectListIndex() {
    const record = this.currentProjectListRecord;
    if (!record || record.indexRequested) {
      return;
    }
    if (this.template.includes("projectTitle")) {
      this.indexRequested = true;
      record.indexRequested = true;
      record.provider.updateView();
    }
  },

  render() {
    if (!this.presetRenderer && !this.parsedTemplate) {
      return null;
    }
    let title;
    try {
      const variables = this.variables();
      title = this.presetRenderer
        ? this.presetRenderer(variables)
        : getTemplateEngine().renderSync(this.parsedTemplate, variables);
    } catch {
      // a template that fails at render time falls back to the application title
      return null;
    }
    if (this.presetRenderer) return title || null;
    title = title
      .replace(/\[\s*\]|\(\s*\)/g, "")
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s\-–—|:·]+|[\s\-–—|:·]+$/g, "");
    return title || null;
  },

  variables() {
    const activeItem = lumine.workspace.getActivePaneItem();
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
