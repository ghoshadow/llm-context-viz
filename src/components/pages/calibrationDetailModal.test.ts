import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCalibrationDetailLayout,
  getCalibrationDetailSectionIndex,
} from './calibrationDetailModal';

test('uses side-by-side layout after a translation is available', () => {
  assert.equal(getCalibrationDetailLayout('translated markdown'), 'side-by-side');
});

test('uses single-column layout before translation is available', () => {
  assert.equal(getCalibrationDetailLayout(''), 'single');
  assert.equal(getCalibrationDetailLayout(undefined), 'single');
});

test('builds different translation cache sections for different constants and content', () => {
  const sysA = getCalibrationDetailSectionIndex('SYS_PROMPT_FALLBACK_CHARS', 'alpha');
  const sysB = getCalibrationDetailSectionIndex('SYS_PROMPT_FALLBACK_CHARS', 'beta');
  const toolsA = getCalibrationDetailSectionIndex('TOOL_DEFS_FALLBACK_CHARS', 'alpha');

  assert.notEqual(sysA, sysB);
  assert.notEqual(sysA, toolsA);
  assert.equal(getCalibrationDetailSectionIndex('SYS_PROMPT_FALLBACK_CHARS', 'alpha'), sysA);
});
