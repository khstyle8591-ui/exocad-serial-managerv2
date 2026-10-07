import type React from 'react';
import type { AppSettings, InboundDryRunEntry, RenewalDryRunEmail } from '../../../shared/types';

export type SettingsFormValues = Partial<AppSettings> & Record<string, unknown>;
export type SettingsFormRef = React.MutableRefObject<SettingsFormValues>;
export type SetSettingValue = (key: string, value: unknown) => void;

// api.inboundDryRun()이 실제로 반환하는 건 InboundDryRunEntry(entries) 모양이지만,
// 과거 RenewalDryRunEmail(emails/matched) 모양의 응답도 방어적으로 렌더링하던 코드가 남아있어
// 두 모양을 전부 optional로 병합해 둔다.
export type SettingsRenewalDryRunEmail = Partial<RenewalDryRunEmail> & Partial<InboundDryRunEntry>;

export type SettingsRenewalDryRunResult = {
  total_checked: number;
  would_save?: number;
  would_skip?: number;
  matched?: number;
  entries?: SettingsRenewalDryRunEmail[];
  emails?: SettingsRenewalDryRunEmail[];
  error?: string;
};

export type DryRunActionResult = {
  success: boolean;
  message: string;
  sample_serial?: string;
};

export type PollNowResult = {
  found: number;
  errors: string[];
};

export const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
