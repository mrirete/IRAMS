provider "google" {
  project = var.project_id
  region  = var.region
}

resource "google_container_cluster" "ers" {
  name     = "ers-gke-cluster"
  location = var.region
  
  remove_default_node_pool = true
  initial_node_count       = 1
}

resource "google_container_node_pool" "primary" {
  name       = "ers-node-pool"
  cluster    = google_container_cluster.ers.name
  location   = var.region
  node_count = 3

  node_config {
    machine_type = "e2-standard-4" # Solid balance for memory/CPU constraints
    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform"
    ]
  }
}

resource "google_sql_database_instance" "ers" {
  name             = "ers-postgres-instance"
  database_version = "POSTGRES_15"
  region           = var.region

  settings {
    tier = "db-custom-4-16384" # 4 vCPUs, 16GB RAM
  }
}

resource "google_redis_instance" "ers" {
  name           = "ers-redis"
  memory_size_gb = 5
  region         = var.region
}

resource "google_storage_bucket" "ers" {
  name          = "ers-assets-${var.project_id}"
  location      = var.region
  force_destroy = true

  uniform_bucket_level_access = true
}
