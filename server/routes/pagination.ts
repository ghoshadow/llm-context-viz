export interface TurnListPagination {
  all: boolean;
  limit: number | null;
  offset: number;
}

const DEFAULT_TURN_LIMIT = 200;
const MAX_TURN_LIMIT = 500;

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' ? value : undefined;
}

function parseNonNegativeInt(value: unknown, fallback: number): number {
  const raw = firstQueryValue(value);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseTurnListPagination(query: Record<string, unknown>): TurnListPagination {
  if (firstQueryValue(query.all) === '1') {
    return { all: true, limit: null, offset: 0 };
  }

  const requestedLimit = parseNonNegativeInt(query.limit, DEFAULT_TURN_LIMIT);
  return {
    all: false,
    limit: Math.min(Math.max(requestedLimit, 1), MAX_TURN_LIMIT),
    offset: parseNonNegativeInt(query.offset, 0),
  };
}
