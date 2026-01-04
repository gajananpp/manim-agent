# CI/CD Setup Guide

This document provides a comprehensive guide for setting up and managing the CI/CD pipeline for the Supervity Agents Workspace using GitHub Actions and Azure AKS.

## Overview

The CI/CD pipeline consists of several workflows:

1. **CI (Continuous Integration)** - Builds, tests, and scans code
2. **CD (Continuous Deployment)** - Deploys to staging
3. **Rollback** - Provides quick rollback capabilities
4. **Cleanup** - Maintains clean environments and removes old resources
5. **Security Scan** - Comprehensive security scanning

## Prerequisites

### Azure Resources
- Azure AKS cluster
- Azure Container Registry (optional, using GitHub Container Registry)
- Resource Group containing the AKS cluster

### GitHub Secrets

You need to configure the following secrets in your GitHub repository:

#### Azure Credentials
```
AZURE_ACR_SP (Service Principal JSON for ACR)
AZURE_AKS_SP (Service Principal JSON for AKS)
AZURE_RESOURCE_GROUP
AZURE_AKS_CLUSTER_NAME
AZURE_CONTAINER_REGISTRY (optional)
```

#### Application Secrets - Staging
```
POSTGRES_PASSWORD
REDIS_PASSWORD
MINIO_ROOT_USER
MINIO_ROOT_PASSWORD
QDRANT_API_KEY
JUPYTER_SVC_TOKEN
OPENAI_API_KEY
ENCRYPTION_KEY
DATABASE_URL
KEYCLOAK_URL
KEYCLOAK_REALM
KEYCLOAK_CLIENT_ID
S3_ENDPOINT
S3_ACCESS_KEY_ID
S3_SECRET_ACCESS_KEY
S3_REGION
S3_BUCKET
REDIS_URL
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
SECRET_KEY
QDRANT_URL
```

#### Application Secrets - Production
Production environment is not used. Only staging secrets are required.

## Workflow Details

### 1. CI Workflow (`.github/workflows/ci.yml`)

**Triggers:**
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop` branches

**Jobs:**
- **Test**: Runs linting, formatting, and tests
- **Build and Push**: Builds Docker images for all services
- **Security Scan**: Scans container images for vulnerabilities

### 2. CD Workflow (`.github/workflows/cd.yml`)

**Triggers:**
- Push to `main` branch (deploys to staging)
- Manual workflow dispatch

**Deployment Strategy:**
- **Staging**: Automatic deployment on push to main

**Services Deployed:**
1. Infrastructure dependencies (PostgreSQL, Redis, MinIO, Qdrant, Temporal)
2. Application services (workflow, integration, workflow-executor, external-tools, jupyter)

### 3. Rollback Workflow (`.github/workflows/rollback.yml`)

**Features:**
- Manual rollback to previous or specific revision
- Environment selection (staging)
- Service-specific rollback
- Verification after rollback

### 4. Cleanup Workflow (`.github/workflows/cleanup.yml`)

**Features:**
- Scheduled cleanup of old container images
- Manual cleanup of Kubernetes resources
- Dry-run capability
- Resource usage reporting

### 5. Security Scan Workflow (`.github/workflows/security-scan.yml`)

**Features:**
- Daily security scans
- Dependency vulnerability scanning
- Container image scanning
- Code quality analysis
- Secret detection
- Infrastructure security checks

## Setup Instructions

### 1. Configure Azure Service Principal

Use the provided Bun script to create a service principal for GitHub Actions:

```bash
# Run the setup script
bun run tools/setup-azure-service-principal.ts
```

This script will:
- Check if Azure CLI is installed and you're logged in
- Prompt for your resource group and AKS cluster name
- Create a service principal with the necessary permissions
- Generate a secrets template file for easy reference

Copy the output JSON and add it as `AZURE_AKS_SP` (for AKS) and `AZURE_ACR_SP` (for ACR) secrets in GitHub.

### 2. Configure GitHub Secrets

1. Go to your repository settings
2. Navigate to "Secrets and variables" → "Actions"
3. Add all required secrets listed above

### 3. Set up GitHub Environments

Create two environments in GitHub:
- `staging`
- `production`

Configure protection rules as needed (required reviewers, deployment branches, etc.).

### 4. Configure AKS Cluster

Ensure your AKS cluster has:
- Helm installed
- Sufficient resources for all services
- Network policies configured (if needed)
- RBAC properly configured

## Deployment Process

### Automatic Deployments

1. **Staging**: Automatically deploys when code is pushed to `main` branch

### Manual Deployments

Use the workflow dispatch feature:
1. Go to Actions tab
2. Select the CD workflow
3. Click "Run workflow"
4. Choose environment and services

### Rollback Process

1. Go to Actions tab
2. Select the Rollback workflow
3. Click "Run workflow"
4. Choose environment, service, and revision

## Monitoring and Troubleshooting

### Health Checks

All services include health checks:
- HTTP services: `/health` endpoint
- gRPC services: TCP socket check
- Temporal workers: Process-based check

### Logs

Access logs using kubectl:
```bash
# Get pod logs
kubectl logs -n supervity-agents-workspace-staging deployment/workflow

# Follow logs
kubectl logs -n supervity-agents-workspace-staging deployment/workflow -f
```

### Common Issues

1. **Image Pull Errors**: Check container registry permissions
2. **Pod Startup Failures**: Check environment variables and secrets
3. **Service Connectivity**: Verify service names and ports
4. **Resource Limits**: Check if pods have sufficient resources

## Security Considerations

1. **Secrets Management**: All sensitive data is stored in GitHub Secrets
2. **Container Security**: Images are scanned for vulnerabilities
3. **Network Security**: Services use ClusterIP for internal communication
4. **RBAC**: Proper role-based access control is configured
5. **Non-root Users**: All containers run as non-root users

## Best Practices

1. **Version Control**: Always use semantic versioning for releases
2. **Testing**: Ensure all tests pass before deployment
3. **Monitoring**: Set up monitoring and alerting for production
4. **Backup**: Regular backups of databases and persistent volumes
5. **Documentation**: Keep deployment documentation updated

## Troubleshooting Commands

### Using the Validation Script

The easiest way to validate your deployment is using the provided Bun script:

```bash
# Validate staging deployment
bun run tools/validate-deployment.ts --namespace supervity-agents-workspace-staging --timeout 600 --verbose
```

### Manual Commands

```bash
# Check pod status
kubectl get pods -n supervity-agents-workspace-staging

# Check service status
kubectl get svc -n supervity-agents-workspace-staging

# Check Helm releases
helm list -n supervity-agents-workspace-staging

# Check Helm history
helm history workflow -n supervity-agents-workspace-staging

# Describe pod for detailed info
kubectl describe pod <pod-name> -n supervity-agents-workspace-staging

# Check events
kubectl get events -n supervity-agents-workspace-staging --sort-by='.lastTimestamp'
```

## Available Tools

The following Bun scripts are available in the `tools/` directory:

### `setup-azure-service-principal.ts`
Creates an Azure service principal for GitHub Actions authentication.

```bash
bun run tools/setup-azure-service-principal.ts
```

### `deploy.ts`
Enhanced deployment script for CI/CD pipelines with full TypeScript support, environment handling, and comprehensive logging.

```bash
bun run tools/deploy.ts [options]
```

Options:
- `-n, --namespace`: Kubernetes namespace (default: supervity-agents-workspace-staging)
- `-e, --environment`: Environment: staging (default: staging)
- `-t, --image-tag`: Docker image tag (default: git commit SHA)
- `--skip-infrastructure`: Skip infrastructure deployment
- `--skip-application`: Skip application deployment
- `-v, --verbose`: Enable verbose output
- `-h, --help`: Show help message

### `deploy-kubeadm-docker-desktop.ts`
Original deployment script for local development with kubeadm or Docker Desktop Kubernetes.

```bash
bun run tools/deploy-kubeadm-docker-desktop.ts
```

This script uses environment variables and is designed for local development environments. It's the original version before CI/CD enhancements.

**When to use which script:**
- **`deploy.ts`**: Use for CI/CD pipelines, production deployments, and when you need advanced features like environment-specific secrets, image tagging, or selective deployment
- **`deploy-kubeadm-docker-desktop.ts`**: Use for local development with kubeadm or Docker Desktop Kubernetes when you want the simple, original deployment approach

### `validate-deployment.ts`
Validates that all services are running correctly after deployment.

```bash
bun run tools/validate-deployment.ts [options]
```

Options:
- `-n, --namespace`: Kubernetes namespace (default: supervity-agents-workspace-staging)
- `-t, --timeout`: Timeout in seconds (default: 300)
- `-v, --verbose`: Enable verbose output
- `-h, --help`: Show help message

## Support

For issues related to CI/CD:
1. Check the GitHub Actions logs
2. Use the validation script to diagnose issues
3. Review the deployment issue template
4. Contact the DevOps team
5. Check the troubleshooting section above
