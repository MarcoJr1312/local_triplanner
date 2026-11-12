data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

module "network" {
  source = "../../modules/network"

  name                      = var.project
  vpc_cidr                  = "10.0.0.0/16"
  azs                       = local.azs
  public_subnet_cidrs       = ["10.0.0.0/24", "10.0.1.0/24"]
  private_app_subnet_cidrs  = ["10.0.10.0/24", "10.0.11.0/24"]
  private_data_subnet_cidrs = ["10.0.20.0/24", "10.0.21.0/24"]
  tags                      = var.tags
}

module "data" {
  source = "../../modules/data"

  name                    = var.project
  private_data_subnet_ids = module.network.private_data_subnet_ids
  rds_security_group_id   = module.network.rds_security_group_id
  instance_class          = var.db_instance_class
  tags                    = var.tags
}

module "storage" {
  source = "../../modules/storage"

  name       = var.project
  account_id = data.aws_caller_identity.current.account_id
  tags       = var.tags
}

module "ingress" {
  source = "../../modules/ingress"

  name                  = var.project
  vpc_id                = module.network.vpc_id
  public_subnet_ids     = module.network.public_subnet_ids
  alb_security_group_id = module.network.alb_security_group_id
  certificate_arn       = var.certificate_arn
  health_check_path     = "/login"
  tags                  = var.tags
}

module "ecs" {
  source = "../../modules/ecs"

  name                    = var.project
  aws_region              = var.region
  vpc_id                  = module.network.vpc_id
  private_app_subnet_ids  = module.network.private_app_subnet_ids
  web_security_group_id   = module.network.web_security_group_id
  api_security_group_id   = module.network.api_security_group_id
  agent_security_group_id = module.network.agent_security_group_id
  alb_target_group_arn    = module.ingress.target_group_arn

  web_image     = var.web_image
  api_image     = var.api_image
  agent_image   = var.agent_image
  desired_count = var.desired_count

  db_host             = module.data.db_endpoint
  db_port             = module.data.db_port
  db_name             = module.data.db_name
  db_secret_arn       = module.data.db_master_user_secret_arn
  dynamodb_table      = module.data.dynamodb_table_name
  s3_bucket           = module.storage.uploads_bucket_name
  firebase_project_id = var.firebase_project_id
  secret_arns         = module.storage.secret_arns

  tags = var.tags
}
