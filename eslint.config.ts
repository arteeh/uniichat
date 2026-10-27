import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["web/app.js"] },
  tseslint.configs.strictTypeChecked,
  { languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } } },
  {
    rules: {
      // the code builds strings from numbers with + and ${} on purpose
      "@typescript-eslint/restrict-plus-operands": ["error", { allowNumberAndString: true }],
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // it flags correct code: `(x) => f(x)`, `return f()` where nothing is returned, `await sleep()` in a for loop's update
      "@typescript-eslint/no-confusing-void-expression": "off",
      // `a && f()` and `c ? f() : g()` as statements are correct
      "@typescript-eslint/no-unused-expressions": ["error", { allowShortCircuit: true, allowTernary: true }],
      // `const { $, ...rest } = x` drops a key; `_x` marks a parameter a signature needs
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", ignoreRestSiblings: true }],
      // each module's functions are grouped in a namespace on purpose
      "@typescript-eslint/no-namespace": "off",
      // process.env and the JSON-backed records lose keys with delete
      "@typescript-eslint/no-dynamic-delete": "off",
      // without noUncheckedIndexedAccess it calls every `xs[k] !== undefined` unnecessary, and it keeps signal.aborted narrowed to false across awaits
      "@typescript-eslint/no-unnecessary-condition": "off",
      // still needed: keyCode 229 marks an IME keystroke where isComposing isn't set (Safari), and older browsers lack caretPositionFromPoint
      "@typescript-eslint/no-deprecated": ["error", { allow: [{ from: "lib", name: "keyCode" }, { from: "lib", name: "caretRangeFromPoint" }] }],
    },
  },
  { files: ["**/*.js"], extends: [tseslint.configs.disableTypeChecked] },
);
