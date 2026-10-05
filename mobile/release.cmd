@echo off
rem Damda Galaxy app: build the signed release APK (see docs/other.md section 8).
rem The signing key lives outside the repo: %USERPROFILE%\damda-keys\damda-release.jks (back it up, never commit it).
rem First time only:  release.cmd key   -> create the key (password typed here, never saved)
rem Every release:    release.cmd       -> mobile\dist\Damda-Galaxy.apk (asks the password when signing)
setlocal
set "JAVA_HOME=C:\Program Files\Android\Android Studio\jbr"
set "HERE=%~dp0"
set "KEYDIR=%USERPROFILE%\damda-keys"
set "KEY=%KEYDIR%\damda-release.jks"
set "BT=%LOCALAPPDATA%\Android\Sdk\build-tools\36.1.0"
set "UNSIGNED=%HERE%android\app\build\outputs\apk\release\app-release-unsigned.apk"
set "OUT=%HERE%dist\Damda-Galaxy.apk"

if /i "%~1"=="key" goto makekey

if not exist "%KEY%" (
  echo [!] No signing key. Run first:  release.cmd key
  exit /b 1
)
set DAMDA_DEV=
pushd "%HERE%"
call npx cap sync android
if errorlevel 1 goto fail
call "%HERE%android\gradlew.bat" -p "%HERE%android" assembleRelease
if errorlevel 1 goto fail
popd
if not exist "%HERE%dist" mkdir "%HERE%dist"
echo.
echo === Type the signing key password ===
call "%BT%\apksigner.bat" sign --ks "%KEY%" --ks-key-alias damda --out "%OUT%" "%UNSIGNED%"
if errorlevel 1 exit /b 1
call "%BT%\apksigner.bat" verify --print-certs "%OUT%" | findstr /i "SHA-1"
echo.
echo [OK] %OUT%
exit /b 0

:makekey
if exist "%KEY%" (
  echo [!] Key already exists: %KEY%
  exit /b 1
)
if not exist "%KEYDIR%" mkdir "%KEYDIR%"
"%JAVA_HOME%\bin\keytool.exe" -genkeypair -v -keystore "%KEY%" -storetype PKCS12 -alias damda -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Damda, O=Damda"
if errorlevel 1 exit /b 1
echo.
echo === SHA-1 for the Google Console Android client (type the password again) ===
"%JAVA_HOME%\bin\keytool.exe" -list -v -keystore "%KEY%" -alias damda | findstr /c:"SHA1:"
exit /b 0

:fail
popd
echo [!] Build failed
exit /b 1
