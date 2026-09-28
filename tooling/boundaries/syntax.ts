import { type Node, type SourceFile as ParsedFile, SyntaxKind } from "typescript/unstable/ast";
import {
  isCallExpression,
  isElementAccessExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isMetaProperty,
  isNoSubstitutionTemplateLiteral,
  isPropertyAccessExpression,
  isShorthandPropertyAssignment,
  isStringLiteral,
} from "typescript/unstable/ast/is";
import { createVirtualFileSystem } from "typescript/unstable/fs";
import { API } from "typescript/unstable/sync";

export interface ImportReference {
  readonly specifier: string;
  readonly line: number;
}

/** A free identifier reference; `member` is set when it is the object of `name.member`. */
export interface IdentifierReference {
  readonly name: string;
  readonly line: number;
  readonly member: string | undefined;
}

export interface SourceFacts {
  /** Static imports, re-exports, literal `import()`, and literal `require()`. */
  readonly imports: readonly ImportReference[];
  readonly nonLiteralDynamicImports: readonly number[];
  readonly identifiers: readonly IdentifierReference[];
  /** Property names read with `.name` or a literal `["name"]`. */
  readonly memberNames: readonly ImportReference[];
  readonly importMetaLines: readonly number[];
}

export interface SourceText {
  readonly path: string;
  readonly content: string;
}

const VIRTUAL_ROOT = "/repo/";

function literalText(node: Node | undefined): string | undefined {
  if (node === undefined) return undefined;
  return isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node) ? node.text : undefined;
}

function sameNode(a: unknown, b: Node): boolean {
  return (
    typeof a === "object" &&
    a !== null &&
    "pos" in a &&
    "end" in a &&
    a.pos === b.pos &&
    a.end === b.end
  );
}

/** Declaration and property names are not references; shorthand `{ name }` is. */
function isNameOf(parent: Node, node: Node): boolean {
  if (isShorthandPropertyAssignment(parent)) return false;
  return "name" in parent && sameNode(parent.name, node);
}

function collectFacts(file: ParsedFile): SourceFacts {
  const imports: ImportReference[] = [];
  const nonLiteralDynamicImports: number[] = [];
  const identifiers: IdentifierReference[] = [];
  const memberNames: ImportReference[] = [];
  const importMetaLines: number[] = [];
  const lineOf = (node: Node): number =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
  const addImport = (specifier: Node | undefined, at: Node): void => {
    const text = literalText(specifier);
    if (text === undefined) nonLiteralDynamicImports.push(lineOf(at));
    else imports.push({ specifier: text, line: lineOf(at) });
  };

  const visit = (node: Node, parent: Node): void => {
    if (isImportDeclaration(node) || (isExportDeclaration(node) && node.moduleSpecifier)) {
      addImport(node.moduleSpecifier, node);
    } else if (isExternalModuleReference(node)) {
      addImport(node.expression, node);
    } else if (isCallExpression(node)) {
      const callee = node.expression;
      if (
        callee.kind === SyntaxKind.ImportKeyword ||
        (isIdentifier(callee) && callee.text === "require")
      ) {
        addImport(node.arguments[0], node);
      }
    } else if (isMetaProperty(node) && node.keywordToken === SyntaxKind.ImportKeyword) {
      importMetaLines.push(lineOf(node));
    } else if (isPropertyAccessExpression(node)) {
      memberNames.push({ specifier: node.name.text, line: lineOf(node.name) });
    } else if (isElementAccessExpression(node)) {
      const key = literalText(node.argumentExpression);
      if (key !== undefined) memberNames.push({ specifier: key, line: lineOf(node) });
    } else if (isIdentifier(node) && !isNameOf(parent, node)) {
      const member =
        isPropertyAccessExpression(parent) && sameNode(parent.expression, node)
          ? parent.name.text
          : undefined;
      identifiers.push({ name: node.text, line: lineOf(node), member });
    }
    node.forEachChild((child) => visit(child, node));
  };
  file.forEachChild((child) => visit(child, file));
  return { imports, nonLiteralDynamicImports, identifiers, memberNames, importMetaLines };
}

/**
 * Parses every file with the pinned TypeScript compiler in a single session and
 * returns syntax facts keyed by repository path. Comments, strings, template
 * text, and regex literals never produce facts because only AST nodes are read.
 */
export function analyzeSources(files: readonly SourceText[]): ReadonlyMap<string, SourceFacts> {
  const facts = new Map<string, SourceFacts>();
  if (files.length === 0) return facts;
  const config = `${VIRTUAL_ROOT}tsconfig.json`;
  const virtualFiles: Record<string, string> = {
    [config]: JSON.stringify({
      compilerOptions: { allowJs: true, noLib: true, noResolve: true, noEmit: true, types: [] },
      files: files.map((file) => file.path),
    }),
  };
  for (const file of files) virtualFiles[VIRTUAL_ROOT + file.path] = file.content;

  const api = new API({ fs: createVirtualFileSystem(virtualFiles), cwd: VIRTUAL_ROOT });
  try {
    const snapshot = api.updateSnapshot({ openProjects: [config] });
    const program = snapshot.getProject(config)?.program;
    for (const file of files) {
      const parsed = program?.getSourceFile(VIRTUAL_ROOT + file.path);
      if (parsed === undefined) throw new Error(`TypeScript did not parse ${file.path}`);
      facts.set(file.path, collectFacts(parsed));
    }
  } finally {
    api.close();
  }
  return facts;
}
