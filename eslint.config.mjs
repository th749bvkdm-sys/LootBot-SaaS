import parser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
export default [{ignores:['**/node_modules/**','**/dist/**','**/.pnpm-store/**','**/.*-integration*.mjs','**/.teacher-local-*.mjs','**/.teacher-test-schema-*.mjs','**/.ui-server.mjs','**/*.d.ts','**/*.tsbuildinfo','lib/api-client-react/src/generated/**','lib/api-zod/src/generated/**']},{
  files:['artifacts/api-server/src/**/*.{ts,mjs}','artifacts/lootbot/src/**/*.{ts,tsx}','lib/db/src/**/*.ts'],
  languageOptions:{parser,parserOptions:{ecmaVersion:'latest',sourceType:'module',ecmaFeatures:{jsx:true}}},
  plugins:{'react-hooks':reactHooks},
  rules:{'no-eval':'error','no-implied-eval':'error','no-new-func':'error','no-debugger':'error','no-dupe-args':'error','no-dupe-keys':'error','no-duplicate-case':'error','no-unreachable':'error','no-unsafe-finally':'error','valid-typeof':'error','no-unexpected-multiline':'error','react-hooks/rules-of-hooks':'error'}
}];
