import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  lstat,
  mkdir,
  mkdtemp,
  copyFile,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  parse,
  sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOCK_PATH = 'docs/dependencies/antlr-parser-lock.json';
const PROFILE = 'antlr-plsql-grammars-v4-7df52be94698550d219d299d04105c6bafadd9c3-antlr4-4.13.2';
const MAIN_CLASS = 'local.schemaforge.antlrparser.Main';
const HELPER_PATH = 'experiments/db-devops-wp0/antlr-helper/target/schemaforge-antlr-parser.jar';
const HELPER_DIR = 'experiments/db-devops-wp0/antlr-helper';
const GENERATED_PACKAGE = 'local.schemaforge.antlrparser';
const FIXED_JAR_DATE = '2026-10-08T00:00:00Z';
const PINNED_JDK_VERSION = `${['21', '0', '12', '1'].join('.')}+1-LTS`;
const MAX_BUFFER = 4 * 1024 * 1024;
const TIMEOUT_MS = 120_000;

const PINNED_GRAMMARS = [
  {
    path: `${HELPER_DIR}/grammar/PlSqlLexer.g4`,
    sha256: 'fd82384ba3ba2f5a7b070a977cd77a05c01fefbfb52938d35dfaf472a2e6e59e',
    license: 'Apache-2.0',
    source_url: 'https://raw.githubusercontent.com/antlr/grammars-v4/7df52be94698550d219d299d04105c6bafadd9c3/sql/plsql/PlSqlLexer.g4',
  },
  {
    path: `${HELPER_DIR}/grammar/PlSqlParser.g4`,
    sha256: '90c6cb500fec711ad7e1d3aa793638686f265e4ce1e02632e1eabd6fded502e3',
    license: 'Apache-2.0',
    source_url: 'https://raw.githubusercontent.com/antlr/grammars-v4/7df52be94698550d219d299d04105c6bafadd9c3/sql/plsql/PlSqlParser.g4',
  },
];
const PINNED_ARTIFACTS = [
  {
    id: 'tool',
    path: '.cache/antlr/antlr4-4.13.2-complete.jar',
    sha256: 'eae2dfa119a64327444672aff63e9ec35a20180dc5b8090b7a6ab85125df4d76',
    url: 'https://repo.maven.apache.org/maven2/org/antlr/antlr4/4.13.2/antlr4-4.13.2-complete.jar',
    license: 'BSD-3-Clause',
    scope: 'EXTERNAL_BUILD_ONLY',
    notShipped: true,
  },
  {
    id: 'runtime',
    path: '.cache/antlr/antlr4-runtime-4.13.2.jar',
    sha256: 'dd3e8a13a2d669bf84fb8d834de35ce4875f27157698d206241ec8488aadcaf7',
    url: 'https://repo.maven.apache.org/maven2/org/antlr/antlr4-runtime/4.13.2/antlr4-runtime-4.13.2.jar',
    license: 'BSD-3-Clause',
    scope: 'HELPER_RUNTIME',
    notShipped: true,
  },
];
const PINNED_NOTICES = [
  {
    path: `${HELPER_DIR}/notices/ANTLR-BSD-3-Clause.txt`,
    sha256: '3db1fb3ee79a4b4f9918fc4d0f6133bf18a3cf787f126cd22f8aa9b862281c0c',
  },
  {
    path: `${HELPER_DIR}/notices/Apache-2.0.txt`,
    sha256: 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30',
  },
  {
    path: `${HELPER_DIR}/notices/NOTICE.txt`,
    sha256: '9984aa4adef5fcf9ba0050baad431dfecbe8e4630a68d03c51dcfa66cb833f47',
  },
];
const SUPPORT_SOURCES = [
  `${HELPER_DIR}/src/local/schemaforge/antlrparser/Main.java`,
  `${HELPER_DIR}/src/local/schemaforge/antlrparser/PlSqlLexerBase.java`,
  `${HELPER_DIR}/src/local/schemaforge/antlrparser/PlSqlParserBase.java`,
];
const TOOL_COMPONENTS = [
  { coordinate: 'org.antlr:antlr4-runtime:4.13.2', sha256: 'dd3e8a13a2d669bf84fb8d834de35ce4875f27157698d206241ec8488aadcaf7', license: 'BSD-3-Clause', packed: true },
  { coordinate: 'org.antlr:antlr-runtime:3.5.3', sha256: '68bf9f5a33dfcb34033495c587e6236bef4e37aa6612919f5b1e843b90669fb9', license: 'BSD-3-Clause', packed: true },
  { coordinate: 'org.antlr:ST4:4.3.4', sha256: 'f927ac384c46d749f8b5ec68972a53aed21e00313509299616edb73bfa15ff33', license: 'BSD-3-Clause', packed: true },
  { coordinate: 'org.abego.treelayout:org.abego.treelayout.core:1.0.3', sha256: 'fa5e31395c39c2e7d46aca0f81f72060931607b2fa41bd36038eb2cb6fb93326', license: 'BSD-3-Clause', packed: true },
  { coordinate: 'com.ibm.icu:icu4j:72.1', sha256: '3df572b240a68d13b5cd778ad2393e885d26411434cd8f098ac5987ea2e64ce3', license: 'Unicode-3.0', packed: false },
];

const sha256 = async (file) => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
};

function validateProfile(lock) {
  if (lock?.schema_version !== 1 || lock.profile !== PROFILE || lock.grammar_commit !== '7df52be94698550d219d299d04105c6bafadd9c3'
      || lock.main_class !== MAIN_CLASS || lock.helper_path !== HELPER_PATH
      || lock.upstream_headerless_bases_included !== false || lock.unknown_required_third_party_grants !== 0
      || lock.execution_approved !== false || lock.production_approved !== false) throw new Error('lock_profile_or_approval_invalid');
}

function validateGrammarPins(lock) {
  if (lock.grammar_files?.length !== PINNED_GRAMMARS.length
      || PINNED_GRAMMARS.some((expected, index) => ['path', 'sha256', 'license', 'source_url']
        .some((key) => lock.grammar_files[index][key] !== expected[key]))) throw new Error('grammar_lock_mismatch');
}

function validateArtifactPins(lock) {
  if (lock.artifacts?.length !== PINNED_ARTIFACTS.length) throw new Error('artifact_lock_mismatch');
  const valid = PINNED_ARTIFACTS.every((expected, index) => {
    const observed = lock.artifacts[index];
    const notShipped = expected.id === 'tool' ? observed.shipped === false : observed.shipped_in_helper === false;
    return observed.id === expected.id && observed.path === expected.path && observed.sha256 === expected.sha256
      && observed.license === expected.license && observed.scope === expected.scope
      && observed.url === expected.url && notShipped;
  });
  if (!valid) throw new Error('artifact_lock_mismatch');
}

function validateNoticePins(lock) {
  if (lock.notices?.length !== PINNED_NOTICES.length
      || PINNED_NOTICES.some((expected, index) => lock.notices[index].path !== expected.path
        || lock.notices[index].sha256 !== expected.sha256)) throw new Error('notice_lock_mismatch');
}

function validateJdkPin(lock) {
  if (lock.external_jdk?.distribution !== 'Eclipse Temurin'
      || lock.external_jdk.version !== PINNED_JDK_VERSION
      || lock.external_jdk.bundled !== false || lock.external_jdk.default_home !== '.cache/licenses/runtime/temurin') {
    throw new Error('jdk_lock_mismatch');
  }
}

function validateToolComponents(lock) {
  if (!Array.isArray(lock.complete_tool_components) || lock.complete_tool_components.length !== TOOL_COMPONENTS.length) {
    throw new Error('tool_component_lock_mismatch');
  }
  const seenComponents = new Set();
  for (const item of lock.complete_tool_components) {
    const pinned = TOOL_COMPONENTS.find(({ coordinate }) => coordinate === item.coordinate);
    if (!pinned || seenComponents.has(item.coordinate) || item.component_artifact_sha256 !== pinned.sha256
        || item.product_shipped !== false || item.packed_in_tool !== pinned.packed || item.license !== pinned.license) {
      throw new Error('tool_component_rights_unreviewed');
    }
    seenComponents.add(item.coordinate);
  }
  for (const { coordinate } of TOOL_COMPONENTS) {
    if (!seenComponents.has(coordinate)) throw new Error('tool_component_lock_mismatch');
  }
}

function validateAuthoredSourcePins(lock) {
  if (!Array.isArray(lock.authored_sources) || lock.authored_sources.length !== SUPPORT_SOURCES.length
      || SUPPORT_SOURCES.some((source) => lock.authored_sources.filter((item) => item.path === source
        && /^[a-f0-9]{64}$/.test(item.sha256 ?? '')).length !== 1)) throw new Error('authored_source_lock_invalid');
}

export function validateLock(lock) {
  validateProfile(lock);
  validateGrammarPins(lock);
  validateArtifactPins(lock);
  validateNoticePins(lock);
  validateJdkPin(lock);
  if (lock.support_source_provenance !== 'docs/dependencies/antlr-provenance.md') {
    throw new Error('support_source_provenance_unresolved');
  }
  validateToolComponents(lock);
  if (!/^[a-f0-9]{64}$/.test(lock.helper_sha256 ?? '')) throw new Error('helper_digest_unpinned');
  validateAuthoredSourcePins(lock);
  return true;
}

/** Resolve an in-repository path while rejecting traversal and symlinks in every component. */
export async function checkedPath(projectRoot, relativePath, { allowMissingLeaf = false } = {}) {
  if (typeof relativePath !== 'string' || !relativePath || isAbsolute(relativePath)) throw new Error('path_invalid');
  const absoluteRoot = resolve(projectRoot);
  const absolutePath = resolve(absoluteRoot, relativePath);
  const rel = relative(absoluteRoot, absolutePath);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('path_escape');
  let current = absoluteRoot;
  const parts = rel.split(sep);
  for (let i = 0; i < parts.length; i += 1) {
    current = join(current, parts[i]);
    const stat = await lstat(current).catch((error) => {
      if (allowMissingLeaf && i === parts.length - 1 && error.code === 'ENOENT') return null;
      throw new Error('path_missing');
    });
    if (stat?.isSymbolicLink()) throw new Error('path_symlink');
    if (!stat && i === parts.length - 1) return current;
    if (i < parts.length - 1 && !stat?.isDirectory()) throw new Error('path_component_invalid');
    if (i === parts.length - 1 && !stat?.isFile() && !stat?.isDirectory()) throw new Error('path_leaf_invalid');
  }
  return current;
}

async function assertDigest(projectRoot, entry) {
  const file = await checkedPath(projectRoot, entry.path);
  if (!(await lstat(file)).isFile()) throw new Error('input_not_regular_file');
  if (await sha256(file) !== entry.sha256) throw new Error('input_digest_mismatch');
  return file;
}

async function verifyEntryDigests(projectRoot, entries) {
  const files = await collectVerifiedPaths(projectRoot, entries);
  const actual = await Promise.all(files.map(sha256));
  if (actual.some((digest, index) => digest !== entries[index].sha256)) throw new Error('input_digest_mismatch');
  return files;
}

async function collectVerifiedPaths(projectRoot, entries, index = 0, files = []) {
  if (index === entries.length) return files;
  const file = await checkedPath(projectRoot, entries[index].path);
  if (!(await lstat(file)).isFile()) throw new Error('input_not_regular_file');
  files.push(file);
  return collectVerifiedPaths(projectRoot, entries, index + 1, files);
}

export async function verifyPinnedFile(projectRoot, entry) {
  return assertDigest(projectRoot, entry);
}

function run(command, args, cwd, env) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  if (result.error?.code === 'ETIMEDOUT') throw new Error('build_tool_timeout');
  if (result.error?.code === 'ENOBUFS') throw new Error('build_tool_output_limit');
  if (result.error || result.status !== 0) throw new Error('build_tool_failed');
  return result.stdout;
}

function compilerEnvironment(javaHome) {
  return {
    JAVA_HOME: javaHome,
    PATH: join(javaHome, 'bin'),
    LANG: 'C',
    LC_ALL: 'C',
    TZ: 'UTC',
  };
}

async function assertJdk(javaHome, env) {
  const java = await checkedAbsoluteFile(join(javaHome, 'bin/java'));
  const javac = await checkedAbsoluteFile(join(javaHome, 'bin/javac'));
  const javaVersion = runVersion(java, ['-version'], env);
  const pinnedVersion = PINNED_JDK_VERSION;
  if (!javaVersion.includes(pinnedVersion)) throw new Error('jdk_version_mismatch');
  const javacVersion = runVersion(javac, ['-version'], env);
  const compilerVersion = pinnedVersion.split('+', 1)[0];
  if (!javacVersion.includes(compilerVersion)) throw new Error('javac_version_mismatch');
  const jar = await checkedAbsoluteFile(join(javaHome, 'bin/jar'));
  return { java, javac, jar };
}

async function checkedAbsoluteFile(file) {
  const absolute = resolve(file);
  const root = parse(absolute).root;
  let current = root;
  const parts = absolute.slice(root.length).split(sep).filter(Boolean);
  await inspectAbsoluteComponents(parts, 0, current);
  return absolute;
}

async function inspectAbsoluteComponents(parts, index, current) {
  if (index === parts.length) return;
  const next = join(current, parts[index]);
  const info = await lstat(next).catch(() => null);
  if (!info) throw new Error('jdk_tool_missing');
  if (info.isSymbolicLink()) throw new Error('jdk_tool_symlink');
  if (index < parts.length - 1 && !info.isDirectory()) throw new Error('jdk_path_invalid');
  if (index === parts.length - 1 && !info.isFile()) throw new Error('jdk_tool_invalid');
  await inspectAbsoluteComponents(parts, index + 1, next);
}

function runVersion(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error?.code === 'ETIMEDOUT') throw new Error('jdk_version_timeout');
  if (result.error || result.status !== 0) throw new Error('jdk_version_unavailable');
  return `${result.stdout}${result.stderr}`;
}

export async function verifyAuthoredSources(projectRoot, lock) {
  validateLock(lock);
  const entries = SUPPORT_SOURCES.map((source) => lock.authored_sources.find((item) => item.path === source));
  await verifyEntryDigests(projectRoot, entries);
  return Object.fromEntries(entries.map((entry) => [entry.path, entry.sha256]));
}

async function validateInputs(projectRoot, lock) {
  validateLock(lock);
  const rootReal = await realpath(projectRoot);
  if (rootReal !== resolve(projectRoot)) throw new Error('project_root_symlink');
  const sourceHashes = await verifyAuthoredSources(projectRoot, lock);
  await verifyEntryDigests(projectRoot, [...PINNED_GRAMMARS, ...PINNED_ARTIFACTS, ...PINNED_NOTICES]);
  const helperDir = await checkedPath(projectRoot, HELPER_DIR);
  if (!(await lstat(helperDir)).isDirectory()) throw new Error('helper_directory_invalid');
  return { sourceHashes, helperDir };
}

async function buildOnce({ tools, runtime, helperDir, env }) {
  const temp = await mkdtemp(join(await realpath(tmpdir()), 'schemaforge-antlr-build-'));
  try {
    const generated = join(temp, 'generated');
    const classes = join(temp, 'classes');
    const jarPath = join(temp, 'schemaforge-antlr-parser.jar');
    await mkdir(generated);
    await mkdir(classes);
    const grammarArgs = [
      '-Xms32m', '-Xmx768m', '-jar', tools,
      '-no-listener', '-no-visitor', '-package', GENERATED_PACKAGE,
      '-lib', generated, '-o', generated,
      ...PINNED_GRAMMARS.map((entry) => resolve(helperDir, 'grammar', entry.path.split('/').at(-1))),
    ];
    run(env.JAVA, grammarArgs, temp, env);

    const generatedJava = await listFiles(generated, (name) => name.endsWith('.java'));
    if (generatedJava.length !== 2) throw new Error('generated_source_set_mismatch');
    const authoredJava = [];
    for (const source of SUPPORT_SOURCES) {
      if (!source.endsWith('.java')) continue;
      authoredJava.push(resolve(helperDir, 'src/local/schemaforge/antlrparser', source.split('/').at(-1)));
    }
    const javacArgs = [
      '-J-Xms32m', '-J-Xmx768m', '--release', '21', '-encoding', 'UTF-8', '-g:none',
      '-classpath', runtime, '-d', classes, ...generatedJava, ...authoredJava,
    ];
    run(join(env.JAVA_HOME, 'bin/javac'), javacArgs, temp, env);

    const manifestPath = join(temp, 'MANIFEST.MF');
    await writeFile(manifestPath, `Manifest-Version: 1.0\r\nMain-Class: ${MAIN_CLASS}\r\n\r\n`, { mode: 0o600 });
    const jarArgs = [
      '--create', '--file', jarPath, '--date', FIXED_JAR_DATE, '--manifest', manifestPath,
      '-C', classes, '.',
      '-C', helperDir, 'notices/ANTLR-BSD-3-Clause.txt',
      '-C', helperDir, 'notices/Apache-2.0.txt',
      '-C', helperDir, 'notices/NOTICE.txt',
    ];
    run(join(env.JAVA_HOME, 'bin/jar'), jarArgs, temp, env);
    await assertJarContents(join(env.JAVA_HOME, 'bin/jar'), jarPath, temp, env);
    return { sha256: await sha256(jarPath), sourcePath: jarPath, temp };
  } catch (error) {
    await rm(temp, { recursive: true, force: true });
    throw error;
  }
}

async function listFiles(directory, predicate) {
  const entries = await (await import('node:fs/promises')).readdir(directory, { withFileTypes: true });
  const files = [];
  const directories = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error('generated_symlink');
    const file = join(directory, entry.name);
    if (entry.isDirectory()) directories.push(file);
    else if (entry.isFile() && predicate(entry.name)) files.push(file);
  }
  const nested = await Promise.all(directories.map((child) => listFiles(child, predicate)));
  return [...files, ...nested.flat()].sort(comparePaths);
}

function comparePaths(left, right) {
  if (left < right) return -1;
  return Number(left > right);
}

function validateJarEntry(name, notices) {
  if (!name || notices.has(name) || name === 'META-INF/MANIFEST.MF' || name === 'META-INF/') return;
  if (['org/antlr/', 'org/stringtemplate/', 'com/ibm/icu/'].some(prefix => name.startsWith(prefix))) {
    throw new Error('runtime_or_tool_embedded');
  }
  const localPackage = 'local/schemaforge/antlrparser/';
  if (name.endsWith('/') && localPackage.startsWith(name)) return;
  if (!name.startsWith(localPackage)) throw new Error('unexpected_jar_entry');
  if (!name.endsWith('/') && !name.endsWith('.class')) throw new Error('unexpected_jar_resource');
}

async function assertJarContents(jarCommand, jarPath, cwd, env) {
  const contents = run(jarCommand, ['--list', '--file', jarPath], cwd, env).trim().split(/\r?\n/);
  const notices = new Set([
    'notices/ANTLR-BSD-3-Clause.txt',
    'notices/Apache-2.0.txt',
    'notices/NOTICE.txt',
  ]);
  for (const name of contents) validateJarEntry(name, notices);
  for (const notice of notices) {
    if (!contents.includes(notice)) throw new Error('jar_notice_missing');
  }
}

export async function build({ projectRoot = ROOT, environment = process.env } = {}) {
  const root = resolve(projectRoot);
  const lockFile = await checkedPath(root, LOCK_PATH);
  const lock = JSON.parse(await readFile(lockFile, 'utf8'));
  const inputs = await validateInputs(root, lock);
  const configuredJavaHome = environment.SCHEMAFORGE_JAVA_HOME
    ? resolve(environment.SCHEMAFORGE_JAVA_HOME)
    : resolve(root, lock.external_jdk.default_home);
  if (!environment.SCHEMAFORGE_JAVA_HOME) await checkedPath(root, lock.external_jdk.default_home);
  const env = compilerEnvironment(configuredJavaHome);
  const { java, javac, jar } = await assertJdk(configuredJavaHome, env);
  const artifactFiles = await resolveArtifactFiles(root, PINNED_ARTIFACTS);

  const buildEnvironment = { ...env, JAVA: java, JAVAC: javac, JAR: jar };
  const buildOptions = {
    tools: artifactFiles.get('tool'),
    runtime: artifactFiles.get('runtime'),
    helperDir: inputs.helperDir,
    env: buildEnvironment,
  };
  const runs = await buildTwiceSequentially(buildOptions);
  try {
    if (runs[0].sha256 !== runs[1].sha256) throw new Error('helper_reproducibility_mismatch');
    const digest = runs[0].sha256;
    const pinned = digest === lock.helper_sha256;
    // A blocked build must preserve the installed reviewed artifact.
    if (pinned) {
      await installReviewedHelper(root, lock.helper_path, runs[0].sourcePath);
    }
    return {
      outcome: pinned ? 'PASS' : 'BLOCKED_REGISTRY_DIGEST',
      scope: 'OFFLINE_CANDIDATE_BUILD_ONLY',
      offline: true,
      build_count: runs.length,
      helper_sha256: digest,
      registered_helper_sha256_matches: pinned,
      artifact_installed: pinned,
      source_sha256: inputs.sourceHashes,
      jdk_version: PINNED_JDK_VERSION,
      runtime_shipped_in_helper: false,
      tool_shipped_in_helper: false,
      execution_approved: false,
      production_approved: false,
      database_calls: 0,
    };
  } finally {
    await Promise.all(runs.map((runResult) => rm(runResult.temp, { recursive: true, force: true })));
  }
}

async function resolveArtifactFiles(projectRoot, entries, index = 0, files = new Map()) {
  if (index === entries.length) return files;
  const entry = entries[index];
  files.set(entry.id, await checkedPath(projectRoot, entry.path));
  return resolveArtifactFiles(projectRoot, entries, index + 1, files);
}

async function buildTwiceSequentially(options) {
  const first = await buildOnce(options);
  try {
    const second = await buildOnce(options);
    return [first, second];
  } catch (error) {
    await rm(first.temp, { recursive: true, force: true });
    throw error;
  }
}

async function installReviewedHelper(projectRoot, helperPath, sourcePath) {
  const outputPath = resolve(projectRoot, helperPath);
  const outputDirectory = dirname(outputPath);
  const relativeOutputDirectory = relative(projectRoot, outputDirectory);
  await checkedPath(projectRoot, relativeOutputDirectory, { allowMissingLeaf: true });
  await mkdir(outputDirectory, { recursive: true });
  const outputRelative = relative(projectRoot, outputPath);
  await checkedPath(projectRoot, outputRelative, { allowMissingLeaf: true });
  const temporaryOutput = `${outputPath}.tmp-${process.pid}-${randomUUID()}`;
  await copyFile(sourcePath, temporaryOutput);
  await checkedPath(projectRoot, relative(projectRoot, temporaryOutput));
  await rename(temporaryOutput, outputPath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await build();
    console.log(JSON.stringify(result, null, 2));
    if (result.outcome !== 'PASS') process.exitCode = 2;
  } catch (error) {
    console.error(/^[a-z0-9_]+$/.test(error.message) ? error.message : 'offline_build_failed');
    process.exitCode = 1;
  }
}
