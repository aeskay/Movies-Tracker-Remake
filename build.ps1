 = "C:\Users\Samuel Alalade\Desktop"
 = "\MovieTrackerBuildTemp"

Write-Host "Copying to temp folder..."
robocopy ".\" "" /MIR /XD .git > 

Write-Host "Starting build..."
 = "C:\Program Files\Android\Android Studio\jbr"
Push-Location "\android"
.\gradlew assembleRelease bundleRelease

Write-Host "Searching for outputs..."
 = Get-ChildItem -Path ".\app\build\outputs" -Recurse -Filter "*.aab" | Select-Object -First 1
 = Get-ChildItem -Path ".\app\build\outputs" -Recurse -Filter "*-release*.apk" | Select-Object -First 1

if () {
    Copy-Item .FullName -Destination "\MovieTracker-Release.aab" -Force
    Write-Host "Copied AAB!"
} else {
    Write-Host "No AAB found!"
}

if () {
    Copy-Item .FullName -Destination "\MovieTracker-Release.apk" -Force
    Write-Host "Copied APK!"
} else {
    Write-Host "No APK found!"
}

Pop-Location
Write-Host "Cleaning up temp folder..."
Remove-Item -Path "" -Recurse -Force
Write-Host "Done!"
