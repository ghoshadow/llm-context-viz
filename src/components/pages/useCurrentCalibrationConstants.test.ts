import assert from 'node:assert/strict';
import test from 'node:test';
import { currentCalibrationRequestKey } from './useCurrentCalibrationConstants';

test('calibration current request key changes when source changes', () => {
  const cwd = '/Users/link/Documents/Anaconda/llm-context-viz';

  assert.notEqual(
    currentCalibrationRequestKey(cwd, 'claude'),
    currentCalibrationRequestKey(cwd, 'opencode'),
  );
  assert.notEqual(
    currentCalibrationRequestKey(cwd, 'claude'),
    currentCalibrationRequestKey(cwd, 'pi'),
  );
  assert.notEqual(
    currentCalibrationRequestKey(cwd, 'claude'),
    currentCalibrationRequestKey(cwd, 'openclaw'),
  );
});

test('calibration current request key is empty without cwd', () => {
  assert.equal(currentCalibrationRequestKey(null, 'opencode'), '');
});
