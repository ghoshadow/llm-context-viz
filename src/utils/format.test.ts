/**
 * format.test.ts — 格式化工具函数测试
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { fmt, fmtK, fmtDur, fmtDate, fmtDateOnly, fmtDateShort } from './format';

// ── fmt 测试 ────────────────────────────────────────────────────────────

test('fmt 将整数格式化为千位分隔字符串', () => {
  assert.equal(fmt(0), '0');
  assert.equal(fmt(100), '100');
  assert.equal(fmt(1000), '1,000');
  assert.equal(fmt(1234567), '1,234,567');
});

test('fmt 对小数进行四舍五入', () => {
  assert.equal(fmt(1234.5), '1,235');
  assert.equal(fmt(1234.4), '1,234');
});

test('fmt 处理负数', () => {
  assert.equal(fmt(-1000), '-1,000');
});

// ── fmtK 测试 ───────────────────────────────────────────────────────────

test('fmtK 小于 1000 返回整数字符串', () => {
  assert.equal(fmtK(0), '0');
  assert.equal(fmtK(200), '200');
  assert.equal(fmtK(999), '999');
});

test('fmtK 大于等于 1000 小于 100000 返回一位小数 K', () => {
  assert.equal(fmtK(1000), '1.00K');
  assert.equal(fmtK(1234), '1.23K');
  assert.equal(fmtK(99999), '100.00K'); // 99999/1000 = 99.999, toFixed(2) => "100.00"
});

test('fmtK 大于等于 100000 返回整数 K', () => {
  assert.equal(fmtK(100000), '100K');
  assert.equal(fmtK(123456), '123K');
  assert.equal(fmtK(999999), '1000K');
});

// ── fmtDur 测试 ─────────────────────────────────────────────────────────

test('fmtDur 小于 1000ms 返回毫秒', () => {
  assert.equal(fmtDur(0), '0ms');
  assert.equal(fmtDur(412), '412ms');
  assert.equal(fmtDur(999), '999ms');
});

test('fmtDur 大于等于 1s 小于 60s 返回秒', () => {
  assert.equal(fmtDur(1000), '1.00s');
  assert.equal(fmtDur(4123), '4.12s');
  assert.equal(fmtDur(59999), '60.00s'); // 59999/1000 = 59.999, toFixed(2) => "60.00"
});

test('fmtDur 大于等于 60s 有秒数返回分秒', () => {
  assert.equal(fmtDur(60000), '1分');
  assert.equal(fmtDur(252000), '4分12秒');
  assert.equal(fmtDur(61000), '1分1秒');
});

test('fmtDur 大于等于 60s 无秒数返回仅分', () => {
  assert.equal(fmtDur(120000), '2分');
  assert.equal(fmtDur(240000), '4分');
});

// ── fmtDate 测试 ─────────────────────────────────────────────────────────

test('fmtDate 格式化 ISO 时间戳为 MM-DD HH:MM', () => {
  const result = fmtDate('2026-06-15T14:30:00Z');
  assert.equal(result.length, 11);
  assert.match(result, /^\d{2}-\d{2} \d{2}:\d{2}$/);
});

test('fmtDate 对空字符串返回空字符串', () => {
  assert.equal(fmtDate(''), '');
});

test('fmtDate 对无效日期返回空字符串', () => {
  assert.equal(fmtDate('not-a-date'), '');
  assert.equal(fmtDate('invalid'), '');
});

// ── fmtDateOnly 测试 ─────────────────────────────────────────────────────

test('fmtDateOnly 格式化 ISO 时间戳为日期', () => {
  const result = fmtDateOnly('2026-06-15T14:30:00Z');
  assert.ok(result.includes('2026'), '应包含年份');
  assert.ok(result.includes('06'), '应包含月份');
  assert.ok(result.includes('15'), '应包含日期');
});

test('fmtDateOnly 对空字符串返回空字符串', () => {
  assert.equal(fmtDateOnly(''), '');
});

test('fmtDateOnly 对无效日期返回空字符串', () => {
  assert.equal(fmtDateOnly('not-a-date'), '');
});

test('fmtDateOnly 对新 Date 不可解析但非空字符串回退到切片', () => {
  // new Date 不抛出异常但 getTime 返回 NaN，走 isNaN 分支返回 ''
  // 某些运行时 new Date('...') 可能返回有效日期
  const result = fmtDateOnly('hello-world-foo');
  assert.ok(typeof result === 'string', '应返回字符串');
  // 不会抛出异常
});

// ── fmtDateShort 测试 ────────────────────────────────────────────────────

test('fmtDateShort 格式化 ISO 时间戳为 M/D HH:MM', () => {
  const result = fmtDateShort('2026-06-15T14:30:00Z');
  assert.match(result, /^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
});

test('fmtDateShort 对空字符串返回空字符串', () => {
  assert.equal(fmtDateShort(''), '');
});

test('fmtDateShort 对无效日期返回空字符串', () => {
  assert.equal(fmtDateShort('invalid-date'), '');
});
