$ErrorActionPreference = 'Stop'
$env:IDF_PATH = 'E:\esp\v6.0.3\esp-idf'
$env:IDF_TOOLS_PATH = 'C:\Espressif\tools'
$env:IDF_PYTHON_ENV_PATH = 'C:\Espressif\tools\python\v6.0.3\venv'
$env:ESP_IDF_VERSION = '6.0.3'
$env:IDF_CCACHE_ENABLE = '0'
$taskToolRoots = @('cmake','ninja','xtensa-esp-elf','esp32ulp-elf','riscv32-esp-elf')
foreach ($taskToolRoot in $taskToolRoots) {
  $taskBins = Get-ChildItem -LiteralPath (Join-Path $env:IDF_TOOLS_PATH $taskToolRoot) -Directory -Recurse | Where-Object { $_.Name -eq 'bin' }
  foreach ($taskBin in $taskBins) { $env:PATH = $taskBin.FullName + ';' + $env:PATH }
}
$env:PATH = 'C:\Espressif\tools\ninja\1.12.1;C:\Espressif\tools\python\v6.0.3\venv\Scripts;' + $env:PATH
