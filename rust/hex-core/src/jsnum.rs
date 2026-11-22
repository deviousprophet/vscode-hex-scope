//! JavaScript number semantics used by the TypeScript originals.
//!
//! The parser ports index with `>>>`, combine bitwise shifts and format numbers in error
//! messages, so the Rust side needs the same `ToInt32`, `ToUint32` and `Number::toString`
//! behaviour instead of Rust's saturating casts and formatting.

/// `Number.isInteger`.
pub fn is_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0
}

/// JavaScript `ToInt32`: NaN and the infinities become 0, then truncate and wrap.
pub fn to_int32(value: f64) -> i32 {
    to_uint32(value) as i32
}

/// JavaScript `ToUint32`: NaN and the infinities become 0, then truncate and wrap.
pub fn to_uint32(value: f64) -> u32 {
    if !value.is_finite() || value == 0.0 {
        return 0;
    }
    let truncated = value.trunc();
    let modulo = truncated.rem_euclid(4_294_967_296.0);
    modulo as u32
}

/// JavaScript `a >>> shift` (the shift count is taken modulo 32).
pub fn shift_right_unsigned(value: f64, shift: f64) -> u32 {
    let count = to_uint32(shift) % 32;
    to_uint32(value) >> count
}

/// JavaScript `Number.prototype.toString()` for the values that reach error messages.
///
/// Uses the shortest round-trip digits from Rust's `Debug` formatting and applies the
/// ECMAScript decimal/exponential thresholds: plain notation for `1e-6 <= |x| < 1e21`,
/// exponential notation otherwise.
pub fn number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_string();
    }
    if value.is_infinite() {
        return if value.is_sign_negative() {
            "-Infinity".to_string()
        } else {
            "Infinity".to_string()
        };
    }
    if value == 0.0 {
        return "0".to_string();
    }

    let negative = value.is_sign_negative();
    let raw = format!("{:?}", value.abs());
    let (digits, exponent) = digits_and_exponent(&raw);
    let rendered = render_js_decimal(&digits, exponent);
    if negative {
        format!("-{rendered}")
    } else {
        rendered
    }
}

/// Split Rust's shortest float representation into significant digits and the decimal
/// exponent `n` where the value is `0.<digits> * 10^n`.
fn digits_and_exponent(raw: &str) -> (Vec<u8>, i32) {
    let (mantissa, exp) = match raw.split_once(['e', 'E']) {
        Some((mantissa, exp)) => (mantissa, exp.parse::<i32>().unwrap_or(0)),
        None => (raw, 0),
    };
    let (whole, fraction) = match mantissa.split_once('.') {
        Some((whole, fraction)) => (whole, fraction),
        None => (mantissa, ""),
    };

    let mut digits: Vec<u8> = whole
        .bytes()
        .chain(fraction.bytes())
        .filter(u8::is_ascii_digit)
        .collect();
    let point = whole.len() as i32 + exp;

    let leading = digits.iter().take_while(|&&d| d == b'0').count();
    digits.drain(..leading);
    let mut exponent = point - leading as i32;

    while digits.len() > 1 && digits.last() == Some(&b'0') {
        digits.pop();
    }
    if digits.is_empty() {
        digits.push(b'0');
        exponent = 1;
    }
    (digits, exponent)
}

fn render_js_decimal(digits: &[u8], exponent: i32) -> String {
    let digit_text: String = digits.iter().map(|&d| char::from(d)).collect();
    let k = digits.len() as i32;

    if k <= exponent && exponent <= 21 {
        let zeros = "0".repeat((exponent - k) as usize);
        return format!("{digit_text}{zeros}");
    }
    if 0 < exponent && exponent <= 21 {
        let (head, tail) = digit_text.split_at(exponent as usize);
        return format!("{head}.{tail}");
    }
    if -6 < exponent && exponent <= 0 {
        let zeros = "0".repeat((-exponent) as usize);
        return format!("0.{zeros}{digit_text}");
    }

    let sign = if exponent > 0 { '+' } else { '-' };
    let magnitude = (exponent - 1).abs();
    let mantissa = if k == 1 {
        digit_text
    } else {
        let (head, tail) = digit_text.split_at(1);
        format!("{head}.{tail}")
    };
    format!("{mantissa}e{sign}{magnitude}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn to_uint32_matches_javascript() {
        assert_eq!(to_uint32(f64::NAN), 0);
        assert_eq!(to_uint32(-7.5), 4_294_967_289);
        assert_eq!(to_uint32(-0.0), 0);
        assert_eq!(to_uint32(1e21), 3_735_027_712);
        assert_eq!(to_uint32(4_294_967_296.0), 0);
    }

    #[test]
    fn numbers_match_javascript_strings() {
        assert_eq!(number_to_string(0.5), "0.5");
        assert_eq!(number_to_string(-0.0), "0");
        assert_eq!(number_to_string(1_000_000.0), "1000000");
        assert_eq!(number_to_string(1e21), "1e+21");
        assert_eq!(number_to_string(5e-324), "5e-324");
        assert_eq!(number_to_string(1e-7), "1e-7");
        assert_eq!(number_to_string(0.000001), "0.000001");
        assert_eq!(
            number_to_string(0.300_000_000_000_000_04),
            "0.30000000000000004"
        );
        assert_eq!(
            number_to_string(9_007_199_254_740_992.0),
            "9007199254740992"
        );
    }
}
