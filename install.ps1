# Create a new product workstation from the ai-product-studio template.
# 从模板创建一个新的产品工位。
#
#   .\install.ps1 install ..\宝宝喂养 --name "宝宝喂养"
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Chee-0806/ai-product-studio/main/install.ps1))) install ..\宝宝喂养 --name "宝宝喂养"
#
# Options (same as install.sh): --name, --git, --with-pack <pack>, --ref <ref>

$c = Get-Content .\install.ps1 -Raw -Encoding UTF8
[IO.File]::WriteAllText("$PWD\install.ps1", $c, (New-Object Text.UTF8Encoding $true))

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}

$Repo = if ($env:PRODUCT_STUDIO_REPO) { $env:PRODUCT_STUDIO_REPO } else { 'Chee-0806/ai-product-studio' }
$Ref  = if ($env:PRODUCT_STUDIO_REF)  { $env:PRODUCT_STUDIO_REF }  else { 'main' }

function Show-Usage {
@'
用法：
  .\install.ps1 install <目录> [--name "产品名"] [--git] [--with-pack pm-methods] [--ref <分支/标签>]

示例：
  .\install.ps1 install ..\宝宝喂养 --name "宝宝喂养"

要求：Node.js >= 18。
'@ | Write-Host
# 用法 = Usage | 目录 = directory | 产品名 = product name | 分支/标签 = branch/tag
# 示例 = Example | 要求 = Requirement
}

function Fail($msg) {
    [Console]::Error.WriteLine("✖ $msg")
    exit 1
}

$rest = @($args)
if ($rest.Count -eq 0) { Show-Usage; exit 1 }
if ($rest[0] -eq 'install') { $rest = @($rest | Select-Object -Skip 1) }
if ($rest.Count -gt 0 -and ($rest[0] -eq '--help' -or $rest[0] -eq '-h')) { Show-Usage; exit 0 }
if ($rest.Count -eq 0 -or [string]::IsNullOrEmpty($rest[0])) { Show-Usage; exit 1 }
$TargetDir = $rest[0]
$rest = @($rest | Select-Object -Skip 1)

$passArgs = @()
for ($i = 0; $i -lt $rest.Count; $i++) {
    if ($rest[$i] -eq '--ref') {
        if ($i + 1 -ge $rest.Count -or [string]::IsNullOrEmpty($rest[$i + 1])) { Fail '--ref 缺少值' }  # "--ref is missing a value"
        $Ref = $rest[$i + 1]
        $i++
    } else {
        $passArgs += $rest[$i]
    }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    # "Node.js not found. Please install Node.js >= 18: https://nodejs.org (or run: winget install OpenJS.NodeJS.LTS)"
    Fail '没有找到 Node.js。请先安装 Node.js >= 18：https://nodejs.org（或运行：winget install OpenJS.NodeJS.LTS）'
}
$nodeMajor = [int](& node -p "process.versions.node.split('.')[0]")
# "Node.js version too old (current X), need >= 18."
if ($nodeMajor -lt 18) { Fail "Node.js 版本过低（当前 $(& node -v)），需要 >= 18。" }

# Locate template: local checkout, otherwise download
$TemplateDir = $null
$TmpDir = $null
$scriptDir = $PSScriptRoot
if (-not $scriptDir -and $MyInvocation.MyCommand.Path) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if ($scriptDir -and
    (Test-Path (Join-Path $scriptDir 'scripts\new.mjs')) -and
    (Test-Path (Join-Path $scriptDir 'skills') -PathType Container)) {
    $TemplateDir = $scriptDir
}

try {
    if (-not $TemplateDir) {
        $TmpDir = Join-Path ([IO.Path]::GetTempPath()) ('product-studio.' + [guid]::NewGuid().ToString('N').Substring(0, 8))
        New-Item -ItemType Directory -Path $TmpDir | Out-Null
        $url = "https://codeload.github.com/$Repo/tar.gz/$Ref"
        $dest = Join-Path $TmpDir 'src'

        if (Get-Command tar -ErrorAction SilentlyContinue) {
            try {
                [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
                $tgz = Join-Path $TmpDir 'src.tar.gz'
                Invoke-WebRequest -Uri $url -OutFile $tgz -UseBasicParsing
                New-Item -ItemType Directory -Path $dest | Out-Null
                & tar -xzf $tgz -C $dest --strip-components=1
                if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
            } catch {
                Fail "下载模板失败：$url"   # "Failed to download template: <url>"
            }
            $TemplateDir = $dest
        }
        elseif (Get-Command git -ErrorAction SilentlyContinue) {
            & git clone --depth 1 --branch $Ref "https://github.com/$Repo.git" $dest *> $null
            if ($LASTEXITCODE -ne 0) { Fail "克隆模板失败：https://github.com/$Repo" }  # "Failed to clone template"
            $TemplateDir = $dest
        }
        else {
            Fail '需要 tar 或 git 来下载模板。'   # "tar or git is required to download the template."
        }
    }

    # "Template directory not found"
    if (-not $TemplateDir) { Fail "没有找到模板目录（scriptDir=[$scriptDir]）。" }
    & node (Join-Path $TemplateDir 'scripts\new.mjs') $TargetDir @passArgs
    exit $LASTEXITCODE
}
finally {
    if ($TmpDir) { Remove-Item $TmpDir -Recurse -Force -ErrorAction SilentlyContinue }
}

