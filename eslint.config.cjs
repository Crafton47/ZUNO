module.exports = [{
  ignores: ['node_modules/**', 'dist/**', '.agents/**', '.gravitas/**'],
}, {
  files: ['**/*.js', '**/*.cjs'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs' },
  rules: {
    'no-dupe-args': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-unreachable': 'error',
    'valid-typeof': 'error',
  },
}];
