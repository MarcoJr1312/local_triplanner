variable "region" {
  description = "AWS region for the Terraform state bucket."
  type        = string
  default     = "us-east-1"
}

variable "project" {
  description = "Project name used in the state bucket name."
  type        = string
  default     = "triplanner"
}
