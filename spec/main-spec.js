const os = require("os");
const path = require("path");
const { CompositeDisposable, Disposable, Emitter } = require("lumine");

describe("Window Title package", () => {
  let setRepresentedFilename;
  let services;

  beforeEach(() => {
    document.title = "Lumine";
    services = new CompositeDisposable();
    setRepresentedFilename = spyOn(
      lumine.applicationDelegate,
      "setRepresentedFilename",
    ).and.callFake(() => {});
  });

  afterEach(() => services.dispose());

  function projectProvider(title) {
    const emitter = new Emitter();
    const provider = {
      getCurrentProject: () => ({ title }),
      onDidChangeCurrentProject: jasmine
        .createSpy("subscribe")
        .and.callFake((callback) => emitter.on("change", callback)),
      updateView: jasmine.createSpy("index"),
      change: () => emitter.emit("change"),
    };
    services.add(new Disposable(() => emitter.dispose()));
    return provider;
  }

  function publish(provider) {
    const edge = lumine.packages.serviceHub.provide("project-list", "1.0.0", provider);
    services.add(edge);
    return edge;
  }

  async function activate(customTemplate) {
    lumine.config.set("window-title.template", "Custom");
    lumine.config.set("window-title.custom", customTemplate);
    return lumine.packages.activatePackage("window-title");
  }

  it("updates the title and represented filename from workspace state", async () => {
    const projectPath = path.dirname(__filename);
    const filePath = __filename;
    const renamedPath = path.join(projectPath, "renamed.js");
    lumine.project.setPaths([projectPath]);

    await activate("{{ fileName }} — {{ projectName }}");
    const editor = await lumine.workspace.open();
    editor.getBuffer().setPath(filePath);

    expect(document.title).toBe(`${path.basename(filePath)} — ${path.basename(projectPath)}`);
    expect(setRepresentedFilename).toHaveBeenCalledWith(filePath);

    editor.getBuffer().setPath(renamedPath);

    expect(document.title).toBe(`renamed.js — ${path.basename(projectPath)}`);
    expect(setRepresentedFilename).toHaveBeenCalledWith(renamedPath);

    lumine.config.set("window-title.template", "Full Path");
    expect(document.title).toBe(renamedPath);

    lumine.config.set("window-title.template", "File");
    expect(document.title).toBe("renamed.js");

    lumine.config.set("window-title.template", "Project");
    expect(document.title).toBe(path.basename(projectPath));

    lumine.config.set("window-title.template", "Project and File");
    expect(document.title).toBe(`${path.basename(projectPath)} — renamed.js`);
  });

  it("updates when project paths change", async () => {
    const firstProjectPath = os.tmpdir();
    const secondProjectPath = path.resolve(__dirname, "../../..");
    lumine.project.setPaths([firstProjectPath]);
    await activate("{{ projectName }} ({{ projectCount }})");

    expect(document.title).toBe(`${path.basename(firstProjectPath)} (1)`);

    lumine.project.setPaths([secondProjectPath, firstProjectPath]);

    expect(document.title).toBe(`${path.basename(secondProjectPath)} (2)`);
    expect(setRepresentedFilename).toHaveBeenCalledWith(secondProjectPath);
  });

  it("activates and deactivates when the core has no URI-change event", async () => {
    const subscribe = lumine.workspace.onDidChangePaneItemURI;
    lumine.workspace.onDidChangePaneItemURI = undefined;
    try {
      await activate("{{ appName }}");
      expect(document.title).toBe("Lumine");
      await lumine.packages.deactivatePackage("window-title");
    } finally {
      lumine.workspace.onDidChangePaneItemURI = subscribe;
    }
  });

  it("omits the project-and-file separator when there is no file", async () => {
    const projectPath = path.resolve(__dirname, "..");
    lumine.project.setPaths([projectPath]);
    lumine.config.set("window-title.template", "Project and File");

    await lumine.packages.activatePackage("window-title");

    expect(document.title).toBe(path.basename(projectPath));
  });

  it("updates for pane items with a title API and removes their listener on deactivation", async () => {
    let itemTitle = "Titled Item";
    const emitter = new Emitter();
    const item = {
      element: document.createElement("div"),
      getTitle: () => itemTitle,
      onDidChangeTitle: (callback) => emitter.on("did-change-title", callback),
    };

    await activate("{{ fileName }}");
    lumine.workspace.getActivePane().activateItem(item);

    expect(document.title).toBe("Titled Item");

    itemTitle = "Renamed Item";
    emitter.emit("did-change-title");

    expect(document.title).toBe("Renamed Item");

    await lumine.packages.deactivatePackage("window-title");
    itemTitle = "Ignored Title";
    emitter.emit("did-change-title");

    expect(document.title).toBe("Lumine");
    expect(setRepresentedFilename).toHaveBeenCalledWith("");
  });

  it("uses the Lumine fallback for empty and invalid templates", async () => {
    await activate("");
    expect(document.title).toBe("Lumine");

    lumine.config.set("window-title.custom", "{% if projectTitle %}");
    expect(document.title).toBe("Lumine");
  });

  it("picks up a repository discovered after the active file's title was rendered", async () => {
    const editor = await lumine.workspace.open(__filename);
    let repository = null;
    spyOn(lumine.repositories, "getForPath").and.callFake(() => repository);
    spyOn(lumine.repositories, "resolveForPath").and.callFake(async () => repository);
    spyOn(lumine.repositories, "retain").and.callFake(() => new Disposable());
    await activate("{{ fileName }} {{ gitHead }}");
    repository = {
      getShortHead: () => "new-branch",
      getStatusSnapshot: () => ({ initialized: true }),
      onDidChangeStatusSnapshot: () => new Disposable(),
      onDidDestroy: () => new Disposable(),
    };
    lumine.repositories.emitter.emit("did-change", {});
    expect(document.title).toBe(`${path.basename(editor.getPath())} new-branch`);
  });

  it("rebinds repository status when the active item changes resource", async () => {
    await activate("{{ fileName }} {{ gitHead }}");
    const first = new Emitter();
    const second = new Emitter();
    const resource = new Emitter();
    let filePath = path.join(os.tmpdir(), "first.png");
    let branch = "first-branch";
    const firstDisposed = jasmine.createSpy("first repository disposed");
    const repositories = [
      {
        getShortHead: () => "first-branch",
        onDidChangeStatusSnapshot(callback) {
          const subscription = first.on("status", callback);
          return new Disposable(() => {
            subscription.dispose();
            firstDisposed();
          });
        },
      },
      {
        getShortHead: () => branch,
        onDidChangeStatusSnapshot: (callback) => second.on("status", callback),
      },
    ];
    spyOn(lumine.repositories, "observeForPath").and.callFake((getPath, callback) => {
      callback(filePath.endsWith("first.png") ? repositories[0] : repositories[1], {
        path: getPath(),
        ready: true,
      });
      return new Disposable();
    });
    const item = {
      element: document.createElement("div"),
      getTitle: () => path.basename(filePath),
      getPath: () => filePath,
      getURI: () => filePath,
      onDidChangeURI: (callback) => resource.on("uri", callback),
    };
    await lumine.workspace.open(item, { pending: true });
    expect(document.title).toBe("first.png first-branch");

    const oldURI = filePath;
    filePath = path.join(os.tmpdir(), "second.png");
    branch = "second-branch";
    resource.emit("uri", { oldURI, newURI: filePath });
    expect(firstDisposed).toHaveBeenCalled();
    expect(document.title).toBe("second.png second-branch");
    expect(setRepresentedFilename).toHaveBeenCalledWith(filePath);

    branch = "updated-branch";
    second.emit("status");
    expect(document.title).toBe("second.png updated-branch");
    first.dispose();
    second.dispose();
    resource.dispose();
  });

  it("updates when the current project-list project changes", async () => {
    const pack = await activate("{{ projectTitle }}");
    let currentProject = { title: "First Project" };
    let didChangeCurrentProject;
    const service = {
      getCurrentProject: () => currentProject,
      onDidChangeCurrentProject(callback) {
        didChangeCurrentProject = callback;
        return new Disposable();
      },
      updateView() {},
    };
    const serviceDisposable = pack.mainModule.consumeProjectList(service);

    expect(document.title).toBe("First Project");

    currentProject = { title: "Second Project" };
    didChangeCurrentProject();

    expect(document.title).toBe("Second Project");

    serviceDisposable.dispose();
    expect(document.title).toBe("Lumine");
  });

  it("indexes a replacement provider and keeps it when the older edge retires", async () => {
    await activate("{{ projectTitle }}");
    const first = projectProvider("First");
    const second = projectProvider("Second");
    const older = publish(first);
    publish(second);
    expect(first.updateView).toHaveBeenCalledTimes(1);
    expect(second.updateView).toHaveBeenCalledTimes(1);
    older.dispose();
    expect(document.title).toBe("Second");
    first.change();
    expect(document.title).toBe("Second");
  });

  it("falls back to the remaining provider without indexing it twice", async () => {
    await activate("{{ projectTitle }}");
    const first = projectProvider("First");
    publish(first);
    const newest = publish(projectProvider("Second"));
    newest.dispose();
    expect(document.title).toBe("First");
    expect(first.updateView).toHaveBeenCalledTimes(1);
  });

  it("shares duplicate payload subscriptions until the last edge retires", async () => {
    const pack = await activate("{{ projectTitle }}");
    const provider = projectProvider("Shared");
    const first = publish(provider);
    const second = publish(provider);
    expect(provider.onDidChangeCurrentProject).toHaveBeenCalledTimes(1);
    expect(provider.updateView).toHaveBeenCalledTimes(1);
    first.dispose();
    expect(document.title).toBe("Shared");
    const update = spyOn(pack.mainModule, "updateTitle").and.callThrough();
    provider.change();
    expect(update).toHaveBeenCalledTimes(1);
    second.dispose();
    expect(document.title).toBe("Lumine");
    update.calls.reset();
    provider.change();
    expect(update).not.toHaveBeenCalled();
  });

  it("releases manual edges at deactivation and ignores them in the next activation", async () => {
    let pack = await activate("{{ projectTitle }}");
    const provider = projectProvider("Shared");
    const old = pack.mainModule.consumeProjectList(provider);
    services.add(old);
    await lumine.packages.deactivatePackage("window-title");
    pack = await activate("{{ projectTitle }}");
    services.add(pack.mainModule.consumeProjectList(provider));
    old.dispose();
    expect(document.title).toBe("Shared");
    const update = spyOn(pack.mainModule, "updateTitle").and.callThrough();
    provider.change();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("disposes a listener returned after a synchronous deactivation", async () => {
    const pack = await activate("{{ projectTitle }}");
    const disposed = jasmine.createSpy("disposed");
    const provider = projectProvider("Retired");
    provider.onDidChangeCurrentProject.and.callFake(() => {
      pack.mainModule.deactivate();
      return new Disposable(disposed);
    });
    services.add(pack.mainModule.consumeProjectList(provider));
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("Lumine");
  });

  it("restores the live provider when a replacement subscription fails", async () => {
    const pack = await activate("{{ projectTitle }}");
    publish(projectProvider("First"));
    const provider = projectProvider("Broken");
    provider.onDidChangeCurrentProject.and.throwError("subscription failed");
    expect(() => pack.mainModule.consumeProjectList(provider)).toThrowError("subscription failed");
    expect(document.title).toBe("First");
  });

  it("retains the newest provider consumed during another provider's subscription", async () => {
    const pack = await activate("{{ projectTitle }}");
    const older = projectProvider("Older");
    const newer = projectProvider("Newer");
    older.onDidChangeCurrentProject.and.callFake(() => {
      services.add(pack.mainModule.consumeProjectList(newer));
      return new Disposable();
    });
    services.add(pack.mainModule.consumeProjectList(older));
    expect(document.title).toBe("Newer");
    expect(newer.updateView).toHaveBeenCalledTimes(1);
    expect(older.updateView).not.toHaveBeenCalled();
  });
});
