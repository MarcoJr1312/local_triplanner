variable "name" {
  description = "Name prefix for the control plane."
  type        = string
}

variable "aws_region" {
  type = string
}

variable "github_repo" {
  description = "GitHub repository in owner/repo form."
  type        = string
}

variable "schedule_expression" {
  description = "EventBridge schedule for the idle check."
  type        = string
  default     = "rate(5 minutes)"
}

variable "idle_minutes" {
  description = "Minutes without traffic before sleep."
  type        = number
  default     = 30
}

variable "alb_name" {
  description = "ALB name used by the sleep checker."
  type        = string
}

variable "target_group_name" {
  description = "Target group name used by the sleep checker."
  type        = string
}

variable "log_retention_days" {
  type    = number
  default = 7
}

variable "tags" {
  type    = map(string)
  default = {}
}
