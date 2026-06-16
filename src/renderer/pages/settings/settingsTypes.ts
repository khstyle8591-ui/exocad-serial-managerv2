import type React from 'react';
import type { AppSettings, RenewalDryRunEmail, RenewalDryRunResult } from '../../../shared/types';

export type SettingsFormValues = Partial<AppSettings> & Record<string, unknown>;
export type SettingsFormRef = React.MutableRefObject<SettingsFormValues>;
export type SetSettingValue = (key: string, value: unknown) => void;

export type SettingsRenewalDryRunEmail = RenewalDryRunEmail & {
  classification?: string;
  extracted_serial?: string | null;
};

export type SettingsRenewalDryRunResult = Omit<RenewalDryRunResult, 'emails'> & {
  emails?: SettingsRenewalDryRunEmail[];
  entries?: SettingsRenewalDryRunEmail[];
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
