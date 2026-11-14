//! Browser application authored in Rust. JavaScript output is generated solely
//! by wasm-bindgen for the browser's WebAssembly and DOM interfaces.
#[cfg(target_arch = "wasm32")]
mod browser;
#[cfg(any(target_arch = "wasm32", test))]
mod workflow;

pub fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    #[test]
    fn untrusted_names_and_sql_cannot_become_markup() {
        assert_eq!(
            super::escape("<script a=\"x\">&'</script>"),
            "&lt;script a=&quot;x&quot;&gt;&amp;&#39;&lt;/script&gt;"
        );
    }
}
