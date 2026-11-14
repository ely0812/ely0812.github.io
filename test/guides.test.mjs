import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { onTopic, onTopicLists } from '../src/guides.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../site.config.json', import.meta.url), 'utf8'));

test('onTopic keeps names that contain the guide pattern; no pattern keeps everything', () => {
  const g = { slug: 'pants-diapers', match: '기저귀|팬티형' };
  assert.equal(onTopic(g, '하기스 맥스드라이 팬티형 기저귀 대형'), true);
  assert.equal(onTopic(g, '센카 퍼펙트 휩 프레시 클렌징 폼'), false);
  assert.equal(onTopic(g, undefined), false);
  assert.equal(onTopic({ slug: 'x' }, '아무 상품'), true);
});

test('onTopicLists drops off-topic ids from guide lists only', () => {
  const products = { 1: { name: '귀체온계 IRT 6525' }, 2: { name: '르무통 메이트 운동화' }, 3: { name: '운동화' } };
  const lists = { 'guide:baby-thermometer': ['1', '2', '9'], 'best:baby': ['2', '3'] };
  const out = onTopicLists(lists, products, [{ slug: 'baby-thermometer', match: '체온계' }]);
  assert.deepEqual(out, { 'guide:baby-thermometer': ['1'], 'best:baby': ['2', '3'] });
  assert.deepEqual(lists['guide:baby-thermometer'], ['1', '2', '9']); // input is not changed
});

test('every guide has a valid match pattern that accepts its own keyword', () => {
  for (const g of config.guides) {
    assert.ok(g.match, `${g.slug}: match 없음`);
    assert.doesNotThrow(() => new RegExp(g.match), `${g.slug}: 잘못된 패턴`);
    assert.ok(onTopic(g, g.keyword), `${g.slug}: 검색어 "${g.keyword}"가 match "${g.match}"에 안 맞음`);
  }
});
