const { CompositeDisposable, Disposable } = require("lumine");

module.exports = class WindowTitleController {
  constructor(owner, window) {
    this.owner = owner;
    this.window = window;
    this.repository = null;
    this.subscriptions = new CompositeDisposable(
      window.getEditorContainer().onDidChangeActivePaneItem(() => this.subscribeToActiveItem()),
      lumine.workspace.onDidChangePaneItemURI?.(({ item }) => {
        if (item === this.activeItem()) this.subscribeToActiveItem();
      }) ?? new Disposable(),
      lumine.project.onDidChangePaths(() => this.subscribeToActiveItem()),
      window.onWillDestroy(() => this.destroy()),
    );
    this.subscribeToActiveItem();
  }

  activeItem() {
    return this.window.getEditorContainer().getActivePaneItem();
  }

  subscribeToActiveItem() {
    this.itemSubscription?.dispose();
    this.itemSubscription = this.activeItem()?.onDidChangeTitle?.(() => this.update());
    this.repositoryObservation?.dispose();
    this.repositorySubscription?.dispose();
    this.repositorySubscription = null;
    this.repository = null;
    this.repositoryObservation = lumine.repositories.observeForPath(
      () => this.activeItem()?.getPath?.() || lumine.project.getPaths()[0] || null,
      (repository, { error }) => {
        if (this.destroyed) return;
        if (repository !== this.repository) {
          this.repositorySubscription?.dispose();
          this.repository = repository;
          this.repositorySubscription = repository?.onDidChangeStatusSnapshot(() => this.update());
        }
        if (error) console.error("Unable to load window title Git status", error);
        this.update();
      },
      { snapshots: "status" },
    );
    this.update();
  }

  update() {
    if (this.destroyed || !this.owner.initialized || this.window.isDestroyed()) return;
    const document = this.window.getDocument();
    if (!document) return;
    document.title = this.owner.render(this.window) || "Lumine";
    const filename = this.owner.representedFilename(this.window);
    void this.window.setRepresentedFilename(filename);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.subscriptions.dispose();
    this.itemSubscription?.dispose();
    this.repositoryObservation?.dispose();
    this.repositorySubscription?.dispose();
    this.owner.windows.delete(this.window);
  }
};
