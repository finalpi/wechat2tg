module.exports = {
	'env': {
		'es2021': true,
		'node': true
	},
	'extends': [
		'eslint:recommended',
		'plugin:@typescript-eslint/recommended',
		'plugin:@typescript-eslint/eslint-recommended',
	],
	'parser': '@typescript-eslint/parser',
	'parserOptions': {
		'ecmaVersion': 'latest',
		'sourceType': 'module',
		'parser': 'babel-eslint',
	},
	rules: {
		'quotes': ['error', 'single'],
		'eol-last': ['error', 'never'],
		'no-multiple-empty-lines': ['error', { 'max': 2, 'maxEOF': 0 }],
		'space-infix-ops': 'error',
		'no-trailing-spaces': 'error',
		'semi': ['error', 'never'],
		'comma-spacing': ['error', { 'before': false, 'after': true }]
	}
}