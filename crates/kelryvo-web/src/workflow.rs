//! Presentation and request binding only. The server remains the authority.
#[cfg(target_arch = "wasm32")]
use serde_json::{Value, json};

#[cfg(target_arch = "wasm32")]
pub(crate) fn plan_body(validation: &Value) -> Value {
    let report = &validation["report"];
    let target = &report["target"];
    json!({"intentVersion":3,"releaseId":report["releaseId"],"assignmentId":target["assignmentId"],"expectedAssignmentRevision":target["assignmentRevision"],"targetBindingId":target["bindingId"],"expectedBindingRevision":target["bindingRevision"],"validationId":validation["id"],"expectedValidationDigest":validation["digest"]})
}

pub(crate) fn execution_status(state: &str) -> (&'static str, &'static str) {
    match state {
        "WAITING_VALIDATION" => ("Queued", "Waiting for independent worker admission."),
        "ADMITTED" => (
            "Running",
            "A protected worker owns this request. Inspect its evidence for progress.",
        ),
        "VERIFIED_SUCCESS" => (
            "Completed",
            "The worker verified execution evidence and postconditions.",
        ),
        "NOOP" => (
            "Completed · no changes",
            "The approved migrations were already applied. No SQL was dispatched.",
        ),
        "HOLD" => (
            "HOLD · investigation required",
            "The outcome requires reconciliation. Do not replay SQL or treat this as a retryable failure.",
        ),
        "CANCELLED" => ("Cancelled", "This waiting request was cancelled."),
        _ => (
            "Unknown · inspect evidence",
            "No execution outcome can be inferred from this state.",
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uncertain_and_unknown_execution_states_never_look_completed_or_retryable() {
        for state in ["HOLD", "FAILED", "", "future-state"] {
            let (label, explanation) = execution_status(state);
            assert!(!label.starts_with("Completed"));
            assert!(!explanation.contains("Retry this"));
        }
        assert!(execution_status("HOLD").1.contains("Do not replay"));
        assert!(execution_status("NOOP").1.contains("No SQL was dispatched"));
    }
}
