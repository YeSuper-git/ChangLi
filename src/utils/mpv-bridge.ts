import { invoke } from '@tauri-apps/api/core';

const isMac = navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac');

/**
 * macOS 专用：通过 IPC socket 控制 mpv
 * Windows/Linux：通过 tauri-plugin-mpv-api 控制
 */
export async function mpvCommand(name: string, args: string[] = []): Promise<any> {
  if (isMac) {
    return invoke('mpv_send_command', { cmd: name, args });
  }
  // Windows/Linux 走插件
  const { command } = await import('tauri-plugin-mpv-api');
  return command(name, args as any);
}

export async function mpvSetProperty(prop: string, value: any): Promise<void> {
  if (isMac) {
    await invoke('mpv_send_command', { cmd: 'set_property', args: [prop, String(value)] });
    return;
  }
  const { setProperty } = await import('tauri-plugin-mpv-api');
  return setProperty(prop, value);
}

export async function mpvGetProperty(prop: string): Promise<any> {
  if (isMac) {
    const result = await invoke<string>('mpv_send_command', { cmd: 'get_property', args: [prop] });
    try {
      const parsed = JSON.parse(result);
      return parsed.data ?? parsed;
    } catch {
      return result;
    }
  }
  const { getProperty } = await import('tauri-plugin-mpv-api');
  return getProperty(prop);
}

export { isMac };
