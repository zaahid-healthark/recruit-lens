// Root ESLint (flat config) for the TypeScript packages (shared + server).
// The mobile app uses Expo's own linting: run `npx expo lint` inside /mobile.
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "mobile/**", "**/*.js", "**/*.mjs"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // `any` is used deliberately at the OpenAI SDK boundary (newer API params lag behind SDK types).
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  }
);
