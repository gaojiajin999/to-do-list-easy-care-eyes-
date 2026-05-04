$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction Stop
$nodePath = $nodeCommand.Source
$taskName = 'TodoReminderBackgroundServices'
$launcherScript = Join-Path $projectDir 'scripts\start-background-services.mjs'
$legacyTaskNames = @(
  'TodoReminderFrontendServer',
  'TodoReminderAnalyticsServer'
)

if (-not (Test-Path -LiteralPath $projectDir)) {
  throw "Project directory not found: $projectDir"
}

if (-not (Test-Path -LiteralPath $nodePath)) {
  throw "node.exe not found: $nodePath"
}

if (-not (Test-Path -LiteralPath $launcherScript)) {
  throw "Startup launcher not found: $launcherScript"
}

foreach ($legacyTaskName in $legacyTaskNames) {
  $legacyTask = Get-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
  if ($legacyTask) {
    Stop-ScheduledTask -TaskName $legacyTaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false
    Write-Host "Removed legacy scheduled task: $legacyTaskName"
  }
}

$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1)

$action = New-ScheduledTaskAction `
  -Execute $nodePath `
  -Argument "`"$launcherScript`"" `
  -WorkingDirectory $projectDir

$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings

Register-ScheduledTask -TaskName $taskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

Write-Host "Installed and started scheduled task: $taskName"
Write-Host "Check: http://127.0.0.1:5173"
Write-Host "Check: http://127.0.0.1:8787/health"
