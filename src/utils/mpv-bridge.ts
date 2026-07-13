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

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try { return JSON.stringify(error); } catch { return String(error); }
}

async function withMpvStage<T>(code: string, stage: string, action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const platform = isMac ? 'macOS/libmpv' : 'Windows/mpv-process';
    throw new Error(`[${code}] ${platform} ${stage}失败：${errorText(error)}`);
  }
}

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
    return withMpvStage('CL-MAC-MPV-INIT', '初始化进程内 libmpv', async () => {
      const { init } = await import('tauri-plugin-libmpv-api');
      const initialOptions = parseMpvArgs(options.args);
      // libmpv 是进程内实例；force-window=yes 只创建 libmpv 输出承载，不会启动外部 mpv 进程。
      initialOptions['force-window'] = true;
      return init({
        initialOptions,
        observedProperties: toLibMpvObserved(options.observedProperties),
      });
    });
  }

  return withMpvStage('CL-WIN-MPV-INIT', '初始化 mpv 子进程', async () => {
    const { init } = await import('tauri-plugin-mpv-api');
    return init({
      ...(options.path ? { path: options.path } : {}),
      showMpvOutput: options.showMpvOutput ?? true,
      args: options.args,
      observedProperties: options.observedProperties,
    });
  });
}

export async function mpvDestroy(): Promise<void> {
  if (isMac) {
    return withMpvStage('CL-MAC-MPV-DESTROY', '销毁进程内 libmpv', async () => {
      const { destroy } = await import('tauri-plugin-libmpv-api');
      return destroy();
    });
  }
  return withMpvStage('CL-WIN-MPV-DESTROY', '销毁 mpv 子进程', async () => {
    const { destroy } = await import('tauri-plugin-mpv-api');
    return destroy();
  });
}

export async function mpvObserveProperties(
  properties: readonly ObservedProperty[],
  callback: (event: { name: string; data?: unknown }) => void,
): Promise<() => void> {
  if (isMac) {
    return withMpvStage('CL-MAC-MPV-OBSERVE', '订阅 libmpv 播放属性', async () => {
      const { observeProperties } = await import('tauri-plugin-libmpv-api');
      return observeProperties(toLibMpvObserved(properties), callback as any);
    });
  }
  return withMpvStage('CL-WIN-MPV-OBSERVE', '订阅 mpv 播放属性', async () => {
    const { observeProperties } = await import('tauri-plugin-mpv-api');
    return observeProperties(properties, callback as any);
  });
}

export async function mpvSetVideoMarginRatio(ratio: { top?: number; right?: number; bottom?: number; left?: number }): Promise<void> {
  if (isMac) {
    return withMpvStage('CL-MAC-MPV-MARGIN', '设置 libmpv 视频边距', async () => {
      const { setVideoMarginRatio } = await import('tauri-plugin-libmpv-api');
      return setVideoMarginRatio(ratio);
    });
  }
  return withMpvStage('CL-WIN-MPV-MARGIN', '设置 mpv 视频边距', async () => {
    const { setVideoMarginRatio } = await import('tauri-plugin-mpv-api');
    return setVideoMarginRatio(ratio);
  });
}

export async function mpvCommand(name: string, args: Array<string | number | boolean> = []): Promise<any> {
  if (isMac) {
    return withMpvStage('CL-MAC-MPV-COMMAND', `执行 libmpv 命令 ${name}`, async () => {
      const { command } = await import('tauri-plugin-libmpv-api');
      return command(name, args);
    });
  }
  return withMpvStage('CL-WIN-MPV-COMMAND', `执行 mpv 命令 ${name}`, async () => {
    const { command } = await import('tauri-plugin-mpv-api');
    return command(name, args as any);
  });
}

export async function mpvSetProperty(prop: string, value: string | number | boolean): Promise<void> {
  if (isMac) {
    return withMpvStage('CL-MAC-MPV-SETPROP', `设置 libmpv 属性 ${prop}`, async () => {
      const { setProperty } = await import('tauri-plugin-libmpv-api');
      return setProperty(prop, value);
    });
  }
  return withMpvStage('CL-WIN-MPV-SETPROP', `设置 mpv 属性 ${prop}`, async () => {
    const { setProperty } = await import('tauri-plugin-mpv-api');
    return setProperty(prop, value);
  });
}

export async function mpvGetProperty(prop: string): Promise<any> {
  if (isMac) {
    return withMpvStage('CL-MAC-MPV-GETPROP', `读取 libmpv 属性 ${prop}`, async () => {
      const { getProperty } = await import('tauri-plugin-libmpv-api');
      return getProperty(prop, 'node');
    });
  }
  return withMpvStage('CL-WIN-MPV-GETPROP', `读取 mpv 属性 ${prop}`, async () => {
    const { getProperty } = await import('tauri-plugin-mpv-api');
    return getProperty(prop);
  });
}

export { isMac };
