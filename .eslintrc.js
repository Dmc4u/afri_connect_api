module.exports = {
  ignorePatterns: ["node_modules/**", "logs/**", "uploads/**", "*.log", "bash.exe.stackdump"],
  env: {
    es2021: true,
    node: true,
  },
  extends: ["eslint:recommended", "airbnb-base", "plugin:prettier/recommended"],
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  rules: {
    // Allow console logs in the API.
    "no-console": "off",

    // Allow _id for MongoDB documents and keep other legacy names visible.
    "no-underscore-dangle": ["warn", { allow: ["_id"] }],

    // Keep legacy cleanup visible without failing the build.
    "no-unused-vars": ["warn", { argsIgnorePattern: "next" }],
    "prettier/prettier": "warn",

    // The existing backend is CommonJS/Express and uses pragmatic service scripts.
    "import/extensions": "off",
    "import/newline-after-import": "warn",
    "import/no-extraneous-dependencies": "off",
    "import/no-unresolved": "warn",
    "import/order": "warn",
    "import/prefer-default-export": "off",
    camelcase: "warn",
    "consistent-return": "warn",
    "dot-notation": "warn",
    "global-require": "warn",
    "no-await-in-loop": "warn",
    "no-bitwise": "warn",
    "no-cond-assign": "warn",
    "no-continue": "warn",
    "no-dupe-keys": "warn",
    "no-else-return": "warn",
    "no-nested-ternary": "warn",
    "no-param-reassign": "warn",
    "no-plusplus": "warn",
    "no-promise-executor-return": "warn",
    "no-restricted-globals": "warn",
    "no-restricted-syntax": "warn",
    "no-return-await": "warn",
    "no-shadow": "warn",
    "no-undef": "warn",
    "no-unneeded-ternary": "warn",
    "no-useless-catch": "warn",
    "no-useless-escape": "warn",
    "no-use-before-define": "warn",
    "object-shorthand": "warn",
    "one-var": "warn",
    "prefer-const": "warn",
    "prefer-destructuring": "warn",
    "prefer-template": "warn",
    radix: "warn",
    "spaced-comment": "warn",
  },
};
