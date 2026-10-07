// 拋棄式：喚醒比對。node wake.mjs <snapA> <snapB>
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const gen = async (root) => {
  const file = join(root, 'apps/web/src/tailwind.css');
  const c = await compile(readFileSync(file, 'utf8'), {
    base: join(root, 'apps/web/src'),
    onDependency() {},
  });
  const sc = new Scanner({ sources: c.sources.map((s) => ({ ...s })) });
  const css = c.build(sc.scan());
  return new Set([...css.matchAll(/^\s*([^{}\n@}][^{}\n]*?)\s*\{/gm)].map((m) => m[1]));
};
const [A, B] = await Promise.all([gen(process.argv[2]), gen(process.argv[3])]);
const added = [...B].filter((x) => !A.has(x)),
  removed = [...A].filter((x) => !B.has(x));
console.log('A', A.size, 'B', B.size, '新增', added.length, '移除', removed.length);
console.log(added.join('\n'));
if (removed.length) console.log('--移除--\n' + removed.join('\n'));
