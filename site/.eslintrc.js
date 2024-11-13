/* eslint-disable import/no-extraneous-dependencies, @typescript-eslint/no-var-requires */
const { rules: baseES6Rules } = require('eslint-config-airbnb-base/rules/es6');

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  plugins: ['@typescript-eslint', 'import', 'unicorn', 'react', '@tanstack/query'],
  extends: [
    'airbnb',
    'airbnb-typescript',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/typescript',
    'plugin:unicorn/recommended',
    'next/core-web-vitals',
    'plugin:@tanstack/eslint-plugin-query/recommended',
    'prettier',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaFeatures: {
      jsx: true,
    },
    project: './tsconfig.json',
  },
  settings: {
    react: {
      pragma: 'React',
      version: 'detect',
    },
  },
  globals: {
    __DEV__: false,
    jasmine: false,
    beforeAll: false,
    afterAll: false,
    beforeEach: false,
    afterEach: false,
    test: false,
    expect: false,
    describe: false,
    jest: false,
    it: false,
  },
  rules: {
    // Always specify extensions for non-standard files.
    'import/extensions': [
      'error',
      'ignorePackages',
      {
        ts: 'never',
        tsx: 'never',
      },
    ],
    // We do not use Flow and already use 'import/extensions'
    // See: https://github.com/benmosher/eslint-plugin-import/blob/master/docs/rules/no-duplicates.md#when-not-to-use-it
    'import/no-duplicates': 'off',
    // Disallow default export https://basarat.gitbook.io/typescript/main-1/defaultisbad
    'import/prefer-default-export': 'off',
    // In TypeScript getter and setter internal values should be stored in properties with an underscore prefix
    'no-underscore-dangle': ['error', { allowAfterThis: true }],
    // Use next-i18next instead of react-i18next directly to support SSR
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: 'react-i18next',
            importNames: ['useTranslation'],
            message: 'Use the useTranslation hook from next-i18next instead.',
          },
        ],
      },
    ],
    // Types are often not the default export
    'unicorn/import-style': 'off',
    // Conflict with "consistent-return"
    'unicorn/no-useless-undefined': 'off',
    // For loops are not allowed by the Airbnb style guide.
    // See: https://github.com/airbnb/javascript#iterators--nope
    'unicorn/no-array-for-each': 'off',
    // Direct exports from imports are not allowed by the Airbnb style guide.
    // See: https://github.com/airbnb/javascript#modules--no-export-from-import
    'unicorn/prefer-export-from': 'off',
    // TypeScript no longer finds the types when using the protocol
    'unicorn/prefer-node-protocol': 'off',
    'unicorn/prefer-module': 'off',
    // ES5 target does not support top level await
    'unicorn/prefer-top-level-await': 'off',
    // ES5 target does not support iterable spread
    'unicorn/prefer-spread': 'off',
    // Has false positives and TypeScript already checks usages
    'react/no-unused-prop-types': 'off',
    // Default props is being deprecated: https://matan.io/posts/react-defaultprops-is-dying
    // Use ES6 destructing defaults instead.
    'react/require-default-props': 'off',
    // Add custom input components
    "jsx-a11y/label-has-associated-control": [ 'error', {
      "controlComponents": ["Switch"],
    }],

    // Copied from https://github.com/airbnb/javascript/issues/1536#issuecomment-547416680
    'unicorn/import-index': 'off',
    'unicorn/prevent-abbreviations': 'off',
    // A base filename should exactly match the name of its default export
    // See: https://github.com/airbnb/javascript#naming--filename-matches-export
    'unicorn/filename-case': [
      'error',
      { cases: { camelCase: true, pascalCase: true, kebabCase: true } },
    ],
    // Improve compatibility with `unicorn/no-unreadable-array-destructuring`
    // See: https://github.com/sindresorhus/eslint-plugin-unicorn/blob/master/docs/rules/no-unreadable-array-destructuring.md#note
    'prefer-destructuring': [
      'error',
      {
        ...baseES6Rules['prefer-destructuring'][1],
        VariableDeclarator: {
          ...baseES6Rules['prefer-destructuring'][1].VariableDeclarator,
          array: false,
        },
        AssignmentExpression: {
          ...baseES6Rules['prefer-destructuring'][1].AssignmentExpression,
          array: false,
        },
      },
    ],
  },
};
