variable "name" {
  description = "Name prefix for ECR repositories."
  type        = string
}

variable "repositories" {
  description = "Repository suffixes to create."
  type        = list(string)
  default     = ["web", "api", "agent"]
}

variable "tags" {
  description = "Common tags."
  type        = map(string)
  default     = {}
}
