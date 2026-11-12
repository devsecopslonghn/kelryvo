//! Closed Oracle execution grammar retained by the native migration contract.
//! This is not a release splitter, a general Oracle parser, or an approval.
use crate::{js_len, js_whitespace as whitespace};
use serde_json::{Value, json};
use std::collections::HashSet;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Word,
    Id,
    String,
    Number,
    Punct,
}

#[derive(Clone)]
struct Token {
    kind: Kind,
    value: String,
}

pub fn is_application_owner(owner: &str) -> bool {
    const PROTECTED: &[&str] = &[
        "ANONYMOUS",
        "APEX_PUBLIC_USER",
        "AUDSYS",
        "CTXSYS",
        "DBSFWUSER",
        "DBSNMP",
        "DIP",
        "DVSYS",
        "EXFSYS",
        "FLOWS_FILES",
        "GGSYS",
        "GSMADMIN_INTERNAL",
        "LBACSYS",
        "MDDATA",
        "MDSYS",
        "OJVMSYS",
        "OLAPSYS",
        "ORACLE_OCM",
        "ORDDATA",
        "ORDPLUGINS",
        "ORDSYS",
        "OUTLN",
        "PDBADMIN",
        "REMOTE_SCHEDULER_AGENT",
        "SI_INFORMTN_SCHEMA",
        "SPATIAL_CSW_ADMIN_USR",
        "SPATIAL_WFS_ADMIN_USR",
        "SYS",
        "SYSTEM",
        "SYS$UMF",
        "WMSYS",
        "XDB",
        "XS$NULL",
    ];
    let upper = owner.to_uppercase();
    !owner.is_empty()
        && owner.len() <= 128
        && !owner.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
        && !PROTECTED.contains(&upper.as_str())
        && !["C##", "SYS", "ORA$", "APEX_", "ORDS_"]
            .iter()
            .any(|p| upper.starts_with(p))
}

fn lex(sql: &str) -> Option<Vec<Token>> {
    if sql.is_empty() || js_len(sql) > 200_000 {
        return None;
    }
    let chars: Vec<char> = sql.chars().collect();
    let mut i = 0;
    let mut out = Vec::new();
    while i < chars.len() {
        let c = chars[i];
        if whitespace(c) {
            i += 1;
            continue;
        }
        if c == '-' && chars.get(i + 1) == Some(&'-') {
            i += 2;
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && chars.get(i + 1) == Some(&'*') {
            i += 2;
            while i + 1 < chars.len() && !(chars[i] == '*' && chars[i + 1] == '/') {
                i += 1;
            }
            if i + 1 >= chars.len() {
                return None;
            }
            i += 2;
            continue;
        }
        let token = if c == '"' || c == '\'' {
            let mut value = String::new();
            let mut closed = false;
            i += 1;
            while i < chars.len() {
                if chars[i] == c && chars.get(i + 1) == Some(&c) {
                    value.push(c);
                    i += 2;
                } else if chars[i] == c {
                    i += 1;
                    closed = true;
                    break;
                } else {
                    value.push(chars[i]);
                    i += 1;
                }
            }
            if !closed || c == '"' && value.is_empty() {
                return None;
            }
            Token {
                kind: if c == '"' { Kind::Id } else { Kind::String },
                value,
            }
        } else if c.is_ascii_alphabetic() || c == '_' {
            let start = i;
            i += 1;
            while i < chars.len() && (chars[i].is_ascii_alphanumeric() || "_$#".contains(chars[i]))
            {
                i += 1;
            }
            Token {
                kind: Kind::Word,
                value: chars[start..i]
                    .iter()
                    .collect::<String>()
                    .to_ascii_uppercase(),
            }
        } else if c.is_ascii_digit() {
            let start = i;
            while i < chars.len() && chars[i].is_ascii_digit() {
                i += 1;
            }
            if chars.get(i) == Some(&'.') {
                i += 1;
                let fraction = i;
                while i < chars.len() && chars[i].is_ascii_digit() {
                    i += 1;
                }
                if i == fraction {
                    return None;
                }
            }
            Token {
                kind: Kind::Number,
                value: chars[start..i].iter().collect(),
            }
        } else if "(),.;+-".contains(c) {
            i += 1;
            Token {
                kind: Kind::Punct,
                value: c.to_string(),
            }
        } else {
            return None;
        };
        out.push(token);
        if out.len() > 20_000 {
            return None;
        }
    }
    Some(out)
}

struct Parser<'a> {
    tokens: &'a [Token],
    i: usize,
    owner: &'a str,
    columns: Vec<Value>,
    index_columns: Vec<String>,
    unique: bool,
}

impl Parser<'_> {
    fn peek(&self, word: &str) -> bool {
        self.tokens.get(self.i).is_some_and(|t| {
            t.value == word
                && t.kind
                    == if word.len() == 1 && "(),.;+-".contains(word) {
                        Kind::Punct
                    } else {
                        Kind::Word
                    }
        })
    }
    fn take(&mut self, word: &str) -> bool {
        if self.peek(word) {
            self.i += 1;
            true
        } else {
            false
        }
    }
    fn id(&mut self) -> Option<String> {
        let t = self.tokens.get(self.i)?;
        if t.kind != Kind::Word && t.kind != Kind::Id {
            return None;
        }
        self.i += 1;
        Some(t.value.clone())
    }
    fn name(&mut self) -> Option<String> {
        let first = self.id()?;
        if !self.take(".") {
            return Some(first);
        }
        let second = self.id()?;
        (first == self.owner).then_some(second)
    }
    fn integer(&mut self) -> bool {
        if self
            .tokens
            .get(self.i)
            .is_some_and(|t| t.kind == Kind::Number && !t.value.contains('.'))
        {
            self.i += 1;
            true
        } else {
            false
        }
    }
    fn datatype(&mut self) -> bool {
        if self.take("NUMBER") {
            if self.take("(") {
                if !self.integer() {
                    return false;
                }
                if self.take(",") && !self.integer() {
                    return false;
                }
                if !self.take(")") {
                    return false;
                }
            }
            return true;
        }
        if self.take("VARCHAR2") || self.take("CHAR") {
            if !self.take("(") || !self.integer() {
                return false;
            }
            let _ = self.take("CHAR") || self.take("BYTE");
            return self.take(")");
        }
        if self.take("DATE") {
            return true;
        }
        if self.take("TIMESTAMP") {
            return !self.take("(") || self.integer() && self.take(")");
        }
        false
    }
    fn literal(&mut self) -> bool {
        if self.tokens.get(self.i).is_some_and(|t| {
            t.kind == Kind::Number
                || t.kind == Kind::String
                || t.kind == Kind::Word && t.value == "NULL"
        }) {
            self.i += 1;
            return true;
        }
        if self.take("-")
            && self
                .tokens
                .get(self.i)
                .is_some_and(|t| t.kind == Kind::Number)
        {
            self.i += 1;
            return true;
        }
        false
    }
    fn column(&mut self) -> Option<String> {
        let name = self.id()?;
        let start = self.i;
        if !self.datatype() {
            return None;
        }
        let types: Vec<&str> = self.tokens[start..self.i]
            .iter()
            .map(|t| t.value.as_str())
            .collect();
        let defaults = if self.take("DEFAULT") {
            let start = self.i;
            if !self.literal() {
                return None;
            }
            Value::Array(self.tokens[start..self.i].iter().map(|t| json!({"type":match t.kind { Kind::Number => "number", Kind::String => "string", Kind::Word => "word", Kind::Punct => "punct", Kind::Id => "id" },"value":t.value})).collect())
        } else {
            Value::Null
        };
        let nullable = !self.take("NOT");
        if !nullable && !self.take("NULL") {
            return None;
        }
        self.columns.push(
            json!({"name":name,"typeTokens":types,"defaultTokens":defaults,"nullable":nullable}),
        );
        Some(name)
    }
    fn columns(&mut self) -> Option<()> {
        if !self.take("(") {
            return None;
        }
        let mut seen = HashSet::new();
        seen.insert(self.column()?);
        while self.take(",") {
            if !seen.insert(self.column()?) {
                return None;
            }
        }
        self.take(")").then_some(())
    }
    fn statement(&mut self) -> Option<(&'static str, &'static str, String, Option<String>)> {
        if self.take("CREATE") {
            self.unique = self.take("UNIQUE");
            if self.take("TABLE") {
                if self.unique {
                    return None;
                }
                let table = self.name()?;
                self.columns()?;
                return Some(("TABLE", "CREATE", table, None));
            }
            if !self.take("INDEX") {
                return None;
            }
            let index = self.name()?;
            if !self.take("ON") {
                return None;
            }
            let table = self.name()?;
            if !self.take("(") {
                return None;
            }
            let first = self.id()?;
            self.index_columns.push(first);
            while self.take(",") {
                let next = self.id()?;
                self.index_columns.push(next);
            }
            if !self.take(")") {
                return None;
            }
            return Some(("INDEX", "CREATE", index, Some(table)));
        }
        if self.take("ALTER") && self.take("TABLE") {
            let table = self.name()?;
            if !self.take("ADD") {
                return None;
            }
            if self.peek("(") {
                self.columns()?;
            } else {
                self.column()?;
            }
            return Some(("TABLE", "ALTER", table.clone(), Some(table)));
        }
        None
    }
}

fn reject(code: &str) -> Value {
    json!({"eligible":false,"code":code})
}

pub fn assess(sql: &str, owner: &str, describe: bool) -> Value {
    if !is_application_owner(owner) {
        return reject("SCHEMA_OWNER_INVALID");
    }
    let Some(mut tokens) = lex(sql) else {
        return reject("SCHEMA_SQL_UNSUPPORTED");
    };
    if tokens
        .last()
        .is_some_and(|t| t.kind == Kind::Punct && t.value == ";")
    {
        tokens.pop();
    }
    if tokens.is_empty()
        || tokens
            .iter()
            .any(|t| t.kind == Kind::Punct && t.value == ";")
    {
        return reject("MULTIPLE_OR_TERMINATED_STATEMENTS");
    }
    let mut parser = Parser {
        tokens: &tokens,
        i: 0,
        owner,
        columns: Vec::new(),
        index_columns: Vec::new(),
        unique: false,
    };
    let Some((object_type, operation, name, existing)) = parser.statement() else {
        return reject("SCHEMA_SQL_UNSUPPORTED");
    };
    if parser.i != tokens.len() {
        return reject("SCHEMA_SQL_UNSUPPORTED");
    }
    let mut result = json!({"eligible":true,"code":"SCHEMA_SQL_ALLOWED","target":{"owner":owner,"name":name,"objectType":object_type,"operation":operation},"existingTable":existing.map(|n| json!({"owner":owner,"name":n}))});
    if describe {
        result["description"] = json!({"columns":parser.columns,"indexColumns":parser.index_columns,"unique":parser.unique});
    }
    result
}
