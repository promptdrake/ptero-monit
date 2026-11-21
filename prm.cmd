@echo off
setlocal
if exist "%~dp0dist\cli.js" (
  node "%~dp0dist\cli.js" %*
) else (
  pushd "%~dp0"
  npx tsx "src\cli.ts" %*
  popd
)
endlocal
