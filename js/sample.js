// 예시 데이터 기능은 없앴다 (10-03). 예전에 들어간 예시가 남아 있으면 앱을 열 때 한 번 지운다.
// 예시 기록(sample: true)과, 실제로 쓰이지 않는 예시 카테고리를 함께 지운다. 실제로 쓴 것은 남긴다.
import { store } from './store.js';
import { usageCount } from './categories.js';

export function purgeSamples() {
  const ids = store.list('expenses', e => e.sample).map(e => e.id);
  if (!ids.length && !store.list('categories', c => c.sample).length) return;
  store.batch(() => {
    ids.forEach(id => store.remove('expenses', id));
    store.list('categories', c => c.sample && !usageCount(c)).forEach(c => store.remove('categories', c.id));
  });
}
