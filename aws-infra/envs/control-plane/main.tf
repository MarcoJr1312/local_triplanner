module "control_plane" {
  source = "../../modules/control-plane"

  name              = var.project
  aws_region        = var.region
  github_repo       = var.github_repo
  alb_name          = var.alb_name
  target_group_name = var.target_group_name
  tags              = var.tags
}

module "registry" {
  source = "../../modules/registry"

  name         = var.project
  repositories = ["web", "api", "agent"]
  tags         = var.tags
}
