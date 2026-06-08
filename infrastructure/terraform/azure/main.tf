provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "ers" {
  name     = "ers-resources"
  location = var.location
}

resource "azurerm_kubernetes_cluster" "ers" {
  name                = "ers-aks-cluster"
  location            = azurerm_resource_group.ers.location
  resource_group_name = azurerm_resource_group.ers.name
  dns_prefix          = "ers-aks"

  default_node_pool {
    name       = "default"
    node_count = 3
    vm_size    = "Standard_DS3_v2" # Compute optimal for models
  }

  identity {
    type = "SystemAssigned"
  }
}

resource "azurerm_postgresql_flexible_server" "ers" {
  name                = "ers-postgres"
  resource_group_name = azurerm_resource_group.ers.name
  location            = azurerm_resource_group.ers.location
  version             = "15"
  administrator_login = "ers_admin"
  administrator_password = var.db_password
  storage_mb          = 131072 # 128GB
  sku_name            = "GP_Standard_D4s_v3"
}

resource "azurerm_redis_cache" "ers" {
  name                = "ers-redis"
  location            = azurerm_resource_group.ers.location
  resource_group_name = azurerm_resource_group.ers.name
  capacity            = 2
  family              = "C"
  sku_name            = "Standard"
  enable_non_ssl_port = false
}

resource "azurerm_storage_account" "ers" {
  name                     = "ersstorage${var.environment}"
  resource_group_name      = azurerm_resource_group.ers.name
  location                 = azurerm_resource_group.ers.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
}
