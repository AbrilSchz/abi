// eslint.config.js  (flat config — ESLint v9+)
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  // 1) Reglas recomendadas base de ESLint
  js.configs.recommended,

  // 2) Ajustes para el código del proyecto
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Permite `_tmp`, `_fwd`, `_move` (vectores temporales reutilizados) sin warning
      'no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Este proyecto loguea telemetría a consola a propósito
      'no-console': 'off',
      // En copilot.js hay catch vacíos con comentario: OK
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },

  // 3) Desactivar reglas de formato (las lleva Prettier) — debe ir al final
  prettier,
];
