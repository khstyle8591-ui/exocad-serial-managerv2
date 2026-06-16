import { describe, expect, it } from 'vitest';
import type { ProductCodeRule } from '../src/shared/types';
import { getPolledProductFields, resolveGroup } from '../src/main/services/order.service';

describe('resolveGroup', () => {
  it('resolves built-in product codes', () => {
    expect(resolveGroup('006-001017', [])).toBe('renewal');
    expect(resolveGroup('006-001002', [])).toBe('addon');
    expect(resolveGroup('006-001001', [])).toBe('main');
    expect(resolveGroup('006-001031', [])).toBe('memo');
    expect(resolveGroup('006-001032', [])).toBe('main');
    expect(resolveGroup('006-001018', [])).toBe('ignore');
  });

  it('trims product codes before matching', () => {
    expect(resolveGroup(' 006-001017 ', [])).toBe('renewal');
  });

  it('returns null for blank or unknown product codes', () => {
    expect(resolveGroup('', [])).toBeNull();
    expect(resolveGroup('   ', [])).toBeNull();
    expect(resolveGroup('unknown-code', [])).toBeNull();
  });

  it('uses custom rules before built-in codes', () => {
    const rules: ProductCodeRule[] = [
      { code: '006-001017', group: 'ignore' },
    ];

    expect(resolveGroup('006-001017', rules)).toBe('ignore');
  });

  it('resolves product codes defined only by custom rules', () => {
    const rules: ProductCodeRule[] = [
      { code: 'CUSTOM-ADDON', group: 'addon' },
    ];

    expect(resolveGroup('CUSTOM-ADDON', rules)).toBe('addon');
  });

  it('moves approved product codes into the main group', () => {
    expect(resolveGroup('006-001010', [])).toBe('main');
    expect(resolveGroup('006-001032', [])).toBe('main');
    expect(resolveGroup('006-006100', [])).toBe('main');
    expect(resolveGroup('006-005080', [])).toBe('main');
  });
});

describe('getPolledProductFields', () => {
  it('routes main and fallback new products into main_product only', () => {
    expect(getPolledProductFields('main', 'EXOCAD Basic', '2026-05-22', 'new')).toEqual({
      main_product: 'EXOCAD Basic',
      version: '',
      notes: '',
    });
    expect(getPolledProductFields(null, 'EXOPLAN Bundle', '2026-05-22', 'new')).toEqual({
      main_product: 'EXOPLAN Bundle',
      version: '',
      notes: '',
    });
  });

  it('routes renewal, memo, and version-update products into notes instead of version', () => {
    for (const group of ['renewal', 'memo', 'version_update'] as const) {
      expect(getPolledProductFields(group, 'EXOCAD Update', '2026-05-22', group === 'renewal' ? 'renewal' : 'new'))
        .toEqual({
          main_product: '',
          version: '',
          notes: '[2026-05-22] Polling product: EXOCAD Update',
        });
    }
  });

  it('keeps add-on products out of main product and version fields', () => {
    expect(getPolledProductFields('addon', 'EXOCAD Implant Module', '2026-05-22', 'addon')).toEqual({
      main_product: '',
      version: '',
      notes: '',
    });
  });
});
