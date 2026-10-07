// ESLint 최소 구성 — "버그 검출 룰"만 켠다(스타일 룰 배제). 모든 룰은 warn(비차단):
// `npm run lint`는 경고를 출력해도 종료코드 0이라 빌드/배포를 막지 않는다.
//
// 이 프로젝트는 tsconfig가 분리돼 있고(tsconfig.json=렌더러, tsconfig.main.json=메인/서버),
// src/portal-client는 어떤 tsconfig에도 포함되지 않아(vite가 타입검사 없이 빌드) 타입 기반 룰을
// 적용할 수 없다. 그래서 두 블록으로 나눈다:
//   1) 타입검사 대상(renderer/main/server/shared) → 비동기 안전 등 타입 기반 룰 포함
//   2) portal-client → 타입 없이 파싱만 → 구문 기반 룰만
import tseslint from 'typescript-eslint';
import globals from 'globals';

// 두 블록 공통(타입 정보가 필요 없는) 룰 — 흔한 실수 + 미사용 코드
const commonRules = {
  '@typescript-eslint/no-unused-vars': ['warn', {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
  }],
  eqeqeq: ['warn', 'smart'],                    // == 대신 === 권장(null 비교는 예외)
  'no-fallthrough': 'warn',                     // switch break 누락
  'no-unreachable': 'warn',                     // 도달 불가 코드
  'no-self-compare': 'warn',                    // x === x
  'no-unsafe-optional-chaining': 'warn',        // a?.b() 후 예외 유발 패턴
  'no-constant-binary-expression': 'warn',      // 항상 참/거짓인 비교
};

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', '**/*.d.ts'],
  },

  // ── 블록 1: 타입검사 대상 — 타입 기반 비동기 안전 룰 포함 ──
  {
    files: [
      'src/renderer/**/*.{ts,tsx}',
      'src/main/**/*.{ts,tsx}',
      'src/server/**/*.{ts,tsx}',
      'src/shared/**/*.{ts,tsx}',
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: ['./tsconfig.json', './tsconfig.main.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      ...commonRules,
      // 비동기 안전(타입 기반) — 잊은 await / 잘못 쓴 Promise
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      // Express/React의 async 콜백(void 자리) 소음을 피하려 checksVoidReturn은 끄고,
      // 조건식에 Promise를 쓰는 등 실제 버그만 잡는다.
      '@typescript-eslint/no-misused-promises': ['warn', { checksVoidReturn: false }],
    },
  },

  // ── 블록 2: portal-client — tsconfig 미포함 → 구문 기반 룰만(타입 룰 제외) ──
  {
    files: ['src/portal-client/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: { ...globals.browser },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: commonRules,
  },
);
