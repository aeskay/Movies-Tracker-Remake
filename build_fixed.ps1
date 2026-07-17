$desktop = "C:\Users\Samuel Alalade\Desktop"
$tempDir = "$desktop\MovieTrackerBuildTemp"

Write-Host "Copying to temp folder..."
robocopy ".\" "$tempDir" /MIR /XD .git > $null

Write-Host "Starting build..."
$env:JAVA_HOME = "C:\Program Files\Android\Android Studio\jbr"
Push-Location "$tempDir\android"
.\gradlew assembleRelease bundleRelease
Pop-Location

Write-Host "Searching for outputs..."
$aab = Get-ChildItem -Path "$tempDir" -Recurse -Filter "*.aab" | Select-Object -First 1
$apk = Get-ChildItem -Path "$tempDir" -Recurse -Filter "*-release*.apk" | Select-Object -First 1

if ($aab) {
    Copy-Item $aab.FullName -Destination "$desktop\MovieTracker-Release.aab" -Force
    Write-Host "Copied AAB to Desktop! Found at: $($aab.FullName)"
} else {
    Write-Host "No AAB found!"
}

if ($apk) {
    Copy-Item $apk.FullName -Destination "$desktop\MovieTracker-Release.apk" -Force
    Write-Host "Copied APK to Desktop! Found at: $($apk.FullName)"
} else {
    Write-Host "No APK found!"
}

if ($aab -and $apk) {
    Write-Host "Cleaning up temp folder..."
    Remove-Item -Path "$tempDir" -Recurse -Force
} else {
    Write-Host "Didn't find outputs, leaving temp folder for debugging."
}
Write-Host "Done!"
