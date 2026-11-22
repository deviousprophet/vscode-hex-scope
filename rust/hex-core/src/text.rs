//! Text helpers that mirror the JavaScript string operations the parsers rely on.

/// JavaScript's `\s` set, used by `String.prototype.trim` and `/\s/`.
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202F}'
                | '\u{205F}'
                | '\u{3000}'
                | '\u{FEFF}'
    )
}

/// Byte offsets of the first and one past the last non-whitespace character.
pub fn trim_bounds(text: &str) -> (usize, usize) {
    let start = text
        .char_indices()
        .find(|(_, c)| !is_js_whitespace(*c))
        .map(|(i, _)| i)
        .unwrap_or(text.len());
    let end = text
        .char_indices()
        .rev()
        .find(|(_, c)| !is_js_whitespace(*c))
        .map(|(i, c)| i + c.len_utf8())
        .unwrap_or(start);
    (start, end)
}

/// `text.trim()` with JavaScript's whitespace set.
pub fn js_trim(text: &str) -> &str {
    let (start, end) = trim_bounds(text);
    &text[start..end]
}

/// Length in UTF-16 code units, the unit JavaScript uses for string indices.
pub fn utf16_len(text: &str) -> usize {
    text.chars().map(char::len_utf16).sum()
}

/// Strip the DOS end-of-file character the originals remove before scanning.
pub fn strip_trailing_sub(source: &str) -> &str {
    source.trim_end_matches('\u{001A}')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn trims_javascript_whitespace_only() {
        assert_eq!(js_trim(" \t\n:0100\u{00A0}"), ":0100");
        assert_eq!(js_trim("\u{FEFF}abc\u{FEFF}"), "abc");
        assert_eq!(js_trim("\u{180E}abc"), "\u{180E}abc");
        assert_eq!(js_trim(" \t"), "");
    }

    #[test]
    fn counts_utf16_units() {
        assert_eq!(utf16_len("abc"), 3);
        assert_eq!(utf16_len("\u{1F44D}"), 2);
        assert_eq!(utf16_len("e\u{0301}"), 2);
    }
}
