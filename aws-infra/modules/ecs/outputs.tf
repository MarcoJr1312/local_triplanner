output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "namespace" {
  value = aws_service_discovery_private_dns_namespace.this.name
}

output "web_service_name" {
  value = aws_ecs_service.web.name
}

output "api_service_name" {
  value = aws_ecs_service.api.name
}

output "agent_service_name" {
  value = aws_ecs_service.agent.name
}

output "task_definition_arns" {
  value = {
    web   = aws_ecs_task_definition.web.arn
    api   = aws_ecs_task_definition.api.arn
    agent = aws_ecs_task_definition.agent.arn
  }
}
