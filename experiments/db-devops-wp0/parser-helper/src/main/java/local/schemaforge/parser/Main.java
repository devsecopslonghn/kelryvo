package local.schemaforge.parser;

import org.flywaydb.core.api.configuration.ClassicConfiguration;
import org.flywaydb.core.api.resource.LoadableResource;
import org.flywaydb.core.internal.parser.ParsingContext;
import org.flywaydb.core.internal.sqlscript.ParsedSqlStatement;
import org.flywaydb.core.internal.sqlscript.SqlStatement;
import org.flywaydb.core.internal.sqlscript.SqlStatementIterator;
import org.flywaydb.database.oracle.OracleParser;

import java.io.Reader;
import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;

/** Offline feasibility CLI for the pinned Flyway 13.9 Oracle parser internals. */
public final class Main {
    private static final int MAX_INPUT_BYTES = 2 * 1024 * 1024;

    private Main() { }

    public static void main(String[] args) throws Exception {
        byte[] raw;
        try {
            raw = System.in.readNBytes(MAX_INPUT_BYTES + 1);
        } catch (Exception inputFailure) {
            writeStop(new byte[0], "input_read_failed", 0, false);
            return;
        }
        if (raw.length > MAX_INPUT_BYTES) {
            writeStop(raw, "input_too_large", 0, false);
            return;
        }
        if (raw.length >= 3 && (raw[0] & 0xff) == 0xef && (raw[1] & 0xff) == 0xbb && (raw[2] & 0xff) == 0xbf) {
            writeStop(raw, "utf8_bom_unsupported", 0, true);
            return;
        }
        String source;
        try {
            source = StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(raw)).toString();
        } catch (Exception invalidEncoding) {
            writeStop(raw, "invalid_utf8", 0, true);
            return;
        }

        ClassicConfiguration config = new ClassicConfiguration();
        config.setPlaceholderReplacement(false);
        ParsingContext parsingContext = new ParsingContext();
        OracleParser parser = new OracleParser(config, parsingContext);
        LoadableResource resource = new LoadableResource() {
            @Override public Reader read() { return new java.io.StringReader(source); }
            @Override public String getAbsolutePath() { return "stdin/V1__input.sql"; }
            @Override public String getAbsolutePathOnDisk() { return null; }
            @Override public String getFilename() { return "V1__input.sql"; }
            @Override public String getRelativePath() { return "V1__input.sql"; }
        };

        List<SqlStatement> statements = new ArrayList<>();
        try (SqlStatementIterator iterator = parser.parse(resource)) {
            while (iterator.hasNext()) statements.add(iterator.next());
        } catch (RuntimeException parserFailure) {
            // Parser exception text can embed source SQL. Keep the CLI's failure channel generic.
            writeStop(raw, "parser_rejected_input", 0, true);
            return;
        }
        List<StatementRange> ranges = new ArrayList<>();
        for (int i = 0; i < statements.size(); i++) {
            SqlStatement statement = statements.get(i);
            ParsedSqlStatement parsed = (ParsedSqlStatement) statement;
            String sourceExecution = statement.getSql() + statement.getDelimiter();
            int charStart = parsed.getPos();
            int charEnd = charStart + sourceExecution.length();
            if (charStart < 0 || charEnd > source.length()
                || !source.regionMatches(charStart, sourceExecution, 0, sourceExecution.length())) {
                writeStop(raw, "parser_output_not_contiguous_source_bytes", statement.getLineNumber(), true);
                return;
            }
            int startByte = utf8Offset(source, charStart);
            int endByte = utf8Offset(source, charEnd);
            byte[] executionBytes = statement.getSql().getBytes(StandardCharsets.UTF_8);
            ranges.add(new StatementRange(startByte, endByte, statement.getSql(), sha256(executionBytes), "source_delimiter_in_range"));
        }

        StringBuilder json = new StringBuilder();
        json.append("{\"schema_version\":1,\"scope\":\"OFFLINE_CANDIDATE_ONLY\",\"production_approved\":false,\"execution_approved\":false,\"raw_sha256\":\"").append(sha256(raw)).append("\",\"parser_profile\":\"flyway-oracle-13.9.0@a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c\",\"statements\":[");
        for (int i = 0; i < ranges.size(); i++) {
            if (i != 0) json.append(',');
            StatementRange range = ranges.get(i);
            json.append("{\"start_byte\":").append(range.startByte())
                .append(",\"end_byte\":").append(range.endByte())
                .append(",\"execution_sql\":\"").append(escape(range.executionSql()))
                .append("\",\"execution_sha256\":\"").append(range.executionSha256())
                .append("\",\"delimiter_disposition\":\"").append(range.delimiterDisposition()).append("\"}");
        }
        json.append("]}");
        System.out.write((json + "\n").getBytes(StandardCharsets.UTF_8));
    }

    private static void writeStop(byte[] raw, String code, int line, boolean completeInput) throws Exception {
        String rawHash = completeInput ? "\"" + sha256(raw) + "\"" : "null";
        String json = "{\"schema_version\":1,\"scope\":\"OFFLINE_CANDIDATE_ONLY\",\"production_approved\":false,\"execution_approved\":false,\"raw_sha256\":" + rawHash + ",\"parser_profile\":\"flyway-oracle-13.9.0@a549f5dd1ac80fbe7bc8103dfcd2d556c606c39c\",\"stop\":{\"code\":\"" + code + "\",\"line\":" + line + "}}\n";
        System.out.write(json.getBytes(StandardCharsets.UTF_8));
        System.exit(2);
    }

    private static int utf8Offset(String value, int charOffset) {
        return value.substring(0, charOffset).getBytes(StandardCharsets.UTF_8).length;
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    private static String escape(String value) {
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < value.length(); i++) {
            char c = value.charAt(i);
            switch (c) {
                case '"' -> out.append("\\\"");
                case '\\' -> out.append("\\\\");
                case '\n' -> out.append("\\n");
                case '\r' -> out.append("\\r");
                case '\t' -> out.append("\\t");
                default -> { if (c < 0x20) out.append(String.format("\\u%04x", (int) c)); else out.append(c); }
            }
        }
        return out.toString();
    }

    private record StatementRange(int startByte, int endByte, String executionSql, String executionSha256,
                                  String delimiterDisposition) { }
}
