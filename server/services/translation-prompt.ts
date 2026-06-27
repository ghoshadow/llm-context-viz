export function buildTranslationPrompt(items: string[]): string {
  const numberedItems = items.map((text, index) => `[${index}] ${text}`).join('\n%%%\n');
  return `请将以下 ${items.length} 段非中文内容逐段翻译为中文。
要求：
- 每段翻译保持编号 [N] 标记
- 段之间用 %%% 分隔
- 普通英文说明必须翻译为中文，不要整句或整段保留英文原文
- 只保留反引号内代码、命令、URL、文件路径、变量名、API 名称、模型 ID、版本号等字面技术 token
- Markdown 标题、列表、缩进和空行结构尽量保持
- 只输出翻译结果，不要解释

${numberedItems}`;
}
