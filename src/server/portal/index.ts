import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { getSettings } from '../../main/settings';
import { cookieMiddleware } from './middleware';
import authRouter from './routes/auth';
import setupRouter from './routes/setup';
import profileRouter from './routes/profile';
import requestsRouter from './routes/requests';
import adminRouter from './routes/admin';

const router = Router();

// 쿠키 파싱 (cookie-parser 없이 수동 처리)
router.use(cookieMiddleware);

// 관리자 라우트는 portal_enabled 가드 앞에 마운트 (설정 변경 포함)
router.use('/admin', adminRouter);

// 포털 비활성화 시 503 반환
router.use((_req: Request, res: Response, next: NextFunction) => {
  if (!getSettings().portal_enabled) {
    res.status(503).json({ error: 'Portal is not enabled.' });
    return;
  }
  next();
});

// 공개 엔드포인트 — 크레딧 패키지 목록 (인증 불필요)
router.get('/packages', (_req: Request, res: Response) => {
  res.json({ packages: getSettings().credit_packages });
});

// 공개 엔드포인트 — 포털 신청 화면 설정 (패키지 + 신청 설명문, 인증 불필요)
router.get('/config', (_req: Request, res: Response) => {
  const s = getSettings();
  res.json({
    packages: s.credit_packages,
    descriptions: s.portal_request_descriptions,
  });
});

router.use('/auth', authRouter);
router.use('/setup', setupRouter);
router.use('/profile', profileRouter);
router.use('/requests', requestsRouter);

export default router;
