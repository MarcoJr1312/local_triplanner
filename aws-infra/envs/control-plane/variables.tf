variable "region" {
  type    = string
  default = "us-east-1"
}

variable "project" {
  type    = string
  default = "triplanner"
}

variable "github_repo" {
  description = "GitHub repository owner/repo that hosts the wake/sleep workflows."
  type        = string
}

variable "github_owner_id" {
  description = "Immutable numeric GitHub owner id. GitHub includes it in OIDC sub claims (`owner@id/repo@id`)."
  type        = string
  default     = ""
}

variable "github_repo_id" {
  description = "Immutable numeric GitHub repository id, used with github_owner_id in OIDC sub claims."
  type        = string
  default     = ""
}

variable "alb_name" {
  description = "ALB name created by the app stack."
  type        = string
  default     = "triplanner-alb"
}

variable "target_group_name" {
  description = "Web target group name created by the app stack."
  type        = string
  default     = "triplanner-web"
}

variable "tags" {
  type = map(string)
  default = {
    Project   = "triplanner"
    ManagedBy = "terraform"
    Stack     = "control-plane"
  }
}
