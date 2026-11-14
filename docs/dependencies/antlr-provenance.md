# Native Oracle grammar provenance

The two grammar files are unchanged Apache-2.0 sources from grammars-v4 commit
`7df52be94698550d219d299d04105c6bafadd9c3`; their original headers and authors remain.
Build-generated Rust recognizers use antlr-rust-codegen 0.34.0 and
antlr-rust-runtime 0.34.0. The host-generator Cargo.lock pins the pristine runtime archive; application
builds use the identity-verified [runtime patch](../../dependencies/antlr-rust-runtime/README.md). The grammar crate
retains its Apache-2.0 license and NOTICE; dependency archives retain their own
BSD-3-Clause licenses. Grammar inputs, native adaptations and generated output
hashes are recorded in `crates/kelryvo-oracle-grammar/grammar/lock.json`.

The upstream Java support files have no explicit grant in the inspected source/history.
They are excluded. The initial disposable probe exposed their behavior and must not be
described as an approved dependency or a clean-room implementation.

The project-authored native hooks express the licensed grammar contracts below.
Prior source exposure remains disclosed; the native implementation makes no claim
of clean-room legal clearance. No excluded upstream support file or method body is
included. The hooks do not add grammar productions or split SQL.

| Callback | Licensed derivation and implementation |
| --- | --- |
| Newline | `REMARK_COMMENT` and `PROMPT_MESSAGE` call `IsNewlineAtPos`; a switch tests the requested character for EOF, LF or CR. The older Apache-header lexer at commit `953cd912f398a838ee2137a56aac1661168f4ea2` documents the same call sites. |
| Version | Current version predicates enable grammar alternatives. Apache-header parser at `356f3ea19e3c62fa92e1f3c7997daa8ec7711ad9` explicitly initializes `version12=true`. The adapter enables these language alternatives; this is no Oracle version acceptance claim. |
| Last unit | `script_unit` actions and `terminator` comments specify SQL versus PL/SQL state; an enum implements that state. |
| Slash | `terminator` explicitly requires SOLIDUS alone on its line. The rewrite checks literal source characters on both sides up to LF/CR, including hidden tokens; it does not use the upstream previous/current/next token-line algorithm. Non-whitespace on that line fails closed. |
| Numeric ambiguity | `numeric_function` names SUM/COUNT/ROUND/AVG/MAX/MIN/LEAST/GREATEST before `(`; `unary_expression`/`standard_function` use the predicate before generic alternatives. A set of those symbolic terminal names suppresses the generic branch only when the next token is LEFT_PAREN. |
| Join ambiguity | `table_ref_aux`, `join_clause`, `outer_join_type` and `query_partition_clause` define join prefixes. A symbolic-name set keeps these prefixes from being consumed as a table alias. |

These small callback expressions implement observable licensed grammar contracts. Exact
source hashes and corpus/regression outcomes are checked by the native grammar tests.
This record does not grant rights to the excluded
upstream classes or establish final product distribution clearance.

Primary sources: [pinned parser grammar](https://github.com/antlr/grammars-v4/blob/7df52be94698550d219d299d04105c6bafadd9c3/sql/plsql/PlSqlParser.g4),
[pinned lexer grammar](https://github.com/antlr/grammars-v4/blob/7df52be94698550d219d299d04105c6bafadd9c3/sql/plsql/PlSqlLexer.g4),
[ANTLR license](https://github.com/antlr/antlr4/blob/4.13.2/LICENSE.txt).
