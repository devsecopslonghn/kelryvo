# Local prediction-context repair

This directory is the complete published `antlr-rust-runtime 0.34.0` source,
under its original BSD-3-Clause license. The original archive is retained at
`upstream/antlr-rust-runtime-0.34.0.crate`, SHA-256
`11b6fb4f9634cc5620c38a6951c0898d5bbbd03f43e384e64292570dafa48182`.
The separately locked grammar generator continues to use the registry release.

Only `ContextArena::merge` in `src/prediction.rs` differs from that archive.
Its original recursive parent merges can exceed a standard Rust test thread's
2 MiB stack during adaptive lookahead, before the parser's 256-rule guard runs.
The repair completes parent pairs in postorder using a heap worklist, then
reuses the original merge helpers, cache, wildcard rules and interner. Matching
parents are visited in the original order. Calls back into `merge` from those
helpers return through the identity/cache fast paths, bounding native call depth.
No stack setting, grammar, nesting cap, recovery policy or parser profile changes.

The source gate compares every published file with the retained archive and
permits a difference only inside this function. Native parser tests cover the
300-parenthesis reproducer and exact accepted output; the original corpus and
performance workloads remain enabled. See `RELEASE-READINESS.md` for measurements.

The root Cargo patch selects this source for application builds. The root source
inventory includes these files and the upstream archive in distributions, with
the upstream license and attribution intact. Remove the patch only after a
reviewed upstream release supplies the fix and passes the same contracts.
