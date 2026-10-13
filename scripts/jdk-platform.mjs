const release = '21.0.12.1+1';
const tag = 'jdk-21.0.12.1%2B1';
const suffix = 'linux_hotspot_21.0.12.1_1.tar.gz';

export function selectTemurinArtifact(runtime, platform = process.platform, arch = process.arch) {
  if (platform !== 'linux' || !['x64', 'arm64'].includes(arch)) throw new Error('unsupported_jdk_platform');
  if (runtime?.name !== 'Eclipse Temurin JDK' || runtime.version !== release) throw new Error('invalid_jdk_metadata');

  const assetArch = arch === 'x64' ? 'x64' : 'aarch64';
  const filename = `OpenJDK21U-jdk_${assetArch}_${suffix}`;
  const base = `https://github.com/adoptium/temurin21-binaries/releases/download/${tag}/${filename}`;
  const artifact = runtime.platform_artifacts?.[`linux-${arch}`];
  if (!artifact || artifact.artifact !== base || artifact.official_checksum_asset !== `${base}.sha256.txt`) {
    throw new Error('invalid_jdk_origin');
  }
  if (!/^[a-f0-9]{64}$/.test(artifact.observed_sha256)) throw new Error('invalid_digest');
  if (arch === 'x64' && runtime.artifact !== artifact.artifact) throw new Error('invalid_jdk_origin');
  if (arch === 'x64' && runtime.observed_sha256 !== artifact.observed_sha256) {
    throw new Error('invalid_digest');
  }
  return { platform: `Linux ${arch === 'x64' ? 'x64' : 'aarch64'} HotSpot`, ...artifact };
}
