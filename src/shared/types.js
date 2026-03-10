"use strict";
// === Database Models ===
Object.defineProperty(exports, "__esModule", { value: true });
exports.IPC_CHANNELS = void 0;
// === IPC Channel Names ===
exports.IPC_CHANNELS = {
    // Serial CRUD
    SERIAL_GET_ALL: 'serial:getAll',
    SERIAL_GET_BY_ID: 'serial:getById',
    SERIAL_CREATE: 'serial:create',
    SERIAL_UPDATE: 'serial:update',
    SERIAL_DELETE: 'serial:delete',
    SERIAL_SEARCH: 'serial:search',
    SERIAL_ADD_ADDON: 'serial:addAddon',
    SERIAL_BULK_IMPORT: 'serial:bulkImport',
    // Cancel
    CANCEL_SUBSCRIPTION: 'cancel:subscription',
    CANCEL_CHECK_EXPIRING: 'cancel:checkExpiring',
    // Renewal
    RENEWAL_CHECK_EMAILS: 'renewal:checkEmails',
    RENEWAL_PROCESS: 'renewal:process',
    // Reports
    REPORT_DAILY: 'report:daily',
    REPORT_MONTHLY_EXPIRY: 'report:monthlyExpiry',
    REPORT_SEND: 'report:send',
    // Settings
    SETTINGS_GET: 'settings:get',
    SETTINGS_SAVE: 'settings:save',
    // Logs
    LOGS_GET: 'logs:get',
    LOGS_GET_TODAY: 'logs:getToday',
};
