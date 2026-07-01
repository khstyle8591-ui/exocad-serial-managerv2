export const SERVER_ERRORS = {
  ORDER_NOT_FOUND:            'ERR_ORDER_NOT_FOUND',
  SERIAL_NOT_FOUND:           'ERR_SERIAL_NOT_FOUND',
  ADDON_SERIAL_NOT_FOUND:     'ERR_ADDON_SERIAL_NOT_FOUND',
  SERIAL_NOT_IN_DB:           'ERR_SERIAL_NOT_IN_DB',
  CUSTOMER_HAS_SERIALS:       'ERR_CUSTOMER_HAS_SERIALS',
  LEGACY_ROW_NOT_FOUND:       'ERR_LEGACY_ROW_NOT_FOUND',
  LEGACY_CUSTOMER_NOT_FOUND:  'ERR_LEGACY_CUSTOMER_NOT_FOUND',
  SERIAL_ALREADY_EXISTS:      'ERR_SERIAL_ALREADY_EXISTS',
  IMPORT_NO_FILE:             'ERR_IMPORT_NO_FILE',
  IMPORT_NO_DATA:             'ERR_IMPORT_NO_DATA',
} as const;

export type ServerErrorCode = (typeof SERVER_ERRORS)[keyof typeof SERVER_ERRORS];

/** Build a pipe-delimited error token the renderer can parse and translate. */
export function serverError(code: keyof typeof SERVER_ERRORS, ...params: (string | number)[]): string {
  const base = SERVER_ERRORS[code];
  return params.length === 0 ? base : `${base}|${params.join('|')}`;
}
