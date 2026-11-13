//! Authored cases beyond the frozen migration corpus. These exercise the native
//! profile, not Oracle execution or equivalence with a historical parser.
use kelryvo_core::sha256;
use kelryvo_parser::{PROFILE, parse};

fn exact(sql: &str, execution: &str) {
    let parsed = parse(sql.as_bytes()).unwrap_or_else(|error| panic!("{sql:?}: {error:?}"));
    assert_eq!(parsed.profile, PROFILE);
    assert_eq!(parsed.raw_sha256, sha256(sql));
    assert!(!parsed.execution_approved && !parsed.production_approved);
    assert_eq!(parsed.statement_count, 1, "{sql}");
    let statement = &parsed.statements[0];
    assert_eq!(statement.start_byte, 0, "{sql}");
    assert_eq!(statement.end_byte, sql.len(), "{sql}");
    assert_eq!(statement.execution_sql, execution, "{sql}");
    assert_eq!(statement.source_sha256, sha256(sql));
    assert_eq!(statement.execution_sha256, sha256(execution));
}

#[test]
fn ddl_and_dml_preserve_the_complete_execution_unit() {
    for sql in [
        "CREATE TABLE items (id NUMBER PRIMARY KEY, name VARCHAR2(100) NOT NULL);",
        "ALTER TABLE items ADD (created_at TIMESTAMP DEFAULT SYSTIMESTAMP);",
        "ALTER TABLE items ADD CONSTRAINT uq_items UNIQUE (name);",
        "CREATE UNIQUE INDEX ix_items ON items (LOWER(name));",
        "CREATE SEQUENCE item_seq START WITH 1 INCREMENT BY 1 NOCACHE;",
        "CREATE OR REPLACE VIEW active_items AS SELECT id, name FROM items WHERE id > 0;",
        "CREATE SYNONYM item_alias FOR items;",
        "COMMENT ON COLUMN items.name IS 'Name; with ''quotes''';",
        "GRANT SELECT, INSERT ON items TO app_user;",
        "REVOKE INSERT ON items FROM app_user;",
        "TRUNCATE TABLE items;",
        "DROP TABLE items PURGE;",
        "INSERT INTO items (id, name) VALUES (1, N'Ứng dụng 😀');",
        "INSERT INTO items (id, name) SELECT id, name FROM archive_items;",
        "UPDATE items SET name = 'new' WHERE id = 1;",
        "DELETE FROM items WHERE id = 1;",
        "MERGE INTO items t USING archive_items s ON (t.id = s.id) WHEN MATCHED THEN UPDATE SET t.name = s.name WHEN NOT MATCHED THEN INSERT (id, name) VALUES (s.id, s.name);",
        "COMMIT;",
        "ROLLBACK;",
        "SAVEPOINT before_items;",
    ] {
        exact(sql, sql.strip_suffix(';').unwrap());
    }
}

#[test]
fn predicates_distinguish_numeric_functions_aliases_and_join_prefixes() {
    for sql in [
        "SELECT SUM(id), COUNT(*), ROUND(AVG(id)), MAX(id), MIN(id) FROM items;",
        "SELECT LEAST(id, 10), GREATEST(id, 0) FROM items;",
        "SELECT sum, count, round, avg, max, min FROM items;",
        "SELECT t.id FROM items t INNER JOIN archive_items a ON a.id = t.id;",
        "SELECT t.id FROM items t LEFT OUTER JOIN archive_items a ON a.id = t.id;",
        "SELECT t.id FROM items t RIGHT JOIN archive_items a ON a.id = t.id;",
        "SELECT t.id FROM items t FULL OUTER JOIN archive_items a ON a.id = t.id;",
        "SELECT t.id FROM items t CROSS JOIN archive_items a;",
        "SELECT id FROM items NATURAL JOIN archive_items;",
        "WITH selected AS (SELECT id FROM items) SELECT id FROM selected;",
        "SELECT ROW_NUMBER() OVER (PARTITION BY name ORDER BY id) FROM items;",
        "SELECT id FROM items OFFSET 5 ROWS FETCH NEXT 10 ROWS ONLY;",
        "SELECT JSON_VALUE(payload, '$.name') FROM items;",
    ] {
        exact(sql, sql.strip_suffix(';').unwrap());
    }
}

#[test]
fn plsql_keeps_its_final_semicolon_but_excludes_the_slash() {
    for unit in [
        "BEGIN NULL; END;",
        "DECLARE n NUMBER := 1; BEGIN n := n + 1; END;",
        "BEGIN BEGIN NULL; END; EXCEPTION WHEN OTHERS THEN NULL; END;",
        "CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;",
        "CREATE OR REPLACE FUNCTION f RETURN NUMBER AS BEGIN RETURN 1; END;",
        "CREATE OR REPLACE PACKAGE p AS PROCEDURE run; END p;",
        "CREATE OR REPLACE PACKAGE BODY p AS PROCEDURE run AS BEGIN NULL; END; END p;",
        "CREATE OR REPLACE TRIGGER t BEFORE INSERT ON items BEGIN NULL; END;",
        "CREATE OR REPLACE TYPE BODY item_type AS MEMBER FUNCTION f RETURN NUMBER IS BEGIN RETURN 1; END; END;",
    ] {
        for newline in ["\n", "\r\n"] {
            exact(&format!("{unit}{newline}/"), unit);
        }
    }
}

#[test]
fn plsql_without_a_slash_keeps_its_final_semicolon() {
    for unit in [
        "BEGIN NULL; END;",
        "CREATE OR REPLACE PROCEDURE p AS BEGIN NULL; END;",
        "CREATE OR REPLACE PACKAGE p AS PROCEDURE run; END p;",
    ] {
        exact(unit, unit);
    }
}

#[test]
fn sql_slash_separators_never_enter_the_execution_unit() {
    for newline in ["\n", "\r\n"] {
        for unit in ["SELECT 1 FROM dual", "CREATE TABLE item (id NUMBER)"] {
            exact(&format!("{unit};{newline}/"), unit);
            exact(&format!("{unit}{newline}/"), unit);
        }
    }
}

#[test]
fn mixed_sql_and_plsql_units_keep_their_own_terminator_policy() {
    let units = [
        ("BEGIN NULL; END;", "BEGIN NULL; END;"),
        ("SELECT 1 FROM dual;\n/", "SELECT 1 FROM dual"),
        ("BEGIN NULL; END;\n/", "BEGIN NULL; END;"),
        ("SELECT 2 FROM dual;", "SELECT 2 FROM dual"),
    ];
    let source = units.map(|(source, _)| source).join("\n");
    let parsed = parse(source.as_bytes()).expect("mixed script");
    assert_eq!(parsed.statement_count, units.len());
    let mut offset = 0;
    for (statement, (sql, execution)) in parsed.statements.iter().zip(units) {
        assert_eq!(statement.start_byte, offset);
        assert_eq!(statement.end_byte, offset + sql.len());
        assert_eq!(statement.execution_sql, execution);
        assert_eq!(statement.source_sha256, sha256(sql));
        assert_eq!(statement.execution_sha256, sha256(execution));
        offset += sql.len() + 1;
    }
}

#[test]
fn malformed_late_units_never_return_partial_success() {
    for invalid in [
        "SELECT FROM;",
        "SELECT 1 FROM dual",
        "CREATE TABLE broken (id NUMBER;",
        "INSERT INTO items VALUES ('unterminated);",
        "BEGIN NULL; END\n/",
        "BEGIN NULL; END; /",
        "BEGIN NULL; END;\n/ SELECT 1 FROM dual;",
        "SELECT 1 FROM dual;\n/* trailing */",
        "SELECT 1 FROM dual;\n@other.sql",
        "SELECT 1 FROM dual;\nPROMPT hidden command",
        "SELECT 1 FROM dual;\nSET DEFINE OFF",
        "SELECT 1 FROM dual;\n\0",
    ] {
        let source = format!("CREATE TABLE valid (id NUMBER);\n{invalid}");
        assert!(parse(source.as_bytes()).is_err(), "{invalid:?}");
    }
}

#[test]
fn comments_and_alternative_quotes_cannot_change_unit_boundaries() {
    for literal in [
        "q'[a; ''b'' -- c\n/*d*/ /]'",
        "Q'{a;\r\nb}'",
        "q'<a;b>'",
        "q'(a;b)'",
        "q'!a;b!'",
        "q'#a;b#'",
        "q'~a;b~'",
        "q'/a;b/'",
        "q'\\a;b\\'",
        "'a;''b'",
        "N'Ứng dụng; 😀'",
    ] {
        let first = format!("-- prefix 😀\r\nINSERT INTO items(name) VALUES ({literal});");
        let second = "/* next; / */ SELECT 1 FROM dual;";
        let source = format!("{first}\r\n{second}\n");
        let parsed =
            parse(source.as_bytes()).unwrap_or_else(|error| panic!("{literal}: {error:?}"));
        assert_eq!(parsed.statement_count, 2, "{literal}");
        for (statement, (start, sql)) in parsed
            .statements
            .iter()
            .zip([(0, first.as_str()), (first.len() + 2, second)])
        {
            assert_eq!(statement.start_byte, start);
            assert_eq!(statement.end_byte, start + sql.len());
            assert_eq!(statement.execution_sql, sql.strip_suffix(';').unwrap());
            assert_eq!(statement.source_sha256, sha256(sql));
            assert_eq!(statement.execution_sha256, sha256(&statement.execution_sql));
        }
    }
}
