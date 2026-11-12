use crate::ObjectJson;
use crate::{ApiError, ApiResult, AppState, auth::Authenticated};
use axum::{Json, extract::State, http::StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Input {
    sql: String,
}

pub async fn parse(
    State(state): State<AppState>,
    _: Authenticated,
    ObjectJson(input): ObjectJson<Input>,
) -> ApiResult<Value> {
    let permit = state
        .parser_slots
        .clone()
        .try_acquire_owned()
        .map_err(|_| ApiError(StatusCode::TOO_MANY_REQUESTS, "PARSER_BUSY"))?;
    let parsed = tokio::task::spawn_blocking(move || {
        let _permit = permit;
        kelryvo_parser::parse(input.sql.as_bytes())
    })
    .await
    .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "PARSER_UNAVAILABLE"))?;
    Ok(Json(match parsed {
        Ok(parsed) => serde_json::to_value(parsed)
            .map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE, "PARSER_UNAVAILABLE"))?,
        Err(code) => {
            json!({"ok":false,"code":code,"profile":kelryvo_parser::PROFILE,"executionApproved":false,"productionApproved":false})
        }
    }))
}
