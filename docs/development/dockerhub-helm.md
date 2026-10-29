# Direct Docker Hub and Helm development delivery

The temporary development path is **successful source CI → verified OCI archive →
public Docker Hub digest → direct Helm release**. It does not require Argo CD,
a Docker daemon on the operator workstation, a new database, or GitOps credentials.
The default local password sign-in remains available; LDAP and Keycloak OIDC are
optional additional methods.

## Publish a tested image

Run the existing source, product, OCI and CodeQL gates before publication. The
publisher accepts only the current successful master revision and the exact OCI run
and attempt selected by those gates. It verifies all archive blobs and both platform
configurations, preserves digests during transfer, refuses a conflicting immutable
tag, and verifies the result anonymously. It never updates a chart or a cluster.

The private operator prepares a standard registry auth file outside Git. Do not put
passwords or tokens in command arguments, Helm values, screenshots or output files.
Supply GitHub API access through `GITHUB_TOKEN` in the process environment:

```sh
node scripts/publish-dockerhub.mjs \
  --source-sha VERIFIED_MASTER_SHA \
  --oci-run SUCCESSFUL_OCI_RUN_ID --oci-attempt RUN_ATTEMPT \
  --archive /private/download/kelryvo-app.tar \
  --repository docker.io/YOUR_NAMESPACE/kelryvo-app \
  --authfile /private/docker-auth.json \
  --report /private/dockerhub-publication.json
```

The optional **Kelryvo verified Docker Hub publication** manual workflow performs
the same steps from master using `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` repository
Secrets. Its `repository` input is explicit; no cluster credentials are needed.
Local publication can use an existing private registry credential file without
uploading that credential to GitHub.

## Deploy directly with Helm

Use the sibling `kelryvo-helm-chart` repository and its direct-deployment/identity
instructions. Set `image.repository` and the immutable `image.digest` from the
successful publication report. A public image may use `imagePullSecret: ''`.
Store live namespace, endpoint, CIDR and Secret references in an ignored private
values file, not the application checkout or public evidence.

An existing Argo-created installation has no Helm release history. Its first direct
Helm operation is an intentional ownership adoption: inventory the exact app, ingress,
network policies, PostgreSQL and PVC identities; compare the rendered persistent
specifications with live objects; retain the old resources and obtain the required
independent deployment review. Do not delete the namespace, database, PVC, Argo CD,
or any shared identity provider. Do not use force replacement, uninstall, automatic
rollback or a cascading Argo Application deletion to repair adoption.

Temporarily annotate only the Kelryvo Application with
`argocd.argoproj.io/skip-reconcile: 'true'` after verifying its identity and paused
automatic sync. This is the documented [Argo reconciliation pause](https://argo-cd.readthedocs.io/en/stable/user-guide/skip_reconcile/).
The direct Helm call uses an explicit context/namespace and `--take-ownership` only
for the independently reviewed first adoption; see [Helm ownership adoption](https://helm.sh/docs/v3/topics/advanced/).

Automatic GHCR-to-chart promotion is now opt-in: the legacy delivery workflow runs
only when repository variable `KELRYVO_DELIVERY_MODE` equals `gitops`. Leaving that
variable unset keeps this direct path independent. This changes deployment automation,
not source, test, image verification, CodeQL or security gates. Restore GitOps only
after reviewing the current chart/values and ensuring there is a single reconciler.

## LDAP and Keycloak

The chart's optional identity setting references an existing Secret containing
`identity-runtime.json`. It projects only that key alongside the five app bootstrap
files. The private runtime file supplies the HTTPS public origin, stable encryption
key, pinned TLS routes, CA material, and opaque client/bind secret references.
Never put the file's raw secret values into chart values or a ConfigMap.

Reuse existing LDAP and Keycloak services. Keycloak uses a confidential OIDC client,
authorization-code flow, PKCE S256, and the exact callback
`https://YOUR_APP_HOST/api/auth/oidc/callback`; wildcard redirects and email/group
auto-linking are not used. LDAP requires verified LDAPS and an explicit service bind,
base DN and immutable `entryUUID`. The [Keycloak administration guide](https://www.keycloak.org/docs/latest/server_admin/)
describes client configuration and optional LDAP user federation. Direct LDAP and
Keycloak login are separate Kelryvo provider choices; LDAP federation through Keycloak
is optional and does not replace the app's subject-to-local-actor mapping.

The trusted container operator grants identity configuration capability to an existing
actor with `node scripts/container-identity-admin.mjs grant developer`. In **Identity
providers**, select a trusted route, configure the provider by secret reference, map
its external subject to an existing local actor, then enable it. Keep existing roles,
project grants, local passwords, provider IDs and mappings during upgrades.

Validate local password, LDAP and OIDC login for both intended roles after rollout.
Also check invalid LDAP rejection, ordinary approver configuration denial, session
cleanup and retained projects/jobs/HOLDs. Successful deployment or a provider connection
test alone does not prove an interactive SSO login or Oracle execution acceptance.
