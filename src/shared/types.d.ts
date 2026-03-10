export interface Serial {
    id: number;
    serial_number: string;
    customer_name: string;
    customer_email: string;
    purchase_date: string;
    expiry_date: string;
    status: 'active' | 'cancelled' | 'expired';
    add_ons: string;
    notes: string;
    created_at: string;
    updated_at: string;
}
export interface AddOn {
    name: string;
    added_date: string;
}
export interface RenewalRequest {
    id: number;
    serial_id: number;
    request_date: string;
    request_source: 'email' | 'manual';
    processed: number;
    created_at: string;
}
export interface ActivityLog {
    id: number;
    serial_id: number;
    action: 'registered' | 'renewed' | 'cancelled' | 'addon_added' | 'bulk_imported';
    details: string;
    created_at: string;
}
export interface SerialInput {
    serial_number: string;
    customer_name: string;
    customer_email: string;
    purchase_date: string;
    expiry_date: string;
    add_ons?: AddOn[];
    notes?: string;
}
export interface ExcelSerialRow {
    serial_number: string;
    customer_name: string;
    customer_email: string;
    purchase_date: string;
    expiry_date: string;
    add_ons?: string;
    notes?: string;
}
export interface CancelResult {
    serial_number: string;
    success: boolean;
    error?: string;
}
export interface DailyReport {
    date: string;
    new_registrations: number;
    renewals: number;
    cancellations: number;
    failed_cancellations: CancelResult[];
    details: ActivityLog[];
}
export interface MonthlyExpiryReport {
    report_date: string;
    target_month: string;
    expiring_serials: Serial[];
    total_count: number;
}
export interface AppSettings {
    mail_protocol: 'pop3' | 'imap';
    pop3_host: string;
    pop3_port: number;
    pop3_user: string;
    pop3_password: string;
    pop3_tls: boolean;
    imap_host: string;
    imap_port: number;
    imap_user: string;
    imap_password: string;
    imap_tls: boolean;
    smtp_host: string;
    smtp_port: number;
    smtp_user: string;
    smtp_password: string;
    smtp_tls: boolean;
    report_email_to: string;
    slack_webhook_url: string;
    exocad_site_url: string;
    exocad_login_url: string;
    exocad_username: string;
    exocad_password: string;
    cancel_button_text: string;
    cancel_confirm_text: string;
    webhook_enabled: boolean;
    webhook_port: number;
    webhook_secret: string;
    renewal_keywords: string[];
    mail_check_interval: number;
}
export declare const IPC_CHANNELS: {
    readonly SERIAL_GET_ALL: "serial:getAll";
    readonly SERIAL_GET_BY_ID: "serial:getById";
    readonly SERIAL_CREATE: "serial:create";
    readonly SERIAL_UPDATE: "serial:update";
    readonly SERIAL_DELETE: "serial:delete";
    readonly SERIAL_SEARCH: "serial:search";
    readonly SERIAL_ADD_ADDON: "serial:addAddon";
    readonly SERIAL_BULK_IMPORT: "serial:bulkImport";
    readonly CANCEL_SUBSCRIPTION: "cancel:subscription";
    readonly CANCEL_CHECK_EXPIRING: "cancel:checkExpiring";
    readonly RENEWAL_CHECK_EMAILS: "renewal:checkEmails";
    readonly RENEWAL_PROCESS: "renewal:process";
    readonly REPORT_DAILY: "report:daily";
    readonly REPORT_MONTHLY_EXPIRY: "report:monthlyExpiry";
    readonly REPORT_SEND: "report:send";
    readonly SETTINGS_GET: "settings:get";
    readonly SETTINGS_SAVE: "settings:save";
    readonly LOGS_GET: "logs:get";
    readonly LOGS_GET_TODAY: "logs:getToday";
};
