package local.schemaforge.antlrparser;

import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import org.antlr.v4.runtime.BaseErrorListener;
import org.antlr.v4.runtime.CharStreams;
import org.antlr.v4.runtime.CommonTokenStream;
import org.antlr.v4.runtime.RecognitionException;
import org.antlr.v4.runtime.Recognizer;
import org.antlr.v4.runtime.Token;

/** Offline byte-range adapter for the pinned mature grammar. All statement boundaries come from ANTLR parser contexts. */
public final class Main {
  private static final String PROFILE =
      "antlr-plsql-grammars-v4-7df52be94698550d219d299d04105c6bafadd9c3-antlr4-4.13.2";
  private static final int MAX_INPUT = 2 * 1024 * 1024;

  private Main() {}

  public static void main(String[] args) throws Exception {
    byte[] raw = System.in.readNBytes(MAX_INPUT + 1);
    if (raw.length > MAX_INPUT) {
      stop(raw, "input_too_large", 0);
      return;
    }
    if (raw.length >= 3
        && (raw[0] & 255) == 0xef
        && (raw[1] & 255) == 0xbb
        && (raw[2] & 255) == 0xbf) {
      stop(raw, "utf8_bom_unsupported", 0);
      return;
    }
    String source;
    try {
      source =
          StandardCharsets.UTF_8
              .newDecoder()
              .onMalformedInput(CodingErrorAction.REPORT)
              .onUnmappableCharacter(CodingErrorAction.REPORT)
              .decode(ByteBuffer.wrap(raw))
              .toString();
    } catch (CharacterCodingException e) {
      stop(raw, "invalid_utf8", 0);
      return;
    }

    PlSqlLexer lexer = new PlSqlLexer(CharStreams.fromString(source));
    CommonTokenStream tokens = new CommonTokenStream(lexer);
    PlSqlParser parser = new PlSqlParser(tokens);
    final int[] errors = {0};
    BaseErrorListener listener =
        new BaseErrorListener() {
          @Override
          public void syntaxError(
              Recognizer<?, ?> r,
              Object symbol,
              int line,
              int col,
              String msg,
              RecognitionException e) {
            errors[0]++;
          }
        };
    lexer.removeErrorListeners();
    lexer.addErrorListener(listener);
    parser.removeErrorListeners();
    parser.addErrorListener(listener);
    try {
      tokens.fill();
    } catch (RuntimeException e) {
      stop(raw, "lexer_rejected_input", 0);
      return;
    }
    Token remark =
        tokens.getTokens().stream()
            .filter(t -> t.getType() == PlSqlLexer.REMARK_COMMENT)
            .findFirst()
            .orElse(null);
    if (remark != null) {
      stop(raw, "sqlplus_command_unsupported", remark.getLine());
      return;
    }
    PlSqlParser.Sql_scriptContext tree;
    try {
      tree = parser.sql_script();
    } catch (RuntimeException e) {
      stop(raw, "parser_rejected_input", 0);
      return;
    }
    if (errors[0] != 0) {
      stop(raw, "parser_rejected_input", 0);
      return;
    }
    if (!tree.sql_plus_command().isEmpty()
        || tree.script_unit().stream().anyMatch(u -> u.sql_plus_command() != null)) {
      stop(
          raw,
          "sqlplus_command_unsupported",
          tree.sql_plus_command().isEmpty()
              ? tree.script_unit().stream()
                  .filter(u -> u.sql_plus_command() != null)
                  .findFirst()
                  .get()
                  .getStart()
                  .getLine()
              : tree.sql_plus_command(0).getStart().getLine());
      return;
    }

    int[] cpToChar = codePointCharOffsets(source);
    int[] cpToByte = codePointByteOffsets(source);
    List<PlSqlParser.Script_unitContext> units = tree.script_unit();
    List<PlSqlParser.TerminatorContext> terms = tree.terminator();
    if (units.size() != terms.size()) {
      stop(raw, "missing_source_delimiter", 0);
      return;
    }
    List<Range> ranges = new ArrayList<>();
    int previousEndCp = 0;
    for (int i = 0; i < units.size(); i++) {
      Token begin = units.get(i).getStart();
      Token semi = terms.get(i).SEMICOLON() == null ? null : terms.get(i).SEMICOLON().getSymbol();
      Token slash = terms.get(i).SOLIDUS() == null ? null : terms.get(i).SOLIDUS().getSymbol();
      int startCp = begin.getStartIndex();
      for (Token t : tokens.getTokens()) {
        if (t.getChannel() == Token.HIDDEN_CHANNEL
            && isComment(t)
            && t.getStartIndex() >= previousEndCp
            && t.getStopIndex() < startCp) {
          if (!onlyAsciiWhitespace(source, cpToChar, previousEndCp, t.getStartIndex())) {
            stop(raw, "unmapped_source_bytes", t.getLine());
            return;
          }
          startCp = t.getStartIndex();
          break;
        }
      }
      int execEndCp, endCp;
      if (slash != null) {
        endCp = slash.getStopIndex() + 1;
        String suffix;
        if (semi != null) {
          execEndCp = semi.getStopIndex() + 1;
          suffix = source.substring(cpToChar[execEndCp], cpToChar[endCp]);
        } else {
          int slashStart = slash.getStartIndex();
          if (slashStart >= 2
              && source.substring(cpToChar[slashStart - 2], cpToChar[endCp]).equals("\r\n/")) {
            execEndCp = slashStart - 2;
          } else if (slashStart >= 1
              && source.substring(cpToChar[slashStart - 1], cpToChar[endCp]).equals("\n/")) {
            execEndCp = slashStart - 1;
          } else {
            stop(raw, "unrecognized_source_delimiter", slash.getLine());
            return;
          }
          suffix = source.substring(cpToChar[execEndCp], cpToChar[endCp]);
        }
        if (execEndCp < 0
            || endCp <= execEndCp
            || !(suffix.equals("\r\n/") || suffix.equals("\n/"))) {
          stop(raw, "unrecognized_source_delimiter", slash.getLine());
          return;
        }
      } else if (semi != null) {
        execEndCp = semi.getStartIndex();
        endCp = semi.getStopIndex() + 1;
      } else {
        stop(raw, "missing_source_delimiter", begin.getLine());
        return;
      }
      if (startCp < previousEndCp
          || startCp >= execEndCp
          || execEndCp > endCp
          || endCp > cpToByte.length - 1) {
        stop(raw, "invalid_parser_range", begin.getLine());
        return;
      }
      if (!onlyAsciiWhitespace(source, cpToChar, previousEndCp, startCp)) {
        stop(raw, "unmapped_source_bytes", begin.getLine());
        return;
      }
      String execution = source.substring(cpToChar[startCp], cpToChar[execEndCp]);
      byte[] executionBytes = execution.getBytes(StandardCharsets.UTF_8);
      byte[] sourceExecution =
          java.util.Arrays.copyOfRange(raw, cpToByte[startCp], cpToByte[execEndCp]);
      if (!java.util.Arrays.equals(executionBytes, sourceExecution)) {
        stop(raw, "source_byte_mapping_mismatch", begin.getLine());
        return;
      }
      ranges.add(new Range(cpToByte[startCp], cpToByte[endCp], execution, sha256(executionBytes)));
      previousEndCp = endCp;
    }
    if (!onlyAsciiWhitespace(source, cpToChar, previousEndCp, cpToChar.length - 1)) {
      stop(raw, "unmapped_source_bytes", 0);
      return;
    }
    StringBuilder out = new StringBuilder(header(raw)).append(",\"statements\":[");
    for (int i = 0; i < ranges.size(); i++) {
      if (i > 0) out.append(',');
      Range r = ranges.get(i);
      out.append("{\"start_byte\":")
          .append(r.start)
          .append(",\"end_byte\":")
          .append(r.end)
          .append(",\"execution_sql\":\"")
          .append(escape(r.execution))
          .append("\",\"execution_sha256\":\"")
          .append(r.hash)
          .append("\",\"delimiter_disposition\":\"source_delimiter_in_range\"}");
    }
    System.out.println(out.append("]}").toString());
  }

  private static boolean isComment(Token t) {
    return t.getType() == PlSqlLexer.SINGLE_LINE_COMMENT
        || t.getType() == PlSqlLexer.MULTI_LINE_COMMENT;
  }

  private static boolean onlyAsciiWhitespace(String s, int[] c, int from, int to) {
    for (int i = from; i < to; i++) {
      char ch = s.charAt(c[i]);
      if (!(ch == ' ' || (ch >= '\t' && ch <= '\r'))) return false;
    }
    return true;
  }

  private static int[] codePointCharOffsets(String s) {
    int n = s.codePointCount(0, s.length());
    int[] a = new int[n + 1];
    int ch = 0;
    for (int i = 0; i < n; i++) {
      a[i] = ch;
      ch += Character.charCount(s.codePointAt(ch));
    }
    a[n] = s.length();
    return a;
  }

  private static int[] codePointByteOffsets(String s) {
    int n = s.codePointCount(0, s.length());
    int[] a = new int[n + 1];
    int ch = 0, bytes = 0;
    for (int i = 0; i < n; i++) {
      a[i] = bytes;
      int cp = s.codePointAt(ch);
      bytes += new String(Character.toChars(cp)).getBytes(StandardCharsets.UTF_8).length;
      ch += Character.charCount(cp);
    }
    a[n] = bytes;
    return a;
  }

  private static String header(byte[] raw) throws Exception {
    return "{\"schema_version\":1,\"scope\":\"OFFLINE_CANDIDATE_ONLY\",\"production_approved\":false,\"execution_approved\":false,\"raw_sha256\":\""
        + sha256(raw)
        + "\",\"parser_profile\":\""
        + PROFILE
        + "\"";
  }

  private static void stop(byte[] raw, String code, int line) throws Exception {
    System.out.println(
        header(raw) + ",\"stop\":{\"code\":\"" + code + "\",\"line\":" + line + "}}");
    System.exit(2);
  }

  private static String sha256(byte[] b) throws Exception {
    return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(b));
  }

  private static String escape(String s) {
    StringBuilder b = new StringBuilder();
    for (char c : s.toCharArray()) {
      switch (c) {
        case '"' -> b.append("\\\"");
        case '\\' -> b.append("\\\\");
        case '\n' -> b.append("\\n");
        case '\r' -> b.append("\\r");
        case '\t' -> b.append("\\t");
        default -> {
          if (c < 32) b.append(String.format("\\u%04x", (int) c));
          else b.append(c);
        }
      }
    }
    return b.toString();
  }

  private record Range(int start, int end, String execution, String hash) {}
}
