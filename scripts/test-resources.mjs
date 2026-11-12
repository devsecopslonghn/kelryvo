// Disposable test inputs shared by native container and customer-pilot checks.
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
export const PG_IMAGE='postgres:17.10-bookworm@sha256:9b18b78397054fce88a9552e9d5a3ad5bb7fd258c5b3cc1c5028e46373d6ea8f';
export async function prepareDemoRepository(){
  const root=await mkdtemp(path.resolve('.cache/native-pilot-repository-'));
  await mkdir(path.join(root,'migrations'));
  await writeFile(path.join(root,'migrations/V001__create_widget.sql'),'CREATE TABLE widget (id NUMBER, name VARCHAR2(100 BYTE));\n');
  await writeFile(path.join(root,'migrations/V002__add_description.sql'),'ALTER TABLE widget ADD (description VARCHAR2(200));\n');
  const git=args=>execFileSync('/usr/bin/git',['-C',root,'-c','core.hooksPath=/dev/null',...args],{stdio:'pipe'});
  git(['init','--initial-branch=main']);git(['add','--','migrations']);git(['-c','user.name=Native pilot fixture','-c','user.email=fixture@kelryvo.invalid','-c','commit.gpgsign=false','commit','-m','Synthetic pilot migrations']);
  return root;
}
