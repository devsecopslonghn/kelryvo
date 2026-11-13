//! Same-source Oracle grammar implemented by native Rust recognizers. Recovery,
//! unsupported semantics and unmatched bytes are rejection, never approval.
mod generated {
    pub mod pl_sql_lexer;
    pub mod pl_sql_parser;
}
mod hooks;
use antlr4_runtime::{CommonTokenStream, InputStream, Parser, Token};
use generated::{pl_sql_lexer as lexer, pl_sql_parser as parser};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rejected {
    Syntax,
    Delimiter,
    Sqlplus,
    Unmapped,
    Limit,
}
#[derive(Debug, Clone, Copy)]
pub struct Range {
    pub start: usize,
    pub execution_end: usize,
    pub end: usize,
}
fn whitespace(raw: &[u8]) -> bool {
    raw.iter()
        .all(|b| *b == b' ' || (b'\t'..=b'\r').contains(b))
}

pub fn parse(source: &str) -> Result<Vec<Range>, Rejected> {
    if source.len() > 2 * 1024 * 1024 {
        return Err(Rejected::Limit);
    }
    let mut lexer = lexer::PlSqlLexer::with_hooks(
        InputStream::new(source),
        lexer::PlSqlLexerTypedHooks(hooks::Hooks::new(source)),
    );
    lexer.remove_error_listeners();
    let tokens = CommonTokenStream::try_new(lexer).map_err(|_| Rejected::Syntax)?;
    if tokens.number_of_source_errors() != 0 {
        return Err(Rejected::Syntax);
    }
    if tokens
        .token_store()
        .iter()
        .any(|t| t.token_type() == lexer::REMARK_COMMENT)
    {
        return Err(Rejected::Sqlplus);
    }
    let mut parser = parser::PlSqlParser::with_hooks(
        tokens,
        parser::PlSqlParserTypedHooks(hooks::Hooks::new(source)),
    );
    parser.remove_error_listeners();
    parser.set_max_rule_depth(Some(256));
    let tree = parser.sql_script().map_err(|_| Rejected::Syntax)?;
    if parser.number_of_syntax_errors() != 0 || parser.token_stream().number_of_source_errors() != 0
    {
        return Err(Rejected::Syntax);
    }
    let root = parser.node(tree).as_rule().ok_or(Rejected::Syntax)?;
    if root
        .child_rules(parser::RULE_SQL_PLUS_COMMAND)
        .next()
        .is_some()
    {
        return Err(Rejected::Sqlplus);
    }
    let units = root
        .child_rules(parser::RULE_SCRIPT_UNIT)
        .collect::<Vec<_>>();
    let terms = root
        .child_rules(parser::RULE_TERMINATOR)
        .collect::<Vec<_>>();
    if units.len() != terms.len() {
        return Err(Rejected::Delimiter);
    }
    if units.len() > 4096 {
        return Err(Rejected::Limit);
    }
    let mut previous = 0;
    let raw = source.as_bytes();
    let mut ranges = Vec::new();
    let mut prefix_tokens = parser.token_stream().token_store().iter().peekable();
    for (unit, term) in units.into_iter().zip(terms) {
        if unit.child_rule(parser::RULE_SQL_PLUS_COMMAND).is_some() {
            return Err(Rejected::Sqlplus);
        }
        let begin = unit.start().ok_or(Rejected::Syntax)?;
        let begin_byte = begin.start_byte().ok_or(Rejected::Syntax)?;
        let mut start = begin_byte;
        while prefix_tokens
            .peek()
            .is_some_and(|t| t.start_byte().is_some_and(|b| b < begin_byte))
        {
            let token = prefix_tokens.next().ok_or(Rejected::Syntax)?;
            if token.channel() == antlr4_runtime::HIDDEN_CHANNEL
                && [lexer::SINGLE_LINE_COMMENT, lexer::MULTI_LINE_COMMENT]
                    .contains(&token.token_type())
                && token
                    .start_byte()
                    .is_some_and(|b| b >= previous && b < start)
            {
                start = token.start_byte().ok_or(Rejected::Syntax)?;
            }
        }
        if !whitespace(raw.get(previous..start).ok_or(Rejected::Unmapped)?) {
            return Err(Rejected::Unmapped);
        }
        let semi = term.child_token(parser::SEMICOLON).map(|t| t.symbol());
        let slash = term.child_token(parser::SOLIDUS).map(|t| t.symbol());
        // A PL/SQL unit's final semicolon belongs to its executable body. A
        // SQL unit's semicolon belongs only to the script separator, even when
        // followed by a slash. Never infer the unit kind from delimiter shape.
        let plsql = unit.child_rule(parser::RULE_PLSQL_UNIT).is_some();
        let semicolon_end = semi
            .map(|semi| {
                if plsql {
                    semi.stop_byte().ok_or(Rejected::Syntax)
                } else {
                    semi.start_byte().ok_or(Rejected::Syntax)
                }
            })
            .transpose()?;
        let (execution_end, end) = if let Some(slash) = slash {
            let slash_start = slash.start_byte().ok_or(Rejected::Syntax)?;
            let end = slash.stop_byte().ok_or(Rejected::Syntax)?;
            let separator_start = if let Some(semi) = semi {
                semi.stop_byte().ok_or(Rejected::Syntax)?
            } else if raw.get(slash_start.saturating_sub(2)..slash_start) == Some(b"\r\n") {
                slash_start - 2
            } else if raw.get(slash_start.saturating_sub(1)..slash_start) == Some(b"\n") {
                slash_start - 1
            } else {
                return Err(Rejected::Delimiter);
            };
            if ![b"\n/".as_slice(), b"\r\n/".as_slice()]
                .contains(&raw.get(separator_start..end).ok_or(Rejected::Delimiter)?)
            {
                return Err(Rejected::Delimiter);
            }
            let execution_end = semicolon_end.unwrap_or(separator_start);
            (execution_end, end)
        } else if let Some(semi) = semi {
            (
                semicolon_end.ok_or(Rejected::Syntax)?,
                semi.stop_byte().ok_or(Rejected::Syntax)?,
            )
        } else {
            return Err(Rejected::Delimiter);
        };
        if start >= execution_end
            || !source.is_char_boundary(start)
            || !source.is_char_boundary(execution_end)
            || !source.is_char_boundary(end)
        {
            return Err(Rejected::Syntax);
        }
        ranges.push(Range {
            start,
            execution_end,
            end,
        });
        previous = end;
    }
    if !whitespace(raw.get(previous..).ok_or(Rejected::Unmapped)?) {
        return Err(Rejected::Unmapped);
    }
    Ok(ranges)
}
