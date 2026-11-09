$ErrorActionPreference = 'Stop'
$toolRoot = Join-Path $PSScriptRoot '../.android-tools'
New-Item -ItemType Directory -Force -Path $toolRoot | Out-Null
$toolRoot = (Resolve-Path $toolRoot).Path
function Get-VerifiedArchive($Url, $Path, $Hash) {
  if (!(Test-Path -LiteralPath $Path)) {
    & curl.exe --fail --location --retry 3 --output $Path $Url
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
  }
  if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Hash) { throw "Checksum mismatch: $Path" }
}
if (!(Test-Path "$toolRoot/jdk")) {
  $jdkRelease = Invoke-RestMethod 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse'
  $jdkPackage = $jdkRelease[0].binary.package
  Get-VerifiedArchive $jdkPackage.link "$toolRoot/jdk.zip" $jdkPackage.checksum
  Expand-Archive -LiteralPath "$toolRoot/jdk.zip" -DestinationPath "$toolRoot/jdk-unpacked" -Force
  $jdkDirectory = Get-ChildItem "$toolRoot/jdk-unpacked" -Directory | Select-Object -First 1
  Move-Item -LiteralPath $jdkDirectory.FullName -Destination "$toolRoot/jdk"
}
$env:JAVA_HOME = "$toolRoot/jdk"
$env:ANDROID_HOME = "$toolRoot/sdk"
if (!(Test-Path "$env:ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat")) {
  Get-VerifiedArchive 'https://dl.google.com/android/repository/commandlinetools-win-15859902_latest.zip' "$toolRoot/sdk-tools.zip" '90ae805d20434428bffcb699c290860f19bb5f66a67e6b330067e3de801fb04a'
  Expand-Archive -LiteralPath "$toolRoot/sdk-tools.zip" -DestinationPath "$toolRoot/sdk-unpacked" -Force
  New-Item -ItemType Directory -Force -Path "$env:ANDROID_HOME/cmdline-tools" | Out-Null
  Move-Item -LiteralPath "$toolRoot/sdk-unpacked/cmdline-tools" -Destination "$env:ANDROID_HOME/cmdline-tools/latest"
}
1..100 | ForEach-Object { 'y' } | & "$env:ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" --licenses
& "$env:ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager.bat" 'platform-tools' 'platforms;android-36' 'build-tools;35.0.0' 'build-tools;36.0.0'
if ($LASTEXITCODE -ne 0) { throw 'SDK installation failed' }
$sdkProperty = $env:ANDROID_HOME.Replace('\', '/').Replace(':', '\:')
Set-Content -LiteralPath "$PSScriptRoot/../android/local.properties" -Value "sdk.dir=$sdkProperty" -Encoding ascii
Write-Output 'Android build tools are ready in .android-tools (no global environment changes).'
