import { t, type TranslationKey, type Language } from '../i18n';

const CODE_TO_KEY: Record<string, TranslationKey> = {
  ERR_ORDER_NOT_FOUND:           'err_order_not_found',
  ERR_SERIAL_NOT_FOUND:          'err_serial_not_found',
  ERR_ADDON_SERIAL_NOT_FOUND:    'err_addon_serial_not_found',
  ERR_SERIAL_NOT_IN_DB:          'err_serial_not_in_db',
  ERR_CUSTOMER_HAS_SERIALS:      'err_customer_has_serials',
  ERR_LEGACY_ROW_NOT_FOUND:      'err_legacy_row_not_found',
  ERR_LEGACY_CUSTOMER_NOT_FOUND: 'err_legacy_customer_not_found',
  ERR_SERIAL_ALREADY_EXISTS:     'err_serial_already_exists',
  ERR_IMPORT_NO_FILE:            'err_import_no_file',
  ERR_IMPORT_NO_DATA:            'err_import_no_data',
};

/**
 * Translate a server error token (e.g. "ERR_SERIAL_NOT_FOUND|SN-123") to
 * the user's language. Falls back to the raw string for unknown codes.
 */
export function translateServerError(raw: string | undefined | null, lang: Language): string {
  if (!raw) return '';
  const [code, ...params] = raw.split('|');
  const key = CODE_TO_KEY[code];
  if (!key) return raw;
  let msg = t(lang, key);
  params.forEach((p, i) => { msg = msg.replace(`{${i}}`, p); });
  return msg;
}

/** Apply translateServerError to every item in a string array. */
export function translateServerErrorList(list: string[], lang: Language): string[] {
  return list.map(item => translateServerError(item, lang));
}
