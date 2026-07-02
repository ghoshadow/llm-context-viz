import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ExtractionManifest, ShardFile } from '../content/extract-to-files.js';
import { sanitizeForLog } from '../utils/log-sanitizer.js';
import { buildSafeEnv } from './config.js';
import { buildEntityExtractorDef, buildOrchestratorPrompt, type ExtractionDepth } from './orchestrator-prompt.js';
import { SubmitExtractionSchema } from './schema.js';
import {
  collectParsedItems,
  formatValidationError,
  parseJsonFromText,
  textFromToolResultContent,
} from './ontology-response-parser.js';

/** 分片收集的结构化错误 — 区分致命错误和可恢复错误 */
export interface ShardError {
  type: 'fatal' | 'recoverable';
  detail: string;
  /** 致命错误时标识是否应终止整个提取流程 */
  shouldAbort?: boolean;
}

/** Agent SDK 超时时间（毫秒），单次 query 最长等待 */
const LLM_EXTRACTION_TIMEOUT_MS = 10 * 60 * 1000; // 10 分钟

export async function collectShardTextResults(params: {
  manifest: ExtractionManifest;
  shards: ShardFile[];
  model: string;
  apiKey: string;
  baseUrl: string;
  depth: ExtractionDepth;
  onEvent: (event: string, data: Record<string, unknown>) => void;
  attempt: number;
}): Promise<{ results: Map<number, string>; errors: ShardError[] }> {
  const { manifest, shards, model, apiKey, baseUrl, depth, onEvent, attempt } = params;
  const shardTextResults: Map<number, string> = new Map();
  const errors: ShardError[] = [];
  if (shards.length === 0) return { results: shardTextResults, errors };

  const abort = new AbortController();
  const expectedShards = shards.length;

  if (attempt === 1) {
    for (const shard of shards) onEvent('shard-start', { shardIndex: shard.index });
  } else {
    for (const shard of shards) onEvent('shard-retry', { shardIndex: shard.index, attempt });
  }

  // 超时保护：防止 Agent SDK 永久挂起
  const timeoutId = setTimeout(() => {
    console.error('[extract-ontology] Agent SDK 超时（%d ms），中止', LLM_EXTRACTION_TIMEOUT_MS);
    abort.abort();
  }, LLM_EXTRACTION_TIMEOUT_MS);

  try {
    const q = query({
      prompt: '请开始提取。',
      options: {
        abortController: abort,
        systemPrompt: buildOrchestratorPrompt(manifest, shards, depth),
        model,
        agents: { 'entity-extractor': buildEntityExtractorDef(depth) },
        allowedTools: ['Read', 'Task'],
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: Math.max(shards.length + 5, 5),
        thinking: { type: 'disabled' as const },
        cwd: manifest.rootDir.replace(/\/data\/extractions\/.*$/, ''),
        env: { ...buildSafeEnv({}), ANTHROPIC_API_KEY: apiKey, ANTHROPIC_BASE_URL: baseUrl },
      },
    });

    for await (const msg of q) {
      const mtype = (msg as Record<string, unknown>).type as string;
      const msubtype = (msg as Record<string, unknown>).subtype as string || '';
      console.error('[msg]', sanitizeForLog(mtype), sanitizeForLog(msubtype));

      if (msg.type === 'system' && msubtype === 'init') {
        onEvent('agent-start', { sessionId: (msg as SDKMessage & { session_id: string }).session_id });
      }

      if (msg.type === 'assistant') {
        const am = msg as SDKMessage & { type: 'assistant'; message?: { content?: unknown[] } };
        if (am.message?.content) {
          for (const block of am.message.content as Array<{ type: string; text?: string; name?: string }>) {
            if (block.type === 'text') console.error('  [asst text]', sanitizeForLog((block.text || '').substring(0, 120)));
            if (block.type === 'tool_use') console.error('  [asst tool]', block.name);
          }
        }
      }

      if (msg.type === 'user') {
        const um = msg as SDKMessage & { type: 'user'; message?: { role: string; content?: unknown[] } };
        const blocks = (um.message?.content && Array.isArray(um.message.content))
          ? um.message.content
          : (um.message?.content ? [um.message.content] : []);

        for (const block of blocks as Array<{ type: string; tool_use_id?: string; content?: unknown; text?: string; name?: string }>) {
          if (block.type !== 'tool_result') continue;

          const text = textFromToolResultContent(block.content);
          if (!text) continue;

          console.error('  [tool_result]', sanitizeForLog(text.substring(0, 200)));
          const parsed = parseJsonFromText(text);
          for (const item of collectParsedItems(parsed)) {
            const validation = SubmitExtractionSchema.safeParse(item);
            if (validation.success) {
              const r = validation.data;
              shardTextResults.set(r.shardIndex, JSON.stringify(r));
              console.error('  [parsed shard]', r.shardIndex, 'theme:', sanitizeForLog(r.phaseTheme || ''));
              const shard = manifest.shards.find((s) => s.index === r.shardIndex);
              onEvent('shard-done', {
                shardIndex: r.shardIndex,
                phaseTheme: r.phaseTheme,
                candidates: r.candidates,
                relations: r.relations,
                config: r.config,
                turnRange: shard?.turnRange,
                startTurn: shard?.startTurn,
                endTurn: shard?.endTurn,
                extractionDepth: depth,
              });
            } else {
              const candidate = item as Record<string, unknown>;
              const shardIndex = typeof candidate?.shardIndex === 'number' ? candidate.shardIndex : -1;
              const error = formatValidationError(validation.error);
              console.error('  [validation error]', shardIndex, sanitizeForLog(error));
              const shard = manifest.shards.find((s) => s.index === shardIndex);
              onEvent('shard-error', {
                shardIndex,
                error,
                turnRange: shard?.turnRange,
                startTurn: shard?.startTurn,
                endTurn: shard?.endTurn,
                extractionDepth: depth,
              });
            }
          }
        }
      }

      if (shardTextResults.size >= expectedShards) {
        console.error('[extract-ontology] All', expectedShards, 'shards collected, aborting Agent SDK...');
        abort.abort();
        break;
      }

      if (msg.type === 'result') {
        const resultStr = JSON.stringify(msg);
        console.error('  [result]', sanitizeForLog(resultStr.substring(0, 400)));
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // 区分超时中止和正常中止
      if (shardTextResults.size === 0) {
        const errorDetail = 'Agent SDK 请求超时，所有分片均未返回结果';
        console.error('[extract-ontology]', errorDetail);
        errors.push({ type: 'fatal', detail: errorDetail, shouldAbort: true });
      } else {
        console.error('[extract-ontology] Agent SDK aborted (expected)');
      }
    } else {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error('[extract-ontology] Agent SDK error:', sanitizeForLog(errorMsg));
      onEvent('agent-error', { message: errorMsg });

      // SDK 层面的网络/认证错误视为可恢复（允许重试），SDK 内部崩溃视为致命
      const isFatal = errorMsg.includes('ENOENT') || errorMsg.includes('EACCES') || errorMsg.includes('cwd');
      errors.push({
        type: isFatal ? 'fatal' : 'recoverable',
        detail: errorMsg,
        shouldAbort: isFatal,
      });
    }
  } finally {
    clearTimeout(timeoutId);
  }

  return { results: shardTextResults, errors };
}
