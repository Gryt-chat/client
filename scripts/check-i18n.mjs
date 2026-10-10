import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import i18next from "i18next";
import ts from "typescript";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const en = JSON.parse(read("src/packages/i18n/locales/en.json"));
const zh = JSON.parse(read("src/packages/i18n/locales/zh-CN.json"));
const flatten = (data, prefix = "") => Object.entries(data).flatMap(([key, value]) =>
  typeof value === "string" ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`));
const english = new Map(flatten(en));
const chinese = new Map(flatten(zh));
assert.deepEqual([...english.keys()].sort(), [...chinese.keys()].sort());
for (const [key, value] of english) {
  const placeholders = (text) => [...text.matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1]).sort();
  assert.deepEqual(placeholders(value), placeholders(chinese.get(key)), key);
  const tags = (text) => [...text.matchAll(/<\/?([a-z]+)>/g)].map((match) => match[0]).sort();
  assert.deepEqual(tags(value), tags(chinese.get(key)), `${key}: translator component tags`);
  assert.ok(chinese.get(key).trim(), key);
}
function checkSource(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) checkSource(file);
    else if (/\.tsx?$/.test(file)) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/\b(?:tr|i18n\.t)\("([\w.-]+)"/g)) {
        assert.ok(english.has(match[1]) || english.has(match[1] + "_other"), `${file}: unknown locale key ${match[1]}`);
      }
      for (const match of source.matchAll(/\bi18nKey="([\w.-]+)"/g)) assert.ok(english.has(match[1]), `${file}: unknown Trans key ${match[1]}`);
    }
  }
}
checkSource(fileURLToPath(new URL("../src", import.meta.url)));
const bootstrap = read("src/main.tsx");
const hydrate = bootstrap.indexOf("initGlobalStorage().then(async () => {");
assert.ok(hydrate >= 0);
const restored = bootstrap.indexOf("await restoreLanguagePreference();", hydrate);
assert.ok(restored > hydrate && restored < bootstrap.indexOf("ReactDOM.createRoot", hydrate), "restore language after file storage hydration and before React render");

const source = ts.transpileModule(read("src/packages/i18n/preferences.ts"), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { detectLanguage, readLanguagePreference, resolveLanguage } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
assert.equal(detectLanguage(["zh-CN"]), "zh-CN");
assert.equal(detectLanguage(["zh-Hans-SG", "en"]), "zh-CN");
assert.equal(detectLanguage(["zh-TW", "en-US"]), "en");
assert.equal(detectLanguage(["fr-FR", "zh-CN"]), "zh-CN");
assert.equal(detectLanguage(["en-GB", "zh-CN"]), "en");
assert.equal(detectLanguage(["ja-JP"]), "en");
assert.equal(readLanguagePreference({ getItem() { throw new Error("blocked"); } }), "system");
assert.equal(readLanguagePreference({ getItem() { return "not-a-language"; } }), "system");
assert.equal(resolveLanguage("en", ["zh-CN"]), "en");
assert.equal(resolveLanguage("zh-CN", ["en-US"]), "zh-CN");

const missing = structuredClone(zh);
delete missing.ui.cancel;
const instance = i18next.createInstance();
await instance.init({ resources: { en: { translation: en }, "zh-CN": { translation: missing } }, lng: "zh-CN", fallbackLng: "en", interpolation: { escapeValue: false } });
assert.equal(instance.t("ui.cancel"), "Cancel");
assert.equal(instance.t("chat.messagePerson", { name: "<小明 & Alice>" }), "向 <小明 & Alice> 发送消息");
assert.equal(instance.t("invite.members", { count: 2 }), "2 位成员");
await instance.changeLanguage("en");
assert.equal(instance.t("invite.members", { count: 1 }), "1 member");
assert.equal(instance.t("invite.members", { count: 2 }), "2 members");
console.log(`i18n: ${english.size} matching keys; placeholders, detection, blocked storage, fallback, interpolation and plurals passed`);
