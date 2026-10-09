import { mkdtemp, chmod, rm, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { operateLocalMembership } from '../../scripts/local-membership-operator.mjs';

export async function createMembershipOperatorFixture(databaseUrl) {
  const directory = await mkdtemp(path.join(tmpdir(), 'schemaforge-membership-fixture-'));
  const configPath = path.join(directory, 'config.json');
  const config = { databasePassword: randomBytes(32).toString('hex'), developerToken: randomBytes(32).toString('hex'), approverToken: randomBytes(32).toString('hex') };
  const operatorUrl = new URL(databaseUrl); operatorUrl.password = config.databasePassword;
  await chmod(directory, 0o700);
  await writeFile(configPath, `${JSON.stringify(config)}\n`, { mode: 0o600 });
  await chmod(configPath, 0o600);
  const run = (action, projectId, actorId) => operateLocalMembership({ action, projectId, actorId, configPath, databaseUrl: operatorUrl.toString() });
  return {
    activateEmptyFixture: async app => { await app.ready(); await run('activate'); },
    activate: () => run('activate'),
    grant: (projectId, actorId) => run('grant', projectId, actorId),
    revoke: (projectId, actorId) => run('revoke', projectId, actorId),
    createProjectWithExplicitMembers: async ({ create, read, memberIds }) => {
      const response = await create();
      if (response.statusCode !== 201) throw new Error(`fixture_project_create_failed_${response.statusCode}`);
      const receipt = response.json().project;
      for (const actorId of memberIds) await run('grant', receipt.id, actorId);
      const detail = await read(receipt.id);
      if (detail.statusCode !== 200) throw new Error(`fixture_project_read_failed_${detail.statusCode}`);
      return { receipt, project: detail.json().project };
    },
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
