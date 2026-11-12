variable "name" {
  description = "Name prefix for storage resources."
  type        = string
}

variable "account_id" {
  description = "AWS account ID, used to make the bucket name unique."
  type        = string
}

variable "tags" {
  description = "Common tags."
  type        = map(string)
  default     = {}
}
