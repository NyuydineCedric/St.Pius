package com.reportcard;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Minimal JSON reader/writer, used by the backup format.
 *
 * Main.parseJsonObject only understands a flat object of string values, which
 * is fine for request bodies but cannot represent a whole-database snapshot.
 * This handles nested objects and arrays.
 *
 * Deliberately a plain data parser: it produces only Map, List, String, Double,
 * Boolean and null. Unlike Java object deserialization it cannot instantiate
 * arbitrary classes, so parsing a hostile file cannot execute code — which is
 * the whole reason backups moved off ObjectInputStream.
 */
final class Json {

    private Json() {
    }

    /** Thrown for any malformed input. Callers turn this into a 400. */
    static final class ParseException extends RuntimeException {
        ParseException(String message) {
            super(message);
        }
    }

    // ---------------------------------------------------------------- read

    static Object parse(String text) {
        if (text == null)
            throw new ParseException("Empty input");
        Parser p = new Parser(text);
        p.skipWhitespace();
        Object value = p.readValue(0);
        p.skipWhitespace();
        if (!p.atEnd())
            throw new ParseException("Unexpected trailing content at position " + p.pos);
        return value;
    }

    /** Parses and requires the top level to be an object. */
    static Map<String, Object> parseObject(String text) {
        Object value = parse(text);
        if (!(value instanceof Map))
            throw new ParseException("Expected a JSON object at the top level");
        @SuppressWarnings("unchecked")
        Map<String, Object> map = (Map<String, Object>) value;
        return map;
    }

    private static final class Parser {
        // Guards against a hostile file nesting arrays deeply enough to
        // overflow the stack in this recursive parser.
        private static final int MAX_DEPTH = 64;

        private final String s;
        private int pos;

        Parser(String s) {
            this.s = s;
        }

        boolean atEnd() {
            return pos >= s.length();
        }

        void skipWhitespace() {
            while (pos < s.length() && Character.isWhitespace(s.charAt(pos)))
                pos++;
        }

        private char peek() {
            if (pos >= s.length())
                throw new ParseException("Unexpected end of input");
            return s.charAt(pos);
        }

        private void expect(char c) {
            if (pos >= s.length() || s.charAt(pos) != c)
                throw new ParseException("Expected '" + c + "' at position " + pos);
            pos++;
        }

        Object readValue(int depth) {
            if (depth > MAX_DEPTH)
                throw new ParseException("Nesting too deep");
            skipWhitespace();
            char c = peek();
            switch (c) {
                case '{':
                    return readObject(depth);
                case '[':
                    return readArray(depth);
                case '"':
                    return readString();
                case 't':
                    return readLiteral("true", Boolean.TRUE);
                case 'f':
                    return readLiteral("false", Boolean.FALSE);
                case 'n':
                    return readLiteral("null", null);
                default:
                    return readNumber();
            }
        }

        private Map<String, Object> readObject(int depth) {
            Map<String, Object> map = new LinkedHashMap<>();
            expect('{');
            skipWhitespace();
            if (peek() == '}') {
                pos++;
                return map;
            }
            while (true) {
                skipWhitespace();
                String key = readString();
                skipWhitespace();
                expect(':');
                map.put(key, readValue(depth + 1));
                skipWhitespace();
                char c = peek();
                if (c == ',') {
                    pos++;
                    continue;
                }
                if (c == '}') {
                    pos++;
                    return map;
                }
                throw new ParseException("Expected ',' or '}' at position " + pos);
            }
        }

        private List<Object> readArray(int depth) {
            List<Object> list = new ArrayList<>();
            expect('[');
            skipWhitespace();
            if (peek() == ']') {
                pos++;
                return list;
            }
            while (true) {
                list.add(readValue(depth + 1));
                skipWhitespace();
                char c = peek();
                if (c == ',') {
                    pos++;
                    continue;
                }
                if (c == ']') {
                    pos++;
                    return list;
                }
                throw new ParseException("Expected ',' or ']' at position " + pos);
            }
        }

        private String readString() {
            expect('"');
            StringBuilder sb = new StringBuilder();
            while (true) {
                if (pos >= s.length())
                    throw new ParseException("Unterminated string");
                char c = s.charAt(pos++);
                if (c == '"')
                    return sb.toString();
                if (c != '\\') {
                    sb.append(c);
                    continue;
                }
                if (pos >= s.length())
                    throw new ParseException("Unterminated escape");
                char esc = s.charAt(pos++);
                switch (esc) {
                    case '"':  sb.append('"');  break;
                    case '\\': sb.append('\\'); break;
                    case '/':  sb.append('/');  break;
                    case 'b':  sb.append('\b'); break;
                    case 'f':  sb.append('\f'); break;
                    case 'n':  sb.append('\n'); break;
                    case 'r':  sb.append('\r'); break;
                    case 't':  sb.append('\t'); break;
                    case 'u':
                        if (pos + 4 > s.length())
                            throw new ParseException("Truncated \\u escape");
                        try {
                            sb.append((char) Integer.parseInt(s.substring(pos, pos + 4), 16));
                        } catch (NumberFormatException e) {
                            throw new ParseException("Bad \\u escape at position " + pos);
                        }
                        pos += 4;
                        break;
                    default:
                        throw new ParseException("Unknown escape '\\" + esc + "'");
                }
            }
        }

        private Object readLiteral(String literal, Object value) {
            if (!s.startsWith(literal, pos))
                throw new ParseException("Invalid literal at position " + pos);
            pos += literal.length();
            return value;
        }

        private Double readNumber() {
            int start = pos;
            if (pos < s.length() && (s.charAt(pos) == '-' || s.charAt(pos) == '+'))
                pos++;
            while (pos < s.length()) {
                char c = s.charAt(pos);
                if ((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '-' || c == '+')
                    pos++;
                else
                    break;
            }
            if (start == pos)
                throw new ParseException("Unexpected character '" + s.charAt(pos) + "' at position " + pos);
            try {
                return Double.valueOf(s.substring(start, pos));
            } catch (NumberFormatException e) {
                throw new ParseException("Invalid number at position " + start);
            }
        }
    }

    // --------------------------------------------------------------- write

    /**
     * Escapes a string for embedding in JSON. Unlike the escaper in Main this
     * also handles control characters, which would otherwise produce a file
     * that this parser rejects on restore.
     */
    static String escape(String raw) {
        if (raw == null)
            return "";
        StringBuilder sb = new StringBuilder(raw.length() + 8);
        for (int i = 0; i < raw.length(); i++) {
            char c = raw.charAt(i);
            switch (c) {
                case '"':  sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\b': sb.append("\\b");  break;
                case '\f': sb.append("\\f");  break;
                case '\n': sb.append("\\n");  break;
                case '\r': sb.append("\\r");  break;
                case '\t': sb.append("\\t");  break;
                default:
                    if (c < 0x20)
                        sb.append(String.format("\\u%04x", (int) c));
                    else
                        sb.append(c);
            }
        }
        return sb.toString();
    }

    /** Renders a quoted JSON string, or {@code ""} for null. */
    static String str(String raw) {
        return "\"" + escape(raw) + "\"";
    }

    // ------------------------------------------------------------ accessors
    // Backups are user-supplied files, so every read is defensive: a missing
    // or wrongly-typed field yields the fallback rather than throwing.

    static String getString(Map<String, Object> obj, String key, String fallback) {
        Object v = obj == null ? null : obj.get(key);
        return v instanceof String ? (String) v : fallback;
    }

    static double getDouble(Map<String, Object> obj, String key, double fallback) {
        Object v = obj == null ? null : obj.get(key);
        return v instanceof Double ? (Double) v : fallback;
    }

    static boolean getBoolean(Map<String, Object> obj, String key, boolean fallback) {
        Object v = obj == null ? null : obj.get(key);
        return v instanceof Boolean ? (Boolean) v : fallback;
    }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> getObjectList(Map<String, Object> obj, String key) {
        Object v = obj == null ? null : obj.get(key);
        List<Map<String, Object>> out = new ArrayList<>();
        if (!(v instanceof List))
            return out;
        for (Object item : (List<Object>) v)
            if (item instanceof Map)
                out.add((Map<String, Object>) item);
        return out;
    }

    @SuppressWarnings("unchecked")
    static Map<String, Object> getObject(Map<String, Object> obj, String key) {
        Object v = obj == null ? null : obj.get(key);
        return v instanceof Map ? (Map<String, Object>) v : null;
    }
}
