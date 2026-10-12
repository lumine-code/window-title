const path = require("node:path");

describe("Window title presentation contexts", () => {
  beforeEach(async () => {
    lumine.packages.loadPackage(path.resolve(__dirname, ".."));
    lumine.config.set("window-title.template", "File");
    await lumine.packages.activatePackage("window-title");
  });
  afterEach(async () => {
    await lumine.workspace.discardEditorWindows();
  });

  it("keeps each physical title tied to its own active document", async () => {
    const workspace = lumine.workspace;
    const editor = await workspace.open();
    const extra = await workspace.openEditorWindow({ show: false });
    const second = workspace.buildTextEditor({ buffer: undefined });
    spyOn(editor, "getTitle").and.returnValue("Main document");
    spyOn(second, "getTitle").and.returnValue("Additional document");
    extra.getEditorContainer().getActivePane().activateItem(second, { activatePane: true });
    const main = lumine.packages.getActivePackage("window-title").mainModule;
    main.updateTitle();
    expect(workspace.getActiveTextEditor()).toBe(second);
    expect(document.title).toBe("Main document");
    expect(extra.getDocument().title).toBe("Additional document");
    workspace.paneForItem(editor).activate();
    expect(document.title).toBe("Main document");
    expect(extra.getDocument().title).toBe("Additional document");
  });
});
