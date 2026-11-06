import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const directory = join(root, "src/locales");
const failures = [];

function flatten(tree, prefix = "", result = new Map()) {
  for (const [name, value] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${name}` : name;
    if (typeof value === "string") result.set(key, value);
    else if (value && typeof value === "object" && !Array.isArray(value)) flatten(value, key, result);
    else failures.push(`${key}: expected a string or an object`);
  }
  return result;
}

function readCatalog(name) {
  const text = readFileSync(join(directory, name), "utf8");
  // JSON.parse alone silently accepts duplicate properties, losing translations.
  const syntax = ts.parseJsonText(name, text);
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const seen = new Set();
      for (const property of node.properties) {
        const key = property.name?.text;
        if (seen.has(key)) failures.push(`${name}: duplicate key ${key}`);
        seen.add(key);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return flatten(JSON.parse(text));
}

const source = readCatalog("en.json");
const placeholders = (text) => [...new Set([...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]))].sort().join(",");
const baseKey = (key) => key.replace(/_(zero|one|two|few|many|other)$/, "");
const hasKey = (key) => source.has(key) || [...source.keys()].some((candidate) => baseKey(candidate) === key);
for (const name of readdirSync(directory).filter((name) => name.endsWith(".json") && name !== "en.json")) {
  const catalog = readCatalog(name);
  for (const [key, text] of catalog) {
    const reference = source.get(key) ?? source.get(`${baseKey(key)}_other`);
    if (reference === undefined) failures.push(`${name}: unknown key ${key}`);
    else if (text && placeholders(text) !== placeholders(reference)) failures.push(`${name}: incompatible parameters at ${key}`);
  }
  const missing = [...source.keys()].filter((key) => !catalog.get(key));
  console.log(`${name}: ${source.size - missing.length}/${source.size} source messages translated; ${missing.length} use English fallback`);
  if (process.argv.includes("--list-missing")) for (const key of missing) console.log(`  ${key}`);
}

function visitFiles(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = join(directory, entry.name);
    if (entry.isDirectory()) visitFiles(file);
    else if (/\.tsx?$/.test(file)) {
      const code = readFileSync(file, "utf8");
      const syntax = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
      function checkArgument(argument) {
        if (ts.isStringLiteral(argument) && !hasKey(argument.text)) {
          const { line } = syntax.getLineAndCharacterOfPosition(argument.getStart(syntax));
          failures.push(`${file.slice(root.length + 1)}:${line + 1}: unknown translation key ${argument.text}`);
        } else if (ts.isConditionalExpression(argument)) {
          checkArgument(argument.whenTrue);
          checkArgument(argument.whenFalse);
        }
      }
      function visit(node) {
        if (ts.isCallExpression(node) && /^(t|locale\.t|translateLocaleMessage|localeMessage)$/.test(node.expression.getText(syntax)) && node.arguments[0]) checkArgument(node.arguments[0]);
        if (ts.isJsxAttribute(node) && node.name.getText(syntax) === "titleKey" && node.initializer && ts.isStringLiteral(node.initializer)) checkArgument(node.initializer);
        ts.forEachChild(node, visit);
      }
      visit(syntax);
    }
  }
}
visitFiles(join(root, "src"));
if (failures.length) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else console.log("Catalog structure, duplicate keys, parameters and literal references are valid.");
