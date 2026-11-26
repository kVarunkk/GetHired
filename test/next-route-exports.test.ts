// `next build` refuses any other export from these files ("... is not a valid
// Route export field"), and neither `tsc` nor eslint reports it, so without
// this test it first shows up in the deploy. The lists are the ones in
// next/dist/build/webpack/plugins/next-types-plugin.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SEGMENT_CONFIG = [
  "config",
  "generateStaticParams",
  "revalidate",
  "dynamic",
  "dynamicParams",
  "fetchCache",
  "preferredRegion",
  "runtime",
  "maxDuration",
];

const ROUTE_EXPORTS = new Set([
  ...SEGMENT_CONFIG,
  "GET",
  "HEAD",
  "OPTIONS",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
]);

const PAGE_EXPORTS = new Set([
  ...SEGMENT_CONFIG,
  "default",
  "metadata",
  "generateMetadata",
  "viewport",
  "generateViewport",
  "experimental_ppr",
]);

const APP_DIR = join(process.cwd(), "app");

function entryFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entryFiles(path);
    return /^(route|page|layout)\.(ts|tsx|js|jsx)$/.test(entry.name) ? [path] : [];
  });
}

/** The names a module exports at runtime: types and interfaces don't count. */
function valueExports(fileName: string, code: string): string[] {
  const source = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const addBinding = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) names.push(name.text);
    else name.elements.forEach((element) => ts.isBindingElement(element) && addBinding(element.name));
  };

  for (const statement of source.statements) {
    if (ts.isExportAssignment(statement)) {
      names.push("default");
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly) continue;
      const clause = statement.exportClause;
      if (!clause) names.push("*");
      else if (ts.isNamespaceExport(clause)) names.push(clause.name.text);
      else clause.elements.forEach((element) => !element.isTypeOnly && names.push(element.name.text));
      continue;
    }
    if (!ts.canHaveModifiers(statement)) continue;
    const modifiers = ts.getModifiers(statement)?.map((modifier) => modifier.kind) ?? [];
    if (!modifiers.includes(ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
    if (modifiers.includes(ts.SyntaxKind.DefaultKeyword)) names.push("default");
    else if (ts.isVariableStatement(statement)) {
      statement.declarationList.declarations.forEach((declaration) => addBinding(declaration.name));
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name
    ) {
      names.push(statement.name.text);
    }
  }
  return names;
}

describe("Next.js entry files", () => {
  it("finds the exports the build would refuse", () => {
    const code = `
      export const LIMIT = 3;
      export type Message = { id: string };
      export interface Row { id: string }
      export async function GET() {}
      export { helper, type Other } from "./helper";
    `;
    expect(valueExports("route.ts", code)).toEqual(["LIMIT", "GET", "helper"]);
  });

  it("export only what Next.js allows from route, page and layout files", () => {
    const files = entryFiles(APP_DIR);
    expect(files.length).toBeGreaterThan(100);

    const invalid = files.flatMap((file) => {
      const allowed = /route\.\w+$/.test(file) ? ROUTE_EXPORTS : PAGE_EXPORTS;
      return valueExports(file, readFileSync(file, "utf8"))
        .filter((name) => !allowed.has(name))
        .map((name) => `${relative(process.cwd(), file)}: ${name}`);
    });
    expect(invalid).toEqual([]);
  });
});
