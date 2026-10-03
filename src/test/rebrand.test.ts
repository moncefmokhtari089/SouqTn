import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

const compatibilityAllowList = [
  /souqtn-(?:avatars|listings|products|likes|saved|comments|auctions|auth-return)/i,
  /github\.com\/moncefmokhtari089\/SouqTn\.git/i,
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [entryPath] : [];
  });
}

function disallowedBrandReferences(filePath: string): string[] {
  if (filePath.endsWith("/rebrand.test.ts")) return [];
  const lines = readFileSync(filePath, "utf8").split("\n");
  return lines.flatMap((line, index) => {
    if (!/souqtn/i.test(line) || compatibilityAllowList.some((pattern) => pattern.test(line)))
      return [];
    return [`${filePath}:${index + 1}: ${line.trim()}`];
  });
}

describe("ELmarchii rebrand", () => {
  it("removes visible SouqTN branding while allowing compatibility identifiers", () => {
    const files = [...sourceFiles(path.join(root, "src")), path.join(root, "README.md")];
    const leftovers = files.flatMap(disallowedBrandReferences);
    expect(leftovers).toEqual([]);
  });
});
