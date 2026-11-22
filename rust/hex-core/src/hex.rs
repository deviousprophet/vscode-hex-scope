//! Hex digit decoding shared by the Intel HEX and SREC line parsers.

/// Value of one ASCII hex digit. Callers validate the payload first, so only hex digits arrive.
pub fn nibble(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        _ => byte - b'A' + 10,
    }
}

/// One byte from two ASCII hex digits at `at`.
pub fn byte(hex: &[u8], at: usize) -> u8 {
    (nibble(hex[at]) << 4) | nibble(hex[at + 1])
}
