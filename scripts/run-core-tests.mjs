import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function collect(dir) {
  const files=[];
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    const path=join(dir,entry.name);
    if(entry.isDirectory()) files.push(...collect(path));
    else if((entry.name.endsWith('.node.test.ts')||entry.name.endsWith('.test.ts'))&&!entry.name.endsWith('.test.tsx')) files.push(path);
  }
  return files.sort();
}
const files=collect('tests');
const result=spawnSync(process.execPath,['--experimental-strip-types','--test',...files],{stdio:'inherit'});
process.exit(result.status??1);
