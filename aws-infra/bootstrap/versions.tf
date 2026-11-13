terraform {
  required_version = ">= 1.10.0"

  # Bootstrap state lives in the bucket this configuration creates. The first
  # apply runs on local state; run `terraform init -migrate-state` afterwards so
  # the laptop is not the only copy. See README.md.
  backend "s3" {
    bucket       = "triplanner-tfstate-484826611314"
    key          = "bootstrap/terraform.tfstate"
    region       = "us-east-1"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0, < 7.0"
    }
  }
}

provider "aws" {
  region = var.region
}
