// ============================================================================
// Stage 1: Group assistant/user message pairs into conversation turns.
// ============================================================================

import type {
  SessionLine,
  UserLine,
  AssistantLine,
  SystemLine,
  AttachmentLine,
  AttachmentSummary,
  TurnGroup,
  ContentBlock,
} from '../types/session';

/**
 * Returns true if the user line is a tool-result message — i.e. its content
 * blocks contain at least one `tool_result` entry. Tool-result user messages
 * are continuations of an existing turn rather than turn-initiating messages.
 */
function isToolResult(line: UserLine): boolean {
  const content = line.message.content;
  if (typeof content === 'string') return false;
  return content.some((block: ContentBlock) => block.type === 'tool_result');
}

/**
 * Returns true if a user line should start a new conversation turn.
 *
 * A user line starts a new turn when:
 * 1. It has a `promptId` (explicit user prompt), OR
 * 2. Its content is a non-empty string (plain-text user message), AND
 * 3. It is NOT a tool-result message (which belongs to the current turn).
 */
function startsNewTurn(line: UserLine): boolean {
  if (isToolResult(line)) return false;
  const content = line.message.content;
  // System-generated task notifications are not real user turns
  if (typeof content === 'string' && content.startsWith('<task-notification>')) return false;
  if (typeof content === 'string' && content.length > 0) return true;
  if (Array.isArray(content) && content.length > 0) {
    // Content blocks that are NOT pure tool_results indicate a user prompt.
    return content.some(
      (block: ContentBlock) => block.type === 'text' || block.type === 'image',
    );
  }
  // promptId is a strong signal even for empty content (e.g. title-only prompts).
  return line.promptId != null;
}

function isSamePromptMetaContinuation(line: UserLine, currentUser: UserLine | null): boolean {
  return Boolean(
    currentUser?.promptId &&
    line.promptId === currentUser.promptId &&
    line.isMeta === true,
  );
}

/**
 * Group session lines into conversation turns.
 *
 * A turn is initiated by a user message (one that is not a tool-result
 * continuation) and includes all subsequent assistant responses, system
 * events, and tool-result user messages until the next turn-initiating
 * user message.
 *
 * @param lines - Chronologically ordered session lines.
 * @returns Array of TurnGroup objects with 1-based turnIndex.
 */
export function identifyTurns(lines: SessionLine[]): TurnGroup[] {
  const turns: TurnGroup[] = [];

  // Temporary accumulator for an in-progress turn.
  let currentUser: UserLine | null = null;
  let currentAsstLines: AssistantLine[] = [];
  let currentSystemLines: SystemLine[] = [];
  let currentToolResultLines: UserLine[] = [];
  let currentUserContinuationLines: UserLine[] = [];
  let currentAttachmentLines: AttachmentSummary[] = [];
  let preTurnAttachments: AttachmentSummary[] = [];
  let currentStartTs = '';
  let currentEndTs = '';
  let turnIndex = 0;

  for (const line of lines) {
    if (line.type === 'user') {
      const userLine = line as UserLine;

      if (isSamePromptMetaContinuation(userLine, currentUser)) {
        currentUserContinuationLines.push(userLine);
        currentEndTs = line.timestamp;
        continue;
      }

      if (startsNewTurn(userLine)) {
        // Finalize previous turn if one is in progress.
        if (currentUser !== null) {
          turnIndex++;
          turns.push({
            turnIndex,
            userLine: currentUser,
            asstLines: currentAsstLines,
            systemLines: currentSystemLines,
            toolResultLines: currentToolResultLines,
            userContinuationLines: currentUserContinuationLines,
            attachmentLines: currentAttachmentLines,
            startTs: currentStartTs,
            endTs: currentEndTs,
          });
        }

        // Start a new turn.
        currentUser = userLine;
        currentAsstLines = [];
        currentSystemLines = [];
        currentToolResultLines = [];
        currentUserContinuationLines = [];
        currentAttachmentLines = turnIndex === 0 ? [...preTurnAttachments] : [];
        currentStartTs = line.timestamp;
        continue;
      }

      // Tool-result user line: belongs to current turn.
      // Store it for timeline computation.
      if (currentUser !== null) {
        currentToolResultLines.push(userLine);
        continue;
      }

      // If no turn is in progress yet, treat as a new turn anyway (edge case).
      if (currentUser === null) {
        currentUser = userLine;
        currentStartTs = line.timestamp;
      }
      continue;
    }

    // If we haven't encountered a turn-initiating user message yet,
    // skip until we do.
    if (currentUser === null) continue;

    // Update current turn's end timestamp (only for non-turn-starting lines).
    // Turn-starting lines update endTs when the next turn starts.
    currentEndTs = line.timestamp;

    if (line.type === 'assistant') {
      currentAsstLines.push(line as AssistantLine);
    } else if (line.type === 'system') {
      currentSystemLines.push(line as SystemLine);
    } else if (line.type === 'attachment') {
      const attLine = line as AttachmentLine;
      const att = attLine.attachment;
      if (att && (att.type === 'skill_listing' || att.type === 'task_reminder' || att.type === 'mcp_instructions_delta' || att.type === 'ultra_effort_enter')) {
        const target = currentUser ? currentAttachmentLines : preTurnAttachments;
        target.push({
          type: att.type,
          content: att.content ?? att,
          timestamp: line.timestamp,
        });
      }
    }
    // Other line types (mode, etc.) are silently ignored as they
    // don't participate in turn grouping.
  }

  // Finalize the last turn.
  if (currentUser !== null) {
    turnIndex++;
    turns.push({
      turnIndex,
      userLine: currentUser,
      asstLines: currentAsstLines,
      systemLines: currentSystemLines,
      toolResultLines: currentToolResultLines,
      userContinuationLines: currentUserContinuationLines,
      attachmentLines: currentAttachmentLines,
      startTs: currentStartTs,
      endTs: currentEndTs,
    });
  }

  return turns;
}
