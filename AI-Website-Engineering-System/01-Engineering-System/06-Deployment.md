# Deployment Engineering

## Purpose

This document defines the deployment architecture, infrastructure patterns, release strategies, and operational controls that govern how code moves from development to production within AI-WEOS. It establishes the engineering discipline required to ship software reliably, reversibly, and with minimal human intervention.

## Scope

This document covers:

- Environment architecture and promotion hierarchy
- CI/CD pipeline design and automation rules
- Infrastructure as Code standards
- Deployment strategies (blue-green, canary, rolling)
- Release orchestration and sequencing
- Monitoring, alerting, and observability in deployment context
- Rollback and recovery procedures
- Security scanning and compliance gates
- Configuration management across environments
- Database migration coordination
- Edge and CDN deployment patterns
- Scalability and auto-scaling rules

This document does not cover:

- Application architecture patterns (belongs to Architecture Engineering)
- Frontend build tooling configuration (belongs to Frontend Engineering)
- Backend service implementation (belongs to Backend Engineering)
- Incident response procedures beyond deployment rollback (belongs to Incident Management)
- Cost optimization strategies (belongs to Platform Economics)

## Core Principles

**Immutable Infrastructure**
Deployed artifacts are never modified in place. Any change, no matter how small, triggers a new deployment from a clean build. Servers are replaced, not patched.

**Deployability Is a Feature**
A system that cannot be deployed safely and quickly is incomplete. Deployment constraints influence architecture decisions, not the reverse.

**Every Deployment Must Be Reversible**
The rollback path is part of the deployment. If you cannot roll back within five minutes, you have not completed the deployment.

**Pipeline as Code**
Every CI/CD step is defined in version-controlled configuration. The pipeline is subject to the same review, testing, and change management as application code.

**Parity Across Environments**
Development, staging, and production differ only in scale and secrets. Any environment-specific behavior is a bug waiting to manifest in production.

## Engineering Philosophy

Deployment is not a step that happens after development. Deployment is a continuous process that begins with the first commit. Every engineer who writes code is participating in the deployment system, whether they acknowledge it or not.

The deployment pipeline is the primary control surface for software quality. If a defect reaches production, the pipeline failed, not the developer. Engineering investment in pipeline reliability yields compounding returns across every team and every release.

Treat production as a sacred environment that no human should directly access. All changes flow through automated pipelines. All investigations happen through observability tools. Direct production access is a temporary emergency measure that must be justified, logged, and eliminated through automation.

## Decision Framework

When architecting or modifying the deployment system, evaluate decisions against this sequence:

1. **Safety** — Does this change increase or decrease the risk of a production incident?
2. **Speed** — Does this change reduce the time from commit to production?
3. **Visibility** — Does this change improve our ability to observe deployment state?
4. **Simplicity** — Does this change reduce the number of moving parts?
5. **Cost** — Does the benefit justify the infrastructure and operational cost?

### Decision Matrix

| Deployment Strategy | Risk Profile | Rollback Speed | Infrastructure Cost | Use When |
|---|---|---|---|---|
| Rolling Update | Low | Slow (per-instance) | None additional | Stateless services, low-risk changes |
| Blue-Green | Very Low | Instant (switch traffic) | 2x production | Database schema changes, high-risk releases |
| Canary | Lowest | Instant (shift traffic back) | Small increment | User-facing changes, performance validation |
| Recreate | High | Medium (redeploy old version) | None additional | Non-critical batch services only |

### Strategy Selection Rules

Use **Blue-Green** when:
- The release includes database migrations
- Backward compatibility between versions cannot be guaranteed
- The service has strict uptime requirements

Use **Canary** when:
- The change affects user-facing behavior
- Performance impact is unknown
- A/B feature validation is required
- Gradual rollout is acceptable to stakeholders

Use **Rolling Update** when:
- The service is stateless
- Multiple instances already exist
- The change is backward compatible
- The deployment is low-risk (configuration change, patch)

Never use **Recreate** for user-facing services.

## Standards

### Environment Architecture

The environment hierarchy is fixed and non-negotiable:

```
Development (dev)
  └── Integration (int)
       └── Staging (stg)
            └── Production (prd)
```

**Development (dev):**

| Attribute | Value |
|---|---|
| Purpose | Active development and initial integration |
| Stability | Unstable, frequent breaking changes |
| Data | Synthetic, seeded, non-sensitive |
| Access | All engineers with push access |
| Scale | Minimal, shared resources acceptable |
| Monitoring | Best-effort, not paged |

**Integration (int):**

| Attribute | Value |
|---|---|
| Purpose | Automated testing, cross-service integration validation |
| Stability | Ephemeral, created per feature branch or PR |
| Data | Sanitized production sample or generated |
| Access | CI/CD systems only |
| Scale | Auto-provisioned, auto-destroyed |
| Monitoring | Pipeline results only |

**Staging (stg):**

| Attribute | Value |
|---|---|
| Purpose | Pre-production validation, stakeholder review |
| Stability | Production-like, maintained continuously |
| Data | Anonymized production mirror (refreshed weekly) |
| Access | Release managers, CI/CD systems |
| Scale | Matches production topology at reduced capacity |
| Monitoring | Full observability stack, non-critical alerting |

**Production (prd):**

| Attribute | Value |
|---|---|
| Purpose | Live user traffic |
| Stability | Five-nines target |
| Data | Live production data |
| Access | CI/CD systems only (emergency access via break-glass process) |
| Scale | Full production capacity with auto-scaling |
| Monitoring | Full observability, critical alerting, 24/7 paging |

### CI/CD Pipeline Architecture

The pipeline consists of mandatory sequential gates. No gate can be skipped. Failure at any gate halts the pipeline.

```
Commit → Build → Static Analysis → Unit Tests → Integration Tests → 
Security Scan → Artifact Publication → Deploy to Staging → 
Smoke Tests → Approval Gate → Deploy to Production → Health Checks → 
Post-Deployment Validation
```

**Gate Definitions:**

**Build** *(timeout: 15 minutes)*
- Compile application from source
- Generate static assets
- Build container images
- Output: Immutable artifact with semantic version tag

**Static Analysis** *(timeout: 10 minutes)*
- Linting (all languages)
- Type checking
- Code style enforcement
- Dependency vulnerability scan (fail on critical/high)
- Secret detection (fail immediately, revoke detected secrets)

**Unit Tests** *(timeout: 15 minutes)*
- Execute all unit tests
- Coverage threshold: 80% minimum (configurable per module)
- No flaky test exceptions (flaky tests must be fixed or removed)

**Integration Tests** *(timeout: 30 minutes)*
- Deploy to ephemeral integration environment
- Execute cross-service contract tests
- Validate API schemas
- Database migration dry-run

**Security Scan** *(timeout: 20 minutes)*
- SAST (Static Application Security Testing)
- Container image vulnerability scan
- Dependency license compliance check
- Infrastructure as Code security validation
- Fail on critical or high severity findings

**Artifact Publication** *(timeout: 10 minutes)*
- Push container image to registry with immutable tag
- Push static assets to CDN origin
- Generate deployment manifest
- Sign artifact for integrity verification

**Deploy to Staging** *(timeout: 30 minutes)*
- Apply infrastructure changes via IaC
- Deploy new artifact version
- Run database migrations
- Execute service health checks
- Warm caches if applicable

**Smoke Tests** *(timeout: 15 minutes)*
- Critical path user journey tests
- API endpoint availability
- Third-party integration connectivity
- Data read/write validation

**Approval Gate** *(timeout: 4 hours, after which deployment is cancelled)*
- Manual approval for production deployment
- Required approvers: Release manager + One senior engineer
- Auto-approved for hotfix pipeline (different approver set)

**Deploy to Production** *(timeout: 45 minutes)*
- Execute chosen deployment strategy
- Apply database migrations with transaction verification
- Gradual traffic shift per strategy rules
- Continuous health check monitoring during rollout

**Health Checks** *(timeout: 5 minutes, continuous monitoring extends beyond)*
- All service endpoints return 200
- Latency within 2x baseline
- Error rate below threshold (0.1% or configured baseline)
- CPU/Memory within expected ranges
- Database connection pool healthy

**Post-Deployment Validation**
- Synthetic user journey monitoring (15 minutes)
- Real user monitoring comparison against baseline
- Business metric validation (conversion rate, transaction volume)
- Log anomaly detection
- Auto-rollback trigger if anomaly score exceeds threshold

### Infrastructure as Code Standards

All infrastructure is defined in declarative configuration files stored in the same repository as application code or a dedicated infrastructure repository.

**Tooling:**
- Primary: Terraform or OpenTofu for cloud resources
- Kubernetes resources: Helm charts or Kustomize
- Configuration management: Environment-specific variable files, never hardcoded

**Module Requirements:**
- Every resource belongs to a module
- Modules accept variables, output standard attributes
- Modules are versioned independently
- Breaking module changes require major version bump
- Module README documents inputs, outputs, and dependencies

**State Management:**
- Remote state storage with locking
- State file encrypted at rest
- State access restricted to CI/CD service accounts
- State versioning enabled for rollback
- Never store secrets in state (use secret references)

**Drift Detection:**
- Scheduled drift detection runs daily
- Drift alerts to platform engineering
- Automatic drift reconciliation in development and integration
- Manual drift reconciliation in staging and production

### Container Image Standards

- Base images: Official, pinned by SHA256 digest, never by `:latest`
- Multi-stage builds to minimize image size
- Non-root user for runtime (USER directive)
- Health check defined (HEALTHCHECK directive)
- Labels: `org.opencontainers.image.source`, `version`, `commit_sha`, `build_timestamp`
- Image scanning at build time and continuously on registry
- Retention policy: Last 10 production images, last 5 staging, last 3 others

### Configuration Management

Configuration is strictly separated from code by tier:

| Tier | Contains | Managed In |
|---|---|---|
| Build-time configuration | Compile-time constants, feature flag default values, embedded resource paths | Application code |
| Deploy-time configuration | Environment-specific variables, service endpoints/URLs, resource allocations (CPU, memory) | Environment variable files in IaC repository |
| Runtime configuration | Feature flags (dynamic), rate limits, circuit breaker thresholds | Feature flag service or configuration service |
| Secrets | Credentials, API keys, tokens | Never in environment variables directly — retrieved from secrets manager at runtime or injected via CSI driver, rotated automatically per policy, access logged and audited |

### Database Migration Standards

Migrations are part of the deployment pipeline, not a separate process.

- All migrations must be reversible (define both `up` and `down`)
- Migrations run automatically as a deployment step
- Migrations must be backward compatible with the previous application version
- No long-running migrations in production (use online schema change tools for large tables)
- Migration transactions must not span multiple DDL statements
- Migration pre-flight check validates current schema state
- Rollback runs `down` migration to exact previous version
- Database backup snapshot captured immediately before production migration

## Best Practices

**Deploy During Low-Traffic Windows**
Align production deployments with traffic patterns. Deploy when user activity is lowest and engineering support is fully available. Default: weekday mornings, avoiding Friday deployments unless critical.

**Feature Flags Decouple Deploy from Release**
Deploy code dark. Activate features via flags after deployment validation. This separates the technical act of deployment from the business act of release. An unreleased feature that causes issues can be disabled without rollback.

**Immutable Tagging**
Every artifact receives an immutable tag: `<semver>-<git-short-sha>-<timestamp>`. Never overwrite tags. Never use `latest` in production. The deployed version is always uniquely identifiable.

**Deployment Runbooks**
Every service has a documented runbook covering: deployment steps, health check endpoints, rollback procedure, known failure modes, and escalation contacts. Runbooks live alongside code in the repository.

**Pipeline Observability**
The pipeline itself is monitored. Pipeline duration, failure rate per stage, and mean time to recovery are tracked metrics. A slow or flaky pipeline is a production issue.

**Disaster Recovery Drills**
Execute full environment recreation from IaC and backups quarterly. A recovery process that has never been tested does not exist.

## Workflow

### Standard Release Workflow

1. Developer merges feature branch to main after review
2. CI pipeline triggers automatically on merge
3. Pipeline executes Build through Security Scan gates
4. Artifact is published and tagged
5. Deployment to staging proceeds automatically
6. Smoke tests execute against staging
7. Automated notification sent to release channel with staging results
8. Release manager approves production deployment
9. Canary deployment begins (5% traffic, monitor 10 minutes)
10. If canary healthy, expand to 50% traffic (monitor 5 minutes)
11. If 50% healthy, expand to 100% traffic
12. Post-deployment validation runs for 15 minutes
13. If all checks pass, deployment marked complete
14. Release notes auto-generated and published

### Hotfix Workflow

1. Create hotfix branch from production tag
2. Implement fix, create PR directly to main
3. Hotfix pipeline triggers (expedited, reduced test suite)
4. Senior engineer approval required (auto-notified)
5. Deploy to staging, smoke test (10 minutes)
6. Auto-approve production deployment if staging passes
7. Deploy with accelerated canary (5% → 50% in 2 minutes, 50% → 100% in 3 minutes)
8. Extended post-deployment monitoring (30 minutes)
9. Retrospective required within 24 hours

### Rollback Workflow

**Automatic Rollback (triggered by monitoring):**
1. Anomaly score exceeds threshold during canary
2. Traffic shifted back to previous version
3. Deployment marked as failed
4. Incident ticket auto-created
5. Team notified immediately
6. Previous version artifacts retained, no data loss

**Manual Rollback (triggered by engineer):**
1. Rollback command issued via deployment tool
2. Traffic shifted to previous version
3. Database down migration executed
4. Health checks verify previous state
5. Incident ticket created
6. Post-mortem scheduled

**Rollback Safety Rules:**
- Database down migration must have been tested in staging
- No data created by new version can be lost (soft delete, append-only, or backfill)
- Previous version artifacts must be immediately available (never garbage collected before 30 days)
- Rollback must complete within 5 minutes of decision

### Environment Provisioning Workflow

**New Service:**
1. Define IaC module for service infrastructure
2. Define CI/CD pipeline for service
3. Define monitoring dashboards and alerts
4. Provision in development
5. Validate in integration (ephemeral)
6. Provision in staging
7. Run 24-hour soak test in staging
8. Provision in production during maintenance window
9. Enable traffic gradually per deployment strategy

**Environment Teardown (non-production):**
1. Integration environments auto-destroyed after PR merge or close
2. Staging persists indefinitely
3. Development persists indefinitely
4. All teardowns must release cloud resources completely (no orphaned resources)

## Common Mistakes

**Database Migration in Same Transaction as Code Deployment**
Code deployment and migration execution are separate steps. Deploy migrations first (backward compatible), verify, then deploy new code. Coupling them in one atomic step eliminates rollback options.

**Environment-Specific Code Paths**
`if (environment === 'production')` is a code smell that guarantees staging does not represent production. Use configuration injection instead. The code should be identical across environments.

**Long-Lived Feature Branches Without Integration**
Branches that diverge from main for weeks create deployment risk. Merge conflicts compound. Integration testing becomes meaningless. Deploy to integration environments from feature branches daily.

**Manual Deployment Steps**
Every manual step is a future incident. If a step cannot be automated today, document it as technical debt with a deadline. Manual steps that persist become tribal knowledge that departs with the engineer.

**Deploying Without Observing**
Deploy and walk away is negligence. Every deployment must be actively observed through the canary and post-deployment phases. Alert fatigue is not an excuse to disable deployment monitoring.

**Neglecting Down Migration Testing**
Everyone tests the `up` migration. Almost nobody tests the `down` migration. When rollback is required, the untested down migration fails, extending the incident. Down migrations must pass automated testing in CI.

**Stale Staging Environments**
A staging environment that diverges from production configuration invalidates all pre-production testing. Automated drift detection and weekly environment refresh are mandatory.

**Insufficient Resource Headroom for Blue-Green**
Blue-green requires 2x production capacity during deployment. Teams that size for steady-state and attempt blue-green exhaust resources mid-deployment. Size for deployment, not steady-state.

## Quality Checklist

Before any production deployment:

- [ ] All pipeline gates passed (build, test, scan, staging smoke tests)
- [ ] Database migrations tested with production-scale data volume
- [ ] Down migrations verified in staging
- [ ] Rollback plan documented and artifacts available
- [ ] Feature flags configured correctly (new features dark if needed)
- [ ] Monitoring dashboards updated for new/changed metrics
- [ ] Alert thresholds reviewed and adjusted
- [ ] Runbook reviewed and accessible
- [ ] Deployment window communicated to stakeholders
- [ ] On-call engineer aware of deployment and available
- [ ] Previous version artifacts verified as healthy fallback
- [ ] Secrets rotated if deployment involves credential changes
- [ ] CDN cache invalidation plan ready if static assets changed
- [ ] Third-party API rate limits accommodate deployment traffic shifts
- [ ] Load balancer health check configuration matches new version

Before marking deployment complete:

- [ ] Canary metrics within baseline for 10 minutes
- [ ] Full rollout metrics within baseline for 5 minutes
- [ ] Synthetic transactions succeeding
- [ ] Error rate within acceptable threshold
- [ ] Business metrics stable (orders, signups, etc.)
- [ ] No unusual log patterns
- [ ] Database performance nominal
- [ ] Cache hit rates stable
- [ ] External dependency health confirmed

## AI Decision Rules

**Rule 1: Deployment Strategy Selection**
- IF change includes database migration THEN strategy = blue-green
- IF change is user-facing AND performance-sensitive THEN strategy = canary
- IF change is configuration-only THEN strategy = rolling-update
- IF service is stateless AND has multiple instances THEN strategy = rolling-update
- DEFAULT strategy = blue-green for production

**Rule 2: Pipeline Failure Response**
- IF failure in Build, Static Analysis, or Unit Tests THEN notify committer, block merge
- IF failure in Integration Tests THEN notify committer and team lead, block merge
- IF failure in Security Scan (critical/high) THEN notify security team, block deployment, create Jira ticket
- IF failure in Staging Deployment THEN notify release manager, halt release
- IF failure in Smoke Tests THEN rollback staging, notify team
- IF failure in Production Health Checks THEN auto-rollback, page on-call engineer

**Rule 3: Rollback Automation**
- IF canary metrics show error rate > 2x baseline for > 2 minutes THEN auto-rollback
- IF canary metrics show p95 latency > 3x baseline for > 3 minutes THEN auto-rollback
- IF health check failure count > 3 in 1 minute THEN auto-rollback
- IF database CPU > 90% sustained for 5 minutes post-deployment THEN auto-rollback
- IF auto-rollback triggered THEN create P1 incident, page on-call, preserve all logs

**Rule 4: Environment Promotion**
- CODE promotes: dev → (pass tests) → int → (pass tests) → stg → (pass tests + approval) → prd
- ARTIFACT promotes: built once, same SHA deployed to all environments
- CONFIG promotes: environment-specific values injected at each level
- SECRETS never promote: each environment has independent secrets

**Rule 5: Migration Safety**
- WHEN creating database migration THEN include DOWN migration
- WHEN migration modifies existing column THEN ensure previous app version still functions
- WHEN migration adds NOT NULL column THEN provide default value
- WHEN migration drops column THEN first deploy version that ignores column, then deploy migration
- WHEN migration changes data format THEN run backfill job before deploying new code

**Rule 6: CDN Deployment**
- WHEN static assets change THEN deploy to CDN before application deployment
- WHEN assets are fingerprinted (content hash in filename) THEN set `cache-control: max-age=31536000, immutable`
- WHEN assets are not fingerprinted THEN set `cache-control: max-age=3600, must-revalidate`
- WHEN deploying new application version THEN invalidate CDN for non-fingerprinted assets only
- IF CDN invalidation fails THEN halt application deployment

**Rule 7: Environment Parity Validation**
- WHEN any environment configuration changes THEN validate parity within 24 hours
- IF staging differs from production in resource allocation THEN flag for review
- IF staging uses different database engine version THEN flag as blocking for next release
- IF staging secrets differ in format (not value) from production THEN fix immediately

**Rule 8: Deployment Window Enforcement**
- IF deployment is high-risk (migration, major version, infrastructure change) THEN deploy within defined maintenance window
- IF deployment is standard feature release THEN deploy during business hours with full team availability
- IF deployment is hotfix THEN deploy immediately with accelerated process
- IF deployment is on Friday THEN require explicit senior engineer override
- IF deployment is during holiday or team offsite THEN block unless P1 incident

**Rule 9: Artifact Retention**
- KEEP production artifacts for 30 days minimum
- KEEP staging artifacts for 14 days
- KEEP integration artifacts for 7 days
- DELETE development artifacts after 3 days
- TAG all production deployments with `prd-YYYYMMDD-HHMMSS` for audit trail

**Rule 10: Monitoring and Alerting During Deployment**
- WHEN deployment begins THEN increase monitoring frequency to 10-second intervals
- WHEN canary completes successfully THEN resume normal 60-second intervals
- IF alert fires during deployment window THEN correlate with deployment metrics
- IF correlation coefficient > 0.7 between deployment and alert THEN flag deployment as probable cause
- IF post-deployment anomaly score > threshold THEN auto-rollback and notify

## Examples

### Blue-Green Deployment Sequence

```
State: Blue (v1.4.2) serving 100% production traffic

1. Deploy Green (v1.5.0) to parallel infrastructure
2. Run database migrations on primary (backward compatible)
3. Run smoke tests against Green internal endpoint
4. Health checks: all Green instances healthy
5. Shift 1% traffic to Green, monitor 2 minutes
6. If healthy, shift 100% traffic to Green
7. Green is now production
8. Blue remains available as rollback target
9. After 30 minutes of stable Green, drain Blue connections
10. Blue infrastructure decommissioned after 24 hours

Rollback (if needed before step 10):
- Shift 100% traffic back to Blue
- Down migration on database
- Blue is production again
- Duration: < 2 minutes
```

### Canary Deployment Configuration

```yaml
deployment:
  strategy: canary
  canary:
    steps:
      - traffic: 5%
        duration: 600s
        metrics:
          - error_rate_ratio: 2.0
          - latency_p95_ratio: 1.5
          - cpu_usage_max: 80
      - traffic: 25%
        duration: 300s
        metrics:
          - error_rate_ratio: 1.5
          - latency_p95_ratio: 1.3
      - traffic: 100%
        duration: 0s
    auto_rollback: true
    rollback_threshold_seconds: 120
```

### Pipeline Configuration (Conceptual)

```yaml
pipeline:
  name: service-deploy
  triggers:
    - branch: main
    - branch: hotfix/*
  stages:
    - name: build
      timeout: 15m
      on_failure: notify_committer
    - name: test
      timeout: 25m
      on_failure: notify_committer
      parallel:
        - unit_tests
        - lint
        - type_check
    - name: security
      timeout: 20m
      on_failure: notify_security_team
      steps:
        - sast_scan
        - container_scan
        - dependency_check
        - secret_detection
    - name: deploy_staging
      timeout: 30m
      on_failure: notify_release_manager
    - name: smoke_test
      timeout: 15m
      on_failure: rollback_staging
    - name: approval
      type: manual
      approvers: [release_manager, senior_engineer]
      timeout: 4h
    - name: deploy_production
      timeout: 45m
      strategy: canary
      on_failure: auto_rollback
      on_rollback: page_oncall
    - name: post_deploy_validation
      timeout: 15m
      on_failure: evaluate_rollback
```

### Rollback Command Example

```bash
# Execute rollback to previous version
deploy rollback --service=checkout-api \
                --environment=production \
                --to-version=v2.3.1 \
                --reason="Latency spike detected, incident INC-4829" \
                --auto-down-migrate=true

# System response:
# [1/4] Shifting traffic from v2.4.0 to v2.3.1... DONE
# [2/4] Running down migration 014_revert_index... DONE
# [3/4] Health check v2.3.1 instances... ALL HEALTHY
# [4/4] Rollback complete in 47 seconds
# Incident INC-4829 updated
# On-call engineer notified: rollback successful
```

## Summary

Deployment engineering is the discipline of moving software to production safely, repeatably, and reversibly. It is not an afterthought or a separate team's responsibility. The deployment pipeline is the primary quality gate, the safety net, and the acceleration mechanism for the entire engineering organization.

Immutable infrastructure, automated pipelines, environment parity, and progressive delivery strategies form the technical foundation. But the operating principle is simpler: every deployment must be boring. Boring deployments are predictable, well-practiced, and uneventful. Excitement during deployment is a failure of preparation.

The rollback path is non-negotiable. Deployments that cannot be reversed are incomplete by definition. Database migrations, configuration changes, and infrastructure modifications must all support reversal. This constraint shapes architecture decisions across the entire system.

Monitoring is not separate from deployment. Deployment is a monitored event with defined entry and exit criteria, baseline comparisons, and automatic safety triggers. The system watches itself and intervenes faster than any human operator could.

AI decision rules in this document encode the deterministic logic for deployment safety at scale. They ensure consistency across services, teams, and time. When a decision must be made in the critical seconds of a canary analysis, there is no time for deliberation. The rules must already exist.
