//! User actions for execution.
use super::*;

pub(super) async fn action(
    model: &Model,
    action: Action,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    match action {
        Action::ExecutionReadiness | Action::RequestExecution => {
            if action == Action::RequestExecution {
                api(
                    model,
                    "POST",
                    &format!("/api/plans/{}/execution", segment(id)),
                    Some(fields),
                    None,
                )
                .await?;
                load(model).await?;
                model.borrow_mut().notice="Execution request queued for independent worker validation. SQL has not been executed.".into();
            }
            let response = api(
                model,
                "GET",
                &format!("/api/plans/{}/execution-readiness", segment(id)),
                None,
                None,
            )
            .await?;
            let mut state = model.borrow_mut();
            if !state.data["readinessByPlan"].is_object() {
                state.data["readinessByPlan"] = json!({});
            }
            state.data["readinessByPlan"][id] = response;
        }
        Action::LoadExecutionAttempts
        | Action::OlderExecutionAttempts
        | Action::OpenExecutionAttempt
        | Action::NextAttemptEvents
        | Action::NextAttemptReceipts => {
            let base = format!("/api/execution-jobs/{}/attempts", segment(id));
            let (key, path) = match action {
                Action::OlderExecutionAttempts => (
                    "executionAttempts",
                    format!(
                        "{}?cursor={}",
                        base,
                        segment(s(
                            &model.borrow().data["executionAttempts"][id]["nextCursor"]
                        ))
                    ),
                ),
                Action::OpenExecutionAttempt => (
                    "executionJournal",
                    format!("{}/{}", base, segment(s(&fields["attemptId"]))),
                ),
                Action::NextAttemptEvents | Action::NextAttemptReceipts => {
                    let detail = model.borrow().data["executionJournal"][id].clone();
                    let query = if action == Action::NextAttemptEvents {
                        "eventsCursor"
                    } else {
                        "receiptsCursor"
                    };
                    let field = if action == Action::NextAttemptEvents {
                        "nextEventsCursor"
                    } else {
                        "nextReceiptsCursor"
                    };
                    (
                        "executionJournal",
                        format!(
                            "{}/{}?{}={}",
                            base,
                            segment(s(&detail["attempt"]["id"])),
                            query,
                            segment(s(&detail[field]))
                        ),
                    )
                }
                _ => ("executionAttempts", base),
            };
            let result = api(model, "GET", &path, None, None).await?;
            let mut state = model.borrow_mut();
            if !state.data[key].is_object() {
                state.data[key] = json!({});
            }
            if key == "executionJournal" && action == Action::NextAttemptEvents {
                state.data[key][id]["events"] = result["events"].clone();
                state.data[key][id]["nextEventsCursor"] = result["nextEventsCursor"].clone();
            } else if key == "executionJournal" && action == Action::NextAttemptReceipts {
                state.data[key][id]["receipts"] = result["receipts"].clone();
                state.data[key][id]["nextReceiptsCursor"] = result["nextReceiptsCursor"].clone();
            } else {
                state.data[key][id] = result;
            }
        }
        Action::LoadReconciliations
        | Action::SubmitHoldEvidence
        | Action::RetainHoldEvidence
        | Action::ReviewHoldEvidence => {
            let Route::Project(project, _) = model.borrow().route.clone() else {
                return Err("Select a project first.".into());
            };
            let (job, submission) = id.split_once('/').unwrap_or((id, ""));
            let base = format!("/api/execution-jobs/{}/reconciliations", segment(job));
            if action != Action::LoadReconciliations {
                if s(&fields["reason"])
                    .trim_matches(kelryvo_core::js_whitespace)
                    .is_empty()
                    || action == Action::SubmitHoldEvidence
                        && !recovery_digest(&fields["evidenceDigest"])
                {
                    return Err("Enter a SHA-256 digest and reason for evidence, or a reason for independent review.".into());
                }
                let path = if submission.is_empty() {
                    base.clone()
                } else {
                    format!("{}/{}/decision", base, segment(submission))
                };
                let result = api(model, "POST", &path, Some(fields), None).await?;
                let retained = &result["reconciliation"];
                if retained["jobId"] != job
                    || retained["retryEligible"] != false
                    || retained["executionAuthority"] != false
                    || !submission.is_empty()
                        && (retained["id"] != submission
                            || result["retryEligible"] != false
                            || result["executionAuthority"] != false)
                {
                    return Err(
                        "Could not confirm the reconciliation response. Refresh evidence before continuing."
                            .into(),
                    );
                }
                let mut state = model.borrow_mut();
                if action == Action::SubmitHoldEvidence {
                    for field in ["evidenceDigest", "reason"] {
                        state.data["holdForms"][job]["evidence"][field] = "".into();
                    }
                } else {
                    state.data["holdForms"][job]["reviews"][submission] = "".into();
                }
            }
            let refresh_error = |message: String| match action {
                Action::LoadReconciliations => message,
                Action::SubmitHoldEvidence => format!("Evidence reference retained. {message}"),
                _ => format!("Independent review retained. {message}"),
            };
            let result = api(model, "GET", &base, None, None)
                .await
                .map_err(refresh_error)?;
            let completion = &result["recoveredCompletion"];
            if result["jobId"] != job
                || result["projectId"] != project
                || result["retryEligible"] != false
                || result["executionAuthority"] != false
                || result["reconciliations"]
                    .as_array()
                    .is_none_or(|rows| rows.len() > 20)
                || !completion.is_null()
                    && (completion["status"] != "RECOVERED_APPLIED"
                        || completion["jobState"] != "HOLD"
                        || completion["retryEligible"] != false
                        || completion["executionAuthority"] != false
                        || !recovery_digest(&completion["evidenceDigest"]))
            {
                return Err(refresh_error(
                    "Reconciliation history unavailable. Refresh evidence and try again.".into(),
                ));
            }
            let mut state = model.borrow_mut();
            if !state.data["reconciliations"].is_object() {
                state.data["reconciliations"] = json!({});
            }
            state.data["reconciliations"][job] = result;
            if action != Action::LoadReconciliations {
                state.notice =
                    "HOLD evidence retained. Execution remains held; replay is not permitted."
                        .into();
            }
        }
        Action::InspectExecutionRequest
        | Action::OlderExecutionEvents
        | Action::OlderExecutionRequests
        | Action::CancelExecutionRequest => {
            let project = super::project_id(model)?;
            if action == Action::CancelExecutionRequest {
                api(
                    model,
                    "POST",
                    &format!("/api/execution-jobs/{}/cancel", segment(id)),
                    Some(fields),
                    None,
                )
                .await?;
                load(model).await?;
                model.borrow_mut().notice = "Execution request cancelled.".into();
            } else {
                let path = match action {
                    Action::OlderExecutionRequests => format!(
                        "/api/projects/{}/execution-jobs?cursor={}",
                        segment(&project),
                        segment(s(&model.borrow().data["executionPage"]["nextCursor"]))
                    ),
                    Action::OlderExecutionEvents => format!(
                        "/api/execution-jobs/{}?cursor={}",
                        segment(id),
                        segment(s(
                            &model.borrow().data["executionDetails"][id]["nextCursor"]
                        ))
                    ),
                    _ => format!("/api/execution-jobs/{}", segment(id)),
                };
                let result = api(model, "GET", &path, None, None).await?;
                let mut state = model.borrow_mut();
                if action == Action::OlderExecutionRequests {
                    state.data["executionPage"] = result;
                } else {
                    if !state.data["executionDetails"].is_object() {
                        state.data["executionDetails"] = json!({});
                    }
                    state.data["executionDetails"][id] = result;
                }
            }
        }
        _ => return Err("Unknown execution action".into()),
    }
    Ok(())
}

pub(super) fn execution_review_panel(data: &Value, job: &Value, actor: &Value) -> String {
    let id = s(&job["id"]);
    let mut html = button("export-execution-record", "Export execution record", id);
    html.push_str(&button("load-execution-attempts", "Execution attempts", id));
    let attempts = &data["executionAttempts"][id];
    if attempts.is_object() {
        html.push_str(&format!("<section class=\"execution-journal\"><h4>Retained execution journal</h4><p>Evidence scope: {}. Retained evidence grants no execution authority.</p>",e(&attempts["evidenceScope"])));
        if array(attempts, "attempts").is_empty() {
            html.push_str("<p>No execution attempts.</p>");
        } else {
            html.push_str(&format!(
                "<label for=\"attempt-{id}\">Retained attempt</label><select id=\"attempt-{id}\">",
                id = escape(id)
            ));
            for attempt in array(attempts, "attempts") {
                html.push_str(&format!(
                    "<option value=\"{}\">Generation {} · {}</option>",
                    e(&attempt["id"]),
                    e(&attempt["generation"]),
                    e(&attempt["state"])
                ));
            }
            html.push_str("</select>");
            html.push_str(&button("open-execution-attempt", "Open attempt", id));
        }
        if attempts["nextCursor"].is_string() {
            html.push_str(&button("older-execution-attempts", "Older attempts", id));
        }
        let detail = &data["executionJournal"][id];
        if detail.is_object() {
            html.push_str(&format!(
                "<p>Attempt {} · Generation {} · {}</p><p>Approved source context: {}</p>",
                e(&detail["attempt"]["id"]),
                e(&detail["attempt"]["generation"]),
                e(&detail["attempt"]["state"]),
                if detail["approvedPlanContext"]["available"] == true {
                    "available"
                } else {
                    "unavailable"
                }
            ));
            html.push_str("<h5>Attempt events</h5>");
            html.push_str(&records(
                array(detail, "events"),
                &[
                    ("revision", "Revision"),
                    ("phase", "Phase"),
                    ("ordinal", "Ordinal"),
                    ("statementDigest", "Statement SHA-256"),
                    ("approvedContext", "Approved source"),
                    ("reasonCode", "Reason code"),
                ],
            ));
            if detail["nextEventsCursor"].is_string() {
                html.push_str(&button("next-attempt-events", "More attempt events", id));
            }
            html.push_str("<h5>Receipts</h5>");
            html.push_str(&records(
                array(detail, "receipts"),
                &[
                    ("ordinal", "Ordinal"),
                    ("statementDigest", "Statement SHA-256"),
                    ("receiptDigest", "Receipt SHA-256"),
                    ("centralEvidenceDigest", "Central evidence SHA-256"),
                    ("approvedContext", "Approved source"),
                ],
            ));
            if detail["nextReceiptsCursor"].is_string() {
                html.push_str(&button("next-attempt-receipts", "More receipts", id));
            }
        }
        html.push_str("</section>");
    }
    if job["state"] != "HOLD" {
        return html;
    }
    html.push_str(&button("load-reconciliations", "HOLD evidence review", id));
    let review = &data["reconciliations"][id];
    if !review.is_object() {
        return html;
    }
    html.push_str("<section class=\"hold-review\"><h4>HOLD evidence review</h4><p>Evidence review retains HOLD. It does not attest database effects or permit replay.</p><p>Submit a SHA-256 digest only. Do not paste SQL, credentials or evidence files.</p>");
    if review["recoveredCompletion"].is_object() {
        html.push_str(&format!(
            "<aside aria-label=\"Verified recovery\"><strong>Migration effects verified by recovery</strong><p>The installed verifier confirmed the complete migration effects and original receipts after independent review. This request stays on HOLD and cannot be replayed. Continue with a new plan and approval; its target checks still apply.</p><p>Recovery evidence SHA-256 {}</p></aside>",
            e(&review["recoveredCompletion"]["evidenceDigest"])
        ));
    }
    let author = array(data, "plans")
        .iter()
        .find(|p| p["id"] == job["planId"])
        .map(|p| p["authorId"].clone())
        .unwrap_or(Value::Null);
    for row in array(review, "reconciliations") {
        let submission = s(&row["id"]);
        html.push_str(&format!(
            "<article><h5>Evidence {}</h5><p>{} · {}</p><p>Submitted by {}</p><p>{}</p>",
            e(&row["id"]),
            e(&row["evidenceKind"]),
            e(&row["evidenceDigest"]),
            e(&row["submitterId"]),
            e(&row["reason"])
        ));
        if row["decision"].is_object() {
            html.push_str(&format!(
                "<p>Decision: {} · {}</p><p>{}</p>",
                e(&row["decision"]["decision"]),
                e(&row["decision"]["reviewerId"]),
                e(&row["decision"]["reason"])
            ));
            if review["recoveredCompletion"].is_object()
                && row["id"].is_string()
                && review["recoveredCompletion"]["reconciliationId"] == row["id"]
            {
                html.push_str("<p>This review is linked to the verified recovery above.</p>");
            }
        } else if job["state"] == "HOLD"
            && actor["role"] == "approver"
            && !s(&actor["id"]).is_empty()
            && !s(&author).is_empty()
            && actor["id"] != row["submitterId"]
            && actor["id"] != job["requesterId"]
            && actor["id"] != author
            && data["project"]["archivedAt"].is_null()
        {
            html.push_str(&input(
                &format!("hold-review-reason-{submission}"),
                "HOLD review reason",
                "text",
                true,
            ));
            let key = format!("{id}/{submission}");
            html.push_str(&button("retain-hold-evidence", "Retain HOLD", &key));
            html.push_str(&button(
                "review-hold-evidence",
                "Mark evidence reviewed",
                &key,
            ));
        }
        html.push_str("</article>");
    }
    if job["state"] == "HOLD"
        && data["canDeploy"] == true
        && data["project"]["archivedAt"].is_null()
    {
        html.push_str(&format!("<label for=\"hold-kind-{id}\">Evidence kind</label><select id=\"hold-kind-{id}\"><option value=\"TARGET_LEDGER\">Target ledger</option><option value=\"TARGET_OBSERVATION\">Target observation</option><option value=\"OPERATOR_REPORT\">Operator report</option></select>",id=escape(id)));
        html.push_str(&input(
            &format!("hold-digest-{id}"),
            "Evidence SHA-256",
            "text",
            true,
        ));
        html.push_str(&input(
            &format!("hold-reason-{id}"),
            "Evidence reason",
            "text",
            true,
        ));
        html.push_str(&button("submit-hold-evidence", "Submit evidence", id));
    }
    html.push_str("</section>");
    html
}
