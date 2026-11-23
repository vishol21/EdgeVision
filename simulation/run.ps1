param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('cloud', 'edge', 'both')]
    [string]$Scenario,

    [Parameter(Mandatory = $false)]
    [string]$Profile,

    [Parameter(Mandatory = $false)]
    [ValidateRange(1, 10)]
    [int]$CameraCount = 5,

    [Parameter(Mandatory = $false)]
    [ValidatePattern('^[a-f0-9]{32}$')]
    [string]$WorkloadProfileId
)

$ErrorActionPreference = 'Stop'
$simRoot = $PSScriptRoot
$vendorRoot = Join-Path $simRoot 'vendor/iFogSim'
$classes = Join-Path $simRoot 'target/classes'
$javaHome = $env:JAVA_HOME
if ([string]::IsNullOrWhiteSpace($javaHome) -or -not (Test-Path -LiteralPath (Join-Path $javaHome 'bin/java.exe'))) {
    $javaHome = Join-Path $env:LOCALAPPDATA 'EdgeVision/jdk-23.0.2+7'
}
$java = Join-Path $javaHome 'bin/java.exe'
if (-not (Test-Path -LiteralPath $java)) { throw 'JDK 23 or newer is required. Set JAVA_HOME or install the project JDK in the documented user location.' }
$profilePath = $null
if (-not [string]::IsNullOrWhiteSpace($Profile)) {
    $profilePath = (Resolve-Path -LiteralPath $Profile -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $profilePath -PathType Leaf)) { throw "Profile file not found: $Profile" }
}
if ($null -eq $profilePath -and [string]::IsNullOrWhiteSpace($WorkloadProfileId)) {
    $WorkloadProfileId = [guid]::NewGuid().ToString('N')
}

$entryClass = Join-Path $classes 'com/edgevision/simulation/EdgeVisionSimulation.class'
$needsBuild = -not (Test-Path -LiteralPath $entryClass)
if (-not $needsBuild) {
    $builtAt = (Get-Item -LiteralPath $entryClass).LastWriteTimeUtc
    $newerSources = @(Get-ChildItem -LiteralPath (Join-Path $simRoot 'src/main/java') -Filter '*.java' -File -Recurse |
        Where-Object { $_.LastWriteTimeUtc -gt $builtAt })
    $needsBuild = $newerSources.Count -gt 0
}
if ($needsBuild) {
    & (Join-Path $simRoot 'build.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Simulation build failed.' }
}

$jars = Join-Path $vendorRoot 'jars'
$classpath = "$classes;$jars/*;$(Join-Path $jars 'commons-math3-3.5/*')"
$scenarios = if ($Scenario -eq 'both') { @('cloud', 'edge') } else { @($Scenario) }
$projectRoot = Split-Path -Parent $simRoot
$resultsDir = Join-Path $projectRoot 'results'
New-Item -ItemType Directory -Path $resultsDir -Force | Out-Null

foreach ($currentScenario in $scenarios) {
    if ($null -eq $profilePath) {
        $output = & $java -cp $classpath com.edgevision.simulation.EdgeVisionSimulation $currentScenario $CameraCount $WorkloadProfileId 2>&1
    } else {
        $output = & $java -cp $classpath com.edgevision.simulation.EdgeVisionSimulation $currentScenario $profilePath 2>&1
    }
    $exitCode = $LASTEXITCODE
    $output | ForEach-Object { Write-Output $_ }
    if ($exitCode -ne 0) { throw "Simulation '$currentScenario' failed with exit code $exitCode; no result file was written." }

    $resultLine = $output | Where-Object { $_ -is [string] -and $_.StartsWith('RESULT_JSON:') } | Select-Object -Last 1
    if (-not $resultLine) { throw "Simulation '$currentScenario' completed without a RESULT_JSON record; no result file was written." }
    $json = $resultLine.Substring('RESULT_JSON:'.Length)
    try { $record = $json | ConvertFrom-Json -ErrorAction Stop }
    catch { throw "Simulation '$currentScenario' returned invalid JSON; no result file was written. $($_.Exception.Message)" }
    if ($record.scenario -ne $currentScenario -or $null -eq $record.metrics) {
        throw "Simulation '$currentScenario' returned an invalid result record; no result file was written."
    }

    if ($null -eq $profilePath) {
        $resultPath = Join-Path $resultsDir "$currentScenario.json"
    } else {
        $jobId = [string]$record.workloadProfile.jobId
        if ($jobId -notmatch '^[a-f0-9]{32}$' -or $null -eq $record.workloadProfile) {
            throw 'Profile simulation output did not include a valid workload profile identity; no result file was written.'
        }
        $profileFolder = if ($record.workloadProfile.type -eq 'multi_video') { 'video_batches' } else { 'video_workloads' }
        $profileResultsDir = Join-Path (Join-Path $resultsDir $profileFolder) $jobId
        New-Item -ItemType Directory -Path $profileResultsDir -Force | Out-Null
        $resultPath = Join-Path $profileResultsDir "$currentScenario.json"
    }

    [System.IO.File]::WriteAllText($resultPath, ($record | ConvertTo-Json -Depth 12) + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
    Write-Output "Saved actual simulation results to $resultPath"
}
