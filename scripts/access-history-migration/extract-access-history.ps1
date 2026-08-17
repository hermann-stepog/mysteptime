[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [string]$DatabasePath = "C:\dev\backups\access\BDStep B_be.accdb",

    [Parameter(Mandatory = $false)]
    [string]$OutputDirectory,

    [Parameter(Mandatory = $false)]
    [Security.SecureString]$Password,

    [switch]$AllTables,
    [switch]$SkipSourceHash
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $OutputDirectory) {
    $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $OutputDirectory = Join-Path $projectRoot "private\access-history\$stamp"
}

$DatabasePath = (Resolve-Path -LiteralPath $DatabasePath).Path
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$tablesDirectory = Join-Path $OutputDirectory "tables"
[void](New-Item -ItemType Directory -Path $tablesDirectory -Force)

$relevantTables = @(
    "dbo_Funcionario",
    "Tbl_Funcionarios",
    "Tbl_JobList",
    "Tbl_Horas_Semanal",
    "Tbl_Horas_Semanal2",
    "dbo_Tbl_Jornada",
    "Tbl_Evento",
    "Tbl_Funcao",
    "Tbl_Embarcacao",
    "Tbl_Projeto",
    "Tbl_Cliente",
    "Tbl_Empresas",
    "Tbl_Semanas",
    "Tbl_StatusEmbarque",
    "Tbl_Restricao_Funcionario"
)

# Esses dois campos gigantes não participam do histórico operacional solicitado. A exclusão
# fica registrada no manifest e evita transformar a extração em outra cópia de quase 2 GB.
$excludedColumns = @{
    "Tbl_JobList"     = @("Documentos")
    "Tbl_Funcionarios" = @("Foto")
    # O driver ODBC interpreta o "?" como placeholder mesmo entre colchetes e devolve
    # ERROR 07002. O valor é apenas um flag de medição e não participa do histórico.
    "Tbl_Horas_Semanal" = @("Medido?")
}

function Quote-Identifier([string]$value) {
    return "[" + $value.Replace("]", "]]") + "]"
}

function Safe-FileName([string]$value) {
    return ($value -replace '[<>:"/\\|?*]', '_') + ".csv"
}

function Csv-Cell($value) {
    if ($null -eq $value -or $value -eq [DBNull]::Value) { return "" }
    if ($value -is [DateTime]) {
        $text = $value.ToString("yyyy-MM-ddTHH:mm:ss", [Globalization.CultureInfo]::InvariantCulture)
    }
    elseif ($value -is [byte[]]) {
        $text = [Convert]::ToBase64String($value)
    }
    else {
        $text = [Convert]::ToString($value, [Globalization.CultureInfo]::InvariantCulture)
    }
    if ($text.Contains('"') -or $text.Contains(';') -or $text.Contains("`r") -or $text.Contains("`n")) {
        return '"' + $text.Replace('"', '""') + '"'
    }
    return $text
}

function Export-QueryToCsv {
    param(
        [Data.Odbc.OdbcConnection]$Connection,
        [string]$Sql,
        [string]$Destination
    )

    $command = $Connection.CreateCommand()
    $command.CommandText = $Sql
    $command.CommandTimeout = 0
    $reader = $null
    $writer = $null
    $rows = 0L
    try {
        $reader = $command.ExecuteReader()
        $encoding = New-Object Text.UTF8Encoding($true)
        $writer = New-Object IO.StreamWriter($Destination, $false, $encoding)
        $headers = for ($i = 0; $i -lt $reader.FieldCount; $i++) { Csv-Cell $reader.GetName($i) }
        $writer.WriteLine(($headers -join ';'))
        while ($reader.Read()) {
            $cells = for ($i = 0; $i -lt $reader.FieldCount; $i++) { Csv-Cell $reader.GetValue($i) }
            $writer.WriteLine(($cells -join ';'))
            $rows++
        }
        return $rows
    }
    finally {
        if ($writer) { $writer.Dispose() }
        if ($reader) { $reader.Dispose() }
        $command.Dispose()
    }
}

if (-not $Password) {
    $Password = Read-Host "Senha do banco Access" -AsSecureString
}

$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
$plainPassword = $null
$connection = $null
try {
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $connectionString = "Driver={Microsoft Access Driver (*.mdb, *.accdb)};Dbq=$DatabasePath;Pwd=$plainPassword;ReadOnly=1;"
    $connection = New-Object Data.Odbc.OdbcConnection($connectionString)
    $connection.Open()
}
finally {
    if ($passwordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    }
    $plainPassword = $null
    $Password = $null
}

try {
    $tableSchema = @(
        $connection.GetSchema("Tables") |
            Where-Object { $_.TABLE_NAME -notmatch '^MSys' } |
            Sort-Object TABLE_NAME -Unique
    )
    $columnSchema = @(
        $connection.GetSchema("Columns") |
            Where-Object { $_.TABLE_NAME -notmatch '^MSys' } |
            Sort-Object TABLE_NAME, ORDINAL_POSITION
    )

    $tableSchema | Select-Object TABLE_NAME, TABLE_TYPE | Export-Csv -LiteralPath (Join-Path $OutputDirectory "access_tables.csv") -NoTypeInformation -Delimiter ';' -Encoding UTF8
    $columnSchema | Select-Object TABLE_NAME, ORDINAL_POSITION, COLUMN_NAME, TYPE_NAME, COLUMN_SIZE, NULLABLE | Export-Csv -LiteralPath (Join-Path $OutputDirectory "access_columns.csv") -NoTypeInformation -Delimiter ';' -Encoding UTF8

    $counts = foreach ($table in $tableSchema) {
        $name = [string]$table.TABLE_NAME
        $command = $connection.CreateCommand()
        $command.CommandText = "SELECT COUNT(*) FROM $(Quote-Identifier $name)"
        $command.CommandTimeout = 0
        try {
            [PSCustomObject]@{ TableName = $name; TableType = $table.TABLE_TYPE; RowCount = [int64]$command.ExecuteScalar(); Error = $null }
        }
        catch {
            [PSCustomObject]@{ TableName = $name; TableType = $table.TABLE_TYPE; RowCount = $null; Error = $_.Exception.Message }
        }
        finally {
            $command.Dispose()
        }
    }
    $counts | Export-Csv -LiteralPath (Join-Path $OutputDirectory "access_table_counts.csv") -NoTypeInformation -Delimiter ';' -Encoding UTF8

    $availableNames = @($tableSchema | Select-Object -ExpandProperty TABLE_NAME)
    $selectedNames = if ($AllTables) { $availableNames } else { @($relevantTables | Where-Object { $availableNames -contains $_ }) }
    $exports = foreach ($tableName in $selectedNames) {
        $columns = @(
            $columnSchema |
                Where-Object { $_.TABLE_NAME -eq $tableName } |
                Select-Object -ExpandProperty COLUMN_NAME
        )
        $excluded = @($excludedColumns[$tableName])
        $selectedColumns = @($columns | Where-Object { $excluded -notcontains $_ })
        if (-not $selectedColumns.Count) { continue }

        $fileName = Safe-FileName $tableName
        $destination = Join-Path $tablesDirectory $fileName
        $selectList = ($selectedColumns | ForEach-Object { Quote-Identifier $_ }) -join ', '
        Write-Host "Exportando $tableName..."
        $rowCount = Export-QueryToCsv -Connection $connection -Sql "SELECT $selectList FROM $(Quote-Identifier $tableName)" -Destination $destination
        $fileHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
        [PSCustomObject]@{
            TableName       = $tableName
            FileName        = $fileName
            RowCount        = $rowCount
            Sha256          = $fileHash
            ExcludedColumns = ($excluded -join ',')
        }
    }
    $exports | Export-Csv -LiteralPath (Join-Path $OutputDirectory "exported_tables.csv") -NoTypeInformation -Delimiter ';' -Encoding UTF8

    $sourceHash = if ($SkipSourceHash) { $null } else { (Get-FileHash -LiteralPath $DatabasePath -Algorithm SHA256).Hash.ToLowerInvariant() }
    $sourceInfo = Get-Item -LiteralPath $DatabasePath
    $manifest = [ordered]@{
        formatVersion       = 1
        extractedAtUtc      = (Get-Date).ToUniversalTime().ToString("o")
        readOnly            = $true
        sourcePath          = $DatabasePath
        sourceSizeBytes     = $sourceInfo.Length
        sourceModifiedAtUtc = $sourceInfo.LastWriteTimeUtc.ToString("o")
        sourceSha256        = $sourceHash
        exportedTables      = @($exports)
        excludedPayloads    = @(
            @{ table = "Tbl_JobList"; column = "Documentos"; reason = "LONGCHAR fora do escopo operacional" },
            @{ table = "Tbl_Funcionarios"; column = "Foto"; reason = "LONGCHAR/imagem fora do escopo operacional" },
            @{ table = "Tbl_Horas_Semanal"; column = "Medido?"; reason = "flag de medição; '?' é tratado como parâmetro pelo ODBC" }
        )
    }
    [IO.File]::WriteAllText((Join-Path $OutputDirectory "manifest.json"), ($manifest | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))

    Write-Host "Extração somente-leitura concluída: $OutputDirectory"
}
finally {
    if ($connection -and $connection.State -ne [Data.ConnectionState]::Closed) { $connection.Close() }
    if ($connection) { $connection.Dispose() }
}
