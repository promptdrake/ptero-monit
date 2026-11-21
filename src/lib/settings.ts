/*

╭━━╮╱╱╱╱╱╱╱╱╱╭━━━╮╱╱╱╱╱╱╱╱╱╱╱╭╮
╰┫┣╯╱╱╱╱╱╱╱╱╱┃╭━╮┃╱╱╱╱╭╮╱╱╱╱╭╯╰╮
╱┃┃╭━━┳━━┳━╮╱┃╰━╯┣━┳━━╋╋━━┳━┻╮╭╯
╱┃┃┃╭╮┃╭╮┃╭╮╮┃╭━━┫╭┫╭╮┣┫┃━┫╭━┫┃
╭┫┣┫╰╯┃╭╮┃┃┃┃┃┃╱╱┃┃┃╰╯┃┃┃━┫╰━┫╰╮
╰━━┫╭━┻╯╰┻╯╰╯╰╯╱╱╰╯╰━━┫┣━━┻━━┻━╯
╱╱╱┃┃╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╭╯┃
╱╱╱╰╯╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╱╰━╯
*/
import {
  defaultMonitorSettings,
  getMonitorSettings,
  saveMonitorSettings,
  type MonitorSettings
} from './monitor-store.js';

export type AppSettings = MonitorSettings;
export const defaultAppSettings = defaultMonitorSettings;

export function getAppSettings(): Promise<AppSettings> {
  return getMonitorSettings();
}

export function saveAppSettings(next: AppSettings): Promise<AppSettings> {
  return saveMonitorSettings(next);
}
