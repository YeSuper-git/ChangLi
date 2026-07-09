import React from 'react';

const SCAN_LOGIC_KEY = 'changli_scan_logic_seen';

interface ScanLogicModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

const ScanLogicModal: React.FC<ScanLogicModalProps> = ({ open, onClose, onConfirm }) => {
  if (!open) return null;

  return (
    <div className="changli-modal-backdrop" onClick={onClose}>
      <div
        className="changli-modal-panel !w-[min(100%,520px)] !max-h-[80vh] !p-0 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题 */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">添加视频前，先了解这些识别规则</h2>
        </div>

        {/* 内容 */}
        <div className="px-6 py-4 overflow-y-auto flex-1 space-y-5 text-sm text-gray-600 leading-relaxed">
          {/* 文件夹结构 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">📁 文件夹结构识别</h3>
            <p className="mb-2">添加视频时，选择一个文件夹，系统会自动扫描其中的视频文件。支持嵌套文件夹结构：</p>
            <pre className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 font-mono overflow-x-auto">
{`选择的文件夹/
├── 视频集A/
│   ├── 第1集.mp4
│   └── 第2集.mp4
└── 视频集B/
    ├── S01/
    │   ├── 第1集.mp4
    │   └── 第2集.mp4
    └── S02/
        └── 第1集.mp4`}
            </pre>
            <ul className="mt-2 space-y-1 text-xs text-gray-500">
              <li>• 每个包含视频文件的子文件夹会被识别为一个视频集</li>
              <li>• 支持多层嵌套，系统会自动递归查找视频文件</li>
            </ul>
          </section>

          {/* 海报识别 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">🖼️ 海报识别</h3>
            <p className="mb-1">系统会按以下优先级自动识别视频集海报：</p>
            <ol className="space-y-1 text-xs text-gray-500 list-decimal list-inside">
              <li>文件夹内与视频集同名的图片（如「你的名字」→ 找「你的名字.jpg」）</li>
              <li>文件夹内与视频文件同名的图片（如「abc.mp4」→ 找「abc.jpg」）</li>
              <li>文件夹内文件名包含「pl」或「poster」「cover」「folder」的图片</li>
              <li>文件夹内的第一张图片</li>
              <li>多季视频集：根目录没海报时，会自动去季文件夹里找</li>
            </ol>
            <p className="mt-2 text-xs text-gray-400">建议在视频集文件夹内放置一张海报图片，命名如 poster.jpg 即可自动识别。</p>
          </section>

          {/* 季识别 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">🎬 季识别</h3>
            <p className="mb-1">子文件夹名包含以下格式会自动识别为季：</p>
            <ul className="space-y-1 text-xs text-gray-500">
              <li>• <code className="bg-gray-100 px-1 rounded">第1季</code>、<code className="bg-gray-100 px-1 rounded">第二季</code> 等中文格式</li>
              <li>• <code className="bg-gray-100 px-1 rounded">Season 1</code>、<code className="bg-gray-100 px-1 rounded">season01</code> 等英文格式</li>
              <li>• <code className="bg-gray-100 px-1 rounded">S1</code>、<code className="bg-gray-100 px-1 rounded">S01</code> 等简写格式</li>
              <li>• <code className="bg-gray-100 px-1 rounded">1-2季</code>、<code className="bg-gray-100 px-1 rounded">1-3季</code> 等范围格式</li>
              <li>• 包含「剧场版」或「篇」的会识别为剧场版</li>
              <li>• 无法识别的子文件夹：≤3 个视频识别为剧场版，&gt;3 个自动按顺序编号</li>
            </ul>
          </section>

          {/* 集数识别 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">📝 集数识别</h3>
            <p className="mb-1">分集的集数从视频文件名自动识别，支持以下格式：</p>
            <ul className="space-y-1 text-xs text-gray-500">
              <li>• <code className="bg-gray-100 px-1 rounded">S01E01</code>、<code className="bg-gray-100 px-1 rounded">S1E01</code> 标准季集格式</li>
              <li>• <code className="bg-gray-100 px-1 rounded">EP01</code>、<code className="bg-gray-100 px-1 rounded">E01</code>、<code className="bg-gray-100 px-1 rounded">ep01</code> 格式</li>
              <li>• <code className="bg-gray-100 px-1 rounded">第01集</code>、<code className="bg-gray-100 px-1 rounded">第01话</code> 格式</li>
              <li>• 纯数字文件名：<code className="bg-gray-100 px-1 rounded">01.mp4</code>、<code className="bg-gray-100 px-1 rounded">001.mp4</code></li>
              <li>• <code className="bg-gray-100 px-1 rounded">[01]</code> 方括号格式</li>
              <li>• <code className="bg-gray-100 px-1 rounded">_01_</code> 下划线包围格式</li>
              <li>• 空格包围的数字：<code className="bg-gray-100 px-1 rounded">xxx 01 xxx</code></li>
              <li>• 空格后跟数字到末尾：<code className="bg-gray-100 px-1 rounded">xxx 01</code></li>
              <li>• 点包围的数字：<code className="bg-gray-100 px-1 rounded">xxx.01.xxx</code></li>
            </ul>
            <p className="mt-1 text-xs text-gray-400">文件名不含明确集数时，按文件名自然排序自动编号。</p>
          </section>

          {/* 演员/标签识别 */}
          <section>
            <h3 className="text-sm font-semibold text-gray-800 mb-2">🏷️ 演员/标签识别</h3>
            <p className="mb-1">当分类配置开启了「演员」或「标签」功能时，扫描逻辑会有所不同：</p>
            <ul className="space-y-1 text-xs text-gray-500">
              <li>• 子文件夹名会自动与数据库中的演员名称进行匹配</li>
              <li>• 如果没有匹配到演员，会尝试与标签名称进行匹配</li>
              <li>• 如果启用了演员/标签但都没匹配到，该子文件夹会被跳过</li>
              <li>• 匹配到演员后，还会继续识别演员的时期文件夹</li>
            </ul>
            <p className="mt-2 text-xs text-gray-500">建议按演员或标签建立文件夹结构：</p>
            <pre className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 font-mono overflow-x-auto mt-1">
{`按演员组织：
选择的文件夹/
├── 演员A/
│   ├── 视频集1/
│   └── 视频集2/
└── 演员B/
    └── 视频集3/

按标签组织：
选择的文件夹/
├── 动作/
│   ├── 视频集1/
│   └── 视频集2/
└── 科幻/
    └── 视频集3/`}
            </pre>
          </section>

          {/* 番号识别 - 绅士专区 */}
          <section className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-rose-600 mb-2">🔞 番号识别（绅士专区）</h3>
            <p className="mb-1">针对车牌号格式的文件夹名，系统会自动识别：</p>
            <ul className="space-y-1 text-xs text-gray-500">
              <li>• 自动提取车牌号作为番号（如 <code className="bg-gray-100 px-1 rounded">XYZ-456</code>）</li>
              <li>• 方括号内的内容会自动识别为标题（如 <code className="bg-gray-100 px-1 rounded">XYZ-456[作品标题]</code>）</li>
              <li>• 车牌后带 <code className="bg-gray-100 px-1 rounded">C</code> 或 <code className="bg-gray-100 px-1 rounded">CH</code> 表示中文字幕（如 <code className="bg-gray-100 px-1 rounded">XYZ-456-C</code>、<code className="bg-gray-100 px-1 rounded">XYZ-456-CH[标题]</code>）</li>
              <li>• 文件名包含 <code className="bg-gray-100 px-1 rounded">[中文]</code> 或 <code className="bg-gray-100 px-1 rounded">[字幕]</code> 标记也识别为中文字幕</li>
              <li>• 支持中间带版本标记（如 <code className="bg-gray-100 px-1 rounded">XYZ-456-AI-C[标题]</code>）</li>
              <li>• 文件名包含车牌号的图片会自动识别为海报</li>
            </ul>
          </section>

          {/* 小提示 */}
          <section className="border-t border-gray-100 pt-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">💡 小提示</h3>
            <ul className="space-y-1 text-xs text-gray-500">
              <li>• 添加后可通过右键视频集 → 「检查更新」扫描新增的分集</li>
              <li>• 也可通过视频集详情页的「添加视频」手动添加单个分集</li>
              <li>• 海报和标题随时可在详情页手动修改</li>
              <li>• 后续想再次阅读识别逻辑，可右键「添加」按钮重新查看</li>
            </ul>
          </section>
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
          <button onClick={onClose} className="action-btn text-sm px-4 py-1.5">
            暂不添加
          </button>
          <button onClick={onConfirm} className="action-btn action-btn-primary text-sm px-4 py-1.5">
            我知道了，开始添加
          </button>
        </div>
      </div>
    </div>
  );
};

export const isScanLogicSeen = (): boolean => {
  return localStorage.getItem(SCAN_LOGIC_KEY) === '1';
};

export const markScanLogicSeen = (): void => {
  localStorage.setItem(SCAN_LOGIC_KEY, '1');
};

export default ScanLogicModal;
