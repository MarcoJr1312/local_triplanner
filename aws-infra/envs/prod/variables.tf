variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "triplanner"
}

variable "certificate_arn" {
  description = "ACM certificate ARN for HTTPS. Empty means HTTP-only demo."
  type        = string
  default     = ""
}

variable "web_image" {
  description = "ECR image for the Next.js web service."
  type        = string
}

variable "api_image" {
  description = "ECR image for the Bun GraphQL API."
  type        = string
}

variable "agent_image" {
  description = "ECR image for the Python agent."
  type        = string
}

variable "desired_count" {
  description = "Tasks per service. 0 while asleep; 1 during a demo."
  type        = number
  default     = 0
}

variable "firebase_project_id" {
  type = string
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "tags" {
  type = map(string)
  default = {
    Project   = "triplanner"
    ManagedBy = "terraform"
    Stack     = "prod"
  }
}
