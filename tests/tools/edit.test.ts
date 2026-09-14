import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createEditTool } from "../../src/tools/edit";
import {
  createToolContext,
  createWorkspaceToolFixture,
  expectToolResult,
} from "./workspace-fixture";

const { cleanupTempRoots, createTempRoot } = createWorkspaceToolFixture();

describe("edit tool", () => {
  afterEach(cleanupTempRoots);

  test("replaces a unique text match in an existing file", async () => {
    const root = await createTempRoot();
    await writeFile(path.join(root, "notes.txt"), "hello world\n");
    const edit = createEditTool({ root });
    const result = await edit.execute(
      {
        path: "notes.txt",
        edits: [{ oldText: "world", newText: "kana" }],
      },
      createToolContext(),
    );

    expectToolResult(result);
    expect(result.result).toMatchObject({
      path: "notes.txt",
      replacements: 1,
      bytesWritten: 11,
    });
    expect(result.content).toContain("edited: notes.txt");
    expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("hello kana\n");
  });

  test("applies disjoint edits matched against the original content", async () => {
    const root = await createTempRoot();
    await writeFile(path.join(root, "notes.txt"), "alpha\nbeta\n");
    const edit = createEditTool({ root });
    const result = await edit.execute(
      {
        path: "notes.txt",
        edits: [
          { oldText: "alpha", newText: "beta\nalpha" },
          { oldText: "beta", newText: "BETA" },
        ],
      },
      createToolContext(),
    );

    expectToolResult(result);
    expect(result.result.replacements).toBe(2);
    expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("beta\nalpha\nBETA\n");
  });

  test("reports every validation failure and leaves the file unchanged", async () => {
    const root = await createTempRoot();
    await writeFile(path.join(root, "notes.txt"), "alpha beta beta gamma\n");
    const edit = createEditTool({ root });

    const execution = edit.execute(
      {
        path: "notes.txt",
        edits: [
          { oldText: "alpha", newText: "ALPHA" },
          { oldText: "missing", newText: "absent" },
          { oldText: "beta", newText: "BETA" },
          { oldText: "pha", newText: "PHA" },
        ],
      },
      createToolContext(),
    );

    await expect(execution).rejects.toThrow(
      [
        "Edit failed for notes.txt; no changes were written:",
        "- edits[1]: text not found",
        "- edits[2]: text appears 2 times; provide a more specific oldText",
        "- edits[0] and edits[3]: ranges overlap",
      ].join("\n"),
    );

    expect(await readFile(path.join(root, "notes.txt"), "utf8")).toBe("alpha beta beta gamma\n");
  });
});
