#!/bin/bash
set -e

# Configuration
BUNDLE_DIR=$(dirname "$0")
LOCAL_REGISTRY="localhost:5000"
NAMESPACE="ers-production"

echo "=== ERS Offline Installer ==="

# 1. Load Images into local Docker daemon
echo "[1/4] Loading docker images from tar archive..."
docker load -i "${BUNDLE_DIR}/ers-images.tar"

# 2. Tag and Push to local offline registry (if cluster uses one)
echo "[2/4] Tagging and pushing to local Air-Gapped registry (${LOCAL_REGISTRY})..."
IMAGES=$(docker images --format "{{.Repository}}:{{.Tag}}" | grep "internal.registry/ers")

for IMAGE in $IMAGES; do
  NEW_TAG=$(echo $IMAGE | sed "s|internal.registry|${LOCAL_REGISTRY}|g")
  docker tag $IMAGE $NEW_TAG
  docker push $NEW_TAG
done

# We also tag the public images (postgres, redis, neo4j) to the local registry
for BASE_IMG in "postgres:15-alpine" "redis:7-alpine" "neo4j:5-community" "minio/minio:latest"; do
  docker tag $BASE_IMG "${LOCAL_REGISTRY}/${BASE_IMG}"
  docker push "${LOCAL_REGISTRY}/${BASE_IMG}"
done

# 3. Deploy Helm Chart
echo "[3/4] Deploying Helm Chart to Kubernetes..."
kubectl create namespace ${NAMESPACE} || true

helm upgrade --install ers-platform "${BUNDLE_DIR}/helm/ers-platform-1.0.0.tgz" \
  --namespace ${NAMESPACE} \
  --set global.registry="${LOCAL_REGISTRY}" \
  --wait

echo "[4/4] ERS Platform Offline Installation Complete."
echo "Check status with: kubectl get pods -n ${NAMESPACE}"
