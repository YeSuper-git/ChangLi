const isMac = navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac');

export const MPV_OBSERVED_PROPERTIES = [
  'pause',
  'time-pos',
  'duration',
  'volume',
  'speed',
  'dwidth',
  'dheight',
] as const;

type ObservedProperty = typeof MPV_OBSERVED_PROPERTIES[number];

type MpvInitOptions = {
  path?: string;
  args: string[];
  observedProperties: readonly ObservedProperty[];
  showMpvOutput?: boolean;
};

const LIBMPV_PROPERTY_FORMATS: Record<ObservedProperty, 'flag' | 'double' | 'int64'> = {
  pause: 'flag',
  'time-pos': 'double',
  duration: 'double',
  volume: 'double',
  speed: 'double',
  dwidth: 'int64',
  dheight: 'int64',
};

function parseMpvArgs(args: string[]): Record<string, string | number | boolean> {
  const options: Record<string, string | number | boolean> = {};
  for (const arg of args) {
    if (!arg.startsWith('--')) continue;
    const raw = arg.slice(2);
    const eq = raw.indexOf('=');
    const key = eq >= 0 ? raw.slice(0, eq) : raw;
    const value = eq >= 0 ? raw.slice(eq + 1) : 'yes';
    if (!key || key === 'wid') continue; // libmpv 插件会按当前窗口 label 自动注入 wid
    if (value === 'yes') options[key] = true;
    else if (value === 'no') options[key] = false;
    else if (/^-?\d+(\.\d+)?$/.test(value)) options[key] = Number(value);
    else options[key] = value;
  }
  return options;
}

function toLibMpvObserved(properties: readonly ObservedProperty[]) {
  return properties.map((name) => [name, LIBMPV_PROPERTY_FORMATS[name], 'none'] as const);
}

/**
 * macOS 使用 tauri-plugin-libmpv-api（进程内 libmpv，避免弹外部 mpv 窗口）。
 * Windows 继续使用 tauri-plugin-mpv-api（外部 mpv 进程 + --wid 子窗口），保持既有稳定路径。
 */
export async function mpvInit(options: MpvInitOptions): Promise<string> {
  if (isMac) {
    const { init } = await import('tauri-plugin-libmpv-api');
    const initialOptions = parseMpvArgs(options.args);
    // libmpv 是进程内实例；force-window=yes 保证 loadfile 前有视频输出承载，不会弹外部窗口。
    initialOptions['force-window'] = true;
    return init({
      initialOptions,
      observedProperties: toLibMpvObserved(options.observedProperties),
    });
  }

  const { init } = await import('tauri-plugin-mpv-api');
  return init({
    ...(options.path ? { path: options.path } : {}),
    showMpvOutput: options.showMpvOutput ?? true,
    args: options.args,
    observedProperties: options.observedProperties,
  });
}

export async function mpvDestroy(): Promise<void> {
  if (isMac) {
    const { destroy } = await import('tauri-plugin-libmpv-api');
    return destroy();
  }
  const { destroy } = await import('tauri-plugin-mpv-api');
  return destroy();
}

export async function mpvObserveProperties(
  properties: readonly ObservedProperty[],
  callback: (event: { name: string; data?: unknown }) => void,
): Promise<() => void> {
  if (isMac) {
    const { observeProperties } = await import('tauri-plugin-libmpv-api');
    return observeProperties(toLibMpvObserved(properties), callback as any);
  }
  const { observeProperties } = await import('tauri-plugin-mpv-api');
  return observeProperties(properties, callback as any);
}

export async function mpvSetVideoMarginRatio(ratio: { top?: number; right?: number; bottom?: number; left?: number }): Promise<void> {
  if (isMac) {
    const { setVideoMarginRatio } = await import('tauri-plugin-libmpv-api');
    return setVideoMarginRatio(ratio);
  }
  const { setVideoMarginRatio } = await import('tauri-plugin-mpv-api');
  return setVideoMarginRatio(ratio);
}

export async function mpvCommand(name: string, args: Array<string | number | boolean> = []): Promise<any> {
  if (isMac) {
    const { command } = await import('tauri-plugin-libmpv-api');
    return command(name, args);
  }
  const { command } = await import('tauri-plugin-mpv-api');
  return command(name, args as any);
}

export async function mpvSetProperty(prop: string, value: string | number | boolean): Promise<void> {
  if (isMac) {
    const { setProperty } = await import('tauri-plugin-libmpv-api');
    return setProperty(prop, value);
  }
  const { setProperty } = await import('tauri-plugin-mpv-api');
  return setProperty(prop, value);
}

export async function mpvGetProperty(prop: string): Promise<any> {
  if (isMac) {
    const { getProperty } = await import('tauri-plugin-libmpv-api');
    return getProperty(prop, 'node');
  }
  const { getProperty } = await import('tauri-plugin-mpv-api');
  return getProperty(prop);
}

export { isMac };
