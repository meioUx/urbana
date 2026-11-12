import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "data/**",
      "test-results/**",
      "tmp/**",
      "coverage/**",
    ],
  },
  {
    // Evita falhar o lint por diretivas eslint-disable que ficaram sem uso.
    linterOptions: { reportUnusedDisableDirectives: "warn" },
  },

  // Base: JavaScript (server, shared, tests, scripts, public).
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
  },
  {
    files: [
      "server/**/*.{js,mjs}",
      "tests/**/*.{js,mjs}",
      "scripts/**/*.{js,mjs}",
      "shared/**/*.mjs",
      "eslint.config.js",
      "vite.config.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    // Os scripts de navegador executam callbacks dentro da página (page.evaluate etc.).
    files: ["tests/**/*.{js,mjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    // shared/ e src/*.mjs rodam no servidor e no navegador.
    files: ["shared/**/*.mjs", "src/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["public/sw.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.serviceworker },
    },
  },

  // TypeScript / React (src/ e harness de testes em .tsx).
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["**/*.{ts,tsx,mts}"],
  })),
  {
    files: ["**/*.{ts,tsx,mts}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  // Regras calibradas: o que já passa permanece como erro; achados reais do código
  // existente ficam como aviso até serem corrigidos. Rebaixadas de "error" para "warn"
  // (não desligadas). Ao zerar uma regra, mova-a de volta para "error".
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      "no-unused-vars": "warn",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx,mts}"],
    rules: {
      "no-useless-escape": "warn",
      "no-regex-spaces": "warn",
      "no-empty": "warn",
      "no-useless-catch": "warn",
      "prefer-const": "warn",
    },
  },
  {
    files: ["**/*.{ts,tsx,mts}"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
);
