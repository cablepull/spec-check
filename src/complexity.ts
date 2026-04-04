import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { join, relative, resolve, extname } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { parse } from "@typescript-eslint/parser";
import type { CriterionResult, GateStatus, LLMIdentity, ResolvedConfig, ServiceInfo } from "./types.js";
import { getThreshold } from "./config.js";
import { buildFilePath, buildStoragePaths, writeRecord } from "./storage.js";
import { DEPENDENCY_REGISTRY } from "./dependencies.js";

type Tier = "tier1" | "tier2";
type Language =
  | "typescript" | "javascript" | "python" | "go"
  | "java" | "c" | "cpp" | "csharp" | "ruby" | "swift" | "rust" | "scala" | "kotlin";

export interface ComplexityMetric {
  signature: string;
  name: string;
  file: string;
  line: number;
  language: Language;
  tier: Tier;
  cc: number;
  cognitive: number | null;
  length: number;
  nesting: number | null;
  param_count: number;
  scenario_count: number;
  cc_delta: number | null;
  cognitive_delta: number | null;
  length_delta: number | null;
  nesting_delta: number | null;
  trend_flags: Array<"CC-6" | "CC-7" | "CC-8" | "CC-9">;
  unsupported_reason?: string;
}

export interface ComplexityFileResult {
  file: string;
  language: Language;
  tier: Tier;
  average_cc: number;
  functions: ComplexityMetric[];
}

export interface ComplexityNote {
  code: string;
  detail: string;
  file?: string;
}

export interface ComplexityReport {
  path: string;
  status: GateStatus;
  criteria: CriterionResult[];
  files: ComplexityFileResult[];
  notes: ComplexityNote[];
  durationMs: number;
}

const SKIP_DIRS = new Set([
  "node_modules", "dist", "build", ".git", ".next", "coverage",
  ".cache", "__pycache__", "vendor",
]);

const EXTENSIONS: Record<string, Language> = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cc": "cpp",
  ".cpp": "cpp",
  ".cxx": "cpp",
  ".cs": "csharp",
  ".rb": "ruby",
  ".swift": "swift",
  ".rs": "rust",
  ".scala": "scala",
  ".kt": "kotlin",
};

const PYTHON_HELPER = `
import ast, json, sys

path = sys.argv[1]
source = open(path, "r", encoding="utf-8").read()
lines = source.splitlines()
tree = ast.parse(source, filename=path)

def count_length(start, end):
    count = 0
    for idx in range(start - 1, min(end, len(lines))):
        line = lines[idx].strip()
        if not line or line.startswith("#"):
            continue
        count += 1
    return count

class Analyzer(ast.NodeVisitor):
    def __init__(self):
        self.cc = 1
        self.cognitive = 0
        self.max_nesting = 0

    def walk_nested(self, node, nesting):
        self.max_nesting = max(self.max_nesting, nesting)
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                continue
            self.visit_with_nesting(child, nesting)

    def visit_with_nesting(self, node, nesting):
        if isinstance(node, ast.If):
            self.cc += 1
            self.cognitive += 1 + nesting
            self.walk_nested(node, nesting + 1)
            return
        if isinstance(node, (ast.For, ast.AsyncFor, ast.While)):
            self.cc += 1
            self.cognitive += 1 + nesting
            self.walk_nested(node, nesting + 1)
            return
        if isinstance(node, ast.Try):
            for handler in node.handlers:
                self.cc += 1
                self.cognitive += 1 + nesting
            self.walk_nested(node, nesting + 1)
            return
        if isinstance(node, ast.BoolOp):
            self.cc += max(0, len(node.values) - 1)
            self.cognitive += max(0, len(node.values) - 1)
        if isinstance(node, ast.IfExp):
            self.cc += 1
            self.cognitive += 1 + nesting
        if isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)):
            self.cc += len(node.generators)
            self.cognitive += len(node.generators) * (1 + nesting)

        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                continue
            self.visit_with_nesting(child, nesting)

results = []
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        analyzer = Analyzer()
        analyzer.walk_nested(node, 0)
        params = len(getattr(node.args, "posonlyargs", [])) + len(node.args.args) + len(node.args.kwonlyargs)
        results.append({
            "name": node.name,
            "line": node.lineno,
            "cc": analyzer.cc,
            "cognitive": analyzer.cognitive,
            "length": count_length(node.lineno, getattr(node, "end_lineno", node.lineno)),
            "nesting": analyzer.max_nesting,
            "param_count": params,
        })

print(json.dumps(results))
`;

const GO_HELPER = `
package main

import (
  "encoding/json"
  "go/ast"
  "go/parser"
  "go/token"
  "os"
  "strings"
)

type Result struct {
  Name       string \`json:"name"\`
  Line       int    \`json:"line"\`
  CC         int    \`json:"cc"\`
  Cognitive  int    \`json:"cognitive"\`
  Length     int    \`json:"length"\`
  Nesting    int    \`json:"nesting"\`
  ParamCount int    \`json:"param_count"\`
}

func countLength(lines []string, start, end int) int {
  count := 0
  inBlock := false
  for i := start - 1; i < end && i < len(lines); i++ {
    line := strings.TrimSpace(lines[i])
    if line == "" {
      continue
    }
    if strings.HasPrefix(line, "/*") {
      inBlock = true
    }
    if inBlock {
      if strings.Contains(line, "*/") {
        inBlock = false
      }
      continue
    }
    if strings.HasPrefix(line, "//") {
      continue
    }
    count++
  }
  return count
}

func visit(node ast.Node, nesting int, cc *int, cognitive *int, maxNesting *int) {
  if node == nil {
    return
  }
  if nesting > *maxNesting {
    *maxNesting = nesting
  }
  switch n := node.(type) {
  case *ast.IfStmt:
    *cc++
    *cognitive += 1 + nesting
    visit(n.Init, nesting, cc, cognitive, maxNesting)
    visit(n.Cond, nesting, cc, cognitive, maxNesting)
    visit(n.Body, nesting+1, cc, cognitive, maxNesting)
    visit(n.Else, nesting+1, cc, cognitive, maxNesting)
    return
  case *ast.ForStmt, *ast.RangeStmt:
    *cc++
    *cognitive += 1 + nesting
  case *ast.SwitchStmt, *ast.TypeSwitchStmt, *ast.SelectStmt:
    *cognitive += 1 + nesting
  case *ast.CaseClause:
    *cc++
    *cognitive += 1 + nesting
  case *ast.BinaryExpr:
    if n.Op.String() == "&&" || n.Op.String() == "||" {
      *cc++
      *cognitive++
    }
  }

  ast.Inspect(node, func(child ast.Node) bool {
    if child == nil || child == node {
      return true
    }
    switch child.(type) {
    case *ast.FuncDecl, *ast.FuncLit:
      return false
    }
    visit(child, nesting, cc, cognitive, maxNesting)
    return false
  })
}

func main() {
  path := os.Args[1]
  content, _ := os.ReadFile(path)
  lines := strings.Split(string(content), "\\n")
  fset := token.NewFileSet()
  file, err := parser.ParseFile(fset, path, content, parser.ParseComments)
  if err != nil {
    os.Stderr.WriteString(err.Error())
    os.Exit(1)
  }

  results := []Result{}
  for _, decl := range file.Decls {
    fn, ok := decl.(*ast.FuncDecl)
    if !ok || fn.Body == nil {
      continue
    }
    cc := 1
    cognitive := 0
    maxNesting := 0
    visit(fn.Body, 0, &cc, &cognitive, &maxNesting)
    name := fn.Name.Name
    if fn.Recv != nil && len(fn.Recv.List) > 0 {
      if ident, ok := fn.Recv.List[0].Type.(*ast.Ident); ok {
        name = ident.Name + "." + name
      }
    }
    paramCount := 0
    if fn.Type.Params != nil {
      for _, field := range fn.Type.Params.List {
        if len(field.Names) == 0 {
          paramCount++
        } else {
          paramCount += len(field.Names)
        }
      }
    }
    start := fset.Position(fn.Pos()).Line
    end := fset.Position(fn.End()).Line
    results = append(results, Result{
      Name: name,
      Line: start,
      CC: cc,
      Cognitive: cognitive,
      Length: countLength(lines, start, end),
      Nesting: maxNesting,
      ParamCount: paramCount,
    })
  }

  json.NewEncoder(os.Stdout).Encode(results)
}
`;

function walkFiles(root: string): string[] {
  const files: string[] = [];
  function scan(dir: string) {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith(".") || SKIP_DIRS.has(entry)) continue;
      const full = join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) {
        scan(full);
      } else if (stat.isFile() && EXTENSIONS[extname(entry).toLowerCase()]) {
        files.push(full);
      }
    }
  }
  scan(root);
  return files.sort();
}

function readText(path: string): string {
  try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function stripCommentOnlyLines(lines: string[]): string[] {
  let inBlock = false;
  return lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (inBlock) {
      if (trimmed.includes("*/")) inBlock = false;
      return false;
    }
    if (trimmed.startsWith("/*")) {
      inBlock = !trimmed.includes("*/");
      return false;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return false;
    return true;
  });
}

function countFunctionLength(source: string, start: number, end: number): number {
  const lines = source.split("\n").slice(start - 1, end);
  return stripCommentOnlyLines(lines).length;
}

function isNode(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && "type" in (value as Record<string, unknown>);
}

function childNodes(node: Record<string, unknown>): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) out.push(item);
      }
    } else if (isNode(value)) {
      out.push(value);
    }
  }
  return out;
}

function controlIncrement(type: string, node: Record<string, unknown>): { cc: number; cognitive: number; enter: boolean; alternateSameLevel?: boolean } {
  switch (type) {
    case "IfStatement":
      return { cc: 1, cognitive: 1, enter: true, alternateSameLevel: true };
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "CatchClause":
      return { cc: 1, cognitive: 1, enter: true };
    case "SwitchCase":
      return (node.test ? { cc: 1, cognitive: 1, enter: true } : { cc: 0, cognitive: 0, enter: true });
    case "ConditionalExpression":
      return { cc: 1, cognitive: 1, enter: true };
    case "LogicalExpression": {
      const op = String(node.operator ?? "");
      return op === "&&" || op === "||" ? { cc: 1, cognitive: 1, enter: false } : { cc: 0, cognitive: 0, enter: false };
    }
    default:
      return { cc: 0, cognitive: 0, enter: false };
  }
}

function functionName(node: Record<string, unknown>, parent?: Record<string, unknown>): string {
  if (node.type === "FunctionDeclaration" && isNode(node.id)) {
    return String(node.id.name ?? "anonymous");
  }
  if ((node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") && parent) {
    if (parent.type === "VariableDeclarator" && isNode(parent.id)) {
      return String(parent.id.name ?? "anonymous");
    }
    if ((parent.type === "Property" || parent.type === "MethodDefinition") && isNode(parent.key)) {
      return String(parent.key.name ?? parent.key.value ?? "anonymous");
    }
    if (parent.type === "AssignmentExpression" && isNode(parent.left)) {
      const left = parent.left as Record<string, unknown>;
      const property = isNode(left.property) ? left.property : undefined;
      return String(left.name ?? property?.name ?? property?.value ?? "anonymous");
    }
  }
  return "anonymous";
}

function analyzeFunctionNode(source: string, relFile: string, language: Language, node: Record<string, unknown>, name: string): ComplexityMetric {
  const startLine = Number((node.loc as { start?: { line?: number } } | undefined)?.start?.line ?? 1);
  const endLine = Number((node.loc as { end?: { line?: number } } | undefined)?.end?.line ?? startLine);
  const body = isNode(node.body) ? node.body : node;

  let cc = 1;
  let cognitive = 0;
  let maxNesting = 0;

  function visit(current: Record<string, unknown>, nesting: number, parent?: Record<string, unknown>) {
    if (current !== body && /Function(Expression|Declaration)$|ArrowFunctionExpression/.test(String(current.type))) {
      return;
    }
    const { cc: ccInc, cognitive: cogInc, enter, alternateSameLevel } = controlIncrement(String(current.type), current);
    cc += ccInc;
    cognitive += cogInc ? cogInc + (enter ? nesting : 0) : 0;
    if (enter) maxNesting = Math.max(maxNesting, nesting + 1);

    for (const child of childNodes(current)) {
      let nextNesting = nesting;
      if (enter) nextNesting = nesting + 1;
      if (alternateSameLevel && current.type === "IfStatement" && child === current.alternate && isNode(current.alternate) && current.alternate.type === "IfStatement") {
        nextNesting = nesting;
      }
      visit(child, nextNesting, current);
    }
  }

  visit(body, 0);

  const params = Array.isArray(node.params) ? node.params.length : 0;
  return {
    signature: `${relFile}::${name}@${startLine}`,
    name,
    file: relFile,
    line: startLine,
    language,
    tier: "tier1",
    cc,
    cognitive,
    length: countFunctionLength(source, startLine, endLine),
    nesting: maxNesting,
    param_count: params,
    scenario_count: 0,
    cc_delta: null,
    cognitive_delta: null,
    length_delta: null,
    nesting_delta: null,
    trend_flags: [],
  };
}

function analyzeTsJsFile(file: string, root: string): ComplexityMetric[] {
  const source = readText(file);
  const ast = parse(source, {
    loc: true,
    range: true,
    sourceType: "module",
    ecmaVersion: "latest",
    ecmaFeatures: { jsx: true },
  }) as unknown as Record<string, unknown>;

  const results: ComplexityMetric[] = [];
  function traverse(node: Record<string, unknown>, parent?: Record<string, unknown>) {
    const type = String(node.type);
    if (/Function(Expression|Declaration)$|ArrowFunctionExpression/.test(type)) {
      results.push(analyzeFunctionNode(source, relative(root, file), EXTENSIONS[extname(file).toLowerCase()]!, node, functionName(node, parent)));
    }
    for (const child of childNodes(node)) {
      traverse(child, node);
    }
  }
  traverse(ast);
  return results;
}

function runEmbeddedHelper(code: string, ext: string, command: string, file: string): { ok: boolean; stdout: string; stderr: string } {
  const dir = mkdtempSync(join(tmpdir(), "spec-check-"));
  const helperPath = join(dir, `helper.${ext}`);
  writeFileSync(helperPath, code, "utf-8");
  const parts = command.split(" ");
  const proc = spawnSync(parts[0]!, [...parts.slice(1), helperPath, file], {
    encoding: "utf-8",
    timeout: 5_000,
  });
  rmSync(dir, { recursive: true, force: true });
  return { ok: proc.status === 0, stdout: proc.stdout ?? "", stderr: proc.stderr ?? "" };
}

function analyzePythonFile(file: string, root: string): ComplexityMetric[] {
  const output = runEmbeddedHelper(PYTHON_HELPER, "py", "python3", file);
  if (!output.ok) throw new Error(output.stderr.trim() || "python analysis failed");
  const parsed = JSON.parse(output.stdout) as Array<Record<string, unknown>>;
  return parsed.map((item) => ({
    signature: `${relative(root, file)}::${String(item.name)}@${Number(item.line)}`,
    name: String(item.name),
    file: relative(root, file),
    line: Number(item.line),
    language: "python",
    tier: "tier1",
    cc: Number(item.cc),
    cognitive: Number(item.cognitive),
    length: Number(item.length),
    nesting: Number(item.nesting),
    param_count: Number(item.param_count),
    scenario_count: 0,
    cc_delta: null,
    cognitive_delta: null,
    length_delta: null,
    nesting_delta: null,
    trend_flags: [],
  }));
}

function analyzeGoFile(file: string, root: string): ComplexityMetric[] {
  const output = runEmbeddedHelper(GO_HELPER, "go", "go run", file);
  if (!output.ok) throw new Error(output.stderr.trim() || "go analysis failed");
  const parsed = JSON.parse(output.stdout) as Array<Record<string, unknown>>;
  return parsed.map((item) => ({
    signature: `${relative(root, file)}::${String(item.name)}@${Number(item.line)}`,
    name: String(item.name),
    file: relative(root, file),
    line: Number(item.line),
    language: "go",
    tier: "tier1",
    cc: Number(item.cc),
    cognitive: Number(item.cognitive),
    length: Number(item.length),
    nesting: Number(item.nesting),
    param_count: Number(item.param_count),
    scenario_count: 0,
    cc_delta: null,
    cognitive_delta: null,
    length_delta: null,
    nesting_delta: null,
    trend_flags: [],
  }));
}

function pythonAvailable(): boolean {
  return spawnSync("python3", ["--version"], { encoding: "utf-8" }).status === 0;
}

function goAvailable(): boolean {
  return spawnSync("go", ["version"], { encoding: "utf-8" }).status === 0;
}

function lizardAvailable(): boolean {
  return spawnSync("lizard", ["--version"], { encoding: "utf-8" }).status === 0;
}

function analyzeLizardFiles(files: string[], root: string): { metrics: ComplexityMetric[]; notes: ComplexityNote[] } {
  if (files.length === 0) return { metrics: [], notes: [] };
  if (!lizardAvailable()) {
    const install = DEPENDENCY_REGISTRY.lizard?.install ?? {};
    const guidance = Object.entries(install).map(([manager, cmd]) => `${manager}: ${cmd}`).join(" | ");
    return {
      metrics: [],
      notes: files.map((file) => ({
        code: "DEPENDENCY_MISSING",
        file: relative(root, file),
        detail: `lizard is not installed; Tier 2 analysis skipped. Install with ${guidance || "pipx install lizard"}.`,
      })),
    };
  }

  const proc = spawnSync("lizard", ["--csv", ...files], {
    encoding: "utf-8",
    timeout: 10_000,
  });
  if (proc.status !== 0) {
    return {
      metrics: [],
      notes: files.map((file) => ({
        code: "ANALYSIS_FAILED",
        file: relative(root, file),
        detail: `lizard failed: ${(proc.stderr || proc.stdout || "unknown error").trim()}`,
      })),
    };
  }

  const metrics: ComplexityMetric[] = [];
  const lines = (proc.stdout ?? "").trim().split("\n").filter(Boolean);
  if (lines.length === 0) {
    return { metrics: [], notes: [] };
  }

  for (const line of lines) {
    const parts = line.split(",");
    if (parts.length < 10) continue;
    const nloc = Number(parts[0]);
    const cc = Number(parts[1]);
    const params = Number(parts[3]);
    const name = String(parts[7] ?? parts[5] ?? "anonymous").replace(/^"|"$/g, "");
    const sourceFile = String(parts[6] ?? "").replace(/^"|"$/g, "");
    const rel = relative(root, sourceFile);
    const language = EXTENSIONS[extname(sourceFile).toLowerCase()];
    if (!language) continue;
    const lineNo = Number(parts[9] ?? 1);
    metrics.push({
      signature: `${rel}::${name}@${lineNo}`,
      name,
      file: rel,
      line: lineNo,
      language,
      tier: "tier2",
      cc,
      cognitive: null,
      length: nloc,
      nesting: null,
      param_count: params,
      scenario_count: 0,
      cc_delta: null,
      cognitive_delta: null,
      length_delta: null,
      nesting_delta: null,
      trend_flags: [],
      unsupported_reason: `lizard does not provide cognitive complexity or nesting depth for ${language}`,
    });
  }

  return { metrics, notes: [] };
}

function scenarioCountByFunction(specPath: string): Map<string, number> {
  const text = readText(join(specPath, "requirements.md"));
  const counts = new Map<string, number>();
  if (!text) return counts;

  const blocks = text.split(/(?=^\s*(?:#{1,6}\s+)?Example:)/im);
  for (const block of blocks) {
    const normalized = block.toLowerCase();
    const identifiers = [...new Set(block.match(/\b[a-zA-Z_][a-zA-Z0-9_]{2,}\b/g) ?? [])];
    for (const name of identifiers) {
      const variants = [
        name.toLowerCase(),
        name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase(),
        name.replace(/_/g, " ").toLowerCase(),
      ];
      if (variants.some((variant) => normalized.includes(variant))) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
  }
  return counts;
}

interface HistoricalMetric {
  timestamp: string;
  signature: string;
  cc: number;
  cognitive: number | null;
  length: number;
  nesting: number | null;
}

function readHistory(dir: string): HistoricalMetric[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  function scan(current: string) {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) scan(full);
      else if (entry.includes("_complexity_") && entry.endsWith(".jsonl")) files.push(full);
    }
  }
  scan(dir);
  const history: HistoricalMetric[] = [];
  for (const file of files) {
    const line = readText(file).trim();
    if (!line) continue;
    try {
      const record = JSON.parse(line) as { results?: HistoricalMetric[]; timestamp?: string };
      for (const item of record.results ?? []) {
        history.push({
          ...item,
          timestamp: item.timestamp ?? record.timestamp ?? "",
        });
      }
    } catch {}
  }
  return history
    .filter((item) => item.timestamp)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function applyHistory(metric: ComplexityMetric, history: HistoricalMetric[]): void {
  const prior = history.filter((item) => item.signature === metric.signature);
  if (prior.length === 0) return;
  const last = prior[prior.length - 1]!;
  metric.cc_delta = metric.cc - last.cc;
  metric.cognitive_delta =
    metric.cognitive === null || last.cognitive === null ? null : metric.cognitive - last.cognitive;
  metric.length_delta = metric.length - last.length;
  metric.nesting_delta =
    metric.nesting === null || last.nesting === null ? null : metric.nesting - last.nesting;

  if (prior.length < 3) return;
  const recent = prior.slice(-3);
  const ccSeries = [...recent.map((item) => item.cc), metric.cc];
  const lenSeries = [...recent.map((item) => item.length), metric.length];
  const cogSeries = [...recent.map((item) => item.cognitive), metric.cognitive];
  const nestSeries = [...recent.map((item) => item.nesting), metric.nesting];
  const increasing = (series: number[]) => series.every((value, idx) => idx === 0 || value > series[idx - 1]!);
  const allNumbers = (series: Array<number | null>): series is number[] => series.every((value) => value !== null);

  if (increasing(ccSeries)) metric.trend_flags.push("CC-6");
  if (allNumbers(cogSeries) && increasing(cogSeries)) metric.trend_flags.push("CC-7");
  if (increasing(lenSeries)) metric.trend_flags.push("CC-8");
  if (allNumbers(nestSeries) && increasing(nestSeries)) metric.trend_flags.push("CC-9");
}

function statusFromCriteria(criteria: CriterionResult[]): GateStatus {
  if (criteria.some((item) => item.status === "BLOCK")) return "BLOCKED";
  if (criteria.some((item) => item.status === "VIOLATION")) return "FAILING";
  if (criteria.some((item) => item.status === "WARNING")) return "PASSING_WITH_WARNINGS";
  return "PASS";
}

function buildCriteria(metrics: ComplexityMetric[], fileResults: ComplexityFileResult[], config: ResolvedConfig, notes: ComplexityNote[]): CriterionResult[] {
  const criteria: CriterionResult[] = [];
  const hasUnsupportedCognitive = metrics.some((item) => item.cognitive === null);
  const hasUnsupportedNesting = metrics.some((item) => item.nesting === null);
  const cc1 = metrics.filter((item) => item.cc > Number(getThreshold(config, "CC-1")));
  criteria.push(cc1.length > 0 ? {
    id: "CC-1",
    status: "VIOLATION",
    detail: `${cc1.length} function(s) exceed the CC threshold.`,
    evidence: cc1.slice(0, 5).map((item) => `${item.file}:${item.line} ${item.name} CC=${item.cc}`),
    fix: "Reduce branching complexity or split the function into smaller units.",
  } : { id: "CC-1", status: "PASS", detail: "No function exceeds the CC threshold." });

  const cc2Threshold = Number(getThreshold(config, "CC-2"));
  const cc2 = metrics.filter((item) => item.cc > cc2Threshold && item.scenario_count < item.cc);
  criteria.push(cc2.length > 0 ? {
    id: "CC-2",
    status: "WARNING",
    detail: `${cc2.length} high-CC function(s) have fewer spec scenarios than their CC value.`,
    evidence: cc2.slice(0, 5).map((item) => `${item.file}:${item.line} ${item.name} scenarios=${item.scenario_count}, cc=${item.cc}`),
    fix: "Add spec examples covering the missing behavioral branches.",
  } : { id: "CC-2", status: "PASS", detail: "Spec scenario coverage is at or above CC for high-complexity functions." });

  const cc3Threshold = Number(getThreshold(config, "CC-3"));
  const cc3 = fileResults.filter((item) => item.average_cc > cc3Threshold);
  criteria.push(cc3.length > 0 ? {
    id: "CC-3",
    status: "WARNING",
    detail: `${cc3.length} file(s) exceed the average CC threshold.`,
    evidence: cc3.slice(0, 5).map((item) => `${item.file} avg_cc=${item.average_cc.toFixed(2)}`),
    fix: "Reduce per-file branching concentration by splitting or simplifying the functions in these files.",
  } : { id: "CC-3", status: "PASS", detail: "Average CC per file is within threshold." });

  const cc4Threshold = Number(getThreshold(config, "CC-4"));
  const supportedNesting = metrics.filter((item) => item.nesting !== null);
  const cc4 = supportedNesting.filter((item) => (item.nesting ?? 0) > cc4Threshold);
  criteria.push(cc4.length > 0 ? {
    id: "CC-4",
    status: "WARNING",
    detail: `${cc4.length} function(s) exceed the nesting threshold.`,
    evidence: cc4.slice(0, 5).map((item) => `${item.file}:${item.line} ${item.name} nesting=${item.nesting}`),
    fix: "Flatten control flow with guard clauses, extraction, or early returns.",
  } : supportedNesting.length === 0 ? {
    id: "CC-4",
    status: "PASS",
    detail: "Nesting depth is unsupported for the analyzed Tier 2 languages.",
  } : { id: "CC-4", status: "PASS", detail: "Nesting depth is within threshold." });

  const cc5Threshold = Number(getThreshold(config, "CC-5"));
  const cc5 = metrics.filter((item) => item.param_count > cc5Threshold);
  criteria.push(cc5.length > 0 ? {
    id: "CC-5",
    status: "WARNING",
    detail: `${cc5.length} function(s) exceed the parameter-count threshold.`,
    evidence: cc5.slice(0, 5).map((item) => `${item.file}:${item.line} ${item.name} params=${item.param_count}`),
    fix: "Collapse related parameters into a value object or split responsibilities.",
  } : { id: "CC-5", status: "PASS", detail: "Parameter count is within threshold." });

  for (const id of ["CC-6", "CC-7", "CC-8", "CC-9"] as const) {
    const flagged = metrics.filter((item) => item.trend_flags.includes(id));
    criteria.push(flagged.length > 0 ? {
      id,
      status: "WARNING",
      detail: `${flagged.length} function(s) show a sustained increasing ${id.replace("CC-", "").toLowerCase()} trend.`,
      evidence: flagged.slice(0, 5).map((item) => `${item.file}:${item.line} ${item.name}`),
      fix: "Review recent refactors and reduce the sustained growth in this metric.",
    } : {
      id,
      status: "PASS",
      detail: id === "CC-7" && hasUnsupportedCognitive
        ? "Trend skipped where cognitive complexity is unsupported for Tier 2 languages."
        : id === "CC-9" && hasUnsupportedNesting
        ? "Trend skipped where nesting depth is unsupported for Tier 2 languages."
        : (id === "CC-7" || id === "CC-9") && notes.some((note) => note.code === "DEPENDENCY_MISSING")
        ? `Trend skipped where ${id === "CC-7" ? "cognitive complexity" : "nesting depth"} is unsupported for Tier 2 languages.`
        : notes.some((note) => note.code === "NO_HISTORY")
        ? "Insufficient history to evaluate sustained trend."
        : "No sustained increasing trend detected.",
    });
  }

  return criteria;
}

export async function runComplexity(service: ServiceInfo, config: ResolvedConfig, llm: LLMIdentity): Promise<ComplexityReport> {
  const start = Date.now();
  const root = service.rootPath;
  const files = walkFiles(root);
  const notes: ComplexityNote[] = [];
  const metrics: ComplexityMetric[] = [];
  const scenarioCounts = scenarioCountByFunction(service.specPath);
  const pyAvailable = pythonAvailable();
  const goIsAvailable = goAvailable();
  const tier2Files: string[] = [];

  for (const file of files) {
    const language = EXTENSIONS[extname(file).toLowerCase()];
    if (!language) continue;
    try {
      if ((language === "typescript" || language === "javascript")) {
        metrics.push(...analyzeTsJsFile(file, root));
      } else if (language === "python") {
        if (!pyAvailable) {
          notes.push({ code: "RUNTIME_NOT_FOUND", detail: "Python runtime not found; Python files were skipped.", file: relative(root, file) });
          continue;
        }
        metrics.push(...analyzePythonFile(file, root));
      } else if (language === "go") {
        if (!goIsAvailable) {
          notes.push({ code: "RUNTIME_NOT_FOUND", detail: "Go runtime not found; Go files were skipped.", file: relative(root, file) });
          continue;
        }
        metrics.push(...analyzeGoFile(file, root));
      } else {
        tier2Files.push(file);
      }
    } catch (error) {
      notes.push({ code: "ANALYSIS_FAILED", detail: String(error), file: relative(root, file) });
    }
  }

  const tier2 = analyzeLizardFiles(tier2Files, root);
  metrics.push(...tier2.metrics);
  notes.push(...tier2.notes);

  for (const metric of metrics) {
    metric.scenario_count = scenarioCounts.get(metric.name) ?? scenarioCounts.get(metric.name.replace(/\./g, "")) ?? 0;
  }

  const storagePaths = buildStoragePaths(root, service, config.value.metrics.db_path);
  const historyDir = join(storagePaths.storageRoot, storagePaths.org, storagePaths.repo, storagePaths.service);
  const history = readHistory(historyDir);
  if (history.length === 0) notes.push({ code: "NO_HISTORY", detail: "No prior complexity runs found; delta trends were not evaluated." });
  for (const metric of metrics) {
    applyHistory(metric, history);
  }

  metrics.sort((a, b) => b.cc - a.cc || a.file.localeCompare(b.file) || a.line - b.line);
  const grouped = new Map<string, ComplexityFileResult>();
  for (const metric of metrics) {
    const current = grouped.get(metric.file) ?? {
      file: metric.file,
      language: metric.language,
      tier: metric.tier,
      average_cc: 0,
      functions: [],
    };
    current.functions.push(metric);
    grouped.set(metric.file, current);
  }
  const fileResults = [...grouped.values()].map((item) => ({
    ...item,
    functions: item.functions.sort((a, b) => b.cc - a.cc || a.line - b.line),
    average_cc: item.functions.reduce((sum, fn) => sum + fn.cc, 0) / Math.max(item.functions.length, 1),
  })).sort((a, b) => b.average_cc - a.average_cc || a.file.localeCompare(b.file));

  const criteria = buildCriteria(metrics, fileResults, config, notes);

  const filePath = buildFilePath(storagePaths, llm, "complexity");
  writeRecord(filePath, {
    schema_version: 1,
    timestamp: new Date().toISOString(),
    project_path: root,
    org: storagePaths.org,
    repo: storagePaths.repo,
    service: storagePaths.service,
    git_commit: storagePaths.commit8,
    branch: storagePaths.branch,
    llm_provider: llm.provider,
    llm_model: llm.model,
    llm_id: llm.id,
    results: metrics.map((item) => ({
      signature: item.signature,
      file: item.file,
      name: item.name,
      line: item.line,
      cc: item.cc,
      cognitive: item.cognitive,
      length: item.length,
      nesting: item.nesting,
      param_count: item.param_count,
      scenario_count: item.scenario_count,
      cc_delta: item.cc_delta,
      cognitive_delta: item.cognitive_delta,
      length_delta: item.length_delta,
      nesting_delta: item.nesting_delta,
    })),
  });

  return {
    path: root,
    status: statusFromCriteria(criteria),
    criteria,
    files: fileResults,
    notes,
    durationMs: Date.now() - start,
  };
}
