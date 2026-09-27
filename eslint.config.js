import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // استثناء ملف المخرجات النهائي فقط لأنه ملف مولد تلقائياً (Build Artifact)
    ignores: ["main.js", "dist/**", "node_modules/**"],
  },
  {
    // ملفات إعدادات Node.js (مثل esbuild.config.mjs)
    files: ["esbuild.config.mjs"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // كود المصدر الخاص بالإضافة داخل src/
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
