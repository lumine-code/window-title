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
    ).andCallFake(() => {});
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
