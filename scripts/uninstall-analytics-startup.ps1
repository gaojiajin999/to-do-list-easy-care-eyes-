$ErrorActionPreference = 'Stop'

$taskNames = @(
  'TodoReminderBackgroundServices',
  'TodoReminderFrontendServer',
  'TodoReminderAnalyticsServer'
)

foreach ($taskName in $taskNames) {
  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

  if (-not $task) {
    Write-Host "Scheduled task not found: $taskName"
    continue
  }

  Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false

  Write-Host "Removed scheduled task: $taskName"
}
