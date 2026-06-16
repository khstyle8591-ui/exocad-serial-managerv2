import type { AppSettings, PollSource } from '../../shared/types';
import { logger } from '../utils/logger';
import { restartPreExpiryTask, startDailyReportTasks, startExpiryNoticeTask, startMailCheck } from '../scheduler';
import { startPollingScheduler } from './order.service';

type SchedulerName = 'mailCheck' | 'preExpiryCancel' | 'dailyReport' | 'expiryNotice' | 'orderPolling';

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

function stableStringify(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function changed<T extends keyof AppSettings>(before: AppSettings, after: AppSettings, keys: T[]): boolean {
  return keys.some(key => stableStringify(before[key]) !== stableStringify(after[key]));
}

function normalizePollSources(sources: PollSource[]): Array<Pick<PollSource, 'id' | 'name' | 'enabled' | 'schedule_times'>> {
  return (sources || []).map(source => ({
    id: source.id,
    name: source.name,
    enabled: source.enabled,
    schedule_times: source.schedule_times || [],
  }));
}

function pollScheduleChanged(before: AppSettings, after: AppSettings): boolean {
  return stableStringify(normalizePollSources(before.poll_sources || [])) !==
    stableStringify(normalizePollSources(after.poll_sources || []));
}

function getChangedSchedulers(before: AppSettings, after: AppSettings): SchedulerName[] {
  const schedulers: SchedulerName[] = [];

  if (changed(before, after, ['mail_check_times'])) {
    schedulers.push('mailCheck');
  }

  if (changed(before, after, ['auto_cancel_enabled', 'auto_cancel_days_before', 'auto_cancel_time'])) {
    schedulers.push('preExpiryCancel');
  }

  if (changed(before, after, ['daily_report_times'])) {
    schedulers.push('dailyReport');
  }

  if (changed(before, after, [
    'expiry_notice_enabled',
    'expiry_notice_time',
    'expiry_notice_rules',
    'expiry_notice_days',
    'expiry_notice_renewal_template',
    'expiry_notice_stop_template',
  ])) {
    schedulers.push('expiryNotice');
  }

  if (pollScheduleChanged(before, after)) {
    schedulers.push('orderPolling');
  }

  return schedulers;
}

function restartScheduler(name: SchedulerName): void {
  switch (name) {
    case 'mailCheck':
      startMailCheck();
      return;
    case 'preExpiryCancel':
      restartPreExpiryTask();
      return;
    case 'dailyReport':
      startDailyReportTasks();
      return;
    case 'expiryNotice':
      startExpiryNoticeTask();
      return;
    case 'orderPolling':
      startPollingScheduler();
      return;
  }
}

export function refreshSchedulersForSettingsChange(before: AppSettings, after: AppSettings): SchedulerName[] {
  const schedulers = getChangedSchedulers(before, after);

  if (schedulers.length === 0) {
    logger.info('Settings saved: no scheduler changes');
    return [];
  }

  const restarted: SchedulerName[] = [];
  const failed: string[] = [];

  for (const scheduler of schedulers) {
    try {
      restartScheduler(scheduler);
      restarted.push(scheduler);
    } catch (err: unknown) {
      const errorMessage = getErrorMessage(err);
      failed.push(`${scheduler}: ${errorMessage}`);
      logger.error(`Scheduler refresh failed after settings save (${scheduler}): ${errorMessage}`);
    }
  }

  logger.info(`Schedulers refreshed after settings save: ${restarted.length > 0 ? restarted.join(', ') : 'none'}`);
  if (failed.length > 0) {
    logger.warn(`Scheduler refresh failures after settings save: ${failed.join(' | ')}`);
  }

  return restarted;
}
