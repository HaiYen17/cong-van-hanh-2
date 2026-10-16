$ErrorActionPreference = "Stop"

$gcloud = Get-Command gcloud -ErrorAction Stop
$scopes = @(
  "https://www.googleapis.com/auth/cloud-platform"
  "https://www.googleapis.com/auth/spreadsheets.readonly"
  "https://www.googleapis.com/auth/drive.readonly"
) -join ","

& $gcloud.Source auth application-default login "--scopes=$scopes"
