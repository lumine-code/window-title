describe("window-title lazy custom templates", () => {
  let main;

  beforeEach(async () => {
    lumine.config.set("window-title.template", "File");
    if (lumine.packages.isPackageLoaded("window-title")) {
      await lumine.packages.unloadPackage("window-title");
    }
    main = (await lumine.packages.activatePackage("window-title")).mainModule;
  });

  afterEach(async () => {
    await lumine.packages.unloadPackage("window-title");
    await lumine.workspace.discardEditorWindows();
  });

  async function holdImport() {
    const module = await main.importTemplateEngine();
    let release, fail;
    spyOn(main, "importTemplateEngine").and.returnValue(
      new Promise((resolve, reject) => {
        release = () => resolve(module);
        fail = reject;
      }),
    );
    return { release, fail };
  }

  function custom(source) {
    lumine.config.set("window-title.custom", source);
    lumine.config.set("window-title.template", "Custom");
    return main.updateTemplate();
  }

  it("uses presets synchronously without importing the template engine", async () => {
    const editor = await lumine.workspace.open(__filename);
    spyOn(main, "importTemplateEngine").and.callThrough();
    lumine.config.set("window-title.template", "Full Path");
    expect(main.render()).toBe(editor.getPath());
    expect(main.importTemplateEngine).not.toHaveBeenCalled();
  });

  it("shares a native import while keeping render synchronous after compilation", async () => {
    spyOn(main, "importTemplateEngine").and.callThrough();
    const [first, second] = await Promise.all([
      main.ensureTemplateEngine(),
      main.ensureTemplateEngine(),
    ]);
    expect(first).toBe(second);
    expect(main.importTemplateEngine).toHaveBeenCalledTimes(1);
    await custom("{{ appName }} custom");
    expect(main.render()).toBe("Lumine custom");
    expect(document.title).toBe("Lumine custom");
  });

  it("compiles only the latest template when configuration changes during import", async () => {
    const { release } = await holdImport();
    const first = custom("old");
    const second = custom("{{ appName }} latest");
    release();
    await Promise.all([first, second]);
    expect(main.render()).toBe("Lumine latest");
    expect(document.title).toBe("Lumine latest");
    expect(main.importTemplateEngine).toHaveBeenCalledTimes(1);
  });

  it("keeps a preset selected while a previous custom template is loading", async () => {
    const editor = await lumine.workspace.open(__filename);
    const { release } = await holdImport();
    const pending = custom("old custom");
    lumine.config.set("window-title.template", "Full Path");
    release();
    await pending;
    expect(document.title).toBe(editor.getPath());
    expect(main.parsedTemplate).toBeNull();
  });

  it("ignores errors and title publication after the owning generation is unloaded", async () => {
    const { fail } = await holdImport();
    const retired = main;
    const pending = custom("old custom");
    spyOn(lumine.notifications, "addWarning");
    await lumine.packages.unloadPackage("window-title");
    lumine.config.set("window-title.template", "File");
    main = (await lumine.packages.activatePackage("window-title")).mainModule;
    fail(new Error("Retired import failed"));
    await pending;
    expect(retired.parsedTemplate).toBeNull();
    expect(main.parsedTemplate).toBeNull();
    expect(lumine.notifications.addWarning).not.toHaveBeenCalled();
    expect(document.title).toBe("Lumine");
  });

  it("reports a current import failure and retries the next template update", async () => {
    spyOn(main, "importTemplateEngine").and.rejectWith(new Error("Held import failed"));
    spyOn(lumine.notifications, "addWarning");
    await custom("{{ appName }}");
    expect(lumine.notifications.addWarning).toHaveBeenCalledWith("window-title: invalid template", {
      detail: "Held import failed",
    });
    main.importTemplateEngine.and.callThrough();
    await main.updateTemplate();
    expect(main.render()).toBe("Lumine");
    expect(main.importTemplateEngine).toHaveBeenCalledTimes(2);
  });

  it("does not overwrite a reactivated package title after a successful retired import", async () => {
    const editor = await lumine.workspace.open(__filename);
    const { release } = await holdImport();
    const retired = main;
    const pending = custom("retired custom");
    await lumine.packages.deactivatePackage("window-title");
    lumine.config.set("window-title.template", "Full Path");
    main = (await lumine.packages.activatePackage("window-title")).mainModule;
    release();
    await pending;
    expect(retired.parsedTemplate).toBeNull();
    expect(main.render()).toBe(editor.getPath());
    expect(document.title).toBe(editor.getPath());
  });

  it("resolves custom titles independently for every window after the shared import", async () => {
    const first = await lumine.workspace.open(__filename);
    const { release } = await holdImport();
    const pending = custom("{{ fileName }}");
    const extra = await lumine.workspace.openEditorWindow({ show: false });
    const second = lumine.workspace.buildTextEditor();
    spyOn(second, "getTitle").and.returnValue("Other window");
    extra.getEditorContainer().getActivePane().activateItem(second, { activatePane: true });
    release();
    await pending;
    expect(document.title).toBe(first.getTitle());
    expect(extra.getDocument().title).toBe("Other window");
    second.destroy();
  });

  it("renders the latest active item after loading instead of retaining its old filename", async () => {
    const first = await lumine.workspace.open(__filename);
    const { release } = await holdImport();
    const pending = custom("{{ fileName }}");
    const second = lumine.workspace.buildTextEditor();
    spyOn(second, "getTitle").and.returnValue("Current editor");
    const pane = lumine.workspace.paneForItem(first);
    pane.activateItem(second);
    release();
    await pending;
    expect(document.title).toBe("Current editor");
    second.destroy();
  });
});
