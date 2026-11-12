variable "name" {
  description = "Name prefix for data resources."
  type        = string
}

variable "private_data_subnet_ids" {
  description = "Private data subnet IDs for RDS."
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "Security group allowing Postgres from api/agent."
  type        = string
}

variable "db_name" {
  description = "Postgres database name."
  type        = string
  default     = "triplanner"
}

variable "db_username" {
  description = "Postgres master username."
  type        = string
  default     = "triplanner"
}

variable "instance_class" {
  description = "RDS instance class. Single-AZ for the demo."
  type        = string
  default     = "db.t4g.micro"
}

variable "allocated_storage" {
  description = "Initial RDS storage in GB."
  type        = number
  default     = 20
}

variable "engine_version" {
  description = "Postgres major/minor version."
  type        = string
  default     = "16"
}

variable "tags" {
  description = "Common tags."
  type        = map(string)
  default     = {}
}
