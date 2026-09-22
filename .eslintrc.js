module.exports = {
  root: true,
  env: {
    es6: true,
    node: true,
    browser: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'security', 'jsdoc'],
  extends: ['eslint:recommended', 'plugin:security/recommended'],
  rules: {
    'eol-last': 'error',
    // security/detect-object-injection just gives a lot of false positives
    // see https://github.com/nodesecurity/eslint-plugin-security/issues/21
    'security/detect-object-injection': 'off',
    '@typescript-eslint/no-var-requires': 'error',
    // Use typescript-eslint’s version of the no-redeclare rule, which isn’t triggered by overload signatures.
    // TODO remove this once we start using the full @typescript-eslint/recommended ruleset in #958
    'no-redeclare': 'off',
    '@typescript-eslint/no-redeclare': 'error',
    'jsdoc/multiline-blocks': [
      'warn',
      {
        noZeroLineText: false,
        noFinalLineText: false,
      },
    ],
  },
  overrides: [
    {
      files: ['**/*.{ts,tsx}'],
      rules: {
        '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^_' }],
        // TypeScript already enforces these rules better than any eslint setup can
        'no-undef': 'off',
        'no-dupe-class-members': 'off',
        'no-unused-vars': 'off',
      },
    },
    {
      files: ['packages/core/ably.d.ts', 'packages/core/modular.d.ts'],
      extends: ['plugin:jsdoc/recommended'],
      rules: {
        'jsdoc/check-tag-names': ['warn', { definedTags: ['experimental'] }],
      },
    },
  ],
  ignorePatterns: [
    'build',
    'packages/*/dist',
    'test',
    'tools',
    'scripts',
    'typedoc/generated',
    '/packages/core/react',
    'Gruntfile.js',
    'grunt',
  ],
  settings: {
    jsdoc: {
      tagNamePreference: {
        default: 'defaultValue',
      },
    },
  },
};
