const { test } = require('node:test');
const assert = require('node:assert/strict');
const { citationsFor } = require('../study');
test('citations resolve only to authorized context; invented references are removed', () => {
  const allowed = [{ id: 'local-a', remote_id: 'source:abc', kind: 'source', title: 'My notes' }];
  const result = citationsFor('Fact [source:abc]. Again [source:abc]. Secret [source:other]. Fabrication [insight:unknown].', allowed);
  assert.equal(result.citations.length, 1);
  assert.deepEqual(result.citations[0], { id: 'local-a', kind: 'source', title: 'My notes' });
  assert.equal(result.text, 'Fact [1]. Again [1]. Secret [unverified reference omitted]. Fabrication [unverified reference omitted].');
});
