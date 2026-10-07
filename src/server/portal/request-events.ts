import { EventEmitter } from 'events';

// 포털 신청(portal_requests) 생성/상태변경 시 매니저 어드민 화면에 즉시 알리기 위한 이벤트 버스.
// SSE(Server-Sent Events) 구독자에게 "목록이 바뀌었다"는 신호만 보내고, 실제 데이터는
// 클라이언트가 평소처럼 GET /portal/admin/requests로 다시 조회한다(페이로드를 여기 담지 않음).
export const portalRequestEvents = new EventEmitter();

export function emitPortalRequestChanged(): void {
  portalRequestEvents.emit('changed');
}
