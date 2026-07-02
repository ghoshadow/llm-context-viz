import type { OntologyEvidence } from '../../shared/types/ontology.js';

export function parseJsonFromText(text: string): unknown | null {
  // 1. 直接解析
  try { return JSON.parse(text); } catch {}

  // 2. ```json ... ``` 包裹
  const m = text.match(/```json\s*([\s\S]*?)```/);
  if (m?.[1]) try { return JSON.parse(m[1]); } catch {}

  // 3. ``` ... ``` 包裹
  const m2 = text.match(/```\s*([\s\S]*?)```/);
  if (m2?.[1]) try { return JSON.parse(m2[1]); } catch {}

  // 4. 第一个 { 到最后一个 }
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a !== -1 && b > a) try { return JSON.parse(text.slice(a, b + 1)); } catch {}

  return null;
}

export function formatValidationError(err: unknown): string {
  if (err && typeof err === 'object' && 'issues' in err) {
    const issues = (err as { issues?: Array<{ path?: Array<string | number>; message: string }> }).issues || [];
    return issues
      .slice(0, 3)
      .map((i) => `${i.path?.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
  }
  return err instanceof Error ? err.message : String(err);
}

export function toOntologyEvidence(evidence: Array<OntologyEvidence | (Omit<OntologyEvidence, 'source'> & { source?: OntologyEvidence['source'] })>): OntologyEvidence[] {
  return evidence.map((e) => ({
    ...e,
    source: e.source ?? 'reasoning_summary',
  }));
}

export function collectParsedItems(parsed: unknown): unknown[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const single = parsed as Record<string, unknown>;
  return Array.isArray(parsed)
    ? parsed
    : Array.isArray(single.results)
      ? single.results
      : [parsed];
}

export function textFromToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('\n');
  }
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
}
