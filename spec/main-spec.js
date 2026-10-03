const os = require("os");
const path = require("path");
const { Disposable, Emitter } = require("lumine");

describe("Window Title package", () => {
  let setRepresentedFilename;

  beforeEach(() => {
    document.title = "Lumine";
    setRepresentedFilename = spyOn(
      lumine.applicationDelegate,
      "setRepresentedFilename",
    ).and.callFake(() => {});
  });

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

  it("rebinds repository status when the active item changes resource", async () => {
    const pack = await activate("{{ fileName }} {{ gitHead }}");
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
    spyOn(pack.mainModule, "currentRepository").and.callFake(() =>
      filePath.endsWith("first.png") ? repositories[0] : repositories[1],
    );
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
});
