variable "name" {
  description = "Name prefix for ingress resources."
  type        = string
}

variable "vpc_id" {
  description = "VPC ID."
  type        = string
}

variable "public_subnet_ids" {
  description = "Public subnets for the ALB."
  type        = list(string)
}

variable "alb_security_group_id" {
  description = "Security group for the ALB."
  type        = string
}

variable "certificate_arn" {
  description = "Optional ACM certificate ARN. When empty, HTTP forwards directly (demo only)."
  type        = string
  default     = ""
}

variable "health_check_path" {
  description = "ALB target group health check path."
  type        = string
  default     = "/login"
}

variable "tags" {
  description = "Common tags."
  type        = map(string)
  default     = {}
}
