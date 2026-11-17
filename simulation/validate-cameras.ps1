param(
    [string]$OutputPath = (Join-Path $PSScriptRoot '../results/validation/camera-workloads.json')
)
$ErrorActionPreference = 'Stop'
$simRoot = $PSScriptRoot
& (Join-Path $simRoot 'build.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Production simulation build failed.' }
$javaHome = $env:JAVA_HOME
if ([string]::IsNullOrWhiteSpace($javaHome) -or -not (Test-Path -LiteralPath (Join-Path $javaHome 'bin/javac.exe'))) {
    $javaHome = Join-Path $env:LOCALAPPDATA 'EdgeVision/jdk-23.0.2+7'
}
$java = Join-Path $javaHome 'bin/java.exe'
$javac = Join-Path $javaHome 'bin/javac.exe'
$classes = Join-Path $simRoot 'target/classes'
$testClasses = Join-Path $simRoot 'target/test-classes'
$jars = Join-Path $simRoot 'vendor/iFogSim/jars'
$classpath = "$classes;$jars/*;$(Join-Path $jars 'commons-math3-3.5/*')"
New-Item -ItemType Directory -Path $testClasses -Force | Out-Null
& $javac --release 23 -encoding UTF-8 -cp $classpath -d $testClasses (Join-Path $simRoot 'tests/CameraWorkloadValidation.java')
if ($LASTEXITCODE -ne 0) { throw 'Camera validation harness compilation failed.' }

function Invoke-CameraValidation([string]$Mode, [int]$Count, [string]$Identity) {
    $output = & $java -cp "$testClasses;$classpath" com.edgevision.simulation.CameraWorkloadValidation $Mode $Count $Identity 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Camera validation failed ($Mode, $Count): $($output -join [Environment]::NewLine)" }
    $line = $output | Where-Object { $_ -is [string] -and $_.StartsWith('VALIDATION_JSON:') } | Select-Object -Last 1
    if (-not $line) { throw "Missing validation evidence ($Mode, $Count)." }
    return $line.Substring('VALIDATION_JSON:'.Length) | ConvertFrom-Json
}

$rows = @()
foreach ($count in @(1, 2, 3, 5, 6, 10)) {
    $identity = [guid]::NewGuid().ToString('N')
    $sources = Invoke-CameraValidation 'sources' $count $identity
    $cloud = Invoke-CameraValidation 'cloud' $count $identity
    $edge = Invoke-CameraValidation 'edge' $count $identity
    $rows += [ordered]@{ cameraCount = $count; sources = $sources; cloud = $cloud; edge = $edge }
    Write-Host "PASS $count cameras: $($cloud.actualEmittedTuples) emitted/processed tuples per scenario; actual sensors and 100 ms schedule verified."
}
$report = [ordered]@{
    schemaVersion = 1
    completedAt = [DateTime]::UtcNow.ToString('o')
    type = 'synthetic_virtual_camera_validation'
    simulatorRevision = '5f68d3947e450d8d2b4af42670be819206be68c9'
    method = 'Test-only factory inspection and captured simulation-clock emission trace; separate fresh JVM per source inspection or scenario.'
    limitation = 'Round-robin timing phases are inferred from the aggregate captured trace; the trace does not independently tag each emission with a source ID. Factory inspection verifies actual named Sensor entities separately. These are simulator checks, not hardware measurements.'
    cases = $rows
}
$destination = [IO.Path]::GetFullPath($OutputPath)
New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
[IO.File]::WriteAllText($destination, ($report | ConvertTo-Json -Depth 12) + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Host "Saved validation evidence to $destination"
