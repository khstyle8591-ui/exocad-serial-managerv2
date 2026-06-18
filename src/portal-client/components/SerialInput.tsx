import { useRef } from 'react';

// 8-4-8 시리얼 입력 — 앞 박스가 채워지면 자동으로 다음 박스로 이동.
// 값은 'XXXXXXXX-XXXX-XXXXXXXX' 형태로 상위에 전달.
const SEGMENTS = [8, 4, 8] as const;

interface Props {
  value: string;
  onChange: (serial: string) => void;
  disabled?: boolean;
}

function splitValue(value: string): [string, string, string] {
  const parts = value.split('-');
  return [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];
}

export default function SerialInput({ value, onChange, disabled }: Props) {
  const refs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)];
  const segs = splitValue(value);

  function sanitize(raw: string, max: number): string {
    return raw.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, max);
  }

  function emit(next: string[]) {
    onChange(next.join('-'));
  }

  function handleChange(i: number, raw: string) {
    const clean = sanitize(raw, SEGMENTS[i]);
    const next = [...segs];
    next[i] = clean;
    emit(next);
    // 현재 박스가 가득 차면 다음 박스로 포커스 이동
    if (clean.length === SEGMENTS[i] && i < SEGMENTS.length - 1) {
      refs[i + 1].current?.focus();
    }
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    // 빈 박스에서 백스페이스 → 이전 박스로 이동
    if (e.key === 'Backspace' && segs[i].length === 0 && i > 0) {
      refs[i - 1].current?.focus();
    }
  }

  function handlePaste(i: number, e: React.ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    const alnum = pasted.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    // 전체 시리얼을 붙여넣은 경우 8-4-8로 분할
    const next: string[] = [...segs];
    let cursor = 0;
    for (let seg = i; seg < SEGMENTS.length; seg++) {
      next[seg] = alnum.slice(cursor, cursor + SEGMENTS[seg]);
      cursor += SEGMENTS[seg];
    }
    emit(next);
    // 마지막으로 채워진 박스에 포커스
    const lastFilled = Math.min(SEGMENTS.length - 1, i + (alnum.length > SEGMENTS[i] ? SEGMENTS.length : 0));
    refs[lastFilled].current?.focus();
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {SEGMENTS.map((len, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            ref={refs[i]}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            value={segs[i]}
            maxLength={len}
            onChange={e => handleChange(i, e.target.value)}
            onKeyDown={e => handleKeyDown(i, e)}
            onPaste={e => handlePaste(i, e)}
            style={{
              width: len === 4 ? 64 : 116,
              textAlign: 'center',
              letterSpacing: '0.12em',
              fontFamily: 'monospace',
              textTransform: 'uppercase',
              margin: 0,
            }}
          />
          {i < SEGMENTS.length - 1 && <span style={{ color: 'var(--text3)', fontWeight: 600 }}>–</span>}
        </div>
      ))}
    </div>
  );
}
