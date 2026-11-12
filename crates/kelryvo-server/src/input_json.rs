//! Typed API requests retain the named-object wire contract of the original
//! handlers. Serde's positional struct representation is not an API input form.
use crate::{ApiError, invalid};
use axum::{
    Json,
    body::{Body, to_bytes},
    extract::{FromRequest, MatchedPath, Request},
    http::{Method, StatusCode, header},
    middleware::Next,
    response::{IntoResponse, Response},
};
use serde::de::DeserializeOwned;
use serde_json::{Value, value::RawValue};
use std::collections::HashMap;

#[derive(Clone, Copy)]
pub(crate) struct ParsedBodyTruthiness(pub bool);

pub(crate) fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|v| v != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// The retained server parses supported request bodies before authentication,
/// including endpoints whose handlers ignore a body. Rate limiting stays outside
/// this boundary. No body or parse error is allowed to reach metadata first.
pub(crate) async fn parse(request: Request, next: Next) -> Response {
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(MatchedPath::as_str);
    let Some(route) = route.filter(|route| route.starts_with("/api/")) else {
        return next.run(request).await;
    };
    if !matches!(
        *request.method(),
        Method::POST | Method::PUT | Method::PATCH
    ) {
        return next.run(request).await;
    }
    let limit = if matches!(
        (request.method(), route),
        (&Method::POST, "/api/projects/{id}/sql-drafts")
            | (&Method::PUT, "/api/projects/{id}/sql-drafts/{draft}")
    ) {
        2_200_000
    } else {
        1024 * 1024
    };
    let content_type = request.headers().get(header::CONTENT_TYPE);
    let media_type = content_type
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or_default().trim());
    let json = media_type.is_some_and(|v| v.eq_ignore_ascii_case("application/json"));
    let text = media_type.is_some_and(|v| v.eq_ignore_ascii_case("text/plain"));
    if content_type.is_some() && !json && !text {
        return invalid().into_response();
    }
    let missing_type = media_type.is_none();
    let (mut parts, body) = request.into_parts();
    let bytes = match to_bytes(body, limit).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return ApiError(StatusCode::PAYLOAD_TOO_LARGE, "REQUEST_TOO_LARGE").into_response();
        }
    };
    if missing_type && !bytes.is_empty() {
        return invalid().into_response();
    }
    // The retained string decoder counts the UTF-8 replacement bytes too.
    // Check that bound before authentication even on body-ignoring routes.
    let decoded = String::from_utf8_lossy(&bytes);
    if decoded.len() > limit {
        return ApiError(StatusCode::PAYLOAD_TOO_LARGE, "REQUEST_TOO_LARGE").into_response();
    }
    if json {
        // Node's UTF-8 request decoder replaces invalid sequences and its JSON
        // parser accepts one leading BOM. Keep that lexical boundary, retaining
        // byte limits before allocating or interpreting a JSON value.
        let decoded = decoded.strip_prefix('\u{feff}').unwrap_or(&decoded);
        let (accepted, password_budget) = validate_json(decoded);
        if !accepted {
            return invalid().into_response();
        }
        parts
            .extensions
            .insert(ParsedBodyTruthiness(password_budget));
        let body = Body::from(decoded.to_owned());
        next.run(Request::from_parts(parts, body)).await
    } else {
        parts
            .extensions
            .insert(ParsedBodyTruthiness(!decoded.is_empty()));
        next.run(Request::from_parts(parts, Body::from(bytes)))
            .await
    }
}

fn validate_json(source: &str) -> (bool, bool) {
    match serde_json::from_str::<Value>(source) {
        Ok(value) => (safe_keys(&value), truthy(&value)),
        // Syntactically valid numbers can exceed f64. Keep poison checks and
        // lexical validity independent of typed conversion and authentication.
        Err(_) => (safe_raw_keys(source), raw_truthy(source)),
    }
}

pub(crate) async fn fallback(request: Request, next: Next) -> Response {
    let path = request.uri().path();
    if path == "/api" || path.starts_with("/api/") {
        not_found(request).await
    } else {
        next.run(request).await
    }
}

/// Unregistered routes/methods retain the root HTTP parser's refusal envelope,
/// outside registered API quotas, authentication, metadata and execution grants.
pub(crate) async fn not_found(request: Request) -> Response {
    let message = format!("Route {}:{} not found", request.method(), request.uri());
    let query = request.method().as_str() == "QUERY";
    if query && !request.headers().contains_key(header::CONTENT_TYPE) {
        return fallback_error(
            StatusCode::BAD_REQUEST,
            "FST_ERR_ROUTE_MISSING_CONTENT_TYPE",
            "Method 'QUERY' must provide a 'Content-Type' header.",
        );
    }
    if query
        && !request.headers().contains_key(header::TRANSFER_ENCODING)
        && request
            .headers()
            .get(header::CONTENT_LENGTH)
            .is_none_or(|v| v == "0")
    {
        return fallback_error(
            StatusCode::BAD_REQUEST,
            "FST_ERR_ROUTE_MISSING_CONTENT",
            "Method 'QUERY' must provide a request body.",
        );
    }
    let body_method = query
        || matches!(
            *request.method(),
            Method::POST | Method::PUT | Method::PATCH | Method::DELETE | Method::OPTIONS
        );
    let media_type = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(|v| v.split(';').next().unwrap_or_default().trim());
    let json = media_type.is_some_and(|v| v.eq_ignore_ascii_case("application/json"));
    let text = media_type.is_some_and(|v| v.eq_ignore_ascii_case("text/plain"));
    if body_method && (json || text) {
        let limit = 1024 * 1024;
        let bytes = match to_bytes(request.into_body(), limit).await {
            Ok(bytes) => bytes,
            Err(_) => {
                return fallback_error(
                    StatusCode::PAYLOAD_TOO_LARGE,
                    "FST_ERR_CTP_BODY_TOO_LARGE",
                    "Request body is too large",
                );
            }
        };
        let decoded = String::from_utf8_lossy(&bytes);
        if decoded.len() > limit {
            return fallback_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "FST_ERR_CTP_BODY_TOO_LARGE",
                "Request body is too large",
            );
        }
        if json && bytes.is_empty() {
            return fallback_error(
                StatusCode::BAD_REQUEST,
                "FST_ERR_CTP_EMPTY_JSON_BODY",
                "Body cannot be empty when content-type is set to 'application/json'",
            );
        }
        if json && !validate_json(decoded.strip_prefix('\u{feff}').unwrap_or(&decoded)).0 {
            return fallback_error(
                StatusCode::BAD_REQUEST,
                "FST_ERR_CTP_INVALID_JSON_BODY",
                "Body is not valid JSON but content-type is set to 'application/json'",
            );
        }
    }
    (
        StatusCode::NOT_FOUND,
        Json(serde_json::json!({"message":message,"error":"Not Found","statusCode":404})),
    )
        .into_response()
}

fn fallback_error(status: StatusCode, code: &str, message: &str) -> Response {
    (status, Json(serde_json::json!({"statusCode":status.as_u16(),"code":code,"error":status.canonical_reason().unwrap_or("Error"),"message":message}))).into_response()
}

fn raw_truthy(source: &str) -> bool {
    let Ok(value) = serde_json::from_str::<&RawValue>(source) else {
        return false;
    };
    match value.get() {
        "null" | "false" | "\"\"" => false,
        raw if raw.starts_with(['{', '[', '"']) || raw == "true" => true,
        raw => raw.parse::<f64>().is_ok_and(|number| number != 0.0),
    }
}

/// Match the retained JSON parser's prototype-key refusals at every depth.
/// Last-key-wins decoding happens first, so overwritten properties retain their
/// existing wire semantics. A plain `prototype` property is not forbidden.
fn safe_keys(root: &Value) -> bool {
    let mut pending = vec![root];
    while let Some(value) = pending.pop() {
        match value {
            Value::Object(object) => {
                if object.contains_key("__proto__")
                    || object
                        .get("constructor")
                        .and_then(Value::as_object)
                        .is_some_and(|value| value.contains_key("prototype"))
                {
                    return false;
                }
                pending.extend(object.values());
            }
            Value::Array(array) => pending.extend(array),
            _ => {}
        }
    }
    true
}

fn safe_raw_keys(source: &str) -> bool {
    let Ok(root) = serde_json::from_str::<&RawValue>(source) else {
        return false;
    };
    let mut pending = vec![(root, 0_u8)];
    while let Some((value, depth)) = pending.pop() {
        // Preserve the native JSON extractor's bounded nesting. RawValue skips
        // numeric conversion; it must not create an unbounded fallback parser.
        if depth >= 128 {
            return false;
        }
        match value.get().as_bytes().first() {
            Some(b'{') => {
                let Ok(object) = serde_json::from_str::<HashMap<String, &RawValue>>(value.get())
                else {
                    return false;
                };
                if object.contains_key("__proto__") {
                    return false;
                }
                if let Some(constructor) = object.get("constructor")
                    && constructor.get().starts_with('{')
                    && serde_json::from_str::<HashMap<String, &RawValue>>(constructor.get())
                        .is_ok_and(|object| object.contains_key("prototype"))
                {
                    return false;
                }
                pending.extend(object.into_values().map(|value| (value, depth + 1)));
            }
            Some(b'[') => {
                let Ok(array) = serde_json::from_str::<Vec<&RawValue>>(value.get()) else {
                    return false;
                };
                pending.extend(array.into_iter().map(|value| (value, depth + 1)));
            }
            _ => {}
        }
    }
    true
}

pub struct ObjectJson<T>(pub T);
impl<S, T> FromRequest<S> for ObjectJson<T>
where
    S: Send + Sync,
    T: DeserializeOwned + Send,
{
    type Rejection = Response;

    async fn from_request(request: Request, state: &S) -> Result<Self, Self::Rejection> {
        // Keep Axum's content-type, syntax and configured body-limit failures;
        // the shared HTTP error layer projects those to the retained contract.
        let Json(value) = Json::<Value>::from_request(request, state)
            .await
            .map_err(IntoResponse::into_response)?;
        if !value.is_object() {
            return Err(invalid().into_response());
        }
        serde_json::from_value(value)
            .map(Self)
            .map_err(|_| invalid().into_response())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        body::{Body, to_bytes},
        http::{Request, StatusCode},
        routing::post,
    };
    use serde::Deserialize;
    use serde_json::json;
    use tower::ServiceExt;
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Named {
        name: String,
        owners: Vec<String>,
        #[serde(default, deserialize_with = "crate::supplied")]
        description: Option<String>,
    }
    async fn echo(ObjectJson(body): ObjectJson<Named>) -> Json<Value> {
        Json(json!({"name":body.name,"owners":body.owners,"description":body.description}))
    }
    #[tokio::test]
    async fn named_objects_keep_valid_lists_and_reject_positional_structs() {
        let app = Router::new().route("/", post(echo));
        for body in [
            json!(["positional", ["APP"]]),
            Value::Null,
            json!(false),
            json!({"name":"named","owners":["APP"],"description":null}),
            json!({"name":"named","owners":["APP"],"extra":true}),
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri("/")
                        .header("content-type", "application/json")
                        .body(Body::from(body.to_string()))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        json!({"name":"named","owners":["APP","SECOND_APP"]}).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_bytes(response.into_body(), 16384).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap(),
            json!({"name":"named","owners":["APP","SECOND_APP"],"description":null})
        );
    }
}
