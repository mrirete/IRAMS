#!/bin/bash
set -e

# Configuration
VERSION="1.0.0"
OUTPUT_DIR="./dist/airgapped-ers-v${VERSION}"
IMAGE_TAR="${OUTPUT_DIR}/ers-images.tar"

# List of services to export
SERVICES=(
  "api-gateway"
  "data-fabric"
  "predict"
  "analyze"
  "comply"
  "vision"
  "work"
  "agents"
  "frontend"
)

# 1. Prepare Directory
echo "Preparing export directory at ${OUTPUT_DIR}..."
mkdir -p "${OUTPUT_DIR}/helm"

# 2. Build or Pull required images (Assuming local registry or built via compose)
echo "Ensuring all images are built locally..."
docker-compose -f ../docker/docker-compose.yml build

# 3. Export Docker Images
echo "Exporting images to ${IMAGE_TAR}..."
docker save \
  postgres:15-alpine \
  redis:7-alpine \
  neo4j:5-community \
  minio/minio \
  internal.registry/ers/api-gateway:latest \
  internal.registry/ers/data-fabric:latest \
  internal.registry/ers/predict:latest \
  internal.registry/ers/analyze:latest \
  internal.registry/ers/comply:latest \
  internal.registry/ers/vision:latest \
  internal.registry/ers/work:latest \
  internal.registry/ers/agents:latest \
  internal.registry/ers/frontend:latest \
  > "${IMAGE_TAR}"

# 4. Package Helm Chart
echo "Packaging Helm Chart..."
helm package ../helm/ers-platform -d "${OUTPUT_DIR}/helm"

# 5. Archive
echo "Compressing deployment bundle..."
tar -czvf "ers-airgapped-bundle-v${VERSION}.tar.gz" "${OUTPUT_DIR}"

echo "Export Complete: ers-airgapped-bundle-v${VERSION}.tar.gz"
