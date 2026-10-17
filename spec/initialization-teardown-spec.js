describe("window-title initialization teardown", () => {
  let pack;

  beforeEach(async () => {
    if (lumine.packages.getLoadedPackage("window-title"))
      await lumine.packages.unloadPackage("window-title", { serialize: false });
    pack = lumine.packages.loadPackage("window-title");
    if (pack.loadError) throw pack.loadError;
    pack.initializeForExternalUse("deserialization before activation");
    expect(pack.mainInitialized).toBe(true);
    expect(pack.mainActivationStarted).toBe(false);
  });

  afterEach(async () => {
    if (lumine.packages.getLoadedPackage("window-title"))
      await lumine.packages.unloadPackage("window-title", { serialize: false });
  });

  it("deactivates an initialized package without activating its UI", async () => {
    const scope = pack.lifecycleContext.subscriptions;
    await expectAsync(pack.deactivate()).toBeResolved();
    expect(scope.disposed).toBe(true);
    expect(pack.mainInitialized).toBe(false);
  });

  it("unloads an initialized package and releases its lifecycle scope", async () => {
    const scope = pack.lifecycleContext.subscriptions;
    await expectAsync(
      lumine.packages.unloadPackage("window-title", { serialize: false }),
    ).toBeResolved();
    expect(scope.disposed).toBe(true);
    expect(lumine.packages.getLoadedPackage("window-title")).toBeUndefined();
  });
});
