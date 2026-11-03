import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FileDifferences } from './file_differences.ts';

test('FileDifferences.fromParsedDiff handles one-line files', () => {
  const parsed = JSON.parse(`
{"oldFileName": "1", "newFileName": "2", "hunks": [
{"oldStart": 1, "oldLines": 1, "newStart": 1, "newLines": 1,
  "lines": ["-a","+b"]}
]}
`);
  const fileDifferences = FileDifferences.fromParsedDiff(parsed);
  assert.deepEqual(JSON.parse(JSON.stringify(fileDifferences)), {
    file1Name: '1',
    file2Name: '2',
    differences: [{
      file1Start: 0,
      file2Start: 0,
      file1Lines: ['a'],
      file2Lines: ['b'],
    }],
  });
});
