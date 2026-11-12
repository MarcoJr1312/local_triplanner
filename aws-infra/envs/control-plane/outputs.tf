output "wake_url" {
  description = "POST this URL to trigger the wake workflow."
  value       = module.control_plane.wake_url
}

output "control_table_name" {
  value = module.control_plane.control_table_name
}

output "github_token_secret_arn" {
  value = module.control_plane.github_token_secret_arn
}

output "ecr_repository_urls" {
  value = module.registry.repository_urls
}
