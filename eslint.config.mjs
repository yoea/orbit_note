import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 本地临时探针/复刻渲染脚本（UI 重活验证用，非项目源码）。
    // ★ 必须写在这里：ESLint 的 flat config **不读 .gitignore**，单加 .gitignore 挡不住它。
    // 一次性验证脚本常常留个没用到的 import，会把门禁搞出一条无意义的告警。
    "Temp/**",
  ]),
]);

export default eslintConfig;
