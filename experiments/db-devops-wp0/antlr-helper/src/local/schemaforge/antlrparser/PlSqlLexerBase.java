package local.schemaforge.antlrparser;

import org.antlr.v4.runtime.CharStream;
import org.antlr.v4.runtime.IntStream;
import org.antlr.v4.runtime.Lexer;

/** Project-authored newline callback for the licensed REM/PROMPT lexer rules. */
public abstract class PlSqlLexerBase extends Lexer {
    protected PlSqlLexerBase(CharStream input) { super(input); }

    protected boolean IsNewlineAtPos(int offset) {
        return switch (_input.LA(offset)) {
            case IntStream.EOF, '\r', '\n' -> true;
            default -> false;
        };
    }
}
