module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
  ],
  ignorePatterns: ["dist", "dist-electron", "release", ".eslintrc.cjs"],
  parser: "@typescript-eslint/parser",
  plugins: ["react-refresh", "unused-imports", "simple-import-sort"],
  rules: {
    "react-refresh/only-export-components": [
      "warn",
      { allowConstantExport: true },
    ],
    "simple-import-sort/imports": "error",
    "simple-import-sort/exports": "error",
    "unused-imports/no-unused-imports": "warn",
    // A cast through unknown switches the type checker off. Type it, or say why here (GRYT-1792).
    "no-restricted-syntax": [
      "error",
      {
        selector: "TSAsExpression > TSAsExpression.expression[typeAnnotation.type='TSUnknownKeyword']",
        message: "Don't cast through unknown. Fix the types, or disable this line with the reason.",
      },
    ],
    "@typescript-eslint/no-explicit-any": "error",
    // Our own values get real types. A file that parses outside input carries a disable at the
    // top saying so, and the goal is to remove each one (GRYT-1792).
    "@typescript-eslint/ban-types": [
      "error",
      { extendDefaults: true, types: { unknown: "Type it. If it's outside input being checked, disable at the top of the file with the reason." } },
    ],
  },
  overrides: [
    // Tests reach into window for hooks the app exposes to them, which is what the cast is for.
    { files: ["e2e/**"], rules: { "no-restricted-syntax": "off", "@typescript-eslint/ban-types": "off" } },
    // Review-required auth files: unknown is untrusted vault, token and certificate input checked here.
    { files: ["src/packages/common/src/auth/**"], rules: { "@typescript-eslint/ban-types": "off" } },
    // TS 5.7 types a Uint8Array's buffer as ArrayBufferLike, which BufferSource won't take.
    { files: ["src/packages/common/src/auth/server-pins.ts"], rules: { "no-restricted-syntax": "off" } },
  ],
  "parserOptions": {
    "sourceType": "module",
    "ecmaVersion": "latest"
  }
};
