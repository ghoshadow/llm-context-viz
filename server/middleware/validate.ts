/**
 * validate.ts — Zod 请求体验证中间件工厂。
 *
 * 使用方式：
 *   import { z } from 'zod';
 *   import { validateBody } from '../middleware/validate.js';
 *   router.post('/', validateBody(MySchema), handler);
 *
 * 验证失败时返回 400 + 中文错误消息。
 */

import type { Request, Response, NextFunction } from 'express';
import { z, ZodError } from 'zod';

/**
 * 创建 body 验证中间件。
 * 验证 req.body 是否符合给定的 Zod schema。
 */
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const messages = err.errors.map((e) => {
          const path = e.path.join('.');
          return path ? `${path}: ${e.message}` : e.message;
        });
        res.status(400).json({ error: `请求体格式错误: ${messages.join('; ')}` });
        return;
      }
      next(err);
    }
  };
}

/**
 * 创建 query 验证中间件。
 * 验证 req.query 是否符合给定的 Zod schema。
 */
export function validateQuery<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      req.query = schema.parse(req.query) as any;
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const messages = err.errors.map((e) => {
          const path = e.path.join('.');
          return path ? `${path}: ${e.message}` : e.message;
        });
        res.status(400).json({ error: `查询参数格式错误: ${messages.join('; ')}` });
        return;
      }
      next(err);
    }
  };
}

// ── Schemas ─────────────────────────────────────────────────────────────────

/** POST /ontology/ 本体数据保存 schema */
export const OntologyDataSchema = z.object({
  data: z.object({
    types: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        color: z.string(),
      }),
    ),
    nodes: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        type: z.string(),
        firstTurn: z.number().int().positive(),
      }).passthrough(),
    ),
    edges: z.array(
      z.object({
        s: z.string(),
        t: z.string(),
        label: z.string(),
      }).passthrough(),
    ),
  }).passthrough(),
});

/** POST /sessions/:id/translate 翻译请求 schema */
export const TranslateRequestSchema = z.object({
  text: z.string().min(1, 'text 不能为空'),
  turnIndex: z.number().int().min(0),
  stepIndex: z.number().int(),
  sectionIndex: z.number().int().min(0),
  force: z.boolean().optional(),
});

/** POST /scanner/import 导入请求 schema */
export const ImportRequestSchema = z.object({
  path: z.string().min(1, '缺少文件路径'),
});
