import { api as restApi, type Api as RestApi } from './api';

type ElectronApi = Window['electronAPI'];
type ClientApi = RestApi & Partial<ElectronApi>;

function getElectronApi(): Partial<ElectronApi> | null {
  if (typeof window === 'undefined') return null;
  return window.electronAPI ?? null;
}

export const api = new Proxy(restApi as ClientApi, {
  get(target, prop: keyof ClientApi) {
    const electronApi = getElectronApi() as ClientApi | null;
    const electronValue = electronApi?.[prop];
    if (electronValue !== undefined) return electronValue;
    return target[prop];
  },
}) as ClientApi;

export type Api = typeof api;
