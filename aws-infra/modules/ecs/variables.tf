variable "name" {
  description = "Name prefix for ECS resources."
  type        = string
}

variable "aws_region" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_app_subnet_ids" {
  type = list(string)
}

variable "web_security_group_id" {
  type = string
}

variable "api_security_group_id" {
  type = string
}

variable "agent_security_group_id" {
  type = string
}

variable "alb_target_group_arn" {
  type = string
}

variable "web_image" {
  type = string
}

variable "api_image" {
  type = string
}

variable "agent_image" {
  type = string
}

variable "desired_count" {
  description = "Desired tasks per service. 0 when the demo is asleep."
  type        = number
  default     = 0
}

variable "db_host" {
  type = string
}

variable "db_port" {
  type = number
}

variable "db_name" {
  type = string
}

variable "db_secret_arn" {
  type      = string
  sensitive = true
}

variable "dynamodb_table" {
  type = string
}

variable "s3_bucket" {
  type = string
}

variable "firebase_project_id" {
  type = string
}

variable "secret_arns" {
  description = "Map of logical secret name to Secrets Manager ARN."
  type        = map(string)
  sensitive   = true
}

variable "log_retention_days" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
