#!/usr/bin/env python3
"""Compare original/patched context merges and reproduce the bounded-stack repair."""
from pathlib import Path
import hashlib
import subprocess
import tarfile
import tempfile

root = Path(__file__).resolve().parent.parent
subprocess.run(["python3", str(root / "tools/prepare-dependencies.py"), "--verify"], check=True)
tail=r'''
fn main() {
    let deep = std::env::args().any(|s| s == "deep");
    std::thread::Builder::new().stack_size(256 * 1024).spawn(move || {
        let mut arena = ContextArena::new();
        let mut workspace = PredictionWorkspace::default();
        if deep {
            let mut left = arena.singleton(EMPTY_CONTEXT, 1);
            let mut right = arena.singleton(EMPTY_CONTEXT, 2);
            for _ in 0..10000 {
                left = arena.singleton(left, 7);
                right = arena.singleton(right, 7);
            }
            let mut merged = arena.merge(left, right, false, &mut workspace);
            for _ in 0..10000 {
                assert_eq!(arena.len(merged), 1);
                assert_eq!(arena.return_state(merged, 0), Some(7));
                merged = arena.parent(merged, 0).unwrap();
            }
            assert_eq!(arena.len(merged), 2);
            assert_eq!(arena.return_state(merged, 0), Some(1));
            assert_eq!(arena.return_state(merged, 1), Some(2));
            println!("10000 context parents merged on 256 KiB");
        } else {
            let mut nodes = vec![EMPTY_CONTEXT];
            let mut seed = 0x61u64;
            for step in 0..4000 {
                let mut next = || {seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1); seed as usize};
                let left = nodes[next() % nodes.len()];
                let right = nodes[next() % nodes.len()];
                let fresh = arena.intern_entries(&[(left, (next() % 11) as u32), (right, (next() % 11 + 20) as u32)]);
                nodes.push(fresh);
                let merged = arena.merge(fresh, right, step % 2 == 0, &mut workspace);
                nodes.push(merged);
                let reversed = arena.merge(right, fresh, step % 2 == 0, &mut workspace);
                assert_eq!(merged, reversed);
                print!("{}:", merged.0);
                for i in 0..arena.len(merged) { print!("{:?},", arena.entry(merged, i)); }
                println!();
                if step % 7 == 0 { workspace.reset(); }
            }
        }
    }).unwrap().join().unwrap();
}
'''
with tarfile.open(root / '.deps/antlr-rust-runtime-0.34.0.crate') as archive:
    original = archive.extractfile('antlr-rust-runtime-0.34.0/src/prediction.rs').read().decode()
outputs = []
with tempfile.TemporaryDirectory(prefix='context-merge-') as directory:
    for kind, source in [('original', original), ('patched', (root / '.deps/antlr-rust-runtime/src/prediction.rs').read_text())]:
        path = Path(directory) / kind
        path.with_suffix('.rs').write_text('#![allow(dead_code)]\n' + source + tail)
        subprocess.run(['rustc', '--edition=2024', '-C', 'debuginfo=2', str(path.with_suffix('.rs')), '-o', str(path)], check=True)
        result = subprocess.run([str(path)], capture_output=True, check=True)
        outputs.append(result.stdout)
        identity = hashlib.sha256(result.stdout).hexdigest()
        assert identity == '4b5c995467a95382810858c904090201d7f1c1d76fc9c261afdb896d7f4fb7f0', identity
        deep = subprocess.run([str(path), 'deep'], capture_output=True)
        assert deep.returncode == (-6 if kind == 'original' else 0), deep.stderr
        print(kind, 'DAG SHA-256', identity, '10000-parent/256-KiB exit', deep.returncode, flush=True)
assert outputs[0] == outputs[1]
