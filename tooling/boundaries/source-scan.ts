export interface ImportReference {
  readonly specifier: string;
  readonly line: number;
}

export interface SourceScan {
  readonly imports: readonly ImportReference[];
  readonly nonLiteralDynamicImports: readonly number[];
  readonly code: string;
}

const REGEX_PREFIX = /^$|[(,=:[!&|?{};]/;

function regexEnd(source: string, start: number): number {
  let inClass = false;
  let j = start + 1;
  while (j < source.length) {
    const ch = source.charAt(j);
    if (ch === "\\") j += 2;
    else if (ch === "\n") return j;
    else {
      if (ch === "[") inClass = true;
      else if (ch === "]") inClass = false;
      else if (ch === "/" && !inClass) return j + 1;
      j += 1;
    }
  }
  return source.length;
}

/**
 * Replaces comments, regex literals, and string/template contents with spaces so later regular
 * expressions see only code. Newlines are kept so line numbers stay correct.
 * Returns the blanked code and the literal string values with their offsets.
 */
function blankNonCode(source: string): {
  readonly code: string;
  readonly strings: ReadonlyMap<number, string>;
} {
  let code = "";
  const strings = new Map<number, string>();
  let i = 0;
  const blank = (text: string): string => text.replace(/[^\n]/g, " ");
  while (i < source.length) {
    const ch = source.charAt(i);
    const next = source.charAt(i + 1);
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      code += blank(source.slice(i, stop));
      i = stop;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      code += blank(source.slice(i, stop));
      i = stop;
    } else if (ch === "/" && REGEX_PREFIX.test(code.trimEnd().slice(-1))) {
      const stop = regexEnd(source, i);
      code += blank(source.slice(i, stop));
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < source.length && source.charAt(j) !== ch) {
        j += source.charAt(j) === "\\" ? 2 : 1;
      }
      const stop = Math.min(j + 1, source.length);
      strings.set(code.length, source.slice(i + 1, j));
      code += ch + blank(source.slice(i + 1, j)) + (j < source.length ? ch : "");
      i = stop;
    } else {
      code += ch;
      i += 1;
    }
  }
  return { code, strings };
}

const STATIC_FROM = /\b(?:import|export)\b[^;]*?\bfrom\s*(?=["'])/g;
const SIDE_EFFECT = /\bimport\s*(?=["'])/g;
const DYNAMIC = /\b(?:import|require)\s*\(\s*/g;

function lineAt(code: string, offset: number): number {
  let line = 1;
  for (let k = 0; k < offset; k += 1) if (code.charAt(k) === "\n") line += 1;
  return line;
}

export function scanSource(source: string): SourceScan {
  const { code, strings } = blankNonCode(source);
  const imports: ImportReference[] = [];
  const nonLiteralDynamicImports: number[] = [];
  const take = (offset: number): void => {
    const specifier = strings.get(offset);
    if (specifier !== undefined) imports.push({ specifier, line: lineAt(code, offset) });
  };
  for (const match of code.matchAll(STATIC_FROM)) take(match.index + match[0].length);
  for (const match of code.matchAll(SIDE_EFFECT)) take(match.index + match[0].length);
  for (const match of code.matchAll(DYNAMIC)) {
    const offset = match.index + match[0].length;
    const quote = code.charAt(offset);
    if (quote === '"' || quote === "'") take(offset);
    else nonLiteralDynamicImports.push(lineAt(code, match.index));
  }
  return { imports, nonLiteralDynamicImports, code };
}
