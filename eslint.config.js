const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    // React Compiler's react-hooks/immutability and react-hooks/refs rules
    // fire on Reanimated's intentionally-mutable SharedValue API
    // (translateX.value = ...). Disable for files that use Reanimated.
    files: ["app/upload.tsx", "app/(tabs)/index.tsx", "app/score/[id].tsx"],
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
    },
  },
]);
