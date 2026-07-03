import { useEffect, useState } from 'react';
import { api } from '../client';

const POLL_INTERVAL_MS = 30_000;

/** 매니저 조치가 필요한 포털 신청 건수를 30초 간격으로 폴링. 사이드바/탭 배지에 사용. */
export function usePortalActionableCount(): number {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = () => {
      api.portal.getActionableRequestCount<{ count: number }>()
        .then(d => { if (!cancelled) setCount(d.count); })
        .catch(() => { /* 배지는 best-effort — 조회 실패 시 이전 값 유지 */ });
    };

    load();
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return count;
}
