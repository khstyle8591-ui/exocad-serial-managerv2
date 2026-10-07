import { ProductCodeGroup } from './types';

// ────────────────────────────────────────────────────────────
// Product Code 분류표 — 단일 소스 (Single Source of Truth)
//
// 서버(order.service resolveGroup)와 렌더러(설정 화면 표시)가 모두 이 상수를
// import 한다. 절대 다른 곳에 하드코딩 사본을 만들지 말 것.
//
// 문제/변경 코드는 여기서 고치지 말고, 설정 > Product Code Group Settings의
// 커스텀 코드 등록으로 오버라이드한다(resolveGroup에서 커스텀이 built-in보다 우선).
// ────────────────────────────────────────────────────────────
export const BUILT_IN_CODES: Record<ProductCodeGroup, string[]> = {
  // 신규 필수 메인 프로덕트
  main: [
    '006-001001', '006-001010', '006-001020', '006-001034',
    '006-005080', '006-005082', '006-005083', '006-005098', '006-005099',
    '006-006100', '006-006101', '006-006102',
  ],
  // 메인에 추가되는 모듈
  addon: [
    '006-001002', '006-001003', '006-001004', '006-001005', '006-001006', '006-001007',
    '006-001008', '006-001009', '006-001012', '006-001013', '006-001014', '006-001015',
    '006-001016', '006-001037', '006-001039',
    '006-005100', '006-005101', '006-005102', '006-005103', '006-005104', '006-005105',
    '006-005106', '006-005107', '006-005108', '006-005109', '006-005110',
    '006-006103',
  ],
  // 메인 갱신 시 발급되는 코드
  renewal: [
    '006-001017', '006-001035',
    '006-005200', '006-005201', '006-005212', '006-005213', '006-005214', '006-005215',
    '006-006104', '006-006105', '006-006106',
  ],
  // 갱신과 함께 발급되는 모듈 (단독 발급 시 경고)
  renewal_addon: [
    '006-001018', '006-001019', '006-001021', '006-001022', '006-001023', '006-001024',
    '006-001025', '006-001026', '006-001027', '006-001028', '006-001029', '006-001030',
    '006-001038',
    '006-005202', '006-005203', '006-005204', '006-005205', '006-005206', '006-005207',
    '006-005208', '006-005209', '006-005210', '006-005211',
    '006-006107',
  ],
  // 상품정보와 무관, 메모만 필요
  memo: [
    '006-001011', '006-001031', '006-001033', '006-001036', '006-001040', '006-001041',
    '006-005081', '006-005198', '006-005199',
  ],
  // 스페셜1 — EXOCAD Basic → Ultimate Bundle 승급
  upgrade: [
    '006-001032',
  ],
  // 스페셜2 — AI credits
  credits: [
    '006-001042',
  ],
  // 완전 무시(기본 비어있음, 필요 시 커스텀 등록으로 지정)
  ignore: [],
};

// 설정 화면 그룹 표시 순서 (단일 소스)
export const PRODUCT_CODE_GROUP_ORDER: ProductCodeGroup[] = [
  'main', 'addon', 'renewal', 'renewal_addon', 'memo', 'upgrade', 'credits', 'ignore',
];

export const CODE_TO_PRODUCT_NAME: Record<string, string> = {
  '006-001001': 'exocad DentalCAD Core',
  '006-001010': 'exocad DentalCAD (Standard)',
  '006-001020': 'exocad DentalCAD 2in1',
  '006-001032': 'EXOCAD Basic → Ultimate Bundle (Upgrade)',
  '006-001034': 'exocad DentalCAD Core Version',
  '006-001042': 'AI Credits',
  '006-005080': 'exocad ChairsideCAD',
  '006-005082': 'exocad ChairsideCAD SE',
  '006-005083': 'exocad ChairsideCAD Standard',
  '006-005098': 'exocad ChairsideCAD Pro',
  '006-005099': 'exocad ChairsideCAD Premium',
  '006-006100': 'exocad exoplan Core',
  '006-006101': 'exocad exoplan Standard',
  '006-006102': 'exocad exoplan Pro',
  '006-001002': 'Model Creator',
  '006-001003': 'Virtual Articulator',
  '006-001004': 'TruSmile',
  '006-001005': 'Smile Creator',
  '006-001006': 'Implant Module',
  '006-001007': 'CAD-CAM Module',
  '006-001008': 'Surgical Guide Module',
  '006-001009': 'Partial Framework Module',
  '006-001012': 'Full Denture Module',
  '006-001013': 'Orthodontics Module',
  '006-001014': 'Quick Model Creator',
  '006-001015': 'Model Creator Pro',
  '006-001016': 'Digital Bite Registration',
  '006-001037': 'Flexible Partial Denture',
  '006-001036': 'Smile Composer',
  '006-001039': 'Partner Cloud Module',
  '006-005100': 'ChairsideCAD Add-on 1',
  '006-005101': 'ChairsideCAD Add-on 2',
  '006-005102': 'ChairsideCAD Add-on 3',
  '006-005103': 'ChairsideCAD Add-on 4',
  '006-005104': 'ChairsideCAD Add-on 5',
  '006-005105': 'ChairsideCAD Add-on 6',
  '006-005106': 'ChairsideCAD Add-on 7',
  '006-005107': 'ChairsideCAD Add-on 8',
  '006-005108': 'ChairsideCAD Add-on 9',
  '006-005109': 'ChairsideCAD Add-on 10',
  '006-005110': 'ChairsideCAD Add-on 11',
  '006-006103': 'exoplan Add-on',
  '006-001017': 'Maintenance/Renewal',
  '006-001035': 'DentalCAD Renewal',
  '006-005200': 'ChairsideCAD Renewal',
  '006-005201': 'ChairsideCAD SE Renewal',
  '006-005212': 'ChairsideCAD Renewal (2yr)',
  '006-005213': 'ChairsideCAD Renewal (3yr)',
  '006-005214': 'ChairsideCAD Renewal (4yr)',
  '006-005215': 'ChairsideCAD Renewal (5yr)',
  '006-006104': 'exoplan Renewal',
  '006-006105': 'exoplan Renewal (2yr)',
  '006-006106': 'exoplan Renewal (3yr)',
};
