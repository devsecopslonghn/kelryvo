//! Closed UI action vocabulary and direct feature dispatch.
use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(super) enum Action {
    Account,
    AddDraftFile,
    AddPlanComment,
    AnalyzeMigrations,
    ApplyDraftReconciliation,
    Approve,
    ArchiveProject,
    AssignInstanceSchemas,
    AssignPlanReviewer,
    AttachInstance,
    BindingAssignment,
    BindingEvidence,
    BindingWorkspace,
    CancelExecutionRequest,
    CaptureRetainedBaseline,
    CaptureSchemaBaseline,
    ChangePassword,
    ChangeReviewScope,
    ChooseConnectionProject,
    ChooseInstanceProject,
    ClaimPlanReview,
    ClearSchemaObjectFilters,
    CloseSchemaSnapshot,
    CompareDraftRevisions,
    ComparePlanSource,
    CompareRetainedReleases,
    CompareRetainedSchema,
    CompareSchemaSnapshots,
    Connections,
    CreateDeploymentProfile,
    CreateDraft,
    CreateEnvironment,
    CreateIdentityProvider,
    CreatePlan,
    CreateProject,
    CreateValidatedPlan,
    CreateWorkspacePlan,
    DiscardDraftEdits,
    DiscoverInstance,
    DiscoverProjectConnection,
    ExecutionReadiness,
    ExportExecutionRecord,
    ExportPlanRecord,
    FilterAudit,
    FilterMigrationHistory,
    FilterPlanStatus,
    FilterProjectConnections,
    Identity,
    ImportGitRelease,
    InspectBinding,
    InspectDraftConflict,
    InspectExecutionRequest,
    InspectTarget,
    InstanceObservations,
    Instances,
    LdapLogin,
    LinkIdentity,
    LoadExecutionAttempts,
    LoadLatestDraft,
    LoadPlanComments,
    LoadPlanComparisons,
    LoadPlanDrift,
    LoadPlanReviewers,
    LoadReconciliations,
    LoadTargetSchema,
    Login,
    Logout,
    LookupIdentity,
    ManagedLifecycle,
    ManagedPreflight,
    MoreAccountAccess,
    MoreAccountSessions,
    MoreAssignedSchemas,
    MoreConnectionTargets,
    MoreMigrationSql,
    MoreProjectConnectionHistory,
    MoreProjectConnections,
    MoreReviewInbox,
    MoreSchemaBaselines,
    MoreSchemaConnections,
    MoreSchemaReferences,
    MoreSchemaSnapshots,
    MoreSchemaTargets,
    MoreTargetBindings,
    MoreTargetOptions,
    NewDraft,
    NewerMigrationHistory,
    NextAttemptEvents,
    NextAttemptReceipts,
    ObserveSchemaEvidence,
    ObserveTarget,
    ObserveTargetSchema,
    OidcLogin,
    OlderAudit,
    OlderExecutionAttempts,
    OlderExecutionEvents,
    OlderExecutionRequests,
    OlderMigrationHistory,
    OlderSchemaBaselines,
    OlderSchemaSnapshots,
    OlderSqlDrafts,
    OpenDraft,
    OpenDraftSource,
    OpenExecutionAttempt,
    OpenHistoryPlan,
    OpenHistoryRequest,
    OpenIdentityProvider,
    OpenInboxPlan,
    OpenManagedConnection,
    OpenOriginatingDraft,
    OpenPlanComparison,
    OpenRelease,
    OpenRetainedSchema,
    OpenSchemaSnapshot,
    ParseSql,
    PrepareRelease,
    PreviewReleaseFile,
    Project,
    ProjectConnectionHistory,
    ProjectNextStep,
    Projects,
    RecordConnectionTarget,
    RefreshAccount,
    RefreshAudit,
    RefreshGitRefs,
    RefreshInstanceProfiles,
    RefreshMigrationHistory,
    RefreshPlanList,
    RefreshProjectConnections,
    RefreshReviewInbox,
    RefreshSchema,
    RefreshSchemaReferences,
    RefreshTargets,
    RefreshWorkspace,
    RegisterDiscoveryConnection,
    RegisterInstance,
    RegisterManualReference,
    Reject,
    RemoveDraftFile,
    RequestExecution,
    RetainHoldEvidence,
    RetireInstanceProfile,
    RetireProjectConnection,
    Review,
    ReviewDraftSyntax,
    ReviewHoldEvidence,
    ReviewPlanSql,
    RevokeAccountSession,
    RevokeIdentity,
    RevokeInstance,
    RotateInstance,
    SaveDraft,
    SaveIdentityProvider,
    SaveManagedConfiguration,
    SaveProjectSource,
    SaveTargetBinding,
    SchemaToHistory,
    SchemaToPlans,
    SchemaToWorkspace,
    SelectSchemaTarget,
    Setup,
    SubmitHoldEvidence,
    SwitchProject,
    Tab,
    TargetEvidence,
    TestIdentityProvider,
    TestInstance,
    TestProjectConnection,
    TokenLogin,
    UndoDraftRemove,
    ValidateDraft,
    ValidatePlanRelease,
    VerifyConnectionTarget,
    VerifyTarget,
    ViewPlanValidation,
    WithdrawPlanApproval,
}

pub(super) async fn dispatch(
    model: &Model,
    name: &str,
    id: &str,
    fields: Value,
) -> Result<(), String> {
    let action: Action = serde_json::from_value(json!(name)).map_err(|_| "Unknown action")?;
    match action {
        Action::SwitchProject => shell::switch(model, id).await?,
        Action::RefreshWorkspace => {
            let project = model.borrow().data["projectId"].as_str().map(str::to_owned);
            if matches!(model.borrow().route, Route::Instances)
                && let Some(project) = project
            {
                load_instance_project(model, &project).await?;
            } else {
                load(model).await?;
            }
        }
        Action::SelectSchemaTarget
        | Action::RefreshSchema
        | Action::MoreSchemaTargets
        | Action::MoreSchemaConnections
        | Action::MoreSchemaSnapshots
        | Action::MoreSchemaBaselines
        | Action::OpenRetainedSchema
        | Action::CloseSchemaSnapshot
        | Action::ClearSchemaObjectFilters
        | Action::CompareRetainedSchema
        | Action::CaptureRetainedBaseline
        | Action::ObserveSchemaEvidence
        | Action::SchemaToWorkspace
        | Action::SchemaToPlans
        | Action::SchemaToHistory => schema_baselines::action(model, action, id).await?,
        Action::RefreshSchemaReferences | Action::MoreSchemaReferences => {
            schema_references::action(model, action).await?
        }
        Action::RetireInstanceProfile | Action::RefreshInstanceProfiles => {
            instance_profiles::action(model, action, id, fields).await?
        }
        Action::ProjectNextStep => project_next_step::navigate(model).await?,
        Action::RecordConnectionTarget
        | Action::VerifyConnectionTarget
        | Action::MoreConnectionTargets
        | Action::ChooseConnectionProject
        | Action::RegisterManualReference
        | Action::RegisterDiscoveryConnection
        | Action::FilterProjectConnections
        | Action::MoreProjectConnections
        | Action::RefreshProjectConnections
        | Action::ProjectConnectionHistory
        | Action::MoreProjectConnectionHistory
        | Action::TestProjectConnection
        | Action::DiscoverProjectConnection
        | Action::RetireProjectConnection => connections::action(model, action, id, fields).await?,
        Action::FilterAudit | Action::RefreshAudit | Action::OlderAudit => {
            audit::action(model, action, id).await?
        }
        Action::FilterPlanStatus => plan_list::filter(model, id)?,
        Action::RefreshPlanList => load(model).await?,
        Action::RefreshAccount
        | Action::MoreAccountAccess
        | Action::MoreAccountSessions
        | Action::RevokeAccountSession => account::action(model, action, id, fields).await?,
        Action::BindingAssignment
        | Action::SaveTargetBinding
        | Action::RefreshTargets
        | Action::MoreTargetOptions
        | Action::MoreTargetBindings
        | Action::MoreAssignedSchemas
        | Action::InspectBinding
        | Action::BindingEvidence
        | Action::BindingWorkspace => target_bindings::action(model, action, id, fields).await?,
        Action::AnalyzeMigrations | Action::MoreMigrationSql => {
            migration_analysis::action(model, action, id).await?
        }
        Action::CreateIdentityProvider
        | Action::OpenIdentityProvider
        | Action::SaveIdentityProvider
        | Action::LinkIdentity
        | Action::RevokeIdentity
        | Action::LookupIdentity
        | Action::TestIdentityProvider
        | Action::OidcLogin
        | Action::LdapLogin => identity::action(model, action, id, fields).await?,
        Action::SaveProjectSource
        | Action::CreateDeploymentProfile
        | Action::OpenManagedConnection
        | Action::SaveManagedConfiguration
        | Action::ManagedPreflight
        | Action::ManagedLifecycle => configuration::action(model, action, id, fields).await?,
        Action::OpenRelease
        | Action::PreviewReleaseFile
        | Action::CompareRetainedReleases
        | Action::RefreshGitRefs
        | Action::ImportGitRelease => releases::action(model, action, id, fields).await?,
        Action::FilterMigrationHistory
        | Action::OlderMigrationHistory
        | Action::NewerMigrationHistory
        | Action::RefreshMigrationHistory
        | Action::OpenHistoryRequest => {
            migration_history::action(model, action, id, fields).await?
        }
        Action::RefreshReviewInbox
        | Action::MoreReviewInbox
        | Action::ChangeReviewScope
        | Action::OpenInboxPlan => review_inbox::action(model, action, id).await?,
        Action::OpenOriginatingDraft => draft_editor::open_origin(model, fields).await?,
        Action::Projects
        | Action::Project
        | Action::Tab
        | Action::Account
        | Action::Instances
        | Action::Connections
        | Action::Review
        | Action::Identity => {
            model.borrow_mut().route = match action {
                Action::Project => Route::Project(id.into(), "overview".into()),
                Action::Tab => {
                    let (id, tab) = id.split_once('/').ok_or("Invalid project")?;
                    Route::Project(id.into(), tab.into())
                }
                Action::Account => Route::Account,
                Action::Instances => Route::Instances,
                Action::Connections => Route::Connections,
                Action::Review => Route::Review,
                Action::Identity => Route::Identity,
                _ => Route::Projects,
            };
            load(model).await?;
        }
        Action::CreateProject => projects::create(model, fields).await?,
        Action::ArchiveProject => project_lifecycle::archive(model, fields).await?,
        Action::CreateEnvironment => {
            let project = super::project_id(model)?;
            let suffix = "environments";
            api(
                model,
                "POST",
                &format!("/api/projects/{}/{suffix}", segment(&project)),
                Some(fields),
                None,
            )
            .await?;
            load(model).await?;
        }
        Action::ParseSql => {
            model.borrow_mut().data["previewSource"] = fields["sql"].clone();
            let parsed = api(model, "POST", "/api/parser/oracle", Some(fields), None).await?;
            model.borrow_mut().data["parsed"] = parsed;
        }
        Action::AddDraftFile
        | Action::RemoveDraftFile
        | Action::UndoDraftRemove
        | Action::DiscardDraftEdits
        | Action::InspectDraftConflict
        | Action::ApplyDraftReconciliation
        | Action::LoadLatestDraft
        | Action::ReviewDraftSyntax
        | Action::ValidateDraft
        | Action::CompareDraftRevisions
        | Action::OpenDraftSource => {
            draft_editor::action(model, action, id, fields).await?;
        }
        Action::OpenHistoryPlan
        | Action::ValidatePlanRelease
        | Action::ViewPlanValidation
        | Action::CreatePlan
        | Action::CreateValidatedPlan
        | Action::CreateWorkspacePlan
        | Action::ReviewPlanSql
        | Action::ExportPlanRecord
        | Action::ExportExecutionRecord
        | Action::LoadPlanComments
        | Action::AddPlanComment
        | Action::ComparePlanSource
        | Action::LoadPlanComparisons
        | Action::OpenPlanComparison
        | Action::LoadPlanReviewers
        | Action::AssignPlanReviewer
        | Action::ClaimPlanReview
        | Action::WithdrawPlanApproval
        | Action::LoadPlanDrift
        | Action::Approve
        | Action::Reject => plans::action(model, action, id, fields).await?,
        Action::ExecutionReadiness
        | Action::RequestExecution
        | Action::LoadExecutionAttempts
        | Action::OlderExecutionAttempts
        | Action::OpenExecutionAttempt
        | Action::NextAttemptEvents
        | Action::NextAttemptReceipts
        | Action::LoadReconciliations
        | Action::SubmitHoldEvidence
        | Action::RetainHoldEvidence
        | Action::ReviewHoldEvidence
        | Action::InspectExecutionRequest
        | Action::OlderExecutionEvents
        | Action::OlderExecutionRequests
        | Action::CancelExecutionRequest => execution::action(model, action, id, fields).await?,
        Action::LoadTargetSchema
        | Action::OlderSchemaSnapshots
        | Action::OlderSchemaBaselines
        | Action::OpenSchemaSnapshot
        | Action::CaptureSchemaBaseline
        | Action::CompareSchemaSnapshots
        | Action::ObserveTargetSchema
        | Action::InspectTarget
        | Action::ObserveTarget
        | Action::VerifyTarget
        | Action::TargetEvidence => target_bindings::action(model, action, id, fields).await?,
        Action::AssignInstanceSchemas
        | Action::AttachInstance
        | Action::TestInstance
        | Action::DiscoverInstance
        | Action::InstanceObservations
        | Action::ChooseInstanceProject
        | Action::RegisterInstance
        | Action::RotateInstance
        | Action::RevokeInstance => instances::action(model, action, id, fields).await?,
        Action::Login
        | Action::TokenLogin
        | Action::Setup
        | Action::ChangePassword
        | Action::Logout => account::action(model, action, id, fields).await?,
        Action::OpenDraft
        | Action::NewDraft
        | Action::OlderSqlDrafts
        | Action::PrepareRelease
        | Action::CreateDraft
        | Action::SaveDraft => draft_editor::action(model, action, id, fields).await?,
    }
    Ok(())
}
