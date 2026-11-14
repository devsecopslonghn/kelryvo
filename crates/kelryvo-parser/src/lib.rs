//! Byte-preserving native Oracle SQL parser. This is a distinct parser profile;
//! it never attests compatibility with old Java/ANTLR approvals.
use kelryvo_core::{MAX_INPUT_BYTES, MAX_PLAN_STATEMENTS, sha256};
use kelryvo_oracle_grammar::Rejected;
use serde::{Deserialize, Serialize};
pub mod snapshot;

pub const PROFILE: &str = "kelryvo-oracle-rust-v2-antlr-0.34.0";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Statement {
    pub start_byte: usize,
    pub end_byte: usize,
    pub source_sha256: String,
    pub execution_sha256: String,
    pub execution_sql: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Parsed {
    pub ok: bool,
    pub kind: &'static str,
    pub profile: &'static str,
    pub statement_count: usize,
    pub statements: Vec<Statement>,
    pub raw_sha256: String,
    pub execution_approved: bool,
    pub production_approved: bool,
}

impl Parsed {
    /// Retained statement identities use release order, file order and exact byte spans.
    pub fn identities(&self, path: &serde_json::Value, offset: usize) -> Vec<serde_json::Value> {
        self.statements.iter().enumerate().map(|(index, s)| serde_json::json!({"ordinal":offset+index+1,"path":path,"fileOrdinal":index+1,"startByte":s.start_byte,"endByte":s.end_byte,"sourceSha256":s.source_sha256,"executionSha256":s.execution_sha256})).collect()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ParseError {
    InputTooLarge,
    InvalidUtf8,
    Utf8BomUnsupported,
    MissingSourceDelimiter,
    InvalidQuotation,
    UnterminatedComment,
    SqlplusCommandUnsupported,
    ParserRejectedInput,
    StatementLimit,
    UnmappedSourceBytes,
}

/// Preserve useful lexical diagnostics before the authoritative grammar runs.
/// This scan never constructs statements or grants acceptance.
fn check_quoting(raw: &[u8]) -> Result<(), ParseError> {
    let mut i = 0;
    while i < raw.len() {
        if raw[i..].starts_with(b"--") {
            i += 2;
            while i < raw.len() && raw[i] != b'\n' {
                i += 1;
            }
        } else if raw[i..].starts_with(b"/*") {
            i += 2;
            while i + 1 < raw.len() && &raw[i..i + 2] != b"*/" {
                i += 1;
            }
            if i + 1 >= raw.len() {
                return Err(ParseError::UnterminatedComment);
            }
            i += 2;
        } else if (raw[i] == b'q' || raw[i] == b'Q') && raw.get(i + 1) == Some(&b'\'') {
            let open = *raw.get(i + 2).ok_or(ParseError::InvalidQuotation)?;
            if open.is_ascii_whitespace() || open == b'\'' || !open.is_ascii() {
                return Err(ParseError::InvalidQuotation);
            }
            let close = match open {
                b'[' => b']',
                b'(' => b')',
                b'{' => b'}',
                b'<' => b'>',
                c => c,
            };
            i += 3;
            while i + 1 < raw.len() && !(raw[i] == close && raw[i + 1] == b'\'') {
                i += 1;
            }
            if i + 1 >= raw.len() {
                return Err(ParseError::InvalidQuotation);
            }
            i += 2;
        } else if raw[i] == b'\'' || raw[i] == b'"' {
            let quote = raw[i];
            i += 1;
            loop {
                if i >= raw.len() {
                    return Err(ParseError::InvalidQuotation);
                }
                if raw[i] == quote {
                    i += 1;
                    if raw.get(i) == Some(&quote) {
                        i += 1;
                    } else {
                        break;
                    }
                } else {
                    i += 1;
                }
            }
        } else {
            i += 1;
        }
    }
    Ok(())
}

/// Parse the complete Oracle script with the pinned native grammar, rejecting
/// recovery and preserving exact source/execution bytes, including PL/SQL.
/// Historical profiles and approvals never acquire this profile implicitly.
pub fn parse(raw: &[u8]) -> Result<Parsed, ParseError> {
    if raw.len() > MAX_INPUT_BYTES {
        return Err(ParseError::InputTooLarge);
    }
    if raw.starts_with(&[0xef, 0xbb, 0xbf]) {
        return Err(ParseError::Utf8BomUnsupported);
    }
    let source = std::str::from_utf8(raw).map_err(|_| ParseError::InvalidUtf8)?;
    check_quoting(raw)?;
    let ranges = kelryvo_oracle_grammar::parse(source).map_err(|error| match error {
        Rejected::Syntax => ParseError::ParserRejectedInput,
        Rejected::Delimiter => ParseError::MissingSourceDelimiter,
        Rejected::Sqlplus => ParseError::SqlplusCommandUnsupported,
        Rejected::Unmapped => ParseError::UnmappedSourceBytes,
        Rejected::Limit => ParseError::StatementLimit,
    })?;
    if ranges.len() > MAX_PLAN_STATEMENTS {
        return Err(ParseError::StatementLimit);
    }
    let statements = ranges
        .into_iter()
        .map(|range| {
            let sql = &source[range.start..range.execution_end];
            Statement {
                start_byte: range.start,
                end_byte: range.end,
                source_sha256: sha256(&raw[range.start..range.end]),
                execution_sha256: sha256(sql),
                execution_sql: sql.to_owned(),
            }
        })
        .collect::<Vec<_>>();
    Ok(Parsed {
        ok: true,
        kind: "PARSE",
        profile: PROFILE,
        statement_count: statements.len(),
        statements,
        raw_sha256: sha256(raw),
        execution_approved: false,
        production_approved: false,
    })
}
