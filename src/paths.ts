/** Path, language, and glob helpers used by the detectors. */

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function basename(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf("/");
  return i >= 0 ? n.slice(i + 1) : n;
}

export function extension(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i + 1).toLowerCase();
}

export function isTestFile(path: string): boolean {
  const p = normalizePath(path);
  const base = basename(p);
  if (/\.(test|spec)\.[^.]+$/.test(base)) return true;
  if (/^test_.*\.py$/.test(base) || /_test\.(py|go|rs)$/.test(base)) return true;
  if (base.endsWith("Test.java") || base.endsWith("Tests.java") || base.endsWith("Test.kt")) {
    return true;
  }
  if (/(^|\/)(__tests__|__test__|tests|test)\//.test(p)) return true;
  return false;
}

export function isSourceLike(path: string): boolean {
  const base = basename(path);
  if (
    /^(Makefile|makefile|GNUmakefile|Dockerfile|Justfile|justfile)$/.test(base) ||
    base === ".env" ||
    base.startsWith(".env.")
  ) {
    return true;
  }
  const ext = extension(path);
  return /^(ts|tsx|js|jsx|mjs|cjs|mts|cts|py|rb|go|rs|java|kt|kts|c|cc|cpp|h|hh|hpp|cs|php|swift|scala|sh|bash|zsh|yml|yaml|json|toml|env|tf)$/.test(
    ext,
  );
}

export type LangFamily = "js" | "py" | "rb" | "go" | "rs" | "java" | "sh" | "other";

export function langFamily(path: string): LangFamily {
  const ext = extension(path);
  if (/^(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/.test(ext)) return "js";
  if (ext === "py") return "py";
  if (ext === "rb") return "rb";
  if (ext === "go") return "go";
  if (ext === "rs") return "rs";
  if (/^(java|kt|kts)$/.test(ext)) return "java";
  if (/^(sh|bash|zsh)$/.test(ext) || /^(Makefile|makefile|GNUmakefile)$/.test(basename(path))) {
    return "sh";
  }
  return "other";
}

export function globToRegExp(pattern: string): RegExp {
  const n = normalizePath(pattern);
  let re = "^";
  for (let i = 0; i < n.length; i++) {
    const c = n[i]!;
    if (c === "*" && n[i + 1] === "*") {
      const next = n[i + 2];
      if (next === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if ("+.|()[]{}^$\\".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  re += "$";
  return new RegExp(re);
}

export function matchPath(pattern: string, path: string): boolean {
  const n = normalizePath(path);
  const p = normalizePath(pattern);
  if (p === n) return true;
  if (n.endsWith(`/${p}`)) return true;
  return globToRegExp(p).test(n);
}

export function splitLines(text: string): string[] {
  if (text.length === 0) return [];
  return text.split(/\r?\n/);
}

export function lineNumberAt(text: string, index: number): number {
  if (index <= 0) return 1;
  let line = 1;
  const end = Math.min(index, text.length);
  for (let i = 0; i < end; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}
