variable "name" {
  description = "Name prefix for network resources."
  type        = string
}

variable "vpc_cidr" {
  description = "VPC CIDR block."
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "Two availability zones."
  type        = list(string)
}

variable "public_subnet_cidrs" {
  description = "Public subnet CIDRs (one per AZ)."
  type        = list(string)
}

variable "private_app_subnet_cidrs" {
  description = "Private application subnet CIDRs (one per AZ)."
  type        = list(string)
}

variable "private_data_subnet_cidrs" {
  description = "Private data subnet CIDRs (one per AZ)."
  type        = list(string)
}

variable "interface_endpoints" {
  description = "Interface VPC endpoint services to create."
  type        = list(string)
  default     = ["ecr.api", "ecr.dkr", "logs", "secretsmanager", "kms", "ssm"]
}

variable "tags" {
  description = "Common tags."
  type        = map(string)
  default     = {}
}
