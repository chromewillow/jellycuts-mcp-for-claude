import { describe, expect, it } from "vitest";
import { catalog, findActions, formatActionDetail, searchActions, suggestActions } from "../src/catalog";

describe("catalog data", () => {
  it("has the built-in Shortcuts library and hundreds of actions", () => {
    expect(catalog.actions.length).toBeGreaterThan(500);
    expect(catalog.libraries.find((l) => l.import === "Shortcuts")?.actions).toBeGreaterThan(250);
  });

  it("every action belongs to a listed library and has a name", () => {
    const libs = new Set(catalog.libraries.map((l) => l.import));
    for (const a of catalog.actions) {
      expect(a.name).toMatch(/^[A-Za-z_]\w*$/);
      expect(libs.has(a.library)).toBe(true);
    }
  });

  it("knows the enum values for common parameters", () => {
    const ask = findActions("askForInput")[0];
    const type = ask.params.find((p) => p.name === "type")!;
    expect(catalog.enums[type.enum!]).toEqual(expect.arrayContaining(["Text", "Number", "Date and Time"]));
    expect(catalog.enumAliases[type.enum!].DateandTime).toEqual({ to: "Date and Time", status: "internal" });
  });

  it("marks optional parameters for Shortcuts actions", () => {
    const notify = findActions("sendNotification")[0];
    expect(notify.params.find((p) => p.name === "body")?.optional).toBeFalsy();
    expect(notify.params.find((p) => p.name === "title")?.optional).toBe(true);
  });

  it("has #Color and #Icon values", () => {
    expect(catalog.metadata.colors).toEqual(expect.arrayContaining(["red", "blue"]));
    expect(catalog.metadata.icons).toEqual(expect.arrayContaining(["star", "battery", "shortcuts"]));
  });
});

describe("search", () => {
  const top = (q: string, n = 3) => searchActions(q, { limit: n }).map((a) => a.name);

  it.each([
    ["send a notification", "sendNotification"],
    ["battery level", "batteryLevel"],
    ["http request api", "downloadURL"],
    ["speak text out loud", "speakText"],
    ["ask the user for input", "askForInput"],
    ["copy to clipboard", "setClipboard"],
    ["weather", "getCurrentConditions"],
    ["wait", "wait"],
  ])("%s → %s", (query, expected) => {
    expect(top(query, 5)).toContain(expected);
  });

  it("filters by library", () => {
    const results = searchActions("", { library: "DataJar", limit: 50 });
    expect(results.length).toBeGreaterThan(3);
    expect(results.every((a) => a.library === "DataJar")).toBe(true);
  });
});

describe("suggestions and formatting", () => {
  it("maps invented names to real actions", () => {
    expect(suggestActions("showNotification")[0]).toBe("sendNotification");
    expect(suggestActions("sendNotificaton")).toContain("sendNotification");
  });

  it("lists real Shortcuts spellings, spaces included", () => {
    const text = formatActionDetail(findActions("fileDetail")[0]);
    expect(text).toContain("File Extension");
    expect(text).not.toContain("FileExtension");
    expect(text).toContain("spaces included");
  });

  it("shows the confirmed JSON form for dictionary parameters", () => {
    expect(formatActionDetail(findActions("dictionary")[0])).toContain('json: {"name": "Ada", "age": 36}');
    const download = formatActionDetail(findActions("downloadURL")[0]);
    expect(download).toContain('headers: {\\"Accept\\": \\"application/json\\"}');
    expect(download).toContain("after the other arguments");
    expect(download).toContain("requestType: File, requestVar");
  });

  it("formats details with labels, enum values and docs link", () => {
    const text = formatActionDetail(findActions("changeCase")[0]);
    expect(text).toContain("`case`");
    expect(text).toContain("uppercase");
    expect(text).toContain("https://docs.jellycuts.com/");
  });
});
