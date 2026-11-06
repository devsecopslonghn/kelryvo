// Public configuration uses KELRYVO_*. Retain legacy operator/installation inputs;
// explicit canonical values take precedence. Never mutate the caller's environment.
const aliases = Object.freeze(Object.fromEntries([
  'JAVA_HOME', 'DATABASE_URL', 'DEMO_REPOSITORY_PATH', 'IDENTITY_CONFIG',
  'LOCAL_CONFIG', 'LOCAL_DATABASE_URL', 'METADATA_GENERATION_ID', 'PRODUCT_NAME',
  'REQUIRE_PRODUCT_TESTS', 'TEST_DATABASE_URL', 'TEST_SHARD',
  'UNIT_SCOPE', 'UNIT_ASSIGNMENT_ID', 'UNIT_CLEANUP_FAULT',
].map(name => [`KELRYVO_${name}`, `SCHEMAFORGE_${name}`]).concat([
  ['KELRYVO_DISCOVERY_MANIFEST', 'KELYRVO_DISCOVERY_MANIFEST'],
  ['KELRYVO_DISCOVERY_SECRET_DIRECTORY', 'KELYRVO_DISCOVERY_SECRET_DIRECTORY'],
])));

export function productEnvironment(env = process.env, { includeLegacy = false } = {}) {
  const result = { ...env };
  for (const [name, legacy] of Object.entries(aliases)) {
    if (result[name] === undefined && result[legacy] !== undefined) result[name] = result[legacy];
    delete result[legacy];
  }
  if (includeLegacy) {
    for (const [name, legacy] of Object.entries(aliases)) {
      if (result[name] !== undefined) result[legacy] = result[name];
    }
  }
  return result;
}

// Extend only explicitly allowed names, preserving worker environment boundaries.
export function productEnvironmentKeys(names) {
  return names.flatMap(name => aliases[name] ? [name, aliases[name]] : [name]);
}
