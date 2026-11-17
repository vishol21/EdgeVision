$ErrorActionPreference = 'Stop'

$simRoot = $PSScriptRoot
$vendorRoot = Join-Path $simRoot 'vendor/iFogSim'
$vendorSource = Join-Path $vendorRoot 'src'
$projectSource = Join-Path $simRoot 'src/main/java'
$entryPoint = Join-Path $projectSource 'com/edgevision/simulation/EdgeVisionSimulation.java'
$outputDir = Join-Path $simRoot 'target/classes'

if (-not (Test-Path -LiteralPath $entryPoint)) { throw "Simulation source not found: $entryPoint" }
if (-not (Test-Path -LiteralPath (Join-Path $vendorSource 'org/fog/entities/FogDevice.java'))) {
    throw "iFogSim source is missing. Expected it at $vendorRoot"
}
$javaHome = $env:JAVA_HOME
if ([string]::IsNullOrWhiteSpace($javaHome) -or -not (Test-Path -LiteralPath (Join-Path $javaHome 'bin/javac.exe'))) {
    $javaHome = Join-Path $env:LOCALAPPDATA 'EdgeVision/jdk-23.0.2+7'
}
$javac = Join-Path $javaHome 'bin/javac.exe'
if (-not (Test-Path -LiteralPath $javac)) { throw 'JDK 23 or newer is required. Set JAVA_HOME or install the project JDK in the documented user location.' }

$jars = Join-Path $vendorRoot 'jars'
$classpath = "$jars/*;$(Join-Path $jars 'commons-math3-3.5/*')"
$sourcepath = "$vendorSource;$projectSource"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

Write-Host 'Compiling EdgeVision against the pinned iFogSim source and bundled JARs...'
& $javac --release 23 -encoding UTF-8 -sourcepath $sourcepath -classpath $classpath -d $outputDir $entryPoint
if ($LASTEXITCODE -ne 0) { throw "javac failed with exit code $LASTEXITCODE" }
Write-Host "Compilation succeeded. Classes are in $outputDir"
