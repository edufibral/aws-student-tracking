variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Project name prefix"
  type        = string
  default     = "student-tracker"
}

variable "stage_name" {
  description = "API stage name"
  type        = string
  default     = "prod"
}
