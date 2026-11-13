//! Project-authored callbacks equivalent to the retained Java base contracts.
use crate::generated::{
    pl_sql_lexer::PlSqlLexerHooks,
    pl_sql_parser::{self as p, PlSqlParserHooks},
};
use antlr4_runtime::{CharStream, LexerSemCtx, ParserSemCtx, Token, token::TokenSource};
pub struct Hooks<'a> {
    source: &'a str,
    last_sql: bool,
}
impl<'a> Hooks<'a> {
    pub fn new(source: &'a str) -> Self {
        Self {
            source,
            last_sql: true,
        }
    }
}
impl PlSqlLexerHooks for Hooks<'_> {
    fn is_newline_at_pos<I: CharStream>(
        &mut self,
        ctx: &mut LexerSemCtx<'_, I>,
        offset: i64,
    ) -> bool {
        isize::try_from(offset)
            .ok()
            .is_some_and(|offset| matches!(ctx.la(offset), -1 | 10 | 13))
    }
}
impl Hooks<'_> {
    fn slash<L: TokenSource>(&self, ctx: &mut ParserSemCtx<'_, L>) -> bool {
        let Some(token) = ctx.lt(1) else {
            return false;
        };
        if token.token_type() != p::SOLIDUS {
            return false;
        }
        let Some(start) = token.start_byte() else {
            return false;
        };
        let raw = self.source.as_bytes();
        let Some(before) = raw.get(..start) else {
            return false;
        };
        let Some(after) = raw.get(start + 1..) else {
            return false;
        };
        before
            .iter()
            .rev()
            .take_while(|b| !b"\r\n".contains(b))
            .all(|b| b" \t".contains(b))
            && after
                .iter()
                .take_while(|b| !b"\r\n".contains(b))
                .all(|b| b" \t".contains(b))
    }
}
impl PlSqlParserHooks for Hooks<'_> {
    fn is_last_sql_solidus<L: TokenSource>(&mut self, ctx: &mut ParserSemCtx<'_, L>) -> bool {
        self.last_sql && self.slash(ctx)
    }
    fn is_solidus_separator<L: TokenSource>(&mut self, ctx: &mut ParserSemCtx<'_, L>) -> bool {
        self.slash(ctx)
    }
    fn is_version_10<L: TokenSource>(&mut self, _: &mut ParserSemCtx<'_, L>) -> bool {
        true
    }
    fn is_version_11<L: TokenSource>(&mut self, _: &mut ParserSemCtx<'_, L>) -> bool {
        true
    }
    fn is_version_12<L: TokenSource>(&mut self, _: &mut ParserSemCtx<'_, L>) -> bool {
        true
    }
    fn is_not_numeric_function<L: TokenSource>(&mut self, ctx: &mut ParserSemCtx<'_, L>) -> bool {
        ctx.la(2) != p::LEFT_PAREN
            || ![
                p::SUM,
                p::COUNT,
                p::ROUND,
                p::AVG,
                p::MAX,
                p::MIN,
                p::LEAST,
                p::GREATEST,
            ]
            .contains(&ctx.la(1))
    }
    fn is_not_start_of_join<L: TokenSource>(&mut self, ctx: &mut ParserSemCtx<'_, L>) -> bool {
        ![
            p::INNER,
            p::CROSS,
            p::NATURAL,
            p::PARTITION,
            p::FULL,
            p::LEFT,
            p::RIGHT,
            p::OUTER,
        ]
        .contains(&ctx.la(1))
    }
    fn set_last_unit_plsql<L: TokenSource>(&mut self, _: &mut ParserSemCtx<'_, L>) {
        self.last_sql = false;
    }
    fn set_last_unit_sql<L: TokenSource>(&mut self, _: &mut ParserSemCtx<'_, L>) {
        self.last_sql = true;
    }
}
