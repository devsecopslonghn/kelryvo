use kelryvo_core::sha256;
use kelryvo_parser::{PROFILE, ParseError, parse};

#[test]
fn prediction_context_depth_rejects_without_exhausting_the_test_thread_stack() {
    // Adaptive lookahead reaches thousands of prediction-context parents before
    // generated rule entry can enforce the unchanged 256-rule nesting limit.
    let sql = format!("SELECT {}1{} FROM dual;", "(".repeat(300), ")".repeat(300));
    assert_eq!(
        parse(sql.as_bytes()).unwrap_err(),
        ParseError::ParserRejectedInput
    );

    // Retain exact bytes and identities for accepted nested expressions.
    let sql = "-- nested 😀\r\nSELECT ((((1)))) FROM dual;\r\n";
    let parsed = parse(sql.as_bytes()).unwrap();
    assert_eq!(parsed.raw_sha256, sha256(sql));
    assert_eq!(parsed.statement_count, 1);
    assert_eq!(parsed.profile, PROFILE);
    let statement = &parsed.statements[0];
    assert_eq!(statement.start_byte, 0);
    assert_eq!(statement.end_byte, sql.len() - 2);
    assert_eq!(statement.execution_sql, &sql[..sql.len() - 3]);
    assert_eq!(statement.source_sha256, sha256(&sql[..sql.len() - 2]));
    assert_eq!(statement.execution_sha256, sha256(&sql[..sql.len() - 3]));
    assert!(!parsed.execution_approved && !parsed.production_approved);
}

#[test]
fn preserves_utf8_crlf_comments_literals_and_exact_source_ranges() {
    let raw = "-- Unicode 😀\r\nCREATE TABLE \"Ứng dụng\" (id NUMBER, label VARCHAR2(40) DEFAULT 'a;''b');\r\nCREATE INDEX ix ON \"Ứng dụng\"(id);\r\n".as_bytes();
    let parsed = parse(raw).expect("native SQL");
    assert_eq!(parsed.profile, PROFILE);
    assert_eq!(parsed.statement_count, 2);
    let mut previous_end = 0;
    for statement in parsed.statements {
        let source = &raw[statement.start_byte..statement.end_byte];
        assert!(
            raw[previous_end..statement.start_byte]
                .iter()
                .all(u8::is_ascii_whitespace)
        );
        assert_eq!(source.last(), Some(&b';'));
        assert_eq!(
            &source[..source.len() - 1],
            statement.execution_sql.as_bytes()
        );
        assert_eq!(statement.source_sha256, sha256(source));
        assert_eq!(statement.execution_sha256, sha256(statement.execution_sql));
        previous_end = statement.end_byte;
    }
    assert!(!parsed.execution_approved);
    assert!(!parsed.production_approved);
}

#[test]
fn rejects_late_malformed_sql_without_returning_a_partial_release() {
    assert!(parse(b"CREATE TABLE valid (id NUMBER);\nCREATE TABLE broken (;").is_err());
    assert_eq!(
        parse(b"CREATE TABLE item (id NUMBER)").unwrap_err(),
        ParseError::MissingSourceDelimiter
    );
    assert_eq!(
        parse(b"SET DEFINE OFF\nCREATE TABLE item(id NUMBER);").unwrap_err(),
        ParseError::SqlplusCommandUnsupported
    );
    assert_eq!(
        parse(b"CREATE TABLE item(id VARCHAR2(8) DEFAULT 'missing);").unwrap_err(),
        ParseError::InvalidQuotation
    );
    assert_eq!(
        parse(b"/* missing").unwrap_err(),
        ParseError::UnterminatedComment
    );
}

#[test]
fn rejects_noncanonical_encodings_and_unmapped_comments() {
    assert_eq!(parse(&[0xff]).unwrap_err(), ParseError::InvalidUtf8);
    assert_eq!(
        parse(b"\xef\xbb\xbfSELECT 1 FROM dual;").unwrap_err(),
        ParseError::Utf8BomUnsupported
    );
    assert_eq!(
        parse(b"CREATE TABLE item(id NUMBER); -- unmapped").unwrap_err(),
        ParseError::UnmappedSourceBytes
    );
    assert_eq!(
        parse(&vec![b' '; 2 * 1024 * 1024 + 1]).unwrap_err(),
        ParseError::InputTooLarge
    );
}

#[test]
fn oracle_alternative_quoting_cannot_introduce_statement_boundaries() {
    for quote in ["q'[a;b]'", "q'{a;b}'", "q'<a;b>'", "q'(a;b)'", "q'!a;b!'"] {
        let sql = format!("INSERT INTO item(label) VALUES({quote});");
        let parsed = parse(sql.as_bytes()).expect("Oracle alternative quoting");
        assert_eq!(parsed.statement_count, 1);
        assert_eq!(parsed.statements[0].execution_sql, sql[..sql.len() - 1]);
    }
}
