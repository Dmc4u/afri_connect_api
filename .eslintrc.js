module.exports = {
  env: {
    es2021: true,
    node: true,
  },
  extends: [
    "eslint:recommended",
    "airbnb-base",
    "plugin:prettier/recommended", // ✅ integrates Prettier and disables conflicting rules
  ],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  rules: {
    // ✅ Allow console logs (useful for dev APIs)
    "no-console": "off",

    // ✅ Allow _id (for MongoDB)
    "no-underscore-dangle": ["error", { allow: ["_id"] }],

    // ✅ Ignore unused "next" param in Express middleware
    "no-unused-vars": ["error", { argsIgnorePattern: "next" }],

    // 🧹 Optional: consistent import style and readability tweaks
    "import/extensions": "off",
    "import/no-extraneous-dependencies": "off",
    "import/prefer-default-export": "off",
    "prettier/prettier": "error",
  },
};
