const isMac = navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac');

/**
 * 全平台统一通过 tauri-plugin-mpv-api 控制 mpv。
 * 注意：tauri-plugin-mpv 0.5.2 不是 libmpv FFI，而是 mpv 进程 + --wid 嵌入；
 * 最终稳定性的关键是播放器窗口固定 label=player，插件实例、窗口句柄和清理都指向同一窗口。
 */
export async function mpvCommand(name: string, args: string[] = []): Promise<any> {
  const { command } = await import('tauri-plugin-mpv-api');
  return command(name, args as any);
}

export async function mpvSetProperty(prop: string, value: any): Promise<void> {
  const { setProperty } = await import('tauri-plugin-mpv-api');
  return setProperty(prop, value);
}

export async function mpvGetProperty(prop: string): Promise<any> {
  const { getProperty } = await import('tauri-plugin-mpv-api');
  return getProperty(prop);
}

export { isMac };
