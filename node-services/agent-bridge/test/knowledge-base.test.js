const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

test('Snowchuang buyer service fee knowledge uses the current 5% rate', () => {
  const knowledgeText = fs.readFileSync(
    path.join(__dirname, '..', '客服回复优化.txt'),
    'utf8'
  );

  assert.match(knowledgeText, /专业买手服务费[:：]?\s*5%/);
  assert.match(knowledgeText, /商品金额 × 5%（买手费）/);
  assert.match(knowledgeText, /买手费没有最低收费，按货款金额的5%计算/);
  assert.doesNotMatch(knowledgeText, /3[%％]/);
});
