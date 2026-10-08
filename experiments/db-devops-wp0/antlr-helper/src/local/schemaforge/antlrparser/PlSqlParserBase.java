package local.schemaforge.antlrparser;

import java.util.Set;
import org.antlr.v4.runtime.CharStream;
import org.antlr.v4.runtime.Parser;
import org.antlr.v4.runtime.Token;
import org.antlr.v4.runtime.TokenStream;
import org.antlr.v4.runtime.misc.Interval;

/** Project-authored callbacks derived from the unchanged, licensed grammar contracts.
 * See docs/dependencies/antlr-provenance.md for sources, derivation and limits.
 */
public abstract class PlSqlParserBase extends Parser {
    // Terminal names from the licensed numeric_function and join_clause productions.
    private static final Set<String> NUMERIC_FUNCTIONS = Set.of(
        "SUM", "COUNT", "ROUND", "AVG", "MAX", "MIN", "LEAST", "GREATEST");
    private static final Set<String> JOIN_PREFIXES = Set.of(
        "INNER", "CROSS", "NATURAL", "PARTITION", "FULL", "LEFT", "RIGHT", "OUTER");
    private enum UnitKind { SQL, PLSQL }
    private UnitKind lastUnit = UnitKind.SQL;

    protected PlSqlParserBase(TokenStream input) { super(input); }

    public void setLastUnitPlsql() { lastUnit = UnitKind.PLSQL; }
    public void setLastUnitSql() { lastUnit = UnitKind.SQL; }
    public boolean isLastUnitSql() { return lastUnit == UnitKind.SQL; }

    // Enable the grammar's language productions; these do not certify a target version.
    public boolean isVersion10() { return true; }
    public boolean isVersion11() { return true; }
    public boolean isVersion12() { return true; }

    public boolean IsNotNumericFunction() {
        boolean openingParenthesis = "LEFT_PAREN".equals(getVocabulary().getSymbolicName(_input.LA(2)));
        return !openingParenthesis || !NUMERIC_FUNCTIONS.contains(getVocabulary().getSymbolicName(_input.LA(1)));
    }

    public boolean isNotStartOfJoin() {
        return !JOIN_PREFIXES.contains(getVocabulary().getSymbolicName(_input.LA(1)));
    }

    /** The licensed terminator comment requires a slash alone on its physical source line.
     * Inspect source characters, including hidden-channel material, rather than token lines.
     */
    public boolean isSolidusSeparator() {
        Token slash = _input.LT(1);
        if (!"SOLIDUS".equals(getVocabulary().getSymbolicName(slash.getType()))) return false;
        CharStream source = slash.getInputStream();
        for (int direction : new int[] {-1, 1}) {
            for (int index = slash.getStartIndex() + direction;
                    index >= 0 && index < source.size(); index += direction) {
                String character = source.getText(Interval.of(index, index));
                if (character.equals("\n") || character.equals("\r")) break;
                if (!character.equals(" ") && !character.equals("\t")) return false;
            }
        }
        return true;
    }
}
