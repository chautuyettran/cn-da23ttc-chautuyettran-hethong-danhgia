$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$templatePath = Join-Path $projectRoot '.env.example'
$envPath = Join-Path $projectRoot '.env'

function New-RandomHex([int]$byteCount) {
  $bytes = New-Object byte[] $byteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
}

$secretValues = @{
  JWT_SECRET = New-RandomHex 32
  MONGO_ROOT_USERNAME = "root_$(New-RandomHex 8)"
  MONGO_ROOT_PASSWORD = New-RandomHex 32
  MONGO_APP_USERNAME = "app_$(New-RandomHex 8)"
  MONGO_APP_PASSWORD = New-RandomHex 32
  MONGO_REPLICA_KEY = New-RandomHex 32
}

$content = if (Test-Path $envPath) {
  Get-Content -LiteralPath $envPath -Raw
} else {
  Get-Content -LiteralPath $templatePath -Raw
}

$generated = [System.Collections.Generic.List[string]]::new()
foreach ($name in $secretValues.Keys) {
  $pattern = "(?m)^$name=(.*)$"
  $match = [Regex]::Match($content, $pattern)
  $needsValue = -not $match.Success -or
    [string]::IsNullOrWhiteSpace($match.Groups[1].Value) -or
    $match.Groups[1].Value.Trim() -match '^(?i:generated-by-scripts|replace-|change-me|changeme|your-)'
  if (-not $needsValue) {
    continue
  }

  $replacement = "$name=$($secretValues[$name])"
  if ($match.Success) {
    $content = [Regex]::Replace($content, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{
    param($match)
    return $replacement
    })
  } else {
    $content = $content.TrimEnd() + "`r`n$replacement`r`n"
  }
  $generated.Add($name)
}

if ($generated.Count -gt 0 -or -not (Test-Path $envPath)) {
  Set-Content -LiteralPath $envPath -Value $content -Encoding ASCII
  Write-Output 'Generated values for missing credentials only. Existing non-empty values were preserved; keep .env private.'
} else {
  Write-Output 'All required credentials are already set. The existing .env was left unchanged; continue with docker compose config --quiet.'
}
