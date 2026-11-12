output "alb_dns_name" {
  description = "ALB DNS name. Update the Cloudflare CNAME after every wake."
  value       = module.ingress.alb_dns_name
}

output "alb_zone_id" {
  value = module.ingress.alb_zone_id
}

output "ecs_cluster_name" {
  value = module.ecs.cluster_name
}

output "ecs_service_names" {
  value = {
    web   = module.ecs.web_service_name
    api   = module.ecs.api_service_name
    agent = module.ecs.agent_service_name
  }
}

output "rds_endpoint" {
  value = module.data.db_endpoint
}

output "dynamodb_table_name" {
  value = module.data.dynamodb_table_name
}

output "uploads_bucket_name" {
  value = module.storage.uploads_bucket_name
}

output "private_app_subnet_ids" {
  value = module.network.private_app_subnet_ids
}

output "api_security_group_id" {
  value = module.network.api_security_group_id
}

output "api_task_definition_arn" {
  value = module.ecs.task_definition_arns["api"]
}

output "secret_arns" {
  value     = module.storage.secret_arns
  sensitive = true
}
