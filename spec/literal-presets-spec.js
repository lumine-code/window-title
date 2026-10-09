const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

describe("Window Title literal presets", () => {
  let main, editor, directory;

  beforeEach(async () => {
    lumine.project.setPaths([]);
    directory = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "literal-title-")));
    main = (await lumine.packages.activatePackage("window-title")).mainModule;
    editor = lumine.workspace.buildTextEditor();
    const pane = lumine.workspace.getActivePane();
    pane.addItem(editor);
    pane.activateItem(editor);
  });

  afterEach(async () => {
    editor.destroy();
    await lumine.packages.deactivatePackage("window-title");
    lumine.config.unset("window-title.template");
    lumine.config.unset("window-title.custom");
    lumine.project.setPaths([]);
    await lumine.fileWatchClient.settlePendingTeardown();
    const resolved = fs.realpathSync.native(directory);
    const relative = path.relative(fs.realpathSync.native(os.tmpdir()), resolved);
    if (
      resolved !== directory ||
      path.isAbsolute(relative) ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`)
    )
      throw new Error("Unsafe title fixture cleanup");
    fs.rmSync(resolved, { recursive: true, force: true });
  });

  it("preserves every literal character returned by the Full Path preset", () => {
    const file = path.join(directory, "report  ( ) [ ].txt");
    editor.getBuffer().setPath(file);
    lumine.config.set("window-title.template", "Full Path");
    expect(main.render()).toBe(file);
    expect(document.title).toBe(file);
  });

  it("preserves filename punctuation and omits absent project parts without trimming the filename", () => {
    editor.getBuffer().setPath(path.join(directory, "--report [ ].txt"));
    lumine.project.setPaths([]);
    lumine.config.set("window-title.template", "File");
    expect(main.render()).toBe("--report [ ].txt");
    lumine.config.set("window-title.template", "Project and File");
    expect(main.render()).toBe("--report [ ].txt");
    lumine.project.setPaths([directory]);
    expect(main.render()).toBe(`${path.basename(directory)} — --report [ ].txt`);
  });

  it("retains empty placeholder and separator cleanup for Custom templates", () => {
    editor.getBuffer().setPath(path.join(directory, "report.txt"));
    lumine.config.set("window-title.template", "Custom");
    lumine.config.set("window-title.custom", "{{ fileName }} [] () —");
    expect(main.render()).toBe("report.txt");
  });
});
